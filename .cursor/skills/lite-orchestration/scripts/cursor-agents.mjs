#!/usr/bin/env node
// Outil d’orchestration Creezio Lite pour l’API Cursor Cloud Agents v1 (https://cursor.com/docs/cloud-agent/api/endpoints).
// Usage orchestrateur uniquement ; distinct du transport métier runtime/core/agent-providers. Aucune dépendance au kit.
// Accès : CURSOR_API_KEY en environnement (un compte implicite) sinon le pool commun de comptes via l’adaptateur local optionnel
// (cursor-account-pool.mjs à côté de ce script, distribué avec la compétence, ou CURSOR_ACCOUNT_POOL_MODULE), décidé une fois par appel.
// Sorties JSON sans clé, sans prompt, sans corps fournisseur.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const API = 'https://api.cursor.com';
export const selectionsFile = resolve(dirname(fileURLToPath(import.meta.url)), '../cursor-model.json');
export const accountPoolModule = new URL('./cursor-account-pool.mjs', import.meta.url);
export const exitCodes = Object.freeze({ ok: 0, blocked: 2, unavailable: 3, usage: 4 });
export const pollIntervalsMs = Object.freeze([15_000, 30_000, 60_000, 120_000, 300_000]);
const agentIdPattern = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runIdPattern = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const providerCodePattern = /^[a-z][a-z0-9_]{1,63}$/;
const accountIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const shaPattern = /^[0-9a-f]{40}$/i;
const activeStates = new Set(['pending', 'launched', 'reconciled', 'uncertain']);

export class UsageError extends Error { constructor(message) { super(message); this.name = 'UsageError'; } }

export function readKey(env = process.env) {
  const key = typeof env.CURSOR_API_KEY === 'string' ? env.CURSOR_API_KEY.trim() : '';
  if (!key || key.length > 512 || /[\s\x00-\x1f\x7f]/.test(key)) return null;
  return key;
}

// Accès aux comptes. Mode env : CURSOR_API_KEY, un compte implicite, aucun état de pool (compatibilité). Mode pool : coffre local + pool-state.json,
// clé du compte propriétaire pour chaque appel d’une mission, décision déterministe au lancement et au successeur. Sans adaptateur ni clé : refus explicite.
export function envAccess(key) { return { mode: 'env', pool: null, keyFor: async () => key ?? null }; }
export async function loadAccountAdapter(env = process.env) {
  const override = typeof env.CURSOR_ACCOUNT_POOL_MODULE === 'string' && env.CURSOR_ACCOUNT_POOL_MODULE.trim() ? pathToFileURL(resolve(env.CURSOR_ACCOUNT_POOL_MODULE.trim())).href : null;
  try { return await import(override ?? accountPoolModule.href); }
  catch (error) { if (!override && error?.code === 'ERR_MODULE_NOT_FOUND') return null; throw new UsageError(`Adaptateur de comptes illisible (${override ? 'CURSOR_ACCOUNT_POOL_MODULE' : 'cursor-account-pool.mjs à côté de cursor-agents.mjs'}) ; aucun appel émis.`); }
}
export async function resolveAccess({ env = process.env, adapter, decrypt, now } = {}) {
  const key = readKey(env);
  if (key) return envAccess(key);
  const module = adapter === undefined ? await loadAccountAdapter(env) : adapter;
  const pool = module && typeof module.openAccountPool === 'function' ? await module.openAccountPool({ env, decrypt, now }) : null;
  if (!pool) throw new UsageError('CURSOR_API_KEY absente et aucun coffre de comptes lisible (CURSOR_CREDENTIALS_FILE ou %LOCALAPPDATA%/Creezio/cursor/credentials.json) ; aucun appel émis.');
  return { mode: 'pool', pool, keyFor: async (accountId) => { if (!accountId) throw new UsageError('Compte propriétaire inconnu pour cet appel ; aucun appel émis (entrée de registre sans accountId : utiliser CURSOR_API_KEY, ou --account pour --agent).'); return pool.keyFor(accountId); } };
}
const accessOf = (access, key) => access ?? envAccess(key ?? null);
function assertAccountId(value) { if (typeof value !== 'string' || !accountIdPattern.test(value)) throw new UsageError('Identifiant de compte invalide.'); return value; }
// Preuve fournisseur assainie, enregistrée sur le compte appelé (aucune inférence hors signatures exactes) ; le rapport n’expose que le résumé.
async function recordEvidence(access, accountId, { callKind, modelId, result, agentId }) {
  if (!access.pool || !accountId) return undefined;
  const evidence = access.pool.classify({ callKind, modelId, result, agentId });
  const summary = { accountId, classification: evidence.classification, ...(evidence.httpStatus ? { httpStatus: evidence.httpStatus } : {}), ...(evidence.providerCode ? { providerCode: evidence.providerCode } : {}) };
  try { const account = await access.pool.record(accountId, evidence, { activate: callKind === 'create' }); return { ...summary, recorded: true, account }; }
  catch (error) { return { ...summary, recorded: false, recordError: error?.code ?? 'error' }; }
}
const evidenceHint = (evidence) => {
  if (!evidence) return undefined;
  if (evidence.classification === 'included_usage_exhausted') return `usage inclus épuisé sur le compte ${evidence.accountId} pour ce pool (état enregistré) : relancer la même commande, le compte premium suivant sera choisi ; ou activer l’usage à la demande manuellement. Aucune inférence sur l’autre pool.`;
  if (evidence.classification === 'plan_required') return `compte ${evidence.accountId} sans plan Cloud Agent (deux pools indisponibles, enregistré) : relancer la même commande pour le compte suivant.`;
  if (evidence.classification === 'hard_limit_start_refused') return `plafond de dépenses du compte ${evidence.accountId} : départ refusé par le fournisseur ; nouveaux départs bloqués sur ce compte (startBlock enregistré) jusqu’à validation explicite. Relever la limite manuellement (tableau de bord) puis valider par « --account ${evidence.accountId} », ou relancer la même commande pour le compte suivant de l’ordre ; aucune relance automatique, aucune inférence sur le solde standard, pools et plafond inchangés.`;
  return undefined;
};

// Sélections autorisées : choisies une fois à l'attribution, conservées pour toute la mission. Aucun repli, aucun alias présumé.
const paramsList = (value, where) => { if (!Array.isArray(value) || value.length > 16 || value.some(p => !p || typeof p.id !== 'string' || typeof p.value !== 'string' || !p.id || !p.value)) throw new UsageError(`cursor-model.json : ${where} doit être une liste {id,value}.`); return value.map(p => ({ id: p.id, value: p.value })); };
export function validateSelections(config) {
  if (!config || typeof config !== 'object' || config.formatVersion !== 2 || config.provider !== 'cursor') throw new UsageError('cursor-model.json : formatVersion 2 et provider cursor attendus.');
  if (!config.selections || typeof config.selections !== 'object' || !Object.keys(config.selections).length) throw new UsageError('cursor-model.json : selections requis.');
  const selections = {};
  for (const [name, entry] of Object.entries(config.selections)) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name) || !entry || typeof entry.modelId !== 'string' || !modelIdPattern.test(entry.modelId)) throw new UsageError(`cursor-model.json : sélection ${name} invalide.`);
    selections[name] = { key: name, modelId: entry.modelId, params: paramsList(entry.params ?? [], `selections.${name}.params`) };
  }
  if (typeof config.default !== 'string' || !selections[config.default]) throw new UsageError('cursor-model.json : default doit désigner une sélection.');
  if (config.rules?.fallback !== 'none' || config.rules?.chosenOnceAtAttribution !== true || config.rules?.keptForFollowups !== true) throw new UsageError('cursor-model.json : rules {chosenOnceAtAttribution, keptForFollowups, fallback:none} imposées.');
  return { default: config.default, selections, catalogCheckedAt: typeof config.catalogCheckedAt === 'string' ? config.catalogCheckedAt : null };
}
export async function loadSelections(file = selectionsFile) {
  let raw; try { raw = JSON.parse(await readFile(file, 'utf8')); } catch { throw new UsageError('cursor-model.json illisible.'); }
  return validateSelections(raw);
}
export function resolveSelection(config, key) {
  const selection = config.selections[key ?? config.default];
  if (!selection) throw new UsageError(`Sélection inconnue : ${String(key)}. Choix possibles : ${Object.keys(config.selections).join(', ')}.`);
  return selection;
}
// Sélection de repli du pool (Grok 4.6) telle que déclarée dans le catalogue ; absente ⇒ aucune exception possible, jamais Composer.
const fallbackSelectionOf = (config, access) => (access.pool && config ? Object.values(config.selections).find(s => s.modelId === access.pool.fallbackModel && !/composer/i.test(s.modelId)) ?? null : null);

