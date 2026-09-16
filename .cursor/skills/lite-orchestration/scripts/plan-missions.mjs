#!/usr/bin/env node
// Validateur et planificateur en lecture seule du contrat PLANNING.md (plan public + état privé).
// Déterministe : aucune horloge, aucun réseau, aucune écriture, aucune dépendance. Une ligne JSON sur stdout.
// Codes : 0 valide (missions bloquées ou zéro proposition comprises) · 2 schéma ou contrat invalide · 3 décision non fiable (ready) · 4 usage.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const exitCodes = Object.freeze({ ok: 0, invalid: 2, unreliable: 3, usage: 4 });
const here = dirname(fileURLToPath(import.meta.url));
export const schemaFiles = Object.freeze({ plan: resolve(here, '../planning-plan.schema.json'), state: resolve(here, '../planning-state.schema.json') });
export class UsageError extends Error { constructor(message) { super(message); this.name = 'UsageError'; } }

const MILESTONES = Object.freeze(['delivered', 'integrated', 'published']);
const CHAIN = Object.freeze({ dev: ['start', 'delivered', 'integrated', 'published'], review: ['start', 'delivered'], investigation: ['start', 'delivered'] });
const STEP_NODE = Object.freeze({ start: 'start', integrate: 'integrated', publish: 'published' });
const REACHED = Object.freeze({ delivered: ['delivered'], closed: ['delivered'], integrated: ['delivered', 'integrated'], published: MILESTONES });
const RELEASED = new Set(['integrated', 'published', 'closed', 'cancelled', 'historical']);
const TERMINAL_RUN = new Set(['FINISHED', 'ERROR', 'CANCELLED', 'EXPIRED']);
const HOLDING = new Set(['active', 'delivered', 'unknown']);
const byIdStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byPriority = (a, b) => a.mission.priority - b.mission.priority || byIdStr(a.mission.id, b.mission.id);

