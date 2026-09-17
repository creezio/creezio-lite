#!/usr/bin/env node
// Pool commun de comptes Cursor pour le transport d’orchestration (.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs).
// Un seul coffre local par utilisateur (Windows DPAPI CurrentUser), un état partagé pool-state.json sous verrou exclusif et une décision
// déterministe au moment de chaque appel. Aucun daemon, aucune surveillance de crédit, aucune sonde automatique, aucun quota numérique supposé.
// Les secrets déchiffrés restent en mémoire ou dans le tube privé du déchiffreur : jamais argv, journal, dépôt, registre ni cloud.
import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class PoolError extends Error { constructor(code, message, extra = {}) { super(message); this.name = 'PoolError'; this.code = code; Object.assign(this, extra); } }

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const isoNow = () => new Date().toISOString();
const defaultSleep = ms => new Promise(r => setTimeout(r, ms));
export const FALLBACK_MODEL = 'grok-4.6';
export const composerPattern = /composer/i;
export const modelPoolStates = Object.freeze(['probe_passed_balance_unknown', 'exhaustion_reported', 'recheck_required', 'unavailable_plan']);
export const confirmedUnavailable = new Set(['exhaustion_reported', 'unavailable_plan']);
export const callKinds = Object.freeze(['models', 'create', 'run', 'agent', 'run_read']);
// requireStandardValidation est conservé pour la compatibilité du fichier d’état mais n’est pas un interrupteur : la preuve d’accès standard est toujours exigée.
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

// credentials.json {formatVersion:1, encryption:'windows-dpapi-current-user', createdAt, accounts:[{id, secretDpapi}]}. secretDpapi est la sortie de
// ConvertFrom-SecureString (DPAPI CurrentUser) : chaîne hexadécimale de longueur paire, jamais recopiée dans une erreur. Le coffre n’est jamais réécrit ici.
export const secureStringHexPattern = /^(?:[0-9A-Fa-f]{2}){16,16384}$/;
export function isSecureStringHex(value) { return typeof value === 'string' && secureStringHexPattern.test(value); }
export function parseCredentials(raw) {
  if (!raw || typeof raw !== 'object' || raw.formatVersion !== 1) throw new PoolError('credentials_invalid', 'credentials.json : formatVersion 1 attendu.');
  if (raw.encryption !== 'windows-dpapi-current-user') throw new PoolError('credentials_invalid', 'credentials.json : encryption windows-dpapi-current-user attendu.');
  if (!Array.isArray(raw.accounts) || !raw.accounts.length || raw.accounts.length > 32) throw new PoolError('credentials_invalid', 'credentials.json : 1 à 32 comptes attendus.');
  const seen = new Set(); const accounts = [];
  for (const [index, account] of raw.accounts.entries()) {
    const id = account && typeof account === 'object' && typeof account.id === 'string' && idPattern.test(account.id) ? account.id : null;
    if (!id || seen.has(id)) throw new PoolError('credentials_invalid', `credentials.json : compte n°${index + 1} sans identifiant valide ou dupliqué.`);
    if (!isSecureStringHex(account.secretDpapi)) throw new PoolError('credentials_invalid', `credentials.json : compte ${id} sans chaîne SecureString hexadécimale valide (ConvertFrom-SecureString).`);
    seen.add(id); accounts.push({ id, secretDpapi: account.secretDpapi });
  }
  return { formatVersion: 1, encryption: raw.encryption, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null, accounts };
}