// UUID v5 (espace de noms URL) de "dépôt#mission" : le même brief produit toujours le même agent.
export function missionAgentId(repo, mission) {
  if (typeof repo !== 'string' || typeof mission !== 'string' || !mission.trim()) throw new UsageError('mission et repo requis pour dériver l’identifiant d’agent.');
  const ns = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const hash = createHash('sha1').update(ns).update(`${normalizeRepo(repo)}#${mission.trim()}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `bc-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
export function normalizeRepo(value) {
  let url; try { url = new URL(value); } catch { throw new UsageError('Dépôt GitHub HTTPS attendu.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(url.pathname)) throw new UsageError('Dépôt GitHub HTTPS attendu.');
  return `https://github.com${url.pathname.replace(/\/$/, '').replace(/\.git$/, '')}`;
}
function assertAgentId(value) { if (typeof value !== 'string' || !agentIdPattern.test(value)) throw new UsageError('Identifiant d’agent bc-<uuid> attendu.'); return value; }
function assertRunId(value) { if (typeof value !== 'string' || !runIdPattern.test(value)) throw new UsageError('Identifiant de run run-<uuid> attendu.'); return value; }
function refName(value) { if (typeof value !== 'string' || !value || value.length > 250 || /[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|^[-/]|\/$|\.lock$|@\{/.test(value)) throw new UsageError('Nom de branche ou SHA invalide.'); return value; }

async function readBounded(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel(); return { tooLarge: true }; }
  if (!response.body) return { text: '' };
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maxBytes) { await reader.cancel(); return { tooLarge: true }; } chunks.push(value); }
  return { text: Buffer.concat(chunks).toString('utf8') };
}
function providerCode(data) {
  const code = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error.code : data.code) : undefined;
  return typeof code === 'string' && providerCodePattern.test(code) ? code : undefined;
}
// Message fournisseur borné, réservé à la comparaison exacte des signatures par l’adaptateur ; jamais recopié dans un rapport, un registre ou un état.
function providerMessage(data) {
  const message = data && typeof data === 'object' ? (data.error && typeof data.error === 'object' ? data.error.message : data.message) : undefined;
  return typeof message === 'string' && message.length <= 400 ? message : undefined;
}
const providerFields = data => ({ ...(providerCode(data) ? { providerCode: providerCode(data) } : {}), ...(providerMessage(data) ? { providerMessage: providerMessage(data) } : {}) });
// Résultat fermé : ok | rejected | unavailable | invalid_response. Jamais de corps ni d’en-tête recopié.
export async function call({ method = 'GET', path, body, key, fetchImpl = globalThis.fetch, timeoutMs = 20_000, maxBytes = 2_000_000 }) {
  if (!key) return { outcome: 'unavailable', reason: 'credential_missing', delivery: 'not_sent' };
  if (typeof path !== 'string' || !path.startsWith('/v1/') || /[\s?#]/.test(path)) throw new UsageError('Chemin API non autorisé.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  const delivery = method === 'GET' ? 'not_sent' : 'unknown';
  try {
    let response;
    try {
      response = await fetchImpl(API + path, { method, redirect: 'manual', signal: controller.signal, headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { return { outcome: 'unavailable', reason: controller.signal.aborted ? 'timeout' : 'network', delivery }; }
    const status = response.status;
    if (status >= 300 && status < 400) { await response.body?.cancel(); return { outcome: 'unavailable', reason: 'redirect', status, delivery: 'unknown' }; }
    const read = await readBounded(response, maxBytes);
    if (read.tooLarge) return { outcome: 'invalid_response', reason: 'too_large', status };
    let data; if (read.text) { try { data = JSON.parse(read.text); } catch { data = undefined; } }
    if (status === 401 || status === 403) return { outcome: 'unavailable', reason: 'auth', status, ...providerFields(data) };
    if (status === 429) { const retry = Number(response.headers.get('retry-after')); return { outcome: 'unavailable', reason: 'quota', status, ...(Number.isFinite(retry) && retry > 0 ? { retryAfterMs: Math.min(retry, 3600) * 1000 } : {}), ...providerFields(data) }; }
    if (status >= 500) return { outcome: 'unavailable', reason: 'server', status, ...providerFields(data) };
    if (status >= 400) return { outcome: 'rejected', status, ...providerFields(data) };
    if (status === 204) return { outcome: 'ok', status, data: null };
    if (data === undefined || data === null || typeof data !== 'object') return { outcome: 'invalid_response', reason: 'not_json', status };
    return { outcome: 'ok', status, data };
  } finally { clearTimeout(timer); }
}

function str(value, max = 200) { return typeof value === 'string' && value.length <= max ? value : undefined; }
function parseModels(data) {
  if (!data || !Array.isArray(data.items) || data.items.length > 500) return null;
  const models = [];
  for (const item of data.items) {
    if (!item || typeof item !== 'object') return null;
    const id = str(item.id), displayName = str(item.displayName);
    if (!id || !displayName) return null;
    const aliases = Array.isArray(item.aliases) ? item.aliases.map(a => str(a)).filter(Boolean) : [];
    const parameters = Array.isArray(item.parameters) ? item.parameters.map(p => p && typeof p === 'object' && str(p.id) && Array.isArray(p.values) ? { id: p.id, values: p.values.map(v => v && typeof v === 'object' ? str(v.value) : undefined).filter(Boolean) } : null) : undefined;
    if (parameters && parameters.includes(null)) return null;
    const variants = Array.isArray(item.variants) ? item.variants.map(v => v && typeof v === 'object' && Array.isArray(v.params) && str(v.displayName) ? { displayName: v.displayName, isDefault: v.isDefault === true, params: v.params.map(p => p && typeof p === 'object' && str(p.id) && str(p.value) ? { id: p.id, value: p.value } : null) } : null) : undefined;
    if (variants && (variants.includes(null) || variants.some(v => v.params.includes(null)))) return null;
    models.push({ id, displayName, aliases, parameters, variants });
  }
  return models;
}
const paramKey = params => params.map(p => `${p.id}=${p.value}`).sort().join('&');

// Préflight : catalogue authentifié et daté ; identifiant exact listé ; la combinaison complète de la sélection est égale à une variante du catalogue. Aucune complétion, aucun repli.
// En mode pool, la clé est celle du compte indiqué (ou décidé par l’appelant) ; onResult reçoit le résultat brut pour l’enregistrement de preuve.
export async function preflight({ selection, key, access, accountId, fetchImpl, timeoutMs, onResult } = {}) {
  const checkedAt = new Date().toISOString();
  const base = { command: 'preflight', selection: selection.key, requested: { modelId: selection.modelId, params: selection.params }, catalog: { checkedAt, validated: false }, fallback: 'none', ...(accountId ? { accountId } : {}) };
  const result = await call({ path: '/v1/models', key: await accessOf(access, key).keyFor(accountId), fetchImpl, timeoutMs });
  if (onResult) onResult(result);
  if (result.outcome !== 'ok') return { ...base, status: 'unavailable', reason: result.reason ?? result.outcome, ...(result.status ? { httpStatus: result.status } : {}), ...(result.retryAfterMs ? { retryAfterMs: result.retryAfterMs } : {}), ...(result.providerCode ? { providerCode: result.providerCode } : {}) };
  const models = parseModels(result.data);
  if (!models) return { ...base, status: 'unavailable', reason: 'invalid_response', httpStatus: result.status };
  const exact = models.find(m => m.id === selection.modelId);
  if (!exact) {
    const alias = models.find(m => m.aliases.includes(selection.modelId));
    if (alias) return { ...base, status: 'blocked', reason: 'alias_only', canonicalId: alias.id, modelsListed: models.length };
    const family = selection.modelId.split(/[-.]/).find(part => /^[a-z]{3,}$/i.test(part) && !/^(claude|cursor|thinking|high|low|medium|fast)$/i.test(part));
    return { ...base, status: 'blocked', reason: 'model_absent', modelsListed: models.length, candidates: models.map(m => m.id).filter(id => family && id.toLowerCase().includes(family.toLowerCase())).slice(0, 10) };
  }
  const params = selection.params;
  const variants = exact.variants ?? [];
  const variant = variants.length ? variants.find(v => paramKey(v.params) === paramKey(params)) : (params.length ? undefined : { displayName: exact.displayName, params: [] });
  if (!variant) return { ...base, status: 'blocked', reason: 'variant_invalid', variants: variants.map(v => ({ displayName: v.displayName, params: v.params, isDefault: v.isDefault })), modelsListed: models.length };
  return { ...base, status: 'ok', catalog: { checkedAt, validated: true, displayName: exact.displayName, variant: variant.displayName, modelsListed: models.length } };
}

// Registre privé, hors dépôt : { formatVersion:1, missions:{ [mission]: entrée } }. Écriture atomique.
export async function loadRegistry(file) {
  if (!file) throw new UsageError('--registry <fichier hors dépôt> requis.');
  try { const data = JSON.parse(await readFile(file, 'utf8')); if (!data || data.formatVersion !== 1 || typeof data.missions !== 'object') throw new UsageError('Registre invalide.'); return data; }
  catch (error) { if (error.code === 'ENOENT') return { formatVersion: 1, missions: {} }; if (error instanceof UsageError) throw error; throw new UsageError('Registre illisible.'); }
}
export async function saveRegistry(file, registry) {
  await mkdir(dirname(resolve(file)), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, JSON.stringify(registry, null, 2) + '\n'); await rename(temp, file);
}
function agentSummary(agent) {
  if (!agent || typeof agent !== 'object' || typeof agent.id !== 'string' || !agentIdPattern.test(agent.id)) return null;
  const out = { agentId: agent.id, status: str(agent.status, 20) };
  for (const field of ['url', 'latestRunId', 'createdAt', 'updatedAt']) { const value = str(agent[field], 500); if (value) out[field] = value; }
  return out;
}
function runSummary(run, { full = false } = {}) {
  if (!run || typeof run !== 'object' || typeof run.id !== 'string' || !runIdPattern.test(run.id) || typeof run.agentId !== 'string') return null;
  const out = { runId: run.id, agentId: run.agentId, status: str(run.status, 20) };
  for (const field of ['createdAt', 'updatedAt']) { const value = str(run[field], 64); if (value) out[field] = value; }
  if (Number.isInteger(run.durationMs)) out.durationMs = run.durationMs;
  if (typeof run.result === 'string') out.result = full || run.result.length <= 1200 ? run.result : `${run.result.slice(0, 1200)}… [tronqué ${run.result.length} caractères]`;
  if (run.git && Array.isArray(run.git.branches)) out.branches = run.git.branches.filter(b => b && typeof b === 'object').map(b => ({ repoUrl: str(b.repoUrl, 500), ...(str(b.branch, 250) ? { branch: b.branch } : {}), ...(str(b.prUrl, 500) ? { prUrl: b.prUrl } : {}) }));
  return out;
}

// Reçu de sélection : ce qui a été demandé à l’attribution, ce que le catalogue a validé, ce que l'API a accepté ; modelObserved reste null tant que l'API n'expose pas le modèle d'un run.
// initialSelection = choix à l’attribution (toujours `selection`) ; currentSelection n’existe qu’après une exception (repli Grok 4.6), distincte et datée. createAccepted/runAccepted
// de premier niveau ne parlent que de la sélection initiale : en exception, le POST portait la sélection courante, et c’est elle qui est marquée acceptée (`accepted`, `currentSelection`).
function selectionReceipt(selection, { createAccepted = false, runAccepted = false, entry } = {}) {
  const current = entry?.currentSelection ?? null;
  const sent = current ?? selection;
  const accepted = { modelId: sent.modelId, params: sent.params, createAccepted, runAccepted };
  return { key: selection.key, requested: { modelId: selection.modelId, params: selection.params }, catalog: selection.catalog, createAccepted: current ? false : createAccepted, runAccepted: current ? false : runAccepted, accepted, modelObserved: null, note: 'Un POST accepté ne prouve pas la sélection effective ; un routage interne du fournisseur reste possible.', ...(current ? { currentSelection: { key: current.key, requested: { modelId: current.modelId, params: current.params }, catalog: current.catalog, createAccepted, runAccepted }, exception: entry.exception ?? null } : {}) };
}
function markRunAccepted(receipt) { if (!receipt) return; receipt.accepted.runAccepted = true; if (receipt.currentSelection) receipt.currentSelection.runAccepted = true; else receipt.runAccepted = true; }
const effectiveSelection = entry => entry?.currentSelection ?? entry?.selection ?? null;
const hasLineage = entry => Boolean(entry && (typeof entry.successorOf === 'string' || (Array.isArray(entry.predecessors) && entry.predecessors.length)));
// Livraison incertaine : la requête a pu atteindre le serveur (délai, réseau, redirection, 5xx). Un refus explicite (statut < 500 reçu) n’a rien créé.
const deliveryUncertain = result => result?.delivery !== 'not_sent' && !(Number.isInteger(result?.status) && result.status >= 400 && result.status < 500);
const accountFields = (accountId, decision) => (accountId ? { account: { id: accountId, ...(decision ? { pool: decision.pool, decision: decision.status, ...(decision.explicitValidation ? { explicitValidation: decision.explicitValidation } : {}) } : {}) } } : {});

// Création d’un agent (lancement ou successeur) : POST unique avec agentId déterministe, réconciliation des 409 et appels incertains, preuve enregistrée sur le compte appelé.
async function createAgent({ command, mission, entry, registry, registryFile, body, key, access, accountId, decision, modelId, fetchImpl, timeoutMs, now }) {
  const agentId = body.agentId;
  const result = await call({ method: 'POST', path: '/v1/agents', body, key, fetchImpl, timeoutMs });
  const evidence = await recordEvidence(access, accountId, { callKind: 'create', modelId, result, agentId });
  const extra = { ...accountFields(accountId, decision), ...(evidence ? { evidence: { classification: evidence.classification, recorded: evidence.recorded, ...(evidence.httpStatus ? { httpStatus: evidence.httpStatus } : {}) } } : {}) };
  const hint = evidenceHint(evidence);
  const finish = async (state, fields) => { Object.assign(entry, { state, updatedAt: now() }, fields); await saveRegistry(registryFile, registry); };
  if (result.outcome === 'ok') {
    const agent = agentSummary(result.data?.agent), run = runSummary(result.data?.run);
    if (!agent || !run || agent.agentId !== agentId || run.agentId !== agentId) {
      // L’API a accepté quelque chose sous une identité inattendue : conserver ce qu’elle a réellement retourné ; aucun nouvel identifiant, aucun POST, décision humaine après reconcile.
      const returned = { agentId: agent?.agentId ?? run?.agentId ?? null, runId: run?.runId ?? null, ...(agent?.url ? { url: agent.url } : {}) };
      await finish('uncertain', { reason: 'identity_mismatch', returned });
      return { command, status: 'uncertain', mission, agentId, reason: 'identity_mismatch', returned, nextAction: 'reconcile --mission : lit l’identifiant attendu et l’identifiant retourné ; aucun POST, aucun successeur tant que non résolu', ...extra };
    }
    await finish('launched', { runId: run.runId, url: agent.url });
    return { command, status: 'launched', mission, agentId, runId: run.runId, url: agent.url, selection: selectionReceipt(entry.selection, { createAccepted: true, entry }), ...extra };
  }
  if (result.outcome === 'rejected' && result.status === 409) {
    // Conflit : l’agent existe (pour ce compte) ; un 404 juste après serait contradictoire, donc incertain, jamais « non créé ».
    const reconciled = await reconcileEntry({ entry, key, fetchImpl, timeoutMs, now, concludeAbsent: false });
    await saveRegistry(registryFile, registry);
    return { command, status: reconciled.state === 'reconciled' ? 'existing' : 'uncertain', mission, agentId, providerCode: result.providerCode, ...reconciled, ...extra };
  }
  if (result.outcome === 'rejected') { await finish('failed', { reason: 'rejected', httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}) }); return { command, status: 'blocked', mission, agentId, reason: 'rejected', httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}), ...extra, ...(hint ? { nextAction: hint } : {}) }; }
  if (result.delivery === 'not_sent') { await finish('failed', { reason: result.reason }); return { command, status: 'unavailable', mission, agentId, reason: result.reason, ...extra }; }
  // Envoi incertain (délai, réseau, 5xx) : l’agent existe peut-être, ou existera dans un instant. Une seule lecture ; un 404 immédiat ne prouve pas l’absence :
  // l’état reste uncertain, la conclusion « non créé » appartient à un reconcile explicite ultérieur. Un refus explicite (4xx) lu ensuite en 404 vaut bien « non créé ».
  const uncertain = deliveryUncertain(result);
  const reconciled = await reconcileEntry({ entry, key, fetchImpl, timeoutMs, now, unavailableState: 'uncertain', unavailableReason: result.reason, concludeAbsent: !uncertain });
  await saveRegistry(registryFile, registry);
  return { command, status: reconciled.state === 'reconciled' ? 'existing' : reconciled.state === 'not_created' ? 'unavailable' : 'uncertain', mission, agentId, reason: result.reason, deliveryReason: result.reason, ...reconciled, ...extra, ...(reconciled.state === 'uncertain' ? { nextAction: reconciled.reason === 'not_found_after_unknown_delivery' ? 'reconcile --mission plus tard : livraison incertaine, un 404 immédiat ne prouve pas l’absence ; aucun POST, aucun successeur' : 'reconcile' } : hint ? { nextAction: hint } : {}) };
}
// Lancement dédupliqué : registre → décision de compte (pool) → préflight → POST avec agentId déterministe → réconciliation des 409 et appels incertains.
export async function launch({ mission, repo, ref, prUrl, promptText, name, autoCreatePR = false, workOnCurrentBranch = true, config, select, account, key, access, registryFile, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  if (typeof mission !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(mission)) throw new UsageError('--mission : clé courte [A-Za-z0-9._-] requise.');
  if (typeof promptText !== 'string' || !promptText.trim() || promptText.length > 200_000) throw new UsageError('Brief vide ou trop long.');
  const repoUrl = normalizeRepo(repo);
  if (prUrl !== undefined) { const url = new URL(prUrl); if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?$/.test(url.pathname) || url.search || url.hash || url.username) throw new UsageError('URL de PR GitHub attendue.'); }
  else refName(ref);
  const chosen = resolveSelection(config, select);
  access = accessOf(access, key);
  if (account !== undefined) { assertAccountId(account); if (!access.pool) throw new UsageError('--account exige le pool de comptes (CURSOR_API_KEY désigne un seul compte implicite).'); }
  const registry = await loadRegistry(registryFile);
  const existing = registry.missions[mission];
  // pending = POST interrompu avant enregistrement du résultat : l'agent existe peut-être ; reconcile, jamais un nouveau lancement ni une reprise aveugle.
  if (existing && activeStates.has(existing.state)) return { command: 'launch', status: 'deduplicated', mission, entry: existing, nextAction: ['uncertain', 'pending'].includes(existing.state) ? 'reconcile' : hasLineage(existing) ? 'followup --mission (même agent successeur) ; jamais launch sur une mission à chaîne' : 'followup ou nouvelle clé de mission' };
  // Mission à chaîne prédécesseur/successeur : launch écraserait la chaîne et le propriétaire et réutiliserait l’identifiant initial avec une autre clé. Refus ; la suite est successor ou followup.
  if (existing && hasLineage(existing)) return { command: 'launch', status: 'blocked', mission, reason: 'mission_has_lineage', agentId: existing.agentId, lineage: { successorOf: existing.successorOf ?? null, predecessors: (existing.predecessors ?? []).length, state: existing.state }, nextAction: ['failed', 'not_created'].includes(existing.state) ? 'successor --mission --checkpoint <SHA enregistré> : nouvelle tentative de successeur (relecture du prédécesseur), jamais launch' : 'reconcile --mission puis followup --mission sur le successeur ; jamais launch (historique et propriétaire seraient perdus)' };
  // Décision de compte, déterministe et relue dans l’état partagé : même sélection sur le compte premium éligible ; exception seulement selon la politique du pool.
  let decision = null, accountId = null, active = chosen, exception;
  if (access.pool) {
    const fallbackSelection = fallbackSelectionOf(config, access);
    decision = account ? await routeExplicit(access, account, chosen) : await access.pool.decide({ selection: chosen, fallbackSelection });
    if (decision.status === 'blocked') return { command: 'launch', status: 'blocked', mission, reason: decision.reason, decision, nextAction: decision.nextAction };
    accountId = decision.accountId;
    if (decision.status === 'exception') { active = fallbackSelection; exception = { reason: decision.reason, at: now(), confirmed: decision.confirmed, proof: decision.proof, initialModelId: chosen.modelId }; }
  }
  let modelsResult;
  const check = await preflight({ selection: active, access, accountId, fetchImpl, timeoutMs, onResult: r => { modelsResult = r; } });
  if (check.status !== 'ok') { const evidence = await recordEvidence(access, accountId, { callKind: 'models', modelId: active.modelId, result: modelsResult }); return { command: 'launch', status: check.status, mission, preflight: check, ...accountFields(accountId, decision), ...(evidence ? { evidence: { classification: evidence.classification, recorded: evidence.recorded } } : {}), ...(evidenceHint(evidence) ? { nextAction: evidenceHint(evidence) } : {}) }; }
  const agentId = missionAgentId(repoUrl, mission);
  // La sélection est fixée ici, une fois, et conservée pour toute la mission (reprises comprises). En cas d’exception, initiale et courante restent distinctes.
  const catalog = { checkedAt: check.catalog.checkedAt, displayName: check.catalog.displayName, variant: check.catalog.variant };
  const selection = { key: chosen.key, modelId: chosen.modelId, params: chosen.params, catalog: exception ? { checkedAt: check.catalog.checkedAt, validated: false, note: 'sélection initiale non validée : exception au lancement' } : catalog };
  const entry = { agentId, repo: repoUrl, ...(prUrl ? { prUrl } : { ref }), workOnCurrentBranch: workOnCurrentBranch !== false, selection, ...(exception ? { currentSelection: { key: active.key, modelId: active.modelId, params: active.params, catalog }, exception } : {}), ...(accountId ? { accountId } : {}), state: 'pending', updatedAt: now() };
  registry.missions[mission] = entry; await saveRegistry(registryFile, registry);
  const body = { agentId, prompt: { text: promptText }, model: active.params.length ? { id: active.modelId, params: active.params } : { id: active.modelId }, repos: [prUrl ? { url: repoUrl, prUrl } : { url: repoUrl, startingRef: ref }], workOnCurrentBranch, autoCreatePR, ...(name ? { name: String(name).slice(0, 100) } : {}) };
  return createAgent({ command: 'launch', mission, entry, registry, registryFile, body, key: await access.keyFor(accountId), access, accountId, decision, modelId: active.modelId, fetchImpl, timeoutMs, now });
}
// Compte imposé (--account) : décision humaine explicite, par exemple une mission bornée grok destinée à produire la preuve d’accès standard, ou la validation
// d’un compte en startBlock après relèvement manuel du plafond (l’acceptation lève le blocage). Composer reste interdit, un pool confirmé indisponible aussi.
async function routeExplicit(access, accountId, selection) {
  if (/composer/i.test(selection.modelId)) return { status: 'blocked', reason: 'composer_forbidden', accountId, nextAction: 'Composer n’est jamais utilisé.' };
  const owner = await access.pool.owner({ accountId, modelId: selection.modelId });
  if (!owner.known) return { status: 'blocked', reason: 'account_unknown', accountId, nextAction: `compte ${accountId} absent de l’état du pool.` };
  if (owner.confirmedUnavailable) return { status: 'blocked', reason: 'account_pool_unavailable', accountId, pool: owner.pool, poolState: owner.poolState, nextAction: `pool ${owner.pool} du compte ${accountId} confirmé indisponible (${owner.poolState}) : réactiver manuellement après vérification, aucun POST.` };
  return { status: 'route', accountId, pool: owner.pool, modelId: selection.modelId, selection: 'initial', explicit: true, ...(owner.startBlocked ? { explicitValidation: 'start_block', startBlock: owner.startBlock } : {}) };
}
async function readAgent({ agentId, key, fetchImpl, timeoutMs }) {
  const result = await call({ path: `/v1/agents/${encodeURIComponent(agentId)}`, key, fetchImpl, timeoutMs });
  if (result.outcome !== 'ok') return { failure: { status: result.outcome === 'rejected' ? 'blocked' : 'unavailable', reason: result.reason ?? result.outcome, ...(result.status ? { httpStatus: result.status } : {}), ...(result.providerCode ? { providerCode: result.providerCode } : {}) }, httpStatus: result.status };
  const agent = agentSummary(result.data);
  if (!agent || agent.agentId !== agentId) return { failure: { status: 'unavailable', reason: 'invalid_response' }, httpStatus: result.status };
  return { agent };
}
const openFollowup = entry => entry?.followup && ['pending', 'uncertain'].includes(entry.followup.state) ? entry.followup : null;
// Reprise en attente : l'agent tranche. latestRunId différent du run d'avant tentative ⇒ le POST de suite a été accepté (même si ce run est déjà terminé) ;
// identique ⇒ rien n'a été créé, une réémission redevient possible. Dernier run inconnu ⇒ reste incertain. Aucun POST ici.
function settleFollowup(entry, agent, now) {
  const pending = openFollowup(entry);
  if (!pending) return null;
  if (!agent.latestRunId) { Object.assign(pending, { state: 'uncertain', reason: 'latest_run_unknown', updatedAt: now() }); return { state: 'uncertain', priorRunId: pending.priorRunId, reason: 'latest_run_unknown' }; }
  if (agent.latestRunId !== pending.priorRunId) {
    Object.assign(pending, { state: 'accepted', runId: agent.latestRunId, settledAt: now() }); delete pending.reason;
    Object.assign(entry, { runId: agent.latestRunId, followups: (entry.followups ?? 0) + 1 });
    return { state: 'accepted', priorRunId: pending.priorRunId, runId: agent.latestRunId };
  }
  Object.assign(pending, { state: 'not_created', settledAt: now() }); delete pending.reason;
  return { state: 'not_created', priorRunId: pending.priorRunId };
}
// concludeAbsent : un 404 ne conclut « non créé » que si l’appelant l’autorise (reconcile explicite, ou lecture après un refus explicite), jamais juste après une livraison incertaine.
async function reconcileEntry({ entry, key, fetchImpl, timeoutMs, now, unavailableState = 'uncertain', unavailableReason, concludeAbsent = true }) {
  const { agent, failure, httpStatus } = await readAgent({ agentId: entry.agentId, key, fetchImpl, timeoutMs });
  if (agent) { Object.assign(entry, { state: 'reconciled', updatedAt: now(), ...(agent.latestRunId ? { runId: agent.latestRunId } : {}), ...(agent.url ? { url: agent.url } : {}) }); delete entry.reason; const followup = settleFollowup(entry, agent, now); return { state: 'reconciled', agent, ...(followup ? { followup } : {}) }; }
  if (failure.reason === 'invalid_response' && httpStatus === 200) { Object.assign(entry, { state: 'uncertain', reason: 'identity_mismatch', updatedAt: now() }); return { state: 'uncertain', reason: 'identity_mismatch', ...(entry.returned ? { returned: entry.returned } : {}) }; }
  // 404 ne vaut « jamais créé » que pour un lancement dont aucun run n'a été confirmé, hors identité inattendue et hors lecture immédiate après livraison incertaine ;
  // un agent connu puis introuvable reste incertain, jamais une permission de recréer.
  if (httpStatus === 404 && !entry.runId && !entry.followup && concludeAbsent && entry.reason !== 'identity_mismatch') { Object.assign(entry, { state: 'not_created', updatedAt: now() }); delete entry.reason; return { state: 'not_created' }; }
  const reason = httpStatus === 404 ? (entry.reason === 'identity_mismatch' ? 'identity_mismatch' : concludeAbsent ? 'agent_not_found' : 'not_found_after_unknown_delivery') : unavailableReason ?? failure.reason;
  Object.assign(entry, { state: unavailableState, reason, updatedAt: now() });
  return { state: unavailableState, reason: entry.reason, ...(entry.returned ? { returned: entry.returned } : {}) };
}
// Réconciliation : toujours avec la clé du compte propriétaire de l’agent (même inactif pour la dépense) ; un autre compte ne voit pas cet agent (404).
// Action explicite de l’orchestrateur : c’est ici qu’un 404 peut conclure « non créé » (limite documentée) ; une identité inattendue reste une décision humaine.
export async function reconcile({ mission, key, access, registryFile, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  access = accessOf(access, key);
  const { registry, entry } = await missionEntry({ mission, registryFile });
  const ownerKey = await access.keyFor(entry.accountId);
  const reconciled = await reconcileEntry({ entry, key: ownerKey, fetchImpl, timeoutMs, now });
  // Identité inattendue : lire aussi l’identifiant réellement retourné par l’API, sans l’adopter ni rien créer.
  let returnedAgent;
  if (reconciled.state === 'uncertain' && reconciled.reason === 'identity_mismatch' && entry.returned?.agentId && agentIdPattern.test(entry.returned.agentId)) {
    const read = await readAgent({ agentId: entry.returned.agentId, key: ownerKey, fetchImpl, timeoutMs });
    returnedAgent = read.agent ? { found: true, ...read.agent } : { found: false, ...read.failure };
  }
  await saveRegistry(registryFile, registry);
  const lineage = hasLineage(entry);
  const nextAction = reconciled.state === 'not_created' ? (lineage ? 'successeur non créé : successor --mission --checkpoint <même SHA> pour une nouvelle tentative ; jamais launch (la chaîne prédécesseur/successeur serait écrasée)' : 'launch autorisé sur la même clé')
    : reconciled.reason === 'identity_mismatch' ? `identité inattendue : l’API a retourné ${entry.returned?.agentId ?? 'un identifiant inconnu'}${returnedAgent ? (returnedAgent.found ? ' (agent lisible par le propriétaire)' : ' (illisible par le propriétaire)') : ''} au lieu de ${entry.agentId}. Décision humaine : vérifier cet agent dans le tableau de bord ; aucun POST, aucun successeur, aucune nouvelle création tant que non résolu.`
    : reconciled.reason === 'not_found_after_unknown_delivery' ? 'agent introuvable après livraison incertaine : reconcile à nouveau plus tard ; aucune création ni réémission'
    : reconciled.followup?.state === 'accepted' ? 'status --mission sur le nouveau run ; aucune réémission (limite documentée : latestRunId différent vaut acceptation, un run tiers n’est pas exclu)' : reconciled.followup?.state === 'not_created' ? 'followup --mission autorisé (aucun run accepté depuis priorRunId)' : reconciled.followup?.state === 'uncertain' ? 'dernier run de l’agent inconnu : reprise toujours incertaine ; reconcile à nouveau plus tard, aucune réémission' : reconciled.state === 'uncertain' ? 'reconcile à nouveau ; aucune création ni réémission' : undefined;
  return { command: 'reconcile', mission, agentId: entry.agentId, ...accountFields(entry.accountId), status: reconciled.state, ...(reconciled.agent ? { agent: reconciled.agent } : {}), ...(reconciled.reason ? { reason: reconciled.reason } : {}), ...(reconciled.returned ? { returned: reconciled.returned } : {}), ...(returnedAgent ? { returnedAgent } : {}), ...(reconciled.followup ? { followup: reconciled.followup } : {}), ...(lineage ? { lineage: { successorOf: entry.successorOf ?? null, predecessors: (entry.predecessors ?? []).length } } : {}), ...(nextAction ? { nextAction } : {}) };
}

// Checkpoint : une lecture du run, diff par rapport au dernier état enregistré, résultat tronqué.
export function diffRun(previous, current) {
  const changes = [];
  if (!previous) return ['premier relevé'];
  if (previous.status !== current.status) changes.push(`statut ${previous.status ?? '?'} → ${current.status}`);
  const before = JSON.stringify(previous.branches ?? []), after = JSON.stringify(current.branches ?? []);
  if (before !== after) changes.push('branches/PR modifiées');
  if (!previous.result && current.result) changes.push('résultat final disponible');
  return changes;
}
export const terminalRunStatuses = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);
export function nextInterval(previousMs) { const index = pollIntervalsMs.indexOf(previousMs); return index < 0 ? pollIntervalsMs[0] : pollIntervalsMs[Math.min(index + 1, pollIntervalsMs.length - 1)]; }
async function missionEntry({ mission, registryFile }) {
  const registry = await loadRegistry(registryFile);
  const entry = registry.missions[mission];
  if (!entry) throw new UsageError('Mission inconnue du registre.');
  return { registry, entry };
}
async function readRun({ agentId, runId, key, fetchImpl, timeoutMs, full }) {
  const result = await call({ path: `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`, key, fetchImpl, timeoutMs });
  if (result.outcome !== 'ok') return { failure: { status: result.outcome === 'rejected' ? 'blocked' : 'unavailable', reason: result.reason ?? result.outcome, ...(result.status ? { httpStatus: result.status } : {}), ...(result.providerCode ? { providerCode: result.providerCode } : {}) } };
  const run = runSummary(result.data, { full });
  if (!run || run.runId !== runId || run.agentId !== agentId) return { failure: { status: 'unavailable', reason: 'invalid_response' } };
  return { run };
}
// Checkpoint : le run demandé (ou le dernier run de la mission), le diff, et la sélection initiale rappelée telle quelle. Clé du propriétaire ; --agent en mode pool exige --account.
export async function status({ agentId, runId, mission, account, registryFile, stateFile, key, access, fetchImpl, timeoutMs, full = false }) {
  access = accessOf(access, key);
  let entry, accountId = account === undefined ? undefined : assertAccountId(account);
  if (mission !== undefined) { ({ entry } = await missionEntry({ mission, registryFile })); agentId ??= entry.agentId; runId ??= entry.runId; if (accountId !== undefined && entry.accountId && accountId !== entry.accountId) throw new UsageError('Le compte indiqué n’est pas le propriétaire de la mission.'); accountId = entry.accountId; if (!runId) throw new UsageError('Aucun run connu pour cette mission ; reconcile d’abord.'); }
  assertAgentId(agentId); assertRunId(runId);
  const { run, failure } = await readRun({ agentId, runId, key: await access.keyFor(accountId), fetchImpl, timeoutMs, full });
  if (failure) return { command: 'status', ...failure, agentId, runId, ...accountFields(accountId) };
  let previous = null;
  if (stateFile) { try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new UsageError('Fichier d’état illisible.'); } }
  const changes = diffRun(previous, run);
  if (stateFile) { await mkdir(dirname(resolve(stateFile)), { recursive: true }); await writeFile(stateFile, JSON.stringify(run, null, 2) + '\n'); }
  return { command: 'status', status: 'ok', changed: changes.length > 0, changes, terminal: terminalRunStatuses.has(run.status), run, ...accountFields(accountId), ...(entry?.selection ? { selection: selectionReceipt(entry.selection, { createAccepted: true, entry }) } : {}) };
}

// Reprise du même agent (docs/MAINTENANCE.md : pas de doublon). Toujours : lire l'agent réel et son latestRunId, lire ce run, exiger un état terminal,
// puis un seul POST sans champ model (la sélection initiale s'applique telle quelle). Avec --mission, la tentative est persistée avant l'envoi et
// une livraison inconnue impose reconcile avant toute réémission. Sans registre (--agent), garde minimale seulement : aucune idempotence.
// Toujours la clé du compte propriétaire : jamais une reprise d’un ancien agent avec une autre clé (l’API répond 404 et le run serait perdu).
export async function followup({ agentId, mission, account, registryFile, promptText, key, access, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  access = accessOf(access, key);
  let registry, entry, accountId = account === undefined ? undefined : assertAccountId(account);
  if (mission !== undefined) {
    ({ registry, entry } = await missionEntry({ mission, registryFile }));
    if (!['launched', 'reconciled'].includes(entry.state)) throw new UsageError(`Mission en état ${entry.state} : ${entry.state === 'not_created' || entry.state === 'failed' ? (hasLineage(entry) ? 'successor --checkpoint <SHA enregistré> (nouvelle tentative, jamais launch)' : 'launch') : 'reconcile'} avant toute reprise.`);
    agentId ??= entry.agentId;
    if (agentId !== entry.agentId) throw new UsageError('L’agent indiqué n’est pas celui de la mission.');
    if (accountId !== undefined && entry.accountId && accountId !== entry.accountId) throw new UsageError('Le compte indiqué n’est pas le propriétaire de la mission ; jamais de reprise avec une autre clé.');
    accountId = entry.accountId;
  }
  assertAgentId(agentId);
  if (typeof promptText !== 'string' || !promptText.trim() || promptText.length > 200_000) throw new UsageError('Brief de reprise vide ou trop long.');
  const receipt = entry
    ? { selection: entry.selection ? selectionReceipt(entry.selection, { createAccepted: true, entry }) : undefined, modelSent: false, persistent: true }
    : { modelSent: false, persistent: false, note: 'Sans registre : aucune idempotence ; en cas de livraison inconnue, lire l’agent (latestRunId) soi-même ; aucune répétition automatique. Utiliser --mission/--registry pour une reprise réconciliable.' };
  const report = (fields) => ({ command: 'followup', agentId, ...accountFields(accountId), ...fields, ...receipt });
  const persist = async (fields) => { if (!entry) return; Object.assign(entry, fields, { updatedAt: now() }); await saveRegistry(registryFile, registry); };
  const unresolved = openFollowup(entry);
  if (unresolved) return report({ status: 'blocked', reason: 'followup_unresolved', followup: unresolved, nextAction: 'reconcile --mission avant toute réémission ; aucun POST envoyé' });
  const ownerKey = await access.keyFor(accountId);
  const modelId = effectiveSelection(entry)?.modelId ?? null;
  const { agent, failure: agentFailure } = await readAgent({ agentId, key: ownerKey, fetchImpl, timeoutMs });
  if (agentFailure) return report({ ...agentFailure, nextAction: 'agent illisible : aucun POST envoyé ; relire plus tard' });
  if (!agent.latestRunId) return report({ status: 'blocked', reason: 'latest_run_unknown', nextAction: 'dernier run inconnu : aucun POST envoyé' });
  const registryRunId = entry?.runId;
  const { run, failure: runFailure } = await readRun({ agentId, runId: agent.latestRunId, key: ownerKey, fetchImpl, timeoutMs });
  if (runFailure) return report({ ...runFailure, runId: agent.latestRunId, nextAction: 'run actuel illisible : aucun POST envoyé' });
  if (registryRunId && registryRunId !== run.runId) await persist({ runId: run.runId });
  const stale = registryRunId && registryRunId !== run.runId ? { registryRunId } : {};
  if (!terminalRunStatuses.has(run.status)) return report({ status: 'blocked', reason: 'run_active', runId: run.runId, runStatus: run.status, ...stale, nextAction: 'attendre le terminal (status --follow) ; aucun second run envoyé' });
  // Pool confirmé indisponible pour le propriétaire : aucun POST voué à l’échec ; la suite passe par un successeur lié sur le compte premium suivant.
  // Départ bloqué (plafond refusé) : un run est un nouveau départ ; seul « --account <propriétaire> » explicite vaut validation humaine après relèvement du plafond.
  if (access.pool && accountId && modelId) {
    const owner = await access.pool.owner({ accountId, modelId });
    if (owner.confirmedUnavailable) return report({ status: 'blocked', reason: 'owner_pool_unavailable', runId: run.runId, pool: owner.pool, poolState: owner.poolState, ...stale, nextAction: `pool ${owner.pool} du compte propriétaire ${accountId} confirmé indisponible (${owner.poolState}) : aucun POST ; successor --mission --checkpoint <SHA poussé> pour continuer sur le compte premium suivant, ou réactiver le compte après vérification manuelle.` });
    if (owner.startBlocked && account === undefined) return report({ status: 'blocked', reason: 'owner_start_blocked', runId: run.runId, startBlock: owner.startBlock, ...stale, nextAction: `départs bloqués sur le compte propriétaire ${accountId} depuis un refus de plafond (${owner.startBlock?.at ?? 'date inconnue'}) : aucun POST. Relever la limite manuellement puis valider explicitement par « followup --mission … --account ${accountId} ». Aucun successeur : la disponibilité du propriétaire n’est pas confirmée indisponible, seulement bloquée au départ.` });
  }
  const priorRunId = run.runId;
  await persist({ followup: { state: 'pending', priorRunId, requestedAt: now() } });
  const result = await call({ method: 'POST', path: `/v1/agents/${encodeURIComponent(agentId)}/runs`, body: { prompt: { text: promptText } }, key: ownerKey, fetchImpl, timeoutMs });
  const evidence = await recordEvidence(access, accountId, { callKind: 'run', modelId, result, agentId });
  const evidenceFields = evidence ? { evidence: { classification: evidence.classification, recorded: evidence.recorded } } : {};
  const hint = evidenceHint(evidence);
  if (result.outcome === 'ok') {
    const accepted = runSummary(result.data?.run);
    if (accepted && accepted.agentId === agentId && accepted.runId !== priorRunId) {
      await persist({ runId: accepted.runId, followups: (entry?.followups ?? 0) + 1, followup: { state: 'accepted', priorRunId, runId: accepted.runId, settledAt: now() } });
      markRunAccepted(receipt.selection);
      return report({ status: 'launched', priorRunId, runId: accepted.runId, runStatus: accepted.status, ...stale, ...evidenceFields });
    }
    await persist({ followup: { state: 'uncertain', priorRunId, reason: 'invalid_response', requestedAt: entry?.followup?.requestedAt } });
    return report({ status: 'uncertain', reason: 'invalid_response', priorRunId, nextAction: entry ? 'reconcile --mission ; aucune réémission avant' : 'lire l’agent (latestRunId ≠ priorRunId ⇒ accepté) ; aucune répétition automatique', ...evidenceFields });
  }
  if (result.outcome === 'rejected') {
    // Dont 409 agent_busy : garde complémentaire du serveur, pas la preuve du contrôle client effectué ci-dessus.
    await persist({ followup: { state: 'rejected', priorRunId, httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}), settledAt: now() } });
    return report({ status: 'blocked', reason: 'rejected', priorRunId, httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}), ...evidenceFields, ...(hint ? { nextAction: hint } : {}) });
  }
  if (result.delivery === 'not_sent') {
    await persist({ followup: { state: 'not_created', priorRunId, reason: result.reason, settledAt: now() } });
    return report({ status: 'unavailable', reason: result.reason, priorRunId, nextAction: 'requête non émise ; followup à nouveau possible' });
  }
  await persist({ followup: { state: 'uncertain', priorRunId, reason: result.reason, requestedAt: entry?.followup?.requestedAt } });
  return report({ status: 'uncertain', reason: result.reason, priorRunId, nextAction: entry ? `reconcile --mission ; aucune réémission avant${hint ? ` ; ${hint}` : ''}` : 'lire l’agent (latestRunId ≠ priorRunId ⇒ accepté) ; aucune répétition automatique', ...evidenceFields });
}

