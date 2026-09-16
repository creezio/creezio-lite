#!/usr/bin/env node
// Pool commun de comptes Cursor pour le transport d’orchestration (.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs).
// Un seul coffre local par utilisateur (Windows DPAPI CurrentUser), un état partagé pool-state.json sous verrou exclusif et une décision
// déterministe au moment de chaque appel. Aucun daemon, aucune surveillance de crédit, aucune sonde automatique, aucun quota numérique supposé.
// Les secrets déchiffrés restent en mémoire ou dans le tube privé du déchiffreur : jamais argv, journal, dépôt, registre ni cloud.
import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

export class PoolError extends Error { constructor(code, message, extra = {}) { super(message); this.name = 'PoolError'; this.code = code; Object.assign(this, extra); } }

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isoNow = () => new Date().toISOString();
const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
export const FALLBACK_MODEL = 'grok-4.6';
export const composerPattern = /composer/i;
export const modelPoolStates = Object.freeze(['probe_passed_balance_unknown', 'exhaustion_reported', 'recheck_required', 'unavailable_plan']);
export const confirmedUnavailable = new Set(['exhaustion_reported', 'unavailable_plan']);
export const callKinds = Object.freeze(['models', 'create', 'run', 'agent', 'run_read']);
export const defaultRoutingPolicy = Object.freeze({ priorityAccountIds: [], preferredModel: 'claude-fable-5-1', fallbackModel: FALLBACK_MODEL, fallbackWhen: 'all_custom_accounts_confirmed_unavailable', reuseInactiveForStandard: true, requireStandardValidation: true, neverFallbackToComposer: true, preserveRunningMissions: true, standardProofMaxAgeHours: 24 });

// Signatures fournisseur observées, comparées strictement (statut, code, message exact). Tout autre motif reste « undetermined » : aucune inférence.
export const providerSignatures = Object.freeze([
  { classification: 'included_usage_exhausted', httpStatus: 429, providerCode: 'rate_limit_exceeded', message: "You've used all included Cloud Agent usage: Enable on-demand usage to continue using Cloud Agents" },
  { classification: 'plan_required', httpStatus: 403, providerCode: 'plan_required', message: 'Cloud Agent is not available for free users. Please upgrade to Pro.' },
  { classification: 'hard_limit_start_refused', httpStatus: 400, providerCode: 'usage_limit_exceeded', message: 'You need to increase your hard limit. Background Agent requires at least $2 remaining until your hard limit. Manage it at https://www.cursor.com/dashboard?tab=settings.' },
]);

// Emplacements : CURSOR_CREDENTIALS_FILE sinon %LOCALAPPDATA%/Creezio/cursor/credentials.json ; état et verrou dans le même dossier (un coffre par utilisateur, jamais par application).
export function credentialsPath(env = process.env) {
  const explicit = typeof env.CURSOR_CREDENTIALS_FILE === 'string' ? env.CURSOR_CREDENTIALS_FILE.trim() : '';
  if (explicit) return resolve(explicit);
  const local = typeof env.LOCALAPPDATA === 'string' ? env.LOCALAPPDATA.trim() : '';
  return local ? join(local, 'Creezio', 'cursor', 'credentials.json') : null;
}
export function poolPaths(credentialsFile) { const dir = dirname(credentialsFile); return { credentialsFile, stateFile: join(dir, 'pool-state.json'), lockFile: join(dir, 'pool-state.lock') }; }

