#!/usr/bin/env node
// Outil d’orchestration Creezio Lite pour l’API Cursor Cloud Agents v1 (https://cursor.com/docs/cloud-agent/api/endpoints).
// Usage orchestrateur uniquement ; distinct du transport métier runtime/core/agent-providers. Aucune dépendance au kit.
// Clé : CURSOR_API_KEY en environnement. Sorties JSON sans clé, sans prompt, sans corps fournisseur.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const API = 'https://api.cursor.com';
export const selectionsFile = resolve(dirname(fileURLToPath(import.meta.url)), '../cursor-model.json');
export const exitCodes = Object.freeze({ ok: 0, blocked: 2, unavailable: 3, usage: 4 });
export const pollIntervalsMs = Object.freeze([15_000, 30_000, 60_000, 120_000, 300_000]);
const agentIdPattern = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const runIdPattern = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const providerCodePattern = /^[a-z][a-z0-9_]{1,63}$/;
const activeStates = new Set(['pending', 'launched', 'reconciled', 'uncertain']);

export class UsageError extends Error { constructor(message) { super(message); this.name = 'UsageError'; } }

export function readKey(env = process.env) {
  const key = typeof env.CURSOR_API_KEY === 'string' ? env.CURSOR_API_KEY.trim() : '';
  if (!key || key.length > 512 || /[\s\x00-\x1f\x7f]/.test(key)) return null;
  return key;
}

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
    if (status === 401 || status === 403) return { outcome: 'unavailable', reason: 'auth', status };
    if (status === 429) { const retry = Number(response.headers.get('retry-after')); return { outcome: 'unavailable', reason: 'quota', status, ...(Number.isFinite(retry) && retry > 0 ? { retryAfterMs: Math.min(retry, 3600) * 1000 } : {}) }; }
    if (status >= 500) return { outcome: 'unavailable', reason: 'server', status };
    if (status >= 400) return { outcome: 'rejected', status, providerCode: providerCode(data) };
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
export async function preflight({ selection, key, fetchImpl, timeoutMs } = {}) {
  const checkedAt = new Date().toISOString();
  const base = { command: 'preflight', selection: selection.key, requested: { modelId: selection.modelId, params: selection.params }, catalog: { checkedAt, validated: false }, fallback: 'none' };
  const result = await call({ path: '/v1/models', key, fetchImpl, timeoutMs });
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

// Reçu de sélection : ce qui a été demandé, ce que le catalogue a validé, ce que l'API a accepté ; modelObserved reste null tant que l'API n'expose pas le modèle d'un run.
function selectionReceipt(selection, { createAccepted = false, runAccepted = false } = {}) {
  return { key: selection.key, requested: { modelId: selection.modelId, params: selection.params }, catalog: selection.catalog, createAccepted, runAccepted, modelObserved: null, note: 'Un POST accepté ne prouve pas la sélection effective ; un routage interne du fournisseur reste possible.' };
}
// Lancement dédupliqué : registre → préflight → POST avec agentId déterministe → réconciliation des 409 et appels incertains.
export async function launch({ mission, repo, ref, prUrl, promptText, name, autoCreatePR = false, workOnCurrentBranch = true, config, select, key, registryFile, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  if (typeof mission !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(mission)) throw new UsageError('--mission : clé courte [A-Za-z0-9._-] requise.');
  if (typeof promptText !== 'string' || !promptText.trim() || promptText.length > 200_000) throw new UsageError('Brief vide ou trop long.');
  const repoUrl = normalizeRepo(repo);
  if (prUrl !== undefined) { const url = new URL(prUrl); if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+\/?$/.test(url.pathname) || url.search || url.hash || url.username) throw new UsageError('URL de PR GitHub attendue.'); }
  else refName(ref);
  const chosen = resolveSelection(config, select);
  const registry = await loadRegistry(registryFile);
  const existing = registry.missions[mission];
  // pending = POST interrompu avant enregistrement du résultat : l'agent existe peut-être ; reconcile, jamais un nouveau lancement ni une reprise aveugle.
  if (existing && activeStates.has(existing.state)) return { command: 'launch', status: 'deduplicated', mission, entry: existing, nextAction: ['uncertain', 'pending'].includes(existing.state) ? 'reconcile' : 'followup ou nouvelle clé de mission' };
  const check = await preflight({ selection: chosen, key, fetchImpl, timeoutMs });
  if (check.status !== 'ok') return { command: 'launch', status: check.status, mission, preflight: check };
  const agentId = missionAgentId(repoUrl, mission);
  // La sélection est fixée ici, une fois, et conservée pour toute la mission (reprises comprises).
  const selection = { key: chosen.key, modelId: chosen.modelId, params: chosen.params, catalog: { checkedAt: check.catalog.checkedAt, displayName: check.catalog.displayName, variant: check.catalog.variant } };
  const entry = { agentId, repo: repoUrl, ...(prUrl ? { prUrl } : { ref }), selection, state: 'pending', updatedAt: now() };
  registry.missions[mission] = entry; await saveRegistry(registryFile, registry);
  const body = { agentId, prompt: { text: promptText }, model: selection.params.length ? { id: selection.modelId, params: selection.params } : { id: selection.modelId }, repos: [prUrl ? { url: repoUrl, prUrl } : { url: repoUrl, startingRef: ref }], workOnCurrentBranch, autoCreatePR, ...(name ? { name: String(name).slice(0, 100) } : {}) };
  const result = await call({ method: 'POST', path: '/v1/agents', body, key, fetchImpl, timeoutMs });
  const finish = async (state, extra) => { Object.assign(entry, { state, updatedAt: now() }, extra); await saveRegistry(registryFile, registry); };
  if (result.outcome === 'ok') {
    const agent = agentSummary(result.data?.agent), run = runSummary(result.data?.run);
    if (!agent || !run || agent.agentId !== agentId || run.agentId !== agentId) { await finish('uncertain', { reason: 'identity_mismatch' }); return { command: 'launch', status: 'uncertain', mission, agentId, reason: 'identity_mismatch', nextAction: 'reconcile' }; }
    await finish('launched', { runId: run.runId, url: agent.url });
    return { command: 'launch', status: 'launched', mission, agentId, runId: run.runId, url: agent.url, selection: selectionReceipt(selection, { createAccepted: true }) };
  }
  if (result.outcome === 'rejected' && result.status === 409) {
    const reconciled = await reconcileEntry({ entry, key, fetchImpl, timeoutMs, now });
    await saveRegistry(registryFile, registry);
    return { command: 'launch', status: reconciled.state === 'reconciled' ? 'existing' : 'uncertain', mission, agentId, providerCode: result.providerCode, ...reconciled };
  }
  if (result.outcome === 'rejected') { await finish('failed', { reason: 'rejected', httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}) }); return { command: 'launch', status: 'blocked', mission, agentId, reason: 'rejected', httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}) }; }
  if (result.delivery === 'not_sent') { await finish('failed', { reason: result.reason }); return { command: 'launch', status: 'unavailable', mission, agentId, reason: result.reason }; }
  // Envoi incertain : l’agent existe peut-être. Une seule lecture, puis état uncertain pour reconcile.
  const reconciled = await reconcileEntry({ entry, key, fetchImpl, timeoutMs, now, unavailableState: 'uncertain', unavailableReason: result.reason });
  await saveRegistry(registryFile, registry);
  return { command: 'launch', status: reconciled.state === 'reconciled' ? 'existing' : reconciled.state === 'not_created' ? 'unavailable' : 'uncertain', mission, agentId, reason: result.reason, ...reconciled, ...(reconciled.state === 'uncertain' ? { nextAction: 'reconcile' } : {}) };
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
// identique ⇒ rien n'a été créé, une réémission redevient possible. Aucun POST ici.
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
async function reconcileEntry({ entry, key, fetchImpl, timeoutMs, now, unavailableState = 'uncertain', unavailableReason }) {
  const { agent, failure, httpStatus } = await readAgent({ agentId: entry.agentId, key, fetchImpl, timeoutMs });
  if (agent) { Object.assign(entry, { state: 'reconciled', updatedAt: now(), ...(agent.latestRunId ? { runId: agent.latestRunId } : {}), ...(agent.url ? { url: agent.url } : {}) }); const followup = settleFollowup(entry, agent, now); return { state: 'reconciled', agent, ...(followup ? { followup } : {}) }; }
  if (failure.reason === 'invalid_response' && httpStatus === 200) { Object.assign(entry, { state: 'uncertain', reason: 'identity_mismatch', updatedAt: now() }); return { state: 'uncertain', reason: 'identity_mismatch' }; }
  // 404 ne vaut « jamais créé » que pour un lancement dont aucun run n'a été confirmé ; un agent connu puis introuvable reste incertain, jamais une permission de recréer.
  if (httpStatus === 404 && !entry.runId && !entry.followup) { Object.assign(entry, { state: 'not_created', updatedAt: now() }); return { state: 'not_created' }; }
  Object.assign(entry, { state: unavailableState, reason: httpStatus === 404 ? 'agent_not_found' : unavailableReason ?? failure.reason, updatedAt: now() });
  return { state: unavailableState, reason: entry.reason };
}
export async function reconcile({ mission, key, registryFile, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  const { registry, entry } = await missionEntry({ mission, registryFile });
  const reconciled = await reconcileEntry({ entry, key, fetchImpl, timeoutMs, now });
  await saveRegistry(registryFile, registry);
  const nextAction = reconciled.state === 'not_created' ? 'launch autorisé sur la même clé' : reconciled.followup?.state === 'accepted' ? 'status --mission sur le nouveau run ; aucune réémission' : reconciled.followup?.state === 'not_created' ? 'followup --mission autorisé (aucun run accepté depuis priorRunId)' : reconciled.state === 'uncertain' ? 'reconcile à nouveau ; aucune création ni réémission' : undefined;
  return { command: 'reconcile', mission, agentId: entry.agentId, status: reconciled.state, ...(reconciled.agent ? { agent: reconciled.agent } : {}), ...(reconciled.reason ? { reason: reconciled.reason } : {}), ...(reconciled.followup ? { followup: reconciled.followup } : {}), ...(nextAction ? { nextAction } : {}) };
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
// Checkpoint : le run demandé (ou le dernier run de la mission), le diff, et la sélection initiale rappelée telle quelle.
export async function status({ agentId, runId, mission, registryFile, stateFile, key, fetchImpl, timeoutMs, full = false }) {
  let selection;
  if (mission !== undefined) { const { entry } = await missionEntry({ mission, registryFile }); agentId ??= entry.agentId; runId ??= entry.runId; selection = entry.selection; if (!runId) throw new UsageError('Aucun run connu pour cette mission ; reconcile d’abord.'); }
  assertAgentId(agentId); assertRunId(runId);
  const { run, failure } = await readRun({ agentId, runId, key, fetchImpl, timeoutMs, full });
  if (failure) return { command: 'status', ...failure, agentId, runId };
  let previous = null;
  if (stateFile) { try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new UsageError('Fichier d’état illisible.'); } }
  const changes = diffRun(previous, run);
  if (stateFile) { await mkdir(dirname(resolve(stateFile)), { recursive: true }); await writeFile(stateFile, JSON.stringify(run, null, 2) + '\n'); }
  return { command: 'status', status: 'ok', changed: changes.length > 0, changes, terminal: terminalRunStatuses.has(run.status), run, ...(selection ? { selection: selectionReceipt(selection, { createAccepted: true }) } : {}) };
}

// Reprise du même agent (docs/MAINTENANCE.md : pas de doublon). Toujours : lire l'agent réel et son latestRunId, lire ce run, exiger un état terminal,
// puis un seul POST sans champ model (la sélection initiale s'applique telle quelle). Avec --mission, la tentative est persistée avant l'envoi et
// une livraison inconnue impose reconcile avant toute réémission. Sans registre (--agent), garde minimale seulement : aucune idempotence.
export async function followup({ agentId, mission, registryFile, promptText, key, fetchImpl, timeoutMs, now = () => new Date().toISOString() }) {
  let registry, entry;
  if (mission !== undefined) {
    ({ registry, entry } = await missionEntry({ mission, registryFile }));
    if (!['launched', 'reconciled'].includes(entry.state)) throw new UsageError(`Mission en état ${entry.state} : ${entry.state === 'not_created' || entry.state === 'failed' ? 'launch' : 'reconcile'} avant toute reprise.`);
    agentId ??= entry.agentId;
    if (agentId !== entry.agentId) throw new UsageError('L’agent indiqué n’est pas celui de la mission.');
  }
  assertAgentId(agentId);
  if (typeof promptText !== 'string' || !promptText.trim() || promptText.length > 200_000) throw new UsageError('Brief de reprise vide ou trop long.');
  const receipt = entry
    ? { selection: entry.selection ? selectionReceipt(entry.selection, { createAccepted: true }) : undefined, modelSent: false, persistent: true }
    : { modelSent: false, persistent: false, note: 'Sans registre : aucune idempotence ; en cas de livraison inconnue, lire l’agent (latestRunId) soi-même ; aucune répétition automatique. Utiliser --mission/--registry pour une reprise réconciliable.' };
  const report = (fields) => ({ command: 'followup', agentId, ...fields, ...receipt });
  const persist = async (fields) => { if (!entry) return; Object.assign(entry, fields, { updatedAt: now() }); await saveRegistry(registryFile, registry); };
  const unresolved = openFollowup(entry);
  if (unresolved) return report({ status: 'blocked', reason: 'followup_unresolved', followup: unresolved, nextAction: 'reconcile --mission avant toute réémission ; aucun POST envoyé' });
  const { agent, failure: agentFailure } = await readAgent({ agentId, key, fetchImpl, timeoutMs });
  if (agentFailure) return report({ ...agentFailure, nextAction: 'agent illisible : aucun POST envoyé ; relire plus tard' });
  if (!agent.latestRunId) return report({ status: 'blocked', reason: 'latest_run_unknown', nextAction: 'dernier run inconnu : aucun POST envoyé' });
  const registryRunId = entry?.runId;
  const { run, failure: runFailure } = await readRun({ agentId, runId: agent.latestRunId, key, fetchImpl, timeoutMs });
  if (runFailure) return report({ ...runFailure, runId: agent.latestRunId, nextAction: 'run actuel illisible : aucun POST envoyé' });
  if (registryRunId && registryRunId !== run.runId) await persist({ runId: run.runId });
  const stale = registryRunId && registryRunId !== run.runId ? { registryRunId } : {};
  if (!terminalRunStatuses.has(run.status)) return report({ status: 'blocked', reason: 'run_active', runId: run.runId, runStatus: run.status, ...stale, nextAction: 'attendre le terminal (status --follow) ; aucun second run envoyé' });
  const priorRunId = run.runId;
  await persist({ followup: { state: 'pending', priorRunId, requestedAt: now() } });
  const result = await call({ method: 'POST', path: `/v1/agents/${encodeURIComponent(agentId)}/runs`, body: { prompt: { text: promptText } }, key, fetchImpl, timeoutMs });
  if (result.outcome === 'ok') {
    const accepted = runSummary(result.data?.run);
    if (accepted && accepted.agentId === agentId && accepted.runId !== priorRunId) {
      await persist({ runId: accepted.runId, followups: (entry?.followups ?? 0) + 1, followup: { state: 'accepted', priorRunId, runId: accepted.runId, settledAt: now() } });
      if (receipt.selection) receipt.selection.runAccepted = true;
      return report({ status: 'launched', priorRunId, runId: accepted.runId, runStatus: accepted.status, ...stale });
    }
    await persist({ followup: { state: 'uncertain', priorRunId, reason: 'invalid_response', requestedAt: entry?.followup?.requestedAt } });
    return report({ status: 'uncertain', reason: 'invalid_response', priorRunId, nextAction: entry ? 'reconcile --mission ; aucune réémission avant' : 'lire l’agent (latestRunId ≠ priorRunId ⇒ accepté) ; aucune répétition automatique' });
  }
  if (result.outcome === 'rejected') {
    // Dont 409 agent_busy : garde complémentaire du serveur, pas la preuve du contrôle client effectué ci-dessus.
    await persist({ followup: { state: 'rejected', priorRunId, httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}), settledAt: now() } });
    return report({ status: 'blocked', reason: 'rejected', priorRunId, httpStatus: result.status, ...(result.providerCode ? { providerCode: result.providerCode } : {}) });
  }
  if (result.delivery === 'not_sent') {
    await persist({ followup: { state: 'not_created', priorRunId, reason: result.reason, settledAt: now() } });
    return report({ status: 'unavailable', reason: result.reason, priorRunId, nextAction: 'requête non émise ; followup à nouveau possible' });
  }
  await persist({ followup: { state: 'uncertain', priorRunId, reason: result.reason, requestedAt: entry?.followup?.requestedAt } });
  return report({ status: 'uncertain', reason: result.reason, priorRunId, nextAction: entry ? 'reconcile --mission ; aucune réémission avant' : 'lire l’agent (latestRunId ≠ priorRunId ⇒ accepté) ; aucune répétition automatique' });
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
    else if (['model-file', 'select', 'mission', 'repo', 'ref', 'pr-url', 'prompt-file', 'registry', 'name', 'agent', 'run', 'state'].includes(name) && i + 1 < args.length) options[name] = args[++i];
    else throw new UsageError(`Option inconnue ou incomplète : ${arg}`);
  }
  return options;
}
const help = `cursor-agents — orchestration Creezio Lite (clé : CURSOR_API_KEY en environnement)
  preflight [--select fable|opus|grok] [--model-file f]
  launch --mission K --repo URL (--ref BRANCHE | --pr-url URL) --prompt-file f --registry f [--select clé] [--name n] [--auto-pr] [--new-branch]
  reconcile --mission K --registry f            (tranche aussi une reprise pending/uncertain : accepté ou non créé)
  status (--mission K --registry f | --agent bc-… --run run-…) [--state f] [--follow] [--full]
  followup --mission K --registry f --prompt-file f   (reprise persistée et réconciliable ; à utiliser pour les missions)
  followup --agent bc-… --prompt-file f               (sans registre : garde minimale, aucune idempotence ; livraison inconnue ⇒ lire l’agent soi-même)
Reprise : lecture de l’agent réel (latestRunId) puis du run actuel ; terminal exigé ; un seul POST sans champ model ; livraison inconnue ⇒ reconcile avant réémission.
La sélection (--select, défaut : fable) est choisie une fois au lancement puis conservée pour toute la mission.
Codes : 0 ok · 2 bloqué (modèle refusé, requête rejetée, run actif) · 3 indisponible ou incertain · 4 usage`;
export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl, sleep = ms => new Promise(r => setTimeout(r, ms)), log = line => console.log(line) } = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') { log(help); return exitCodes.ok; }
  const options = parseArgs(rest);
  const key = readKey(env);
  if (!key) throw new UsageError('CURSOR_API_KEY absente ou invalide dans l’environnement ; aucun appel émis.');
  const emit = report => { log(JSON.stringify(report)); return exitCodeFor(report); };
  if (command === 'preflight') { const config = await loadSelections(options['model-file']); return emit(await preflight({ selection: resolveSelection(config, options.select), key, fetchImpl })); }
  if (command === 'launch') {
    const config = await loadSelections(options['model-file']);
    if (!options['prompt-file']) throw new UsageError('--prompt-file requis.');
    const promptText = await readFile(options['prompt-file'], 'utf8');
    return emit(await launch({ mission: options.mission, repo: options.repo, ref: options.ref, prUrl: options['pr-url'], promptText, name: options.name, autoCreatePR: options.flags.has('auto-pr'), workOnCurrentBranch: !options.flags.has('new-branch'), config, select: options.select, key, registryFile: options.registry, fetchImpl }));
  }
  if (command === 'reconcile') return emit(await reconcile({ mission: options.mission, key, registryFile: options.registry, fetchImpl }));
  if (command === 'status') {
    let interval = 0, code = exitCodes.ok;
    for (;;) {
      const report = await status({ agentId: options.agent, runId: options.run, mission: options.mission, registryFile: options.registry, stateFile: options.state, key, fetchImpl, full: options.flags.has('full') });
      if (report.status !== 'ok') return emit(report);
      if (report.changed || !options.flags.has('follow')) code = emit(report);
      if (!options.flags.has('follow') || report.terminal) return code;
      interval = nextInterval(interval); await sleep(interval);
    }
  }
  if (command === 'followup') { if (!options['prompt-file']) throw new UsageError('--prompt-file requis.'); return emit(await followup({ agentId: options.agent, mission: options.mission, registryFile: options.registry, promptText: await readFile(options['prompt-file'], 'utf8'), key, fetchImpl })); }
  throw new UsageError(`Commande inconnue : ${command}`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    const key = readKey(); const message = String(error?.message ?? error?.name ?? 'erreur inconnue');
    console.error(key ? message.replaceAll(key, '[REDACTED]') : message); process.exitCode = exitCodes.usage;
  });
}