// Branche de travail réellement produite par le run terminal : `run.git.branches` pour le dépôt de la mission. Avec --new-branch, entry.ref est la base initiale et le run
// travaille sur une autre branche (cursor/…) : le successeur doit démarrer au HEAD de cette branche-là. Ambiguïté ou branche inattendue ⇒ refus, sauf attestation explicite --branch.
function observedBranches(run, repoUrl) {
  const repo = normalizeRepo(repoUrl).toLowerCase().replace(/^https:\/\//, '');
  const same = value => typeof value === 'string' && value.toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\/$/, '') === repo;
  return [...new Set((run.branches ?? []).filter(b => same(b.repoUrl) && typeof b.branch === 'string' && b.branch).map(b => b.branch))];
}
function resolveWorkingBranch({ predecessor, run, branch }) {
  const observed = observedBranches(run, predecessor.repo);
  const blocked = (reason, nextAction) => ({ blocked: { status: 'blocked', reason, observedBranches: observed, ...(branch !== undefined ? { branch } : {}), nextAction } });
  if (predecessor.prUrl) {
    if (branch !== undefined && observed.length && !observed.includes(branch)) return blocked('branch_unexpected', `branche attestée ${branch} absente des branches observées du run (${observed.join(', ')}) ; aucun successeur.`);
    return { branch: branch ?? observed[0] ?? null, source: branch !== undefined ? 'orchestrator' : observed.length ? 'run_observed' : 'pr_url', observed };
  }
  if (observed.length > 1 && (branch === undefined || !observed.includes(branch))) return blocked('branch_ambiguous', `le run terminal expose plusieurs branches pour ce dépôt (${observed.join(', ')}) : indiquer --branch <celle vérifiée> ; aucun successeur.`);
  if (observed.length === 1) {
    if (branch !== undefined && branch !== observed[0]) return blocked('branch_unexpected', `branche attestée ${branch} ≠ branche observée du run ${observed[0]} ; aucun successeur.`);
    if (branch === undefined && predecessor.workOnCurrentBranch !== false && observed[0] !== predecessor.ref) return blocked('branch_unexpected', `le run a travaillé sur ${observed[0]} alors que la mission ${predecessor.workOnCurrentBranch === true ? 'demandait la branche courante' : 'ne précise pas son mode de branche'} ${predecessor.ref} : vérifier, puis attester par --branch ${observed[0]} si c’est bien la branche de travail ; aucun successeur.`);
    return { branch: observed[0], source: branch !== undefined ? 'orchestrator' : 'run_observed', observed };
  }
  if (observed.length > 1) return { branch, source: 'orchestrator', observed };
  if (branch !== undefined) return { branch, source: 'orchestrator', observed };
  if (predecessor.workOnCurrentBranch === true && predecessor.ref) return { branch: predecessor.ref, source: 'entry_ref', observed };
  return blocked('branch_unknown', `le run terminal n’expose aucune branche pour ce dépôt et la mission ${predecessor.workOnCurrentBranch === false ? 'travaillait sur une nouvelle branche' : 'ne précise pas son mode de branche'} : indiquer --branch <branche vérifiée> ; aucun successeur.`);
}
const checkpointAttestation = 'SHA attesté par l’orchestrateur après sa propre vérification Git ; le transport ne vérifie ni Git ni le distant. Le successeur démarre au HEAD actuel de la branche figée, pas à ce SHA.';