// credentials.json {formatVersion:1, encryption:'windows-dpapi-current-user', createdAt, accounts:[{id, secretDpapi}]}. Les blobs ne sont jamais recopiés dans une erreur.
export function parseCredentials(raw) {
  if (!raw || typeof raw !== 'object' || raw.formatVersion !== 1) throw new PoolError('credentials_invalid', 'credentials.json : formatVersion 1 attendu.');
  if (raw.encryption !== 'windows-dpapi-current-user') throw new PoolError('credentials_invalid', 'credentials.json : encryption windows-dpapi-current-user attendu.');
  if (!Array.isArray(raw.accounts) || !raw.accounts.length || raw.accounts.length > 32) throw new PoolError('credentials_invalid', 'credentials.json : 1 à 32 comptes attendus.');
  const seen = new Set(); const accounts = [];
  for (const [index, account] of raw.accounts.entries()) {
    const id = account && typeof account === 'object' && typeof account.id === 'string' && idPattern.test(account.id) ? account.id : null;
    if (!id || seen.has(id)) throw new PoolError('credentials_invalid', `credentials.json : compte n°${index + 1} sans identifiant valide ou dupliqué.`);
    if (typeof account.secretDpapi !== 'string' || !/^[A-Za-z0-9+/]{16,16384}={0,2}$/.test(account.secretDpapi)) throw new PoolError('credentials_invalid', `credentials.json : compte ${id} sans blob DPAPI base64 valide.`);
    seen.add(id); accounts.push({ id, secretDpapi: account.secretDpapi });
  }
  return { formatVersion: 1, encryption: raw.encryption, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null, accounts };
}

// Déchiffrement DPAPI CurrentUser par PowerShell : blob en entrée standard, secret en sortie standard, rien sur la ligne de commande. Windows uniquement.
export async function dpapiUnprotectCurrentUser(secretDpapi, { platform = process.platform, spawnImpl = spawn, timeoutMs = 15_000 } = {}) {
  if (platform !== 'win32') throw new PoolError('dpapi_unavailable', 'Déchiffrement DPAPI disponible seulement sous Windows (session de l’utilisateur courant).');
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $blob=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $clear=[System.Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($clear))";
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const out = []; let failed = false;
    const fail = (code, message) => { if (failed) return; failed = true; clearTimeout(timer); reject(new PoolError(code, message)); };
    const timer = setTimeout(() => { child.kill(); fail('decrypt_failed', 'Déchiffrement DPAPI interrompu (délai).'); }, timeoutMs);
    child.on('error', () => fail('decrypt_failed', 'Déchiffreur DPAPI introuvable ou non exécutable.'));
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', () => {});
    child.on('close', code => { clearTimeout(timer); if (failed) return; if (code !== 0) return fail('decrypt_failed', 'Déchiffrement DPAPI refusé (autre utilisateur, blob altéré ou session différente).'); resolvePromise(Buffer.concat(out).toString('utf8')); });
    child.stdin.on('error', () => {});
    child.stdin.end(secretDpapi);
  });
}
function validKey(value) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 512 && !/[\s\x00-\x1f\x7f]/.test(value.trim()) ? value.trim() : null; }

// Coffre chargé : identifiants publics, secrets dans une fermeture ; déchiffrement à la demande du seul compte utilisé.
export async function loadCredentials({ file, raw, decrypt = dpapiUnprotectCurrentUser } = {}) {
  if (raw === undefined) {
    if (!file) throw new PoolError('credentials_missing', 'Aucun coffre de comptes configuré.');
    try { raw = await readFile(file, 'utf8'); } catch (error) { throw new PoolError(error.code === 'ENOENT' ? 'credentials_missing' : 'credentials_unreadable', `Coffre de comptes illisible : ${file}`); }
  }
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new PoolError('credentials_invalid', 'credentials.json : JSON invalide.'); }
  const credentials = parseCredentials(parsed);
  const blobs = new Map(credentials.accounts.map(a => [a.id, a.secretDpapi]));
  const keys = new Map();
  return {
    file: file ?? null, createdAt: credentials.createdAt, ids: credentials.accounts.map(a => a.id),
    async keyFor(accountId) {
      if (!blobs.has(accountId)) throw new PoolError('account_unknown', `Compte ${String(accountId).slice(0, 64)} absent du coffre.`, { accountId });
      if (keys.has(accountId)) return keys.get(accountId);
      let clear; try { clear = await decrypt(blobs.get(accountId)); } catch (error) { throw error instanceof PoolError ? Object.assign(error, { accountId }) : new PoolError('decrypt_failed', `Déchiffrement impossible pour le compte ${accountId}.`, { accountId }); }
      const key = validKey(clear);
      if (!key) throw new PoolError('credential_invalid', `Secret déchiffré invalide pour le compte ${accountId}.`, { accountId });
      keys.set(accountId, key); return key;
    },
  };
}