// Déchiffrement DPAPI CurrentUser par PowerShell : la chaîne SecureString hexadécimale (sortie de ConvertFrom-SecureString) arrive par l’entrée standard,
// ConvertTo-SecureString sans -Key la déchiffre pour l’utilisateur courant, le texte clair sort en octets UTF-8 bruts par la sortie standard.
// Invocation durcie après la recette Windows échouée (cfde3a7) : (1) avec -Command et une entrée redirigée, l’hôte Windows PowerShell consomme lui-même stdin pour
// alimenter $input, donc [Console]::In.ReadToEnd() rend une chaîne vide ⇒ on lit $input d’abord, puis Console.In, puis le flux brut ; (2) [Console]::OutputEncoding=…
// lève « The handle is invalid » quand l’enfant n’a pas de console visible ⇒ on n’y touche plus et on écrit les octets directement ; (3) le script passe par
// -EncodedCommand (aucune citation de ligne de commande à interpréter) ; (4) recette f161811 : un PSModulePath hérité d’un runtime PowerShell 7 place ses modules
// (Microsoft.PowerShell.Security 7.0.0.0) avant $PSHOME\Modules de Windows PowerShell 5.1, et ConvertTo-SecureString ne peut plus s’autocharger
// (CouldNotAutoloadMatchingModule) ⇒ l’enfant seul reçoit un environnement sans PSModulePath, et le script remet $env:PSModulePath sur son propre $PSHOME\Modules
// puis importe explicitement Microsoft.PowerShell.Security (étape `module_import`). Chaque étape a son code de sortie : rien d’autre que le clair ne sort sur stdout,
// stderr est ignorée, aucune donnée dans les erreurs. Windows uniquement ; les mocks Linux ne prouvent pas DPAPI.
export const dpapiExitStages = Object.freeze({ 2: 'module_import', 3: 'stdin_empty', 4: 'stdin_format', 5: 'dpapi_unprotect', 6: 'extract', 7: 'stdout_write' });
// Prologue commun (déchiffreur et fixture de recette) : modules résolus depuis le PSHOME de l’hôte enfant uniquement, jamais depuis un chemin hérité.
export const dpapiModulePrologue = [
  "$ErrorActionPreference='Stop'",
  "try { $env:PSModulePath=(Join-Path $PSHOME 'Modules'); Import-Module -Name Microsoft.PowerShell.Security -Force -ErrorAction Stop; if (-not (Get-Command ConvertTo-SecureString -ErrorAction SilentlyContinue) -or -not (Get-Command ConvertFrom-SecureString -ErrorAction SilentlyContinue)) { exit 2 } } catch { exit 2 }",
];
// Environnement de l’enfant : celui du parent sans PSModulePath (Windows PowerShell 5.1 reconstruit alors son chemin par défaut) ; rien d’autre n’est modifié.
export function dpapiChildEnv(env = process.env) { const out = {}; for (const [key, value] of Object.entries(env)) if (key.toLowerCase() !== 'psmodulepath') out[key] = value; return out; }
export const dpapiPowershellScript = [
  ...dpapiModulePrologue,
  "$hex=''",
  "try { $hex=(@($input) | ForEach-Object { [string]$_ }) -join '' } catch { $hex='' }",
  "if (-not $hex) { try { $hex=[Console]::In.ReadToEnd() } catch { $hex='' } }",
  "if (-not $hex) { try { $s=[Console]::OpenStandardInput(); $ms=New-Object System.IO.MemoryStream; $s.CopyTo($ms); $hex=[System.Text.Encoding]::ASCII.GetString($ms.ToArray()) } catch { $hex='' } }",
  "$hex=($hex -replace '\\s','')",
  'if (-not $hex) { exit 3 }',
  "if ($hex -notmatch '^(?:[0-9A-Fa-f]{2})+$') { exit 4 }",
  'try { $secure=ConvertTo-SecureString -String $hex } catch { exit 5 }',
  "try { $clear=(New-Object System.Net.NetworkCredential('',$secure)).Password } catch { exit 6 }",
  'try { $bytes=[System.Text.Encoding]::UTF8.GetBytes($clear); $out=[Console]::OpenStandardOutput(); $out.Write($bytes,0,$bytes.Length); $out.Flush() } catch { exit 7 }',
  'exit 0',
].join('\n');
export const dpapiEncodedCommand = Buffer.from(dpapiPowershellScript, 'utf16le').toString('base64');
export const dpapiPowershellArgs = Object.freeze(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-EncodedCommand', dpapiEncodedCommand]);
// Exécute le déchiffreur sur une chaîne hexadécimale ; erreurs constantes par étape (stage), sans contenu : spawn, timeout, stdin_empty, stdin_format, dpapi_unprotect, extract, stdout_write, powershell_exit.
export function runDpapiChild(hex, { spawnImpl = spawn, timeoutMs = 15_000, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl('powershell.exe', [...dpapiPowershellArgs], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: dpapiChildEnv(env) });
    const out = []; let stderrBytes = 0; let failed = false;
    const fail = (code, message, extra) => { if (failed) return; failed = true; clearTimeout(timer); reject(new PoolError(code, message, extra)); };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* déjà terminé */ } fail('decrypt_failed', 'Déchiffrement DPAPI interrompu (délai).', { stage: 'timeout' }); }, timeoutMs);
    child.on('error', () => fail('decrypt_failed', 'Déchiffreur DPAPI introuvable ou non exécutable (powershell.exe).', { stage: 'spawn' }));
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; });
    child.on('close', code => {
      clearTimeout(timer); if (failed) return;
      if (code === 0) return resolvePromise({ clear: Buffer.concat(out).toString('utf8'), stderrBytes });
      const stage = dpapiExitStages[code] ?? 'powershell_exit';
      const messages = { module_import: 'Module Microsoft.PowerShell.Security introuvable ou non chargeable depuis le PSHOME de l’hôte enfant (ConvertTo/From-SecureString indisponibles).', stdin_empty: 'Le déchiffreur n’a reçu aucune donnée sur son entrée standard.', stdin_format: 'Données reçues par le déchiffreur non hexadécimales (encodage ou transport altéré).', dpapi_unprotect: 'ConvertTo-SecureString a refusé la chaîne (autre utilisateur, autre session, chaîne altérée ou protection non DPAPI).', extract: 'Extraction du clair depuis la SecureString impossible.', stdout_write: 'Écriture du clair vers le tube impossible.', powershell_exit: 'PowerShell s’est terminé avec un code inattendu.' };
      fail('decrypt_failed', messages[stage], { stage, exitCode: code, stderrBytes });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(hex, 'ascii');
  });
}
export async function dpapiUnprotectCurrentUser(secretDpapi, { platform = process.platform, spawnImpl = spawn, timeoutMs = 15_000, env = process.env } = {}) {
  if (platform !== 'win32') throw new PoolError('dpapi_unavailable', 'Déchiffrement DPAPI disponible seulement sous Windows (session de l’utilisateur courant).');
  if (!isSecureStringHex(secretDpapi)) throw new PoolError('credentials_invalid', 'Chaîne SecureString hexadécimale attendue ; aucun déchiffreur lancé.', { stage: 'precheck' });
  const { clear } = await runDpapiChild(secretDpapi, { spawnImpl, timeoutMs, env });
  return clear;
}
// Recette Windows sans secret : PowerShell chiffre une valeur publique connue (DPAPI CurrentUser, ConvertFrom-SecureString), puis le même déchiffreur que le pool
// doit la restituer. Chaque échec est constant et nommé (stage) ; rien de secret n’entre en jeu. Ne prouve rien hors Windows.
export const dpapiSelfTestMarker = 'CREEZIO-DPAPI-SELFTEST-PUBLIC-MARKER';
export const dpapiFixtureScript = [
  ...dpapiModulePrologue,
  `try { $s=ConvertTo-SecureString -String '${dpapiSelfTestMarker}' -AsPlainText -Force; $h=ConvertFrom-SecureString -SecureString $s } catch { exit 5 }`,
  'try { $b=[System.Text.Encoding]::ASCII.GetBytes($h); $o=[Console]::OpenStandardOutput(); $o.Write($b,0,$b.Length); $o.Flush() } catch { exit 7 }',
  'exit 0',
].join('\n');
export const dpapiFixtureArgs = Object.freeze(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(dpapiFixtureScript, 'utf16le').toString('base64')]);
export async function dpapiSelfTest({ platform = process.platform, spawnImpl = spawn, timeoutMs = 15_000, env = process.env } = {}) {
  const report = { command: 'selftest', platform, marker: dpapiSelfTestMarker, inheritedPSModulePath: Object.keys(env).some(k => k.toLowerCase() === 'psmodulepath'), childPSModulePath: 'removed_then_PSHOME_Modules', stages: [] };
  if (platform !== 'win32') return { ...report, status: 'unavailable', stage: 'platform', message: 'Recette DPAPI possible seulement sous Windows.' };
  const fixture = await new Promise((resolvePromise) => {
    const child = spawnImpl('powershell.exe', [...dpapiFixtureArgs], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: dpapiChildEnv(env) });
    const out = []; let done = false;
    const finish = value => { if (!done) { done = true; clearTimeout(timer); resolvePromise(value); } };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* déjà terminé */ } finish({ stage: 'fixture_timeout' }); }, timeoutMs);
    child.on('error', () => finish({ stage: 'spawn' }));
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', () => {});
    child.on('close', code => finish(code === 0 ? { hex: Buffer.concat(out).toString('ascii').trim() } : { stage: code === 2 ? 'fixture_module_import' : code === 5 ? 'fixture_protect' : 'fixture_exit', exitCode: code }));
  });
  if (!fixture.hex) return { ...report, status: 'unavailable', stage: fixture.stage, ...(fixture.exitCode !== undefined ? { exitCode: fixture.exitCode } : {}), message: fixture.stage === 'fixture_module_import' ? 'Module Microsoft.PowerShell.Security introuvable depuis le PSHOME de l’hôte enfant : ConvertTo/From-SecureString indisponibles.' : 'PowerShell n’a pas pu produire la chaîne SecureString de recette.' };
  report.stages.push({ stage: 'fixture', ok: true, hexLength: fixture.hex.length });
  if (!isSecureStringHex(fixture.hex)) return { ...report, status: 'unavailable', stage: 'fixture_format', message: 'La sortie de ConvertFrom-SecureString n’est pas la chaîne hexadécimale attendue.' };
  report.stages.push({ stage: 'precheck', ok: true });
  try {
    const { clear, stderrBytes } = await runDpapiChild(fixture.hex, { spawnImpl, timeoutMs, env });
    report.stages.push({ stage: 'decrypt', ok: true, stderrBytes });
    if (clear !== dpapiSelfTestMarker) return { ...report, status: 'unavailable', stage: 'compare', clearLength: clear.length, message: 'Le clair restitué diffère du marqueur public (encodage de sortie).' };
    return { ...report, status: 'ok', stage: 'done', message: 'Déchiffreur DPAPI opérationnel pour l’utilisateur courant (marqueur public restitué).' };
  } catch (error) {
    return { ...report, status: 'unavailable', stage: error.stage ?? 'decrypt', ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}), ...(error.stderrBytes !== undefined ? { stderrBytes: error.stderrBytes } : {}), message: String(error.message) };
  }
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
const startCalls = new Set(['create', 'run']);
// Effets : épuisement inclus ⇒ le seul pool du modèle appelé est « exhaustion_reported », l’autre « recheck_required » sauf s’il est déjà confirmé ; plan manquant ⇒ deux pools
// « unavailable_plan » ; plafond de dépenses (400 usage_limit_exceeded) ⇒ startBlock : plus aucun nouveau départ (création ou run) sur le compte jusqu’à une validation
// explicite, pools et plafond inchangés, aucun solde inféré ; motifs génériques ⇒ preuve conservée, aucun changement d’état ; acceptation d’un départ ⇒
// « probe_passed_balance_unknown », levée du startBlock (seul un départ explicite --account peut l’atteindre) et, pour le pool standard, preuve datée d’accès réel.
// Tout refus fournisseur daté (statut HTTP) invalide les preuves antérieures du compte (lastRefusalAt). Une sonde passée ne prouve ni solde ni accès futur.
export function applyEvidence(state, accountId, evidence) {
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) throw new PoolError('account_unknown', `Compte ${String(accountId).slice(0, 64)} absent de l’état du pool.`, { accountId });
  const at = evidence.at ?? isoNow();
  const record = { at, callKind: evidence.callKind, modelId: evidence.modelId ?? null, classification: evidence.classification, ...(evidence.httpStatus != null ? { httpStatus: evidence.httpStatus } : {}), ...(evidence.providerCode ? { providerCode: evidence.providerCode } : {}), ...(evidence.reason ? { reason: evidence.reason } : {}), ...(evidence.agentId ? { agentId: evidence.agentId } : {}) };
  account.lastEvidence = record;
  if (Array.isArray(account.evidence)) { account.evidence.push(record); if (account.evidence.length > 20) account.evidence.splice(0, account.evidence.length - 20); }
  if (!account.modelPools || typeof account.modelPools !== 'object') account.modelPools = {};
  const pool = poolFor(record.modelId);
  const isStart = startCalls.has(record.callKind);
  // Invalidation par ordre des événements (pas seulement par horodatage) : une preuve antérieure à un refus, un blocage ou un recheck ne vaut plus rien.
  const invalidateProof = reason => { if (account.standardProof && typeof account.standardProof === 'object' && !account.standardProof.invalidatedBy) account.standardProof.invalidatedBy = { at, reason }; };
  if (record.classification !== 'accepted' && Number.isInteger(record.httpStatus) && record.httpStatus >= 400) { account.lastRefusalAt = at; invalidateProof(record.classification === 'undetermined' ? `refusal_${record.httpStatus}` : record.classification); }
  switch (record.classification) {
    case 'included_usage_exhausted':
      if (pool) { account.modelPools[pool] = 'exhaustion_reported'; if (!confirmedUnavailable.has(account.modelPools[otherPool(pool)])) { account.modelPools[otherPool(pool)] = 'recheck_required'; if (otherPool(pool) === 'standard') { account.standardRecheckAt = at; invalidateProof('standard_recheck_required'); } } deactivate(account, 'included_usage_exhausted', at); }
      break;
    case 'plan_required':
      account.modelPools.custom = 'unavailable_plan'; account.modelPools.standard = 'unavailable_plan'; deactivate(account, 'plan_required', at);
      break;
    case 'hard_limit_start_refused':
      if (isStart) { account.startBlock = { at, reason: 'hard_limit_start_refused', callKind: record.callKind, modelId: record.modelId, httpStatus: record.httpStatus ?? 400, providerCode: record.providerCode ?? 'usage_limit_exceeded' }; invalidateProof('start_block'); }
      break;
    case 'accepted':
      if (pool && isStart) { account.modelPools[pool] = 'probe_passed_balance_unknown'; if (account.startBlock) { account.startBlock = null; account.startBlockClearedAt = at; } if (pool === 'standard') account.standardProof = { at, modelId: record.modelId, kind: `${record.callKind}_accepted`, ...(record.agentId ? { agentId: record.agentId } : {}) }; }
      break;
    default: break;
  }
  return summarizeAccount(account);
}
export function summarizeAccount(account) {
  return { id: account.id, status: account.status ?? 'active', inactiveReason: account.inactiveReason ?? null, modelPools: { custom: account.modelPools?.custom ?? null, standard: account.modelPools?.standard ?? null }, startBlock: account.startBlock ? { at: account.startBlock.at, reason: account.startBlock.reason, callKind: account.startBlock.callKind ?? null } : null, lastRefusalAt: account.lastRefusalAt ?? null, standardProof: account.standardProof ? { at: account.standardProof.at, modelId: account.standardProof.modelId, kind: account.standardProof.kind, ...(account.standardProof.invalidatedBy ? { invalidatedBy: account.standardProof.invalidatedBy } : {}) } : null, lastEvidence: account.lastEvidence ? { at: account.lastEvidence.at, callKind: account.lastEvidence.callKind, classification: account.lastEvidence.classification, ...(account.lastEvidence.httpStatus ? { httpStatus: account.lastEvidence.httpStatus } : {}), ...(account.lastEvidence.providerCode ? { providerCode: account.lastEvidence.providerCode } : {}) } : null };
}
export const startBlocked = account => Boolean(account?.startBlock && typeof account.startBlock === 'object');
export function summarizeState(state) { return { revision: state.revision, updatedAt: state.updatedAt, activeAccountId: state.activeAccountId ?? null, order: orderedAccounts(state).map(a => a.id), routingPolicy: { ...defaultRoutingPolicy, ...(state.routingPolicy ?? {}) }, accounts: orderedAccounts(state).map(summarizeAccount) }; }