// --- Validation structurelle : interprète le sous-ensemble JSON Schema 2020-12 utilisé par les deux schémas du contrat.
function kindOf(value) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value; }
function canonical(value) { return kindOf(value) === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : JSON.stringify(value); }
function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new UsageError(`Schéma : référence non locale ${String(ref)}`);
  let node = root; for (const part of ref.slice(2).split('/')) { node = node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')]; if (node === undefined) throw new UsageError(`Schéma : référence introuvable ${ref}`); }
  return node;
}
const regexCache = new Map();
function regex(pattern) { let re = regexCache.get(pattern); if (!re) { re = new RegExp(pattern, 'u'); regexCache.set(pattern, re); } return re; }
export function validateSchema(schema, data, root = schema, path = '', errors = []) {
  const fail = (message) => { errors.push({ code: 'schema_invalid', path: path || '/', message }); return false; };
  if (schema === true) return true; if (schema === false) return fail('valeur non permise');
  if (schema.$ref) return validateSchema(resolveRef(root, schema.$ref), data, root, path, errors) && validateSchema({ ...schema, $ref: undefined }, data, root, path, errors);
  const kind = kindOf(data); let ok = true;
  if (schema.type !== undefined) { const types = [].concat(schema.type); if (!types.some(t => t === kind || (t === 'number' && kind === 'integer'))) return fail(`type ${types.join('|')} attendu, ${kind} reçu`); }
  if (schema.const !== undefined && canonical(schema.const) !== canonical(data)) ok = fail(`valeur ${JSON.stringify(schema.const)} attendue`);
  if (schema.enum && !schema.enum.some(v => canonical(v) === canonical(data))) ok = fail(`valeur hors énumération ${JSON.stringify(schema.enum)}`);
  if (kind === 'string') {
    const length = Array.from(data).length;
    if (schema.minLength !== undefined && length < schema.minLength) ok = fail(`minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && length > schema.maxLength) ok = fail(`maxLength ${schema.maxLength}`);
    if (schema.pattern !== undefined && !regex(schema.pattern).test(data)) ok = fail(`motif ${schema.pattern} non respecté`);
  }
  if (kind === 'integer' || kind === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) ok = fail(`minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && data > schema.maximum) ok = fail(`maximum ${schema.maximum}`);
  }
  if (kind === 'array') {
    if (schema.minItems !== undefined && data.length < schema.minItems) ok = fail(`minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && data.length > schema.maxItems) ok = fail(`maxItems ${schema.maxItems}`);
    if (schema.uniqueItems && new Set(data.map(canonical)).size !== data.length) ok = fail('éléments en double');
    if (schema.items !== undefined) data.forEach((item, i) => { if (!validateSchema(schema.items, item, root, `${path}/${i}`, errors)) ok = false; });
  }
  if (kind === 'object') {
    const keys = Object.keys(data);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) ok = fail(`minProperties ${schema.minProperties}`);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) ok = fail(`maxProperties ${schema.maxProperties}`);
    for (const key of schema.required ?? []) if (!(key in data)) ok = fail(`propriété requise absente : ${key}`);
    for (const key of keys) {
      const sub = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      if (schema.propertyNames !== undefined && !validateSchema(schema.propertyNames, key, root, sub, errors)) ok = false;
      if (schema.properties && key in schema.properties) { if (!validateSchema(schema.properties[key], data[key], root, sub, errors)) ok = false; }
      else if (schema.additionalProperties === false) ok = fail(`propriété non permise : ${key}`);
      else if (schema.additionalProperties !== undefined && !validateSchema(schema.additionalProperties, data[key], root, sub, errors)) ok = false;
    }
  }
  for (const branch of schema.allOf ?? []) if (!validateSchema(branch, data, root, path, errors)) ok = false;
  if (schema.oneOf) { const matches = schema.oneOf.filter(branch => validateSchema(branch, data, root, path, [])).length; if (matches !== 1) ok = fail(`oneOf : ${matches} variante(s) satisfaite(s), une seule attendue`); }
  if (schema.not !== undefined && validateSchema(schema.not, data, root, path, [])) ok = fail('valeur interdite (not)');
  if (schema.if !== undefined) { const branch = validateSchema(schema.if, data, root, path, []) ? schema.then : schema.else; if (branch !== undefined && !validateSchema(branch, data, root, path, errors)) ok = false; }
  return ok;
}

// --- Validation contractuelle (§2–§3) : références, étapes, graphe (mission, jalon), invariants d’état.
function segments(path) { return path.split('/').filter(Boolean); }
export function pathsCollide(a, b) { const sa = segments(a), sb = segments(b); const n = Math.min(sa.length, sb.length); for (let i = 0; i < n; i++) if (sa[i] !== sb[i]) return false; return true; }
export function validatePlanContract(plan, errors) {
  const missions = new Map(); const push = (error) => errors.push(error);
  plan.missions.forEach((mission, i) => {
    if (missions.has(mission.id)) push({ code: 'duplicate_mission', path: `/missions/${i}/id`, message: `identifiant de mission en double : ${mission.id}`, mission: mission.id });
    else missions.set(mission.id, mission);
    if (!(mission.repo in plan.repos)) push({ code: 'unknown_reference', path: `/missions/${i}/repo`, message: `dépôt non déclaré : ${mission.repo}`, mission: mission.id });
    (mission.reserves.resources ?? []).forEach((resource, j) => { if (!(resource in plan.resources)) push({ code: 'unknown_reference', path: `/missions/${i}/reserves/resources/${j}`, message: `ressource non déclarée : ${resource}`, mission: mission.id }); });
  });
  plan.missions.forEach((mission, i) => {
    for (const stage of ['start', 'integrate', 'publish']) {
      const deps = mission.dependencies[stage] ?? []; const base = `/missions/${i}/dependencies/${stage}`;
      if (stage !== 'start' && mission.kind !== 'dev' && stage in mission.dependencies) push({ code: 'step_not_applicable', path: base, message: `une mission ${mission.kind} ne déclare pas de dépendances ${stage}`, mission: mission.id, step: stage, kind: mission.kind });
      deps.forEach((dep, j) => {
        if ('condition' in dep) { if (!(dep.condition in plan.conditions)) push({ code: 'unknown_reference', path: `${base}/${j}/condition`, message: `condition non déclarée : ${dep.condition}`, mission: mission.id }); return; }
        if (dep.mission === mission.id) { push({ code: 'self_dependency', path: `${base}/${j}/mission`, message: `auto-dépendance : ${mission.id} → ${mission.id}.${dep.step} (l’ordre start < delivered < integrated < published est implicite)`, mission: mission.id }); return; }
        const producer = missions.get(dep.mission);
        if (!producer) { push({ code: 'unknown_reference', path: `${base}/${j}/mission`, message: `mission non déclarée : ${dep.mission}`, mission: mission.id }); return; }
        if (producer.kind !== 'dev' && dep.step !== 'delivered') push({ code: 'step_not_applicable', path: `${base}/${j}/step`, message: `une mission ${producer.kind} n’atteint que delivered, pas ${dep.step}`, mission: mission.id, on: { mission: dep.mission, step: dep.step }, kind: producer.kind });
      });
    }
  });
  if (errors.length) return missions;
  // Graphe (mission, jalon) : arêtes implicites de la chaîne, puis (producteur, jalon) → (consommateur, étape).
  const nodes = []; const edges = new Map(); const add = (from, to) => { edges.get(from).push(to); };
  for (const mission of [...missions.values()].sort((a, b) => byIdStr(a.id, b.id))) { const chain = CHAIN[mission.kind]; for (const step of chain) { nodes.push(`${mission.id}.${step}`); edges.set(`${mission.id}.${step}`, []); } for (let k = 1; k < chain.length; k++) add(`${mission.id}.${chain[k - 1]}`, `${mission.id}.${chain[k]}`); }
  for (const mission of missions.values()) for (const stage of ['start', 'integrate', 'publish']) for (const dep of mission.dependencies[stage] ?? []) if ('mission' in dep) add(`${dep.mission}.${dep.step}`, `${mission.id}.${STEP_NODE[stage]}`);
  const color = new Map(); const stack = [];
  const visit = (node) => {
    color.set(node, 1); stack.push(node);
    for (const next of edges.get(node).slice().sort(byIdStr)) {
      const state = color.get(next);
      if (state === 1) return stack.slice(stack.indexOf(next));
      if (!state) { const cycle = visit(next); if (cycle) return cycle; }
    }
    stack.pop(); color.set(node, 2); return null;
  };
  for (const node of nodes) if (!color.has(node)) { const cycle = visit(node); if (cycle) { push({ code: 'dependency_cycle', path: '/missions', message: `cycle de dépendances : ${cycle.join(' → ')} → ${cycle[0]}`, nodes: cycle }); break; } }
  return missions;
}
const inconsistent = (id, field, message, extra = {}) => ({ code: 'state_inconsistent', path: `/missions/${id}/${field}`, message, mission: id, field, ...extra });
export function validateStateContract(plan, state, missions, errors, warnings) {
  if (state.plan.id !== plan.plan.id) errors.push({ code: 'plan_mismatch', path: '/plan/id', message: `l’état porte le plan ${state.plan.id}, le plan est ${plan.plan.id}` });
  if ((state.plan.revision ?? null) !== (plan.plan.revision ?? null)) warnings.push({ code: 'revision_mismatch', path: '/plan/revision', message: `révision de l’état ${state.plan.revision ?? 'absente'} ≠ révision du plan ${plan.plan.revision ?? 'absente'}` });
  const lots = new Set(plan.missions.map(m => m.lot));
  state.pauses.forEach((pause, i) => {
    const known = pause.scope === 'all' || (pause.scope === 'mission' ? missions.has(pause.target) : pause.scope === 'lot' ? lots.has(pause.target) : pause.target in plan.repos);
    if (!known) errors.push({ code: 'unknown_reference', path: `/pauses/${i}/target`, message: `cible de pause non déclarée : ${pause.scope} ${pause.target}` });
  });
  for (const id of Object.keys(state.conditions)) if (!(id in plan.conditions)) errors.push({ code: 'unknown_reference', path: `/conditions/${id}`, message: `condition hors plan : ${id}` });
  for (const [id, entry] of Object.entries(state.missions)) {
    const mission = missions.get(id);
    if (!mission) { errors.push({ code: 'state_mission_unknown', path: `/missions/${id}`, message: `mission hors plan : ${id}`, mission: id }); continue; }
    const { status } = entry;
    if (status === 'pending') {
      // Rien n’a été lancé : toute trace d’attribution, de run ou de jalon est une régression interdite, jamais normalisée.
      const reconcile = { nextAction: 'reconcile' };
      if (['launched', 'reconciled'].includes(entry.launch)) errors.push(inconsistent(id, 'launch', `pending avec launch ${entry.launch} : un lancement a eu lieu, corriger en active (ou statut atteint) puis réconcilier`, reconcile));
      if (entry.agentId !== undefined && !['not_created', 'failed'].includes(entry.launch)) errors.push(inconsistent(id, 'agentId', 'pending avec un agent attribué : la mission est engagée, corriger en active puis réconcilier', reconcile));
      if (entry.runId !== undefined && entry.runId !== null) errors.push(inconsistent(id, 'runId', 'pending avec un run attribué : corriger en active puis réconcilier', reconcile));
      if (entry.runStatus !== undefined) errors.push(inconsistent(id, 'runStatus', `pending avec runStatus ${entry.runStatus} : un historique de run ne redevient pas pending, garder la preuve et réconcilier`, reconcile));
      for (const field of ['assignedAt', 'deliveredAt', 'integratedAt', 'publishedAt', 'closedAt']) if (entry[field] !== undefined) errors.push(inconsistent(id, field, `pending avec jalon ${field} : un jalon atteint ne redevient pas pending`, reconcile));
    }
    if (status === 'active') {
      if (['not_created', 'failed'].includes(entry.launch)) errors.push(inconsistent(id, 'launch', `active avec launch ${entry.launch} : aucun run n’existe, repasser pending (launch conservé) ou relancer par attribution`));
      if (entry.correction?.requested && (entry.launch !== 'launched' && entry.launch !== 'reconciled')) errors.push(inconsistent(id, 'correction', 'correction demandée sur un lancement non confirmé'));
    }
    if (status === 'delivered' && entry.runStatus !== undefined && !TERMINAL_RUN.has(entry.runStatus)) errors.push(inconsistent(id, 'runStatus', `delivered avec run ${entry.runStatus} non terminal : la mission est encore active`));
    if (['integrated', 'published'].includes(status) && mission.kind !== 'dev') errors.push(inconsistent(id, 'status', `${status} sur une mission ${mission.kind} : seul closed s’applique`));
    if (status === 'closed' && mission.kind === 'dev') errors.push(inconsistent(id, 'status', 'closed sur une mission dev : integrated ou published attendus'));
    if (status === 'historical' && entry.historical) {
      const applicable = mission.kind === 'dev' ? ['integrated', 'published'] : ['closed'];
      if (!applicable.includes(entry.historical.step)) errors.push({ code: 'historical_step_not_applicable', path: `/missions/${id}/historical/step`, message: `jalon historique ${entry.historical.step} inapplicable à une mission ${mission.kind}`, mission: id, step: entry.historical.step, kind: mission.kind });
    }
  }
}

// --- Décision `ready` (§4) : recalcul complet, réservations tenues, capacité, propositions incrémentales, raisons explicites.
function reached(entry) { if (entry.status === 'historical') return REACHED[entry.historical.step] ?? []; return REACHED[entry.status] ?? []; }
function pauseReasons(mission, pauses) { return pauses.filter(p => p.scope === 'all' || (p.scope === 'mission' && p.target === mission.id) || (p.scope === 'lot' && p.target === mission.lot) || (p.scope === 'repo' && p.target === mission.repo)).map(p => ({ code: 'paused', scope: p.scope, ...(p.target !== undefined ? { target: p.target } : {}), since: p.since, reason: p.reason })); }
function holdOf(mission, status) { return { mission: mission.id, status, repo: mission.repo, paths: mission.reserves.paths ?? [], resources: mission.reserves.resources ?? [] }; }
function collisions(mission, holds) {
  const reasons = [];
  for (const hold of holds) {
    if (hold.mission === mission.id) continue;
    if (hold.repo === mission.repo) for (const held of hold.paths) if ((mission.reserves.paths ?? []).some(p => pathsCollide(p, held))) reasons.push({ code: 'reservation_conflict', with: hold.mission, path: held, holderStatus: hold.status });
    for (const held of hold.resources) if ((mission.reserves.resources ?? []).includes(held)) reasons.push({ code: 'reservation_conflict', with: hold.mission, resource: held, holderStatus: hold.status });
  }
  return reasons.sort((a, b) => byIdStr(a.with, b.with) || byIdStr(a.path ?? a.resource, b.path ?? b.resource));
}
export function decide(plan, state) {
  const missions = [...plan.missions].sort((a, b) => byIdStr(a.id, b.id));
  const entryOf = (id) => state.missions[id] ?? { status: 'pending' };
  const dependencyReasons = (deps) => deps.map(dep => {
    if ('condition' in dep) { const proof = state.conditions[dep.condition]; return !proof ? { code: 'condition_unverified', condition: dep.condition } : proof.satisfied ? null : { code: 'condition_failed', condition: dep.condition }; }
    const producer = entryOf(dep.mission); const on = { mission: dep.mission, step: dep.step };
    if (producer.status === 'cancelled') return { code: 'dependency_cancelled', on };
    if (producer.status === 'unknown') return { code: 'dependency_unknown', on };
    return reached(producer).includes(dep.step) ? null : { code: 'dependency_unmet', on };
  }).filter(Boolean);
  const holds = missions.filter(m => HOLDING.has(entryOf(m.id).status)).map(m => holdOf(m, entryOf(m.id).status));
  const unknownIds = missions.filter(m => entryOf(m.id).status === 'unknown').map(m => m.id);
  const capacity = state.capacity; const reliable = capacity.maxActiveRuns !== null && unknownIds.length === 0;
  const unreliableReasons = [...(capacity.maxActiveRuns === null ? [{ code: 'capacity_full', maxActiveRuns: null }] : []), ...unknownIds.map(id => ({ code: 'status_unknown', mission: id }))];
  const warnings = [...(capacity.maxActiveRuns === null ? [{ code: 'capacity_unknown', path: '/capacity/maxActiveRuns', message: 'plafond de runs inconnu (null) : décision non fiable, aucune proposition' }] : []), ...unknownIds.map(id => ({ code: 'status_unknown', path: `/missions/${id}/status`, message: `statut de ${id} inconnu : décision non fiable, aucune proposition`, mission: id }))];
  const active = []; const report = {}; const candidates = [];
  for (const mission of missions) {
    const entry = entryOf(mission.id); const { status } = entry; const base = { status, mission, entry };
    if (status === 'active') { const uncertain = ['pending', 'uncertain'].includes(entry.launch); active.push({ mission: mission.id, kind: mission.kind, runStatus: entry.runStatus ?? null, launch: entry.launch, counted: true }); report[mission.id] = { status, outcome: 'active', step: null, reasons: [uncertain ? { code: 'launch_uncertain', nextAction: 'reconcile' } : { code: 'run_active', runStatus: entry.runStatus ?? null }] }; continue; }
    if (status === 'cancelled') { report[mission.id] = { status, outcome: 'cancelled', step: null, reasons: [] }; continue; }
    if (status === 'unknown') { report[mission.id] = { status, outcome: 'unknown', step: null, reasons: [{ code: 'status_unknown' }] }; continue; }
    if (['published', 'closed', 'historical'].includes(status) || (status === 'delivered' && mission.kind !== 'dev' && !entry.correction?.requested)) { report[mission.id] = { status, outcome: 'done', step: null, reasons: [] }; continue; }
    let step, blocking, context = [];
    if (status === 'pending') { step = 'start'; blocking = [...dependencyReasons(mission.dependencies.start ?? []), ...pauseReasons(mission, state.pauses), ...collisions(mission, holds)]; }
    else if (status === 'delivered' && entry.correction?.requested) { step = 'resume'; context = [{ code: 'correction_pending', step: 'integrate' }]; blocking = [...pauseReasons(mission, state.pauses), ...(TERMINAL_RUN.has(entry.runStatus) ? [] : [{ code: 'run_active', runStatus: entry.runStatus ?? null }])]; }
    else if (status === 'delivered') { step = 'integrate'; blocking = dependencyReasons(mission.dependencies.integrate ?? []); }
    else { step = 'publish'; blocking = dependencyReasons(mission.dependencies.publish ?? []); }
    if (blocking.length) { report[mission.id] = { status, outcome: 'blocked', step, reasons: [...context, ...blocking] }; candidates.push({ ...base, step, outcome: 'blocked', blocking }); continue; }
    candidates.push({ ...base, step, outcome: 'ready', context });
  }
  const counted = active.length; const observed = capacity.observedActiveRuns?.value ?? 0; const activeRuns = Math.max(counted, observed);
  const backlog = { count: missions.filter(m => m.kind === 'dev' && entryOf(m.id).status === 'delivered').length, max: capacity.maxReviewBacklog };
  const ready = candidates.filter(c => c.outcome === 'ready');
  const group = (step) => ready.filter(c => step.includes(c.step)).sort(byPriority);
  const ordered = [...group(['integrate']), ...group(['publish']), ...group(['resume', 'start'])];
  const proposals = []; let free = reliable ? capacity.maxActiveRuns - activeRuns : 0; let proposed = 0;
  const settle = (candidate, outcome, reasons) => { report[candidate.mission.id] = { status: candidate.status, outcome, step: candidate.step, reasons: [...candidate.context, ...reasons] }; };
  if (!reliable) for (const candidate of ordered) settle(candidate, 'waiting', unreliableReasons);
  else {
    const perRepo = new Map();
    for (const candidate of group(['integrate'])) {
      const first = perRepo.get(`integrate:${candidate.mission.repo}`);
      if (first) { settle(candidate, 'waiting', [{ code: 'integration_serialized', after: first }]); continue; }
      perRepo.set(`integrate:${candidate.mission.repo}`, candidate.mission.id);
      proposals.push({ order: proposals.length + 1, mission: candidate.mission.id, step: 'integrate', repo: candidate.mission.repo, prUrl: candidate.entry.prUrl, headSha: candidate.entry.headSha, consumesCapacity: false }); settle(candidate, 'proposed', []);
    }
    for (const candidate of group(['publish'])) {
      const first = perRepo.get(`publish:${candidate.mission.repo}`);
      if (first) { settle(candidate, 'proposed', []); continue; }
      const covers = group(['publish']).filter(c => c.mission.repo === candidate.mission.repo).map(c => c.mission.id);
      perRepo.set(`publish:${candidate.mission.repo}`, candidate.mission.id);
      proposals.push({ order: proposals.length + 1, mission: candidate.mission.id, step: 'publish', repo: candidate.mission.repo, covers, consumesCapacity: false }); settle(candidate, 'proposed', []);
    }
    const proposedHolds = [];
    for (const candidate of group(['resume', 'start'])) {
      const reasons = [];
      if (free <= 0) reasons.push({ code: 'capacity_full' });
      if (candidate.step === 'start' && candidate.mission.kind === 'dev' && backlog.count >= backlog.max) reasons.push({ code: 'review_backlog_full' });
      if (candidate.step === 'start') reasons.push(...collisions(candidate.mission, proposedHolds));
      if (reasons.length) { settle(candidate, 'waiting', reasons); continue; }
      free -= 1; proposed += 1;
      const holdsOf = { paths: candidate.mission.reserves.paths ?? [], resources: candidate.mission.reserves.resources ?? [] };
      if (candidate.step === 'resume') proposals.push({ order: proposals.length + 1, mission: candidate.mission.id, step: 'resume', repo: candidate.mission.repo, priority: candidate.mission.priority, agentId: candidate.entry.agentId, selection: candidate.entry.selection, reason: candidate.entry.correction.reason, consumesCapacity: true, holds: holdsOf });
      else { proposals.push({ order: proposals.length + 1, mission: candidate.mission.id, step: 'start', repo: candidate.mission.repo, priority: candidate.mission.priority, selection: candidate.entry.selection ?? null, consumesCapacity: true, holds: holdsOf }); proposedHolds.push(holdOf(candidate.mission, 'proposed')); }
      settle(candidate, 'proposed', []);
    }
  }
  return {
    reliable, warnings,
    capacity: { maxActiveRuns: capacity.maxActiveRuns, origin: capacity.origin, source: capacity.source, observedAt: capacity.observedAt, providerQuotaVerified: capacity.origin === 'observed', active: activeRuns, proposed, free: reliable ? Math.max(free, 0) : 0, reviewBacklog: backlog },
    active,
    ready: ordered.map(c => ({ mission: c.mission.id, step: c.step })),
    proposals,
    blocked: candidates.filter(c => c.outcome === 'blocked').map(c => ({ mission: c.mission.id, step: c.step, reasons: c.blocking })),
    missions: Object.fromEntries(Object.keys(report).sort(byIdStr).map(id => [id, report[id]])),
  };
}

// --- Rapport (§5) et entrée de commande.
function summary(plan, state) {
  const byKind = {}, byStatus = {};
  for (const mission of plan.missions ?? []) { byKind[mission.kind] = (byKind[mission.kind] ?? 0) + 1; const status = state?.missions?.[mission.id]?.status ?? 'pending'; byStatus[status] = (byStatus[status] ?? 0) + 1; }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
  return { missions: plan.missions?.length ?? 0, byKind: sorted(byKind), byStatus: sorted(byStatus) };
}
export function evaluate(command, { plan, state, schemas }) {
  if (!['validate', 'ready'].includes(command)) throw new UsageError(`Commande inconnue : ${String(command)}`);
  const errors = [], warnings = [];
  const planErrors = [], stateErrors = [];
  validateSchema(schemas.plan, plan, schemas.plan, '', planErrors);
  validateSchema(schemas.state, state, schemas.state, '', stateErrors);
  errors.push(...planErrors.map(e => ({ ...e, file: 'plan' })), ...stateErrors.map(e => ({ ...e, file: 'state' })));
  const planId = plan?.plan?.id ?? null, revision = plan?.plan?.revision ?? null;
  const base = () => ({ command, formatVersion: 1, plan: { id: typeof planId === 'string' ? planId : null, revision: typeof revision === 'string' ? revision : null } });
  if (!errors.length) {
    const contractErrors = []; const missions = validatePlanContract(plan, contractErrors);
    errors.push(...contractErrors.map(e => ({ ...e, file: 'plan' })));
    if (!contractErrors.length) { const stateContract = []; validateStateContract(plan, state, missions, stateContract, warnings); errors.push(...stateContract.map(e => ({ ...e, file: 'state' }))); }
  }
  const valid = errors.length === 0;
  const head = { ...base(), valid, errors, warnings, summary: valid || (planErrors.length === 0 && Array.isArray(plan?.missions)) ? summary(plan, stateErrors.length ? null : state) : { missions: 0, byKind: {}, byStatus: {} } };
  if (command === 'validate' || !valid) return { code: valid ? exitCodes.ok : exitCodes.invalid, report: command === 'ready' ? { ...head, reliable: false, capacity: null, active: [], ready: [], proposals: [], blocked: [], missions: {} } : head };
  const decision = decide(plan, state);
  return { code: decision.reliable ? exitCodes.ok : exitCodes.unreliable, report: { ...head, warnings: [...warnings, ...decision.warnings], reliable: decision.reliable, capacity: decision.capacity, active: decision.active, ready: decision.ready, proposals: decision.proposals, blocked: decision.blocked, missions: decision.missions } };
}
async function readJson(file, label) {
  let text; try { text = await readFile(file, 'utf8'); } catch { return { error: { code: 'file_unreadable', path: '/', message: `${label} illisible : fichier absent ou inaccessible`, file: label } }; }
  try { return { data: JSON.parse(text) }; } catch (e) { return { error: { code: 'json_invalid', path: '/', message: `${label} : JSON invalide (${e.message})`, file: label } }; }
}
export async function loadSchemas(files = schemaFiles) {
  const out = {}; for (const [name, file] of Object.entries(files)) { try { out[name] = JSON.parse(await readFile(file, 'utf8')); } catch { throw new UsageError(`Schéma du contrat illisible : ${file}`); } } return out;
}
function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--plan', '--state'].includes(arg) && i + 1 < args.length) options[arg.slice(2)] = args[++i];
    else throw new UsageError(`Option inconnue ou incomplète : ${arg}`);
  }
  if (!options.plan || !options.state) throw new UsageError('--plan <plan.json> et --state <state.json> requis.');
  return options;
}
const help = `plan-missions — validateur et planificateur en lecture seule (contrat PLANNING.md)
  validate --plan <plan.json> --state <state.json>   structure, références, graphe, invariants d’état
  ready    --plan <plan.json> --state <state.json>   + décision : propositions consultatives et raisons d’attente
Aucune horloge, aucun réseau, aucune écriture. Une ligne JSON sur stdout.
Codes : 0 valide (missions bloquées ou zéro proposition comprises) · 2 schéma ou contrat invalide · 3 décision non fiable (capacité null ou statut unknown) · 4 usage`;
export async function main(argv = process.argv.slice(2), { log = line => console.log(line), schemas } = {}) {
  const [command, ...rest] = argv;
  if (!command || command === '--help') { log(help); return exitCodes.ok; }
  if (!['validate', 'ready'].includes(command)) throw new UsageError(`Commande inconnue : ${command}`);
  const options = parseArgs(rest);
  const loadedSchemas = schemas ?? await loadSchemas();
  const [plan, state] = await Promise.all([readJson(resolve(options.plan), 'plan'), readJson(resolve(options.state), 'state')]);
  const readErrors = [plan.error, state.error].filter(Boolean);
  if (readErrors.length) {
    const report = { command, formatVersion: 1, plan: { id: plan.data?.plan?.id ?? null, revision: plan.data?.plan?.revision ?? null }, valid: false, errors: readErrors, warnings: [], summary: { missions: 0, byKind: {}, byStatus: {} } };
    log(JSON.stringify(command === 'ready' ? { ...report, reliable: false, capacity: null, active: [], ready: [], proposals: [], blocked: [], missions: {} } : report)); return exitCodes.invalid;
  }
  const { code, report } = evaluate(command, { plan: plan.data, state: state.data, schemas: loadedSchemas });
  log(JSON.stringify(report)); return code;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error?.message ?? error)); process.exitCode = exitCodes.usage; });
}