// État partagé : formatVersion 1, revision, updatedAt, activeAccountId, order, accounts[{id,status,inactiveReason,inactiveAt,evidence,modelPools:{custom,standard}}], routingPolicy.
export function defaultPoolState(accountIds, now = isoNow) {
  return { formatVersion: 1, revision: 0, updatedAt: now(), activeAccountId: null, order: [...accountIds], accounts: accountIds.map(id => defaultAccount(id)), routingPolicy: { ...defaultRoutingPolicy, priorityAccountIds: [] } };
}
function defaultAccount(id) { return { id, status: 'active', inactiveReason: null, inactiveAt: null, evidence: [], modelPools: { custom: 'recheck_required', standard: 'recheck_required' } }; }
export function validatePoolState(raw, file = 'pool-state.json') {
  const fail = why => { throw new PoolError('pool_state_invalid', `${file} : ${why}`); };
  if (!raw || typeof raw !== 'object' || raw.formatVersion !== 1) fail('formatVersion 1 attendu.');
  if (!Number.isInteger(raw.revision) || raw.revision < 0) fail('revision entière attendue.');
  if (!Array.isArray(raw.accounts) || !Array.isArray(raw.order)) fail('accounts et order attendus.');
  const ids = new Set();
  for (const account of raw.accounts) { if (!account || typeof account !== 'object' || typeof account.id !== 'string' || !idPattern.test(account.id) || ids.has(account.id)) fail('compte invalide ou dupliqué.'); ids.add(account.id); if (account.modelPools !== undefined && (typeof account.modelPools !== 'object' || account.modelPools === null)) fail(`modelPools invalide pour ${account.id}.`); }
  if (raw.order.some(id => typeof id !== 'string')) fail('order doit lister des identifiants.');
  if (raw.routingPolicy !== undefined && (typeof raw.routingPolicy !== 'object' || raw.routingPolicy === null)) fail('routingPolicy invalide.');
  return raw;
}
async function readPoolStateRaw(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw new PoolError('pool_state_unreadable', `${file} : illisible ou JSON invalide ; aucune réécriture.`); }
}
// Comptes du coffre absents de l’état : ajoutés en fin d’ordre, sans toucher aux comptes, champs et ordre existants.
export function mergeAccounts(state, accountIds) {
  let changed = false;
  for (const id of accountIds) {
    if (!state.accounts.some(a => a.id === id)) { state.accounts.push(defaultAccount(id)); changed = true; }
    if (!state.order.includes(id)) { state.order.push(id); changed = true; }
  }
  return changed;
}
async function atomicWrite(file, data) {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n');
  try { await rename(temp, file); } catch (error) { await unlink(temp).catch(() => {}); throw new PoolError('pool_state_write_failed', `${file} : remplacement atomique impossible (${error.code ?? 'erreur'}).`); }
}