// Ordre configuré : priorityAccountIds, puis order, puis les comptes restants dans l’ordre du fichier. Aucun reclassement selon l’état.
export function orderedAccounts(state) {
  const byId = new Map(state.accounts.map(a => [a.id, a]));
  const seen = new Set(); const out = [];
  for (const id of [...(state.routingPolicy?.priorityAccountIds ?? []), ...state.order, ...state.accounts.map(a => a.id)]) { if (byId.has(id) && !seen.has(id)) { seen.add(id); out.push(byId.get(id)); } }
  return out;
}
// Preuve d’accès standard : départ accepté (create/run) sur CE compte pour CE modèle, datée, plus récente que tout refus fournisseur, tout passage du pool standard à
// recheck_required et tout blocage de départ, et cohérente avec l’état courant (pool standard « probe_passed_balance_unknown », aucun startBlock). Sinon : motif explicite.
export function standardProofStatus(account, modelId, nowMs, maxAgeMs) {
  const proof = account.standardProof;
  const invalid = reason => ({ valid: false, reason, proof: proof ? { at: proof.at, modelId: proof.modelId, kind: proof.kind } : null });
  if (!proof) return invalid('no_proof');
  if (proof.invalidatedBy) return invalid(`invalidated_${proof.invalidatedBy.reason ?? 'event'}`);
  if (proof.modelId !== modelId) return invalid('model_mismatch');
  if (!['create_accepted', 'run_accepted'].includes(proof.kind)) return invalid('kind_not_start');
  const at = Date.parse(proof.at); if (!Number.isFinite(at)) return invalid('undated');
  const age = nowMs - at; if (age < 0 || age > maxAgeMs) return invalid('expired');
  if (startBlocked(account)) return invalid('start_blocked');
  if (account.modelPools?.standard !== 'probe_passed_balance_unknown') return invalid(`standard_pool_${account.modelPools?.standard ?? 'unknown'}`);
  // Garde secondaire par horodatage (états édités à la main) : strictement antérieure à un refus, un recheck ou une désactivation ⇒ caduque.
  const after = (field, reason) => { const t = Date.parse(account[field] ?? ''); return Number.isFinite(t) && at < t ? invalid(reason) : null; };
  return after('lastRefusalAt', 'refusal_after_proof') ?? after('standardRecheckAt', 'recheck_after_proof') ?? after('inactiveAt', 'inactive_after_proof') ?? { valid: true, reason: null, proof: { at: proof.at, modelId: proof.modelId, kind: proof.kind, ageMs: age } };
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
  // startBlock (plafond de dépenses refusé) : aucun nouveau départ automatique sur ce compte, quel que soit le pool, jusqu’à validation explicite (--account).
  const startAllowed = a => !startBlocked(a);
  const standardEligible = a => startAllowed(a) && (a.status !== 'inactive' || policy.reuseInactiveForStandard === true) && !confirmedUnavailable.has(a.modelPools?.standard);
  const startBlockedIds = all.filter(a => !startAllowed(a)).map(a => a.id);
  const startBlockHint = startBlockedIds.length ? ` Départs bloqués après refus de plafond (hard_limit_start_refused) : ${startBlockedIds.join(', ')} ; validation explicite requise (plafond relevé manuellement puis « --account <id> »), aucun solde inféré.` : '';
  if (pool === 'standard') {
    const eligible = candidates.find(standardEligible);
    if (eligible) return { status: 'route', pool, accountId: eligible.id, modelId: selection.modelId, selection: 'initial', accounts };
    return blocked('no_standard_account', `Aucun compte éligible au pool standard dans l’ordre configuré ; réexaminer manuellement les comptes après vérification de leur accès.${startBlockHint}`, { startBlocked: startBlockedIds });
  }
  const customEligible = a => startAllowed(a) && a.status !== 'inactive' && !confirmedUnavailable.has(a.modelPools?.custom);
  const eligible = candidates.find(customEligible);
  if (eligible) return { status: 'route', pool, accountId: eligible.id, modelId: selection.modelId, selection: 'initial', accounts };
  if (all.some(a => excluded.has(a.id) && customEligible(a))) return blocked('only_excluded_account_eligible', 'Seul le compte exclu (propriétaire actuel) reste éligible : reprendre le même agent (followup), pas un successeur.');
  const confirmed = all.filter(a => confirmedUnavailable.has(a.modelPools?.custom)).map(a => a.id);
  const unknown = all.filter(a => !confirmedUnavailable.has(a.modelPools?.custom)).map(a => a.id);
  if (unknown.length) return blocked('custom_availability_unknown', `Comptes premium sans indisponibilité confirmée mais non éligibles (inactifs pour une autre raison, départ bloqué ou état inconnu) : ${unknown.join(', ')}. Vérifier manuellement et réactiver dans pool-state.json ; aucun repli tant qu’un doute subsiste.${startBlockHint}`, { confirmed, unknown, startBlocked: startBlockedIds });
  if (policy.fallbackWhen !== 'all_custom_accounts_confirmed_unavailable') return blocked('fallback_policy_disabled', 'Tous les comptes premium sont confirmés indisponibles et routingPolicy.fallbackWhen interdit le repli : attendre le rétablissement (on-demand ou plan) ; aucun autre modèle.', { confirmed });
  const fallbackModel = policy.fallbackModel;
  const fallbackValid = policy.neverFallbackToComposer === true && fallbackModel === FALLBACK_MODEL && !composerPattern.test(fallbackModel) && fallbackSelection && fallbackSelection.modelId === fallbackModel && !composerPattern.test(fallbackSelection.modelId) && poolFor(fallbackModel) === 'standard';
  if (!fallbackValid) return blocked('fallback_model_forbidden', `Repli autorisé uniquement vers ${FALLBACK_MODEL} déclaré dans cursor-model.json, jamais Composer ; aucune sélection de repli valide.`, { confirmed });
  const standardCandidates = candidates.filter(standardEligible);
  if (!standardCandidates.length) return blocked('no_standard_account', `Tous les comptes premium sont confirmés indisponibles et aucun compte n’est éligible au pool standard ; attendre le rétablissement, aucun autre modèle.${startBlockHint}`, { confirmed, startBlocked: startBlockedIds });
  // Preuve obligatoire, quelle que soit routingPolicy.requireStandardValidation : jamais d’exception avec proof:null, jamais de solde inventé.
  const nowMs = Date.parse(now()); const maxAgeMs = Math.max(1, Number(policy.standardProofMaxAgeHours) || 24) * 3_600_000;
  const proofs = standardCandidates.map(a => ({ account: a, ...standardProofStatus(a, fallbackModel, nowMs, maxAgeMs) }));
  const proven = proofs.find(c => c.valid);
  if (!proven) {
    const proofStatus = Object.fromEntries(proofs.map(c => [c.account.id, c.reason]));
    return blocked('standard_access_unproven', `Tous les comptes premium sont confirmés indisponibles (${confirmed.join(', ')}). Aucune preuve valable (< ${Math.round(maxAgeMs / 3_600_000)} h, postérieure à tout refus, recheck_required ou blocage, pool standard probe_passed_balance_unknown) d’accès réel à ${fallbackModel} pour ${proofs.map(c => `${c.account.id} (${c.reason})`).join(', ')} ; GET /models n’en est pas une. Aucune sonde payante automatique. Action explicite : lancer une mission bornée « --select grok --account <id> » (coût réel, décision humaine), dont l’acceptation enregistre la preuve ; sinon rester bloqué.${startBlockHint}`, { confirmed, standardCandidates: standardCandidates.map(a => a.id), proofStatus, startBlocked: startBlockedIds, requireStandardValidation: 'always' });
  }
  return { status: 'exception', pool: 'standard', accountId: proven.account.id, modelId: fallbackModel, selection: 'fallback', reason: 'all_custom_accounts_confirmed_unavailable', confirmed, proof: proven.proof, accounts };
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
    classify: args => classifyResult({ at: now(), ...args }),
    read: () => withPoolState(paths, () => ({ changed: false, value: state => summarizeState(state) }), options),
    decide: args => withPoolState(paths, state => ({ changed: false, value: decide(state, { ...args, now }) }), options),
    // Propriétaire d’une mission : ses GET restent toujours possibles ; un POST sur un pool confirmé indisponible est refusé avant envoi ; un départ sur un compte
    // en startBlock n’est possible que par validation explicite du transport (--account), jamais automatiquement.
    owner: ({ accountId, modelId }) => withPoolState(paths, state => { const account = state.accounts.find(a => a.id === accountId); const pool = poolFor(modelId); const poolState = account?.modelPools?.[pool] ?? null; return { changed: false, value: { accountId, known: Boolean(account), status: account?.status ?? null, pool, poolState, confirmedUnavailable: confirmedUnavailable.has(poolState), startBlocked: startBlocked(account), startBlock: account?.startBlock ? { at: account.startBlock.at, reason: account.startBlock.reason } : null } }; }, options),
    record: (accountId, evidence, { activate = false } = {}) => withPoolState(paths, state => { const summary = applyEvidence(state, accountId, { ...evidence, at: evidence.at ?? now() }); if (activate && evidence.classification === 'accepted') state.activeAccountId = accountId; return { changed: true, value: summary }; }, options),
  };
  return pool;
}