// Successeur lié (pool seulement) : même mission, même sélection initiale, nouveau compte premium de l’ordre configuré et nouvel identifiant d’agent dérivé (l’API peut refuser
// la réutilisation d’un agentId entre comptes ; l’ancien agent n’est visible que par son propriétaire). Préconditions strictes : propriétaire confirmé indisponible pour la
// sélection courante (une préférence de compte ne justifie aucune migration : sinon followup), aucune reprise ouverte, prédécesseur relu maintenant par son propriétaire
// (agent → latestRunId → run terminal, à chaque tentative), branche de travail observée, checkpoint attesté fourni explicitement (jamais de récupération inventée). Tentative persistée.
export async function successor({ mission, registryFile, promptText, checkpoint, branch, name, config, key, access, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  access = accessOf(access, key);
  if (!access.pool) throw new UsageError('successor exige le pool de comptes : CURSOR_API_KEY désigne un seul compte, aucun successeur possible.');
  if (typeof checkpoint !== 'string' || !shaPattern.test(checkpoint)) throw new UsageError('--checkpoint <SHA Git complet, vérifié et poussé sur la branche de la mission> requis.');
  if (branch !== undefined) refName(branch);
  if (typeof promptText !== 'string' || !promptText.trim() || promptText.length > 200_000) throw new UsageError('Brief de successeur vide ou trop long.');
  const sha = checkpoint.toLowerCase();
  const { registry, entry } = await missionEntry({ mission, registryFile });
  const retrying = ['failed', 'not_created'].includes(entry.state) && typeof entry.successorOf === 'string' && Array.isArray(entry.predecessors) && entry.predecessors.length > 0;
  if (!retrying && !['launched', 'reconciled'].includes(entry.state)) throw new UsageError(`Mission en état ${entry.state} : ${['not_created', 'failed'].includes(entry.state) ? (hasLineage(entry) ? 'chaîne incomplète, reconcile' : 'launch') : 'reconcile'} avant tout successeur.`);
  if (!entry.accountId) return { command: 'successor', status: 'blocked', mission, agentId: entry.agentId, reason: 'owner_unknown', nextAction: 'entrée sans compte propriétaire (lancée avec CURSOR_API_KEY) : aucun successeur ; reprendre avec followup sous la même clé.' };
  if (!entry.selection) throw new UsageError('Entrée sans sélection initiale ; aucun successeur.');
  const persist = async (fields) => { Object.assign(entry, fields, { updatedAt: now() }); await saveRegistry(registryFile, registry); };
  // Prédécesseur : l’entrée courante à la première tentative, le dernier enregistré ensuite ; dans les deux cas relu maintenant via son propriétaire.
  const recorded = retrying ? entry.predecessors[entry.predecessors.length - 1] : null;
  const pred = retrying
    ? { agentId: recorded.agentId, accountId: recorded.accountId, runId: recorded.runId, repo: entry.repo, ref: recorded.checkpoint?.ref ?? entry.ref, prUrl: recorded.checkpoint?.prUrl ?? entry.prUrl, workOnCurrentBranch: recorded.workOnCurrentBranch, url: recorded.url, selection: recorded.selection ?? { key: entry.selection.key, modelId: entry.selection.modelId, params: entry.selection.params }, exception: recorded.exception ?? null, followups: recorded.followups }
    : { agentId: entry.agentId, accountId: entry.accountId, runId: entry.runId, repo: entry.repo, ref: entry.ref, prUrl: entry.prUrl, workOnCurrentBranch: entry.workOnCurrentBranch, url: entry.url, selection: (s => ({ key: s.key, modelId: s.modelId, params: s.params }))(effectiveSelection(entry)), exception: entry.exception ?? null, followups: entry.followups };
  const report = fields => ({ command: 'successor', mission, predecessor: { agentId: pred.agentId, accountId: pred.accountId, runId: pred.runId ?? null, selection: pred.selection, ...(recorded ? { checkpoint: recorded.checkpoint.sha } : {}) }, ...fields });
  if (!retrying) { const unresolved = openFollowup(entry); if (unresolved) return report({ status: 'blocked', reason: 'followup_unresolved', followup: unresolved, nextAction: 'reconcile --mission : une reprise du prédécesseur est encore incertaine ; aucun successeur avant' }); }
  // B1 : le propriétaire doit être confirmé indisponible pour la sélection courante ; sinon la suite est followup sur le même agent, ou une vérification manuelle.
  const owner = await access.pool.owner({ accountId: pred.accountId, modelId: pred.selection.modelId });
  if (!owner.known) return report({ status: 'blocked', reason: 'owner_unknown', nextAction: `compte propriétaire ${pred.accountId} absent de l’état du pool : aucun successeur.` });
  if (!owner.confirmedUnavailable) {
    const why = owner.startBlocked ? `départs bloqués sur le propriétaire ${pred.accountId} après refus de plafond : disponibilité inconnue, non confirmée indisponible. Relever le plafond puis « followup --mission ${mission} --account ${pred.accountId} » ; aucun successeur.`
      : owner.status === 'inactive' ? `propriétaire ${pred.accountId} inactif sans indisponibilité confirmée du pool ${owner.pool} (${owner.poolState ?? 'inconnu'}) : vérifier manuellement, réactiver ou confirmer dans pool-state.json ; aucun successeur tant que la disponibilité est inconnue.`
      : `propriétaire ${pred.accountId} éligible pour ${pred.selection.modelId} (pool ${owner.pool} : ${owner.poolState ?? 'inconnu'}) : reprendre le même agent par « followup --mission ${mission} » ; une préférence de compte ne justifie aucun successeur.`;
    return report({ status: 'blocked', reason: 'owner_not_confirmed_unavailable', owner: { status: owner.status, pool: owner.pool, poolState: owner.poolState, startBlocked: owner.startBlocked }, nextAction: why });
  }
  // B2 : relecture du prédécesseur via son propriétaire à chaque tentative ; une reprise externe entre deux tentatives périme la preuve enregistrée.
  const ownerKey = await access.keyFor(pred.accountId);
  const { agent, failure: agentFailure } = await readAgent({ agentId: pred.agentId, key: ownerKey, fetchImpl, timeoutMs });
  if (agentFailure) return report({ ...agentFailure, nextAction: 'prédécesseur illisible via son propriétaire : aucun POST ; relire plus tard' });
  if (!agent.latestRunId) return report({ status: 'blocked', reason: 'latest_run_unknown', nextAction: 'dernier run du prédécesseur inconnu : aucun successeur' });
  const { run, failure: runFailure } = await readRun({ agentId: pred.agentId, runId: agent.latestRunId, key: ownerKey, fetchImpl, timeoutMs });
  if (runFailure) return report({ ...runFailure, runId: agent.latestRunId, nextAction: 'dernier run du prédécesseur illisible : aucun successeur' });
  const stale = pred.runId && pred.runId !== run.runId ? { registryRunId: pred.runId } : {};
  if (!retrying && entry.runId !== run.runId) await persist({ runId: run.runId });
  if (!terminalRunStatuses.has(run.status)) return report({ status: 'blocked', reason: 'run_active', runId: run.runId, runStatus: run.status, ...stale, nextAction: 'mission active jamais interrompue : attendre le terminal (status --follow), vérifier le checkpoint poussé, puis successor' });
  let reattested = false;
  if (retrying) {
    if (run.runId !== recorded.runId) {
      if (sha === recorded.checkpoint.sha) return report({ status: 'blocked', reason: 'predecessor_resumed', runId: run.runId, runStatus: run.status, ...stale, nextAction: `le prédécesseur a reçu un run ${run.runId} après l’enregistrement (reprise externe) : le checkpoint enregistré est périmé. Vérifier ce run terminal, sa branche et le SHA poussé, puis successor --checkpoint <SHA re-vérifié> [--branch …] ; aucun POST.` });
      reattested = true;
    } else if (sha !== recorded.checkpoint.sha) throw new UsageError('Checkpoint différent de celui enregistré pour le prédécesseur (run inchangé) ; aucun successeur.');
  }
  // B4 : branche de travail réellement produite par le run terminal.
  const working = resolveWorkingBranch({ predecessor: pred, run, branch });
  if (working.blocked) return report({ ...working.blocked, runId: run.runId, runStatus: run.status, ...stale });
  if (retrying && recorded.branch?.name && recorded.branch.name !== working.branch && branch === undefined) return report({ status: 'blocked', reason: 'branch_changed', runId: run.runId, observedBranches: working.observed, recordedBranch: recorded.branch.name, nextAction: `branche observée ${working.branch} ≠ branche enregistrée ${recorded.branch.name} : vérifier, puis attester par --branch ; aucun successeur.` });
  const predecessor = { agentId: pred.agentId, accountId: pred.accountId, runId: run.runId, runStatus: run.status, ...(pred.url ? { url: pred.url } : {}), selection: pred.selection, ...(pred.exception ? { exception: pred.exception } : {}), ...(pred.workOnCurrentBranch !== undefined ? { workOnCurrentBranch: pred.workOnCurrentBranch } : {}), branch: { name: working.branch, source: working.source, observed: working.observed }, checkpoint: { sha, ...(pred.ref ? { ref: pred.ref } : {}), ...(pred.prUrl ? { prUrl: pred.prUrl } : {}), ...(working.branch ? { branch: working.branch } : {}), providedBy: 'orchestrator', verification: 'orchestrator_attested', transportVerifiedGit: false, ...(reattested ? { reattestedAt: now(), previousRunId: recorded.runId } : {}) }, ...(pred.followups ? { followups: pred.followups } : {}), endedAt: retrying && !reattested ? recorded.endedAt : now(), ...(reattested ? { resumedExternally: true } : {}) };
  const initial = { key: entry.selection.key, modelId: entry.selection.modelId, params: entry.selection.params };
  const fallbackSelection = fallbackSelectionOf(config, access);
  const decision = await access.pool.decide({ selection: initial, fallbackSelection, excludeAccountIds: [predecessor.accountId] });
  if (decision.status === 'blocked') return report({ status: 'blocked', reason: decision.reason, decision, nextAction: decision.nextAction, ...stale });
  const active = decision.status === 'exception' ? fallbackSelection : initial;
  let modelsResult;
  const check = await preflight({ selection: active, access, accountId: decision.accountId, fetchImpl, timeoutMs, onResult: r => { modelsResult = r; } });
  if (check.status !== 'ok') { const evidence = await recordEvidence(access, decision.accountId, { callKind: 'models', modelId: active.modelId, result: modelsResult }); return report({ status: check.status, preflight: check, ...accountFields(decision.accountId, decision), ...(evidence ? { evidence: { classification: evidence.classification, recorded: evidence.recorded } } : {}), ...(evidenceHint(evidence) ? { nextAction: evidenceHint(evidence) } : {}) }); }
  // Identifiant dérivé de la mission et du numéro de tentative : jamais l’identifiant du prédécesseur (refus possible entre comptes), idempotence persistée avant le POST.
  const attempt = (entry.successorAttempts ?? 0) + 1;
  const agentId = missionAgentId(entry.repo, `${mission}~s${attempt}`);
  const catalog = { checkedAt: check.catalog.checkedAt, displayName: check.catalog.displayName, variant: check.catalog.variant };
  // L’entrée de mission bascule sur le successeur ; la chaîne des prédécesseurs (avec leur sélection réelle), la sélection initiale et le lien explicite sont conservés.
  for (const field of ['runId', 'url', 'followup', 'followups', 'reason', 'httpStatus', 'providerCode', 'returned']) delete entry[field];
  if (decision.status === 'exception') Object.assign(entry, { currentSelection: { key: active.key, modelId: active.modelId, params: active.params, catalog }, exception: { reason: decision.reason, at: now(), confirmed: decision.confirmed, proof: decision.proof, initialModelId: initial.modelId } });
  else { delete entry.currentSelection; delete entry.exception; }
  const predecessors = retrying ? [...entry.predecessors.slice(0, -1), predecessor] : [...(entry.predecessors ?? []), predecessor];
  await persist({ agentId, accountId: decision.accountId, successorAttempts: attempt, successorOf: predecessor.agentId, predecessors, state: 'pending', workOnCurrentBranch: true, ...(pred.prUrl ? { prUrl: pred.prUrl } : { ref: working.branch }) });
  const body = { agentId, prompt: { text: promptText }, model: active.params.length ? { id: active.modelId, params: active.params } : { id: active.modelId }, repos: [pred.prUrl ? { url: entry.repo, prUrl: pred.prUrl } : { url: entry.repo, startingRef: working.branch }], workOnCurrentBranch: true, autoCreatePR: false, ...(name ? { name: String(name).slice(0, 100) } : {}) };
  const created = await createAgent({ command: 'successor', mission, entry, registry, registryFile, body, key: await access.keyFor(decision.accountId), access, accountId: decision.accountId, decision, modelId: active.modelId, fetchImpl, timeoutMs, now });
  return report({ ...created, attempt, predecessorRun: { runId: run.runId, runStatus: run.status }, branch: { name: working.branch, source: working.source }, checkpoint: { sha, attestation: checkpointAttestation }, ...stale });
}

// Vue du pool et décision déterministe à blanc (aucun appel API, aucune écriture hors création initiale de l’état).
export async function accounts({ config, select, exclude = [], key, access }) {
  access = accessOf(access, key);
  if (!access.pool) return { command: 'accounts', status: 'ok', mode: 'env', note: 'CURSOR_API_KEY : un seul compte implicite, aucun état de pool.' };
  const state = await access.pool.read();
  const chosen = config ? resolveSelection(config, select) : null;
  const decision = chosen ? await access.pool.decide({ selection: chosen, fallbackSelection: fallbackSelectionOf(config, access), excludeAccountIds: exclude }) : undefined;
  return { command: 'accounts', status: 'ok', mode: 'pool', stateFile: access.pool.stateFile, ...state, ...(decision ? { decision: { ...decision, accounts: undefined } } : {}) };
}

export function exitCodeFor(report) {
  if (['ok', 'launched', 'existing', 'deduplicated', 'reconciled', 'not_created'].includes(report.status)) return exitCodes.ok;
  if (['blocked', 'alias_only', 'model_absent'].includes(report.status)) return exitCodes.blocked;
  return exitCodes.unavailable;
}
function parseArgs(args) {
  const options = { flags: new Set() };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) throw new UsageError(`Argument inconnu : ${arg}`);
    const name = arg.slice(2);
    if (['follow', 'full', 'auto-pr', 'new-branch'].includes(name)) options.flags.add(name);
    else if (['model-file', 'select', 'mission', 'repo', 'ref', 'pr-url', 'prompt-file', 'registry', 'name', 'agent', 'run', 'state', 'account', 'checkpoint', 'exclude', 'branch'].includes(name) && i + 1 < args.length) options[name] = args[++i];
    else throw new UsageError(`Option inconnue ou incomplète : ${arg}`);
  }
  return options;
}
const help = `cursor-agents — orchestration Creezio Lite (accès : CURSOR_API_KEY en environnement, sinon pool commun de comptes via CURSOR_CREDENTIALS_FILE)
  preflight [--select fable|opus|grok] [--model-file f] [--account id]
  launch --mission K --repo URL (--ref BRANCHE | --pr-url URL) --prompt-file f --registry f [--select clé] [--account id] [--name n] [--auto-pr] [--new-branch]
  reconcile --mission K --registry f            (tranche aussi une reprise pending/uncertain : accepté ou non créé ; clé du compte propriétaire)
  status (--mission K --registry f | --agent bc-… --run run-… [--account id]) [--state f] [--follow] [--full]
  followup --mission K --registry f --prompt-file f   (reprise persistée et réconciliable, même agent, même compte propriétaire)
  followup --agent bc-… --prompt-file f [--account id] (sans registre : garde minimale, aucune idempotence ; livraison inconnue ⇒ lire l’agent soi-même)
  successor --mission K --registry f --prompt-file f --checkpoint SHA [--branch b] [--name n]   (pool : propriétaire confirmé indisponible, prédécesseur relu terminal, branche de travail observée, checkpoint attesté, compte premium suivant, même sélection)
  accounts [--select clé] [--exclude id]         (pool : état des comptes et décision à blanc, aucun appel API)
Reprise : lecture de l’agent réel (latestRunId) puis du run actuel ; terminal exigé ; un seul POST sans champ model ; livraison inconnue ⇒ reconcile avant réémission.
La sélection (--select, défaut : fable) est choisie une fois au lancement puis conservée pour toute la mission et ses successeurs ; exception Grok 4.6 seulement selon la
politique du pool (tous les comptes premium confirmés indisponibles et preuve datée d’accès standard), jamais Composer.
Codes : 0 ok · 2 bloqué (modèle refusé, requête rejetée, run actif, décision de pool) · 3 indisponible ou incertain · 4 usage`;
export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl, adapter, decrypt, sleep = ms => new Promise(r => setTimeout(r, ms)), log = line => console.log(line) } = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') { log(help); return exitCodes.ok; }
  const options = parseArgs(rest);
  const emit = report => { log(JSON.stringify(report)); return exitCodeFor(report); };
  let access;
  try {
    access = await resolveAccess({ env, adapter, decrypt });
    if (command === 'preflight') {
      const config = await loadSelections(options['model-file']); const selection = resolveSelection(config, options.select);
      let accountId = options.account ? assertAccountId(options.account) : undefined;
      if (access.pool && !accountId) { const decision = await access.pool.decide({ selection, fallbackSelection: fallbackSelectionOf(config, access) }); if (decision.status !== 'route') return emit({ command: 'preflight', status: 'blocked', selection: selection.key, reason: decision.status === 'exception' ? 'exception_requires_launch' : decision.reason, decision: { ...decision, accounts: undefined }, nextAction: decision.nextAction ?? 'exception de repli : décidée au lancement (launch), pas au préflight ; indiquer --account pour un compte précis' }); accountId = decision.accountId; }
      return emit(await preflight({ selection, access, accountId, fetchImpl }));
    }
    if (command === 'launch') {
      const config = await loadSelections(options['model-file']);
      if (!options['prompt-file']) throw new UsageError('--prompt-file requis.');
      const promptText = await readFile(options['prompt-file'], 'utf8');
      return emit(await launch({ mission: options.mission, repo: options.repo, ref: options.ref, prUrl: options['pr-url'], promptText, name: options.name, autoCreatePR: options.flags.has('auto-pr'), workOnCurrentBranch: !options.flags.has('new-branch'), config, select: options.select, account: options.account, access, registryFile: options.registry, fetchImpl }));
    }
    if (command === 'reconcile') return emit(await reconcile({ mission: options.mission, access, registryFile: options.registry, fetchImpl }));
    if (command === 'status') {
      let interval = 0, code = exitCodes.ok;
      for (;;) {
        const report = await status({ agentId: options.agent, runId: options.run, mission: options.mission, account: options.account, registryFile: options.registry, stateFile: options.state, access, fetchImpl, full: options.flags.has('full') });
        if (report.status !== 'ok') return emit(report);
        if (report.changed || !options.flags.has('follow')) code = emit(report);
        if (!options.flags.has('follow') || report.terminal) return code;
        interval = nextInterval(interval); await sleep(interval);
      }
    }
    if (command === 'followup') { if (!options['prompt-file']) throw new UsageError('--prompt-file requis.'); return emit(await followup({ agentId: options.agent, mission: options.mission, account: options.account, registryFile: options.registry, promptText: await readFile(options['prompt-file'], 'utf8'), access, fetchImpl })); }
    if (command === 'successor') { if (!options['prompt-file']) throw new UsageError('--prompt-file requis.'); const config = await loadSelections(options['model-file']); return emit(await successor({ mission: options.mission, registryFile: options.registry, promptText: await readFile(options['prompt-file'], 'utf8'), checkpoint: options.checkpoint, branch: options.branch, name: options.name, config, access, fetchImpl })); }
    if (command === 'accounts') { const config = await loadSelections(options['model-file']); return emit(await accounts({ config, select: options.select, exclude: options.exclude ? [assertAccountId(options.exclude)] : [], access })); }
    throw new UsageError(`Commande inconnue : ${command}`);
  } catch (error) {
    // Erreurs du pool (coffre, déchiffrement, verrou, état) : indisponibilité explicite sans secret ; le reste remonte comme erreur d’usage.
    if (error && error.name === 'PoolError') return emit({ command, status: 'unavailable', reason: error.code, message: String(error.message), ...(error.accountId ? { accountId: error.accountId } : {}), ...(error.stage ? { stage: error.stage } : {}), ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}), ...(error.holder ? { holder: error.holder } : {}) });
    throw error;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    const key = readKey(); const message = String(error?.message ?? error?.name ?? 'erreur inconnue');
    console.error(key ? message.replaceAll(key, '[REDACTED]') : message); process.exitCode = exitCodes.usage;
  });
}