// Verrou exclusif par création O_EXCL de pool-state.lock. Attente bornée puis refus explicite ; un verrou détenu par autrui n’est jamais volé ni supprimé.
export async function withPoolLock(lockFile, fn, { waitMs = 5_000, stepMs = 25, sleep = defaultSleep, now = isoNow, clock = Date.now } = {}) {
  const deadline = clock() + waitMs;
  let handle;
  for (;;) {
    try { handle = await open(lockFile, 'wx'); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw new PoolError('pool_lock_failed', `${lockFile} : verrou impossible (${error.code ?? 'erreur'}).`);
      if (clock() >= deadline) {
        let holder = null; try { const data = JSON.parse(await readFile(lockFile, 'utf8')); holder = { pid: Number.isInteger(data?.pid) ? data.pid : null, at: typeof data?.at === 'string' ? data.at : null }; } catch { holder = null; }
        throw new PoolError('pool_locked', `${lockFile} détenu par un autre processus ; aucun vol de verrou. Vérifier ce processus, puis retirer le verrou manuellement s’il est orphelin.`, { holder });
      }
      await sleep(stepMs);
    }
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() }) + '\n'); } catch { /* le verrou tient par l’existence du fichier */ }
  await handle.close().catch(() => {});
  try { return await fn(); } finally { await unlink(lockFile).catch(() => {}); }
}
// Section critique : charger (ou créer) l’état, appliquer fn(state) → {changed, value}, revérifier la révision puis remplacer atomiquement avec revision+1.
export async function withPoolState({ stateFile, lockFile }, fn, { accountIds = [], now = isoNow, sleep, waitMs, clock } = {}) {
  return withPoolLock(lockFile, async () => {
    const raw = await readPoolStateRaw(stateFile);
    const existed = raw !== null;
    const state = existed ? validatePoolState(raw, stateFile) : defaultPoolState(accountIds, now);
    const merged = existed && mergeAccounts(state, accountIds);
    const revision = state.revision;
    const outcome = await fn(state);
    if (outcome?.changed || !existed || merged) {
      const check = await readPoolStateRaw(stateFile);
      if (existed && (!check || check.revision !== revision)) throw new PoolError('concurrent_modification', `${stateFile} : révision modifiée pendant la section critique (${revision} → ${check?.revision ?? 'absent'}) ; aucune écriture.`);
      state.revision = revision + 1; state.updatedAt = now();
      await atomicWrite(stateFile, state);
    }
    return typeof outcome?.value === 'function' ? outcome.value(state) : outcome?.value;
  }, { sleep, now, waitMs, clock });
}

// Pools de modèles : claude-* facturé sur l’usage « custom » (premium), grok-* sur « standard ». Autre identifiant : inconnu, aucune inférence.
export function poolFor(modelId) { if (typeof modelId !== 'string') return null; if (/^claude-/i.test(modelId)) return 'custom'; if (/^grok-/i.test(modelId)) return 'standard'; return null; }
const otherPool = pool => (pool === 'custom' ? 'standard' : 'custom');