// Recette locale sans secret (Windows) : `node cursor-account-pool.mjs selftest` distingue spawn / stdin / format / DPAPI / extraction sur un marqueur public ;
// `node cursor-account-pool.mjs vault-check` déchiffre chaque compte du coffre configuré et ne rapporte que ok/échec avec l’étape, jamais une clé ni un blob.
export async function poolCli(argv = process.argv.slice(2), { env = process.env, platform = process.platform, spawnImpl = spawn, log = line => console.log(line) } = {}) {
  const [command, ...rest] = argv;
  if (command === 'selftest') { const report = await dpapiSelfTest({ platform, spawnImpl }); log(JSON.stringify(report)); return report.status === 'ok' ? 0 : 3; }
  if (command === 'vault-check') {
    const fileIndex = rest.indexOf('--file'); const file = fileIndex >= 0 ? rest[fileIndex + 1] : credentialsPath(env);
    const report = { command: 'vault-check', file: file ?? null, accounts: [] };
    let credentials;
    try { credentials = await loadCredentials({ file, decrypt: blob => dpapiUnprotectCurrentUser(blob, { platform, spawnImpl }) }); }
    catch (error) { log(JSON.stringify({ ...report, status: 'unavailable', code: error.code ?? 'error', stage: error.stage ?? 'load', message: String(error.message) })); return 3; }
    for (const id of credentials.ids) {
      try { await credentials.keyFor(id); report.accounts.push({ id, ok: true }); }
      catch (error) { report.accounts.push({ id, ok: false, code: error.code ?? 'error', ...(error.stage ? { stage: error.stage } : {}), ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}), ...(error.stderrBytes !== undefined ? { stderrBytes: error.stderrBytes } : {}), message: String(error.message) }); }
    }
    const ok = report.accounts.every(a => a.ok);
    log(JSON.stringify({ ...report, status: ok ? 'ok' : 'unavailable' })); return ok ? 0 : 3;
  }
  log('cursor-account-pool — recette locale : selftest | vault-check [--file credentials.json]'); return command ? 4 : 0;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  poolCli().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error?.code ?? error?.name ?? 'erreur')); process.exitCode = 4; });
}