// Classification d’un résultat de call() du transport : signature exacte ou « undetermined ». Le message fournisseur n’est jamais conservé, seul le fait qu’il ait correspondu.
export function classifyResult({ callKind, modelId, result, at = isoNow(), agentId } = {}) {
  if (!callKinds.includes(callKind)) throw new PoolError('evidence_invalid', 'callKind inconnu.');
  const base = { at, callKind, modelId: typeof modelId === 'string' ? modelId : null, ...(typeof agentId === 'string' ? { agentId } : {}) };
  if (!result || typeof result !== 'object') return { ...base, classification: 'undetermined', reason: 'no_result' };
  if (result.outcome === 'ok') return { ...base, classification: 'accepted', httpStatus: result.status ?? null };
  const message = typeof result.providerMessage === 'string' ? result.providerMessage.trim() : '';
  const match = providerSignatures.find(s => s.httpStatus === result.status && s.providerCode === result.providerCode && s.message === message);
  return { ...base, classification: match ? match.classification : 'undetermined', reason: result.reason ?? result.outcome ?? null, httpStatus: Number.isInteger(result.status) ? result.status : null, providerCode: typeof result.providerCode === 'string' ? result.providerCode : null, messageMatched: Boolean(match) };
}
function deactivate(account, reason, at) { if (account.status !== 'inactive') { account.status = 'inactive'; account.inactiveReason = reason; account.inactiveAt = at; } }
// Effets : épuisement inclus ⇒ le seul pool du modèle appelé est « exhaustion_reported », l’autre « recheck_required » sauf s’il est déjà confirmé ; plan manquant ⇒ deux pools
// « unavailable_plan » ; plafond de création (400) et motifs génériques ⇒ preuve conservée, aucun changement d’état ; acceptation ⇒ « probe_passed_balance_unknown » et, pour
// le pool standard, preuve datée d’accès réel. Une sonde passée ne prouve ni solde ni accès futur.
export function applyEvidence(state, accountId, evidence) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) throw new PoolError('account_unknown', `Compte ${String(accountId).slice(0, 64)} absent de l’état du pool.`, { accountId });
  const at = evidence.at ?? isoNow();
  const record = { at, callKind: evidence.callKind, modelId: evidence.modelId ?? null, classification: evidence.classification, ...(evidence.httpStatus != null ? { httpStatus: evidence.httpStatus } : {}), ...(evidence.providerCode ? { providerCode: evidence.providerCode } : {}), ...(evidence.reason ? { reason: evidence.reason } : {}), ...(evidence.agentId ? { agentId: evidence.agentId } : {}) };
  account.lastEvidence = record;
  if (Array.isArray(account.evidence)) { account.evidence.push(record); if (account.evidence.length > 20) account.evidence.splice(0, account.evidence.length - 20); }
  if (!account.modelPools || typeof account.modelPools !== 'object') account.modelPools = {};
  const pool = poolFor(record.modelId);
  switch (record.classification) {
    case 'included_usage_exhausted':
      if (pool) { account.modelPools[pool] = 'exhaustion_reported'; if (!confirmedUnavailable.has(account.modelPools[otherPool(pool)])) account.modelPools[otherPool(pool)] = 'recheck_required'; deactivate(account, 'included_usage_exhausted', at); }
      break;
    case 'plan_required':
      account.modelPools.custom = 'unavailable_plan'; account.modelPools.standard = 'unavailable_plan'; deactivate(account, 'plan_required', at);
      break;
    case 'accepted':
      if (pool && ['create', 'run'].includes(record.callKind)) { account.modelPools[pool] = 'probe_passed_balance_unknown'; if (pool === 'standard') account.standardProof = { at, modelId: record.modelId, kind: `${record.callKind}_accepted`, ...(record.agentId ? { agentId: record.agentId } : {}) }; }
      break;
    default: break;
  }
  return summarizeAccount(account);
}
export function summarizeAccount(account) {
  return { id: account.id, status: account.status ?? 'active', inactiveReason: account.inactiveReason ?? null, modelPools: { custom: account.modelPools?.custom ?? null, standard: account.modelPools?.standard ?? null }, standardProof: account.standardProof ? { at: account.standardProof.at, modelId: account.standardProof.modelId, kind: account.standardProof.kind } : null, lastEvidence: account.lastEvidence ? { at: account.lastEvidence.at, callKind: account.lastEvidence.callKind, classification: account.lastEvidence.classification, ...(account.lastEvidence.httpStatus ? { httpStatus: account.lastEvidence.httpStatus } : {}), ...(account.lastEvidence.providerCode ? { providerCode: account.lastEvidence.providerCode } : {}) } : null };
}
export function summarizeState(state) { return { revision: state.revision, updatedAt: state.updatedAt, activeAccountId: state.activeAccountId ?? null, order: orderedAccounts(state).map(a => a.id), routingPolicy: { ...defaultRoutingPolicy, ...(state.routingPolicy ?? {}) }, accounts: orderedAccounts(state).map(summarizeAccount) }; }

// Ordre configuré : priorityAccountIds, puis order, puis les comptes restants dans l’ordre du fichier. Aucun reclassement selon l’état.
export function orderedAccounts(state) {
  const byId = new Map(state.accounts.map(a => [a.id, a]));
  const seen = new Set(); const out = [];
  for (const id of [...(state.routingPolicy?.priorityAccountIds ?? []), ...state.order, ...state.accounts.map(a => a.id)]) { if (byId.has(id) && !seen.has(id)) { seen.add(id); out.push(byId.get(id)); } }
  return out;
}
function freshProof(account, modelId, nowMs, maxAgeMs) {
  const proof = account.standardProof;
  if (!proof || proof.modelId !== modelId || !['create_accepted', 'run_accepted'].includes(proof.kind)) return null;
  const at = Date.parse(proof.at); if (!Number.isFinite(at)) return null;
  const age = nowMs - at; return age >= 0 && age <= maxAgeMs ? { at: proof.at, modelId: proof.modelId, kind: proof.kind, ageMs: age } : null;
}
// Décision déterministe. selection = {key, modelId, params} choisie à l’attribution ; fallbackSelection = entrée grok du catalogue (ou null).
// route : même sélection sur le premier compte éligible de l’ordre ; exception : tous les comptes premium confirmés indisponibles ET une preuve
// datée d’accès réel standard (jamais GET /models) ; blocked : explication honnête et action explicite, aucune sonde payante, jamais Composer.
export function decide(state, { selection, fallbackSelection = null, excludeAccountIds = [], now = isoNow } = {}) {
  if (!selection || typeof selection.modelId !== 'string') throw new PoolError('selection_invalid', 'Sélection {modelId} requise.');
  const policy = { ...defaultRoutingPolicy, ...(state.routingPolicy ?? {}) };
  const excluded = new Set(excludeAccountIds);
  const all = orderedAccounts(state);
  const candidates = all.filter(a => !excluded.has(a.id));
  const accounts = all.map(summarizeAccount);
  const blocked = (reason, nextAction, extra = {}) => ({ status: 'blocked', reason, modelId: selection.modelId, pool: poolFor(selection.modelId), accounts, nextAction, ...extra });
  if (composerPattern.test(selection.modelId)) return blocked('composer_forbidden', 'Composer n’est jamais utilisé ; conserver la sélection choisie à l’attribution.');
  const pool = poolFor(selection.modelId);
  if (!pool) return blocked('model_pool_unknown', 'Modèle sans pool connu (custom/standard) : aucune inférence de facturation ; compléter poolFor par PR du kit.');
  if (!all.length) return blocked('no_accounts', 'Aucun compte dans le pool : renseigner credentials.json (coffre DPAPI de l’utilisateur).');
  const standardEligible = a => (a.status !== 'inactive' || policy.reuseInactiveForStandard === true) && !confirmedUnavailable.has(a.modelPools?.standard);
  if (pool === 'standard') {
    const eligible = candidates.find(standardEligible);
    if (eligible) return { status: 'route', pool, accountId: eligible.id, modelId: selection.modelId, selection: 'initial', accounts };
    return blocked('no_standard_account', 'Aucun compte éligible au pool standard dans l’ordre configuré ; réexaminer manuellement les comptes après vérification de leur accès.');
  }
  const customEligible = a => a.status !== 'inactive' && !confirmedUnavailable.has(a.modelPools?.custom);
  const eligible = candidates.find(customEligible);
  if (eligible) return { status: 'route', pool, accountId: eligible.id, modelId: selection.modelId, selection: 'initial', accounts };
  if (all.some(a => excluded.has(a.id) && customEligible(a))) return blocked('only_excluded_account_eligible', 'Seul le compte exclu (propriétaire actuel) reste éligible : reprendre le même agent (followup), pas un successeur.');
  const confirmed = all.filter(a => confirmedUnavailable.has(a.modelPools?.custom)).map(a => a.id);
  const unknown = all.filter(a => !confirmedUnavailable.has(a.modelPools?.custom)).map(a => a.id);
  if (unknown.length) return blocked('custom_availability_unknown', `Comptes premium sans indisponibilité confirmée mais non éligibles (inactifs pour une autre raison ou état inconnu) : ${unknown.join(', ')}. Vérifier manuellement et réactiver dans pool-state.json ; aucun repli tant qu’un doute subsiste.`, { confirmed, unknown });
  if (policy.fallbackWhen !== 'all_custom_accounts_confirmed_unavailable') return blocked('fallback_policy_disabled', 'Tous les comptes premium sont confirmés indisponibles et routingPolicy.fallbackWhen interdit le repli : attendre le rétablissement (on-demand ou plan) ; aucun autre modèle.', { confirmed });
  const fallbackModel = policy.fallbackModel;
  const fallbackValid = policy.neverFallbackToComposer === true && fallbackModel === FALLBACK_MODEL && !composerPattern.test(fallbackModel) && fallbackSelection && fallbackSelection.modelId === fallbackModel && !composerPattern.test(fallbackSelection.modelId) && poolFor(fallbackModel) === 'standard';
  if (!fallbackValid) return blocked('fallback_model_forbidden', `Repli autorisé uniquement vers ${FALLBACK_MODEL} déclaré dans cursor-model.json, jamais Composer ; aucune sélection de repli valide.`, { confirmed });
  const standardCandidates = candidates.filter(standardEligible);
  if (!standardCandidates.length) return blocked('no_standard_account', 'Tous les comptes premium sont confirmés indisponibles et aucun compte n’est éligible au pool standard ; attendre le rétablissement, aucun autre modèle.', { confirmed });
  const nowMs = Date.parse(now()); const maxAgeMs = Math.max(1, Number(policy.standardProofMaxAgeHours) || 24) * 3_600_000;
  if (policy.requireStandardValidation !== false) {
    const proven = standardCandidates.map(a => ({ account: a, proof: freshProof(a, fallbackModel, nowMs, maxAgeMs) })).find(c => c.proof);
    if (!proven) return blocked('standard_access_unproven', `Tous les comptes premium sont confirmés indisponibles (${confirmed.join(', ')}). Aucune preuve datée (< ${Math.round(maxAgeMs / 3_600_000)} h) d’accès réel à ${fallbackModel} pour ${standardCandidates.map(a => a.id).join(', ')} ; GET /models n’en est pas une. Aucune sonde payante automatique. Action explicite : lancer une mission bornée « --select grok --account <id> » (coût réel, décision humaine), dont l’acceptation enregistre la preuve ; sinon rester bloqué.`, { confirmed, standardCandidates: standardCandidates.map(a => a.id) });
    return { status: 'exception', pool: 'standard', accountId: proven.account.id, modelId: fallbackModel, selection: 'fallback', reason: 'all_custom_accounts_confirmed_unavailable', confirmed, proof: proven.proof, accounts };
  }
  return { status: 'exception', pool: 'standard', accountId: standardCandidates[0].id, modelId: fallbackModel, selection: 'fallback', reason: 'all_custom_accounts_confirmed_unavailable', confirmed, proof: null, accounts };
}

// Pool ouvert pour le transport : identifiants publics, clés à la demande, lecture/décision/enregistrement sous verrou. Retourne null sans coffre configuré.
export async function openAccountPool({ env = process.env, decrypt, now = isoNow, sleep, waitMs, clock } = {}) {
  const file = credentialsPath(env);
  if (!file) return null;
  let raw;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT' && !(typeof env.CURSOR_CREDENTIALS_FILE === 'string' && env.CURSOR_CREDENTIALS_FILE.trim())) return null; throw new PoolError(error.code === 'ENOENT' ? 'credentials_missing' : 'credentials_unreadable', `Coffre de comptes illisible : ${file}`); }
  const credentials = await loadCredentials({ file, raw, decrypt });
  const paths = poolPaths(file);
  const options = { accountIds: credentials.ids, now, sleep, waitMs, clock };
  const pool = {
    mode: 'pool', fallbackModel: FALLBACK_MODEL, stateFile: paths.stateFile, lockFile: paths.lockFile, accountIds: credentials.ids,
    keyFor: accountId => credentials.keyFor(accountId),
    classify: args => classifyResult(args),
    read: () => withPoolState(paths, () => ({ changed: false, value: state => summarizeState(state) }), options),
    decide: args => withPoolState(paths, state => ({ changed: false, value: decide(state, { ...args, now }) }), options),
    record: (accountId, evidence, { activate = false } = {}) => withPoolState(paths, state => { const summary = applyEvidence(state, accountId, { ...evidence, at: evidence.at ?? now() }); if (activate && evidence.classification === 'accepted') state.activeAccountId = accountId; return { changed: true, value: summary }; }, options),
  };
  return pool;
}
