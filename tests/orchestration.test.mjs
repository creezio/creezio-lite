import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, cp, readdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createApp, doctor, adopt, inspectOrchestration, orchestrationSources, orchestrationDir, orchestrationManifest, orchestrationRule } from '../bin/lite.mjs';
import { root } from './helpers.mjs';
import * as agents from '../.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs';

const KEY = 'FAKE_TEST_KEY_NOT_A_SECRET_0123456789';
const BODY_MARKER = 'PROVIDER_BODY_MARKER@example.test';
const PROMPT_MARKER = 'BRIEF_PRIVATE_MARKER@example.test';
const REPO = 'https://github.com/example-org/example-app';
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const models = (items) => json({ items });
// Fixtures représentatives du schéma réel du catalogue (identifiants canoniques et variantes complètes) ; le catalogue réel est relu par le pilote connecté.
const values = (...list) => list.map(value => ({ value }));
const P = (id, value) => ({ id, value });
const fable = { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', parameters: [{ id: 'thinking', values: values('true', 'false') }, { id: 'context', values: values('200k', '300k') }, { id: 'effort', values: values('low', 'medium', 'high') }],
  variants: [{ params: [P('thinking', 'true'), P('context', '200k'), P('effort', 'high')], displayName: 'Fable 5.1 Thinking High', isDefault: true }, { params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'high')], displayName: 'Fable 5.1 Thinking High 300k' }, { params: [P('thinking', 'false'), P('context', '200k'), P('effort', 'low')], displayName: 'Fable 5.1' }] };
const opus = { id: 'claude-opus-5', displayName: 'Claude Opus 5', parameters: [{ id: 'thinking', values: values('true', 'false') }, { id: 'context', values: values('200k', '300k') }, { id: 'effort', values: values('low', 'medium', 'high') }, { id: 'fast', values: values('true', 'false') }, { id: 'cyber', values: values('true', 'false') }],
  variants: [{ params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'medium'), P('fast', 'false'), P('cyber', 'false')], displayName: 'Opus 5 Thinking Medium 300k' }, { params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'medium'), P('fast', 'true'), P('cyber', 'false')], displayName: 'Opus 5 Thinking Medium 300k Fast', isDefault: true }] };
const grok = { id: 'grok-4.6', displayName: 'Grok 4.6', parameters: [{ id: 'effort', values: values('low', 'medium', 'high') }, { id: 'fast', values: values('true', 'false') }],
  variants: [{ params: [P('effort', 'medium'), P('fast', 'false')], displayName: 'Grok 4.6 Medium' }, { params: [P('effort', 'medium'), P('fast', 'true')], displayName: 'Grok 4.6 Medium Fast', isDefault: true }] };
const other = { id: 'other-model', displayName: 'Other', aliases: ['other-latest'], parameters: [{ id: 'fast', values: [{ value: 'true' }, { value: 'false' }] }], variants: [{ params: [{ id: 'fast', value: 'true' }], displayName: 'Other fast', isDefault: true }, { params: [{ id: 'fast', value: 'false' }], displayName: 'Other' }] };
const AGENT = agents.missionAgentId(REPO, 'O01');
const RUN = 'run-00000000-0000-4000-8000-000000000001';
const agentRecord = (extra = {}) => ({ id: AGENT, status: 'ACTIVE', url: `https://cursor.com/agents/${AGENT}`, latestRunId: RUN, createdAt: '2026-09-16T00:00:00.000Z', ...extra });
const runRecord = (extra = {}) => ({ id: RUN, agentId: AGENT, status: 'CREATING', createdAt: '2026-09-16T00:00:00.000Z', ...extra });
function recorder(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const request = { method: init.method ?? 'GET', url: String(url), headers: init.headers ?? {}, body: init.body === undefined ? undefined : JSON.parse(init.body), redirect: init.redirect, signal: init.signal };
    calls.push(request);
    const handler = routes[`${request.method} ${new URL(request.url).pathname}`];
    if (!handler) throw new Error(`Route de test inattendue : ${request.method} ${request.url}`);
    return handler(request);
  };
  return { calls, fetchImpl };
}
async function selections() { return agents.loadSelections(); }
function assertNoLeak(value) {
  const text = JSON.stringify(value) + (value instanceof Error ? value.stack : '');
  for (const marker of [KEY, BODY_MARKER, PROMPT_MARKER, 'Bearer ']) assert.ok(!text.includes(marker), `fuite de « ${marker.trim()} » dans ${text.slice(0, 200)}`);
}
async function withTemp(prefix, run) { const temp = await mkdtemp(join(tmpdir(), prefix)); try { return await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }
// Ressources distribuées par le standard composé (O01 transport + P1 contrat de planification + P2 outil + P5 adaptateur du pool de comptes) : liste explicite, jamais dérivée du code testé.
export const DISTRIBUTED = [
  orchestrationRule,
  `${orchestrationDir}/SKILL.md`, `${orchestrationDir}/CONTRACT.md`, `${orchestrationDir}/cursor-model.json`, `${orchestrationDir}/scripts/cursor-agents.mjs`,
  `${orchestrationDir}/PLANNING.md`, `${orchestrationDir}/planning-plan.schema.json`, `${orchestrationDir}/planning-state.schema.json`, `${orchestrationDir}/examples/planning-plan.json`, `${orchestrationDir}/examples/planning-state.json`,
  `${orchestrationDir}/scripts/plan-missions.mjs`,
  `${orchestrationDir}/scripts/cursor-account-pool.mjs`,
].sort();

test('the canonical skill has a valid frontmatter, fixed selections without fallback and no private data', async () => {
  const skill = await readFile(join(root, orchestrationDir, 'SKILL.md'), 'utf8');
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(front, 'frontmatter YAML attendu');
  assert.match(front[1], /^name: lite-orchestration$/m);
  const description = front[1].match(/^description: (.+)$/m); assert.ok(description && description[1].length > 40 && description[1].length <= 1024);
  const desc = description[1];
  for (const needle of ['plan d’orchestration parallèle', 'PLANNING.md', 'ready', 'resources', 'graphe complet dès plan approuvé', 'start', 'integrate', 'publish', 'transition', 'sans vagues', 'Interdiction nominale de changer de modèle', 'exception globale Grok 4.6']) {
    assert.ok(desc.includes(needle), `description SKILL doit déclencher ${needle}`);
  }
  for (const link of ['CONTRACT.md', 'cursor-model.json', 'scripts/cursor-agents.mjs']) assert.ok(skill.includes(link) && (await readdir(join(root, orchestrationDir, link.includes('/') ? 'scripts' : '.'))).includes(link.split('/').pop()));
  const sources = await orchestrationSources();
  assert.deepEqual(Object.keys(sources).sort(), DISTRIBUTED, 'douze ressources distribuées : transport O01, cinq ressources du contrat de planification, outil plan-missions, adaptateur du pool de comptes');
  for (const source of Object.values(sources)) {
    const content = await readFile(source, 'utf8');
    assert.doesNotMatch(content, /bc-[0-9a-f]{8}-[0-9a-f]{4}|run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|\/home\/|\/Users\/|[A-Z]:\\|key_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}/, `donnée privée dans ${source}`);
    assert.ok(!content.includes('Codex ') || /pas de|aucun|ni /i.test(content));
  }
  for (const script of ['cursor-agents.mjs', 'plan-missions.mjs', 'cursor-account-pool.mjs']) {
    const imports = [...(await readFile(sources[`${orchestrationDir}/scripts/${script}`], 'utf8')).matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1]);
    assert.ok(imports.length > 0 && imports.every(i => i.startsWith('node:')), `${script} doit rester autonome, sans import du kit : ${imports}`);
  }
  const config = agents.validateSelections(JSON.parse(await readFile(sources[`${orchestrationDir}/cursor-model.json`], 'utf8')));
  assert.equal(config.default, 'fable'); assert.deepEqual(Object.keys(config.selections), ['fable', 'opus', 'grok']);
  assert.deepEqual(agents.resolveSelection(config), { key: 'fable', modelId: 'claude-fable-5-1', params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'high')] });
  assert.deepEqual(agents.resolveSelection(config, 'opus'), { key: 'opus', modelId: 'claude-opus-5', params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'medium'), P('fast', 'false'), P('cyber', 'false')] });
  assert.deepEqual(agents.resolveSelection(config, 'grok'), { key: 'grok', modelId: 'grok-4.6', params: [P('effort', 'medium'), P('fast', 'false')] }, 'aucun contexte Grok inventé');
  assert.equal(config.catalogCheckedAt, '2026-09-16T18:25:18Z');
  for (const key of ['fable', 'opus', 'grok']) { const sel = agents.resolveSelection(config, key); assert.ok(!sel.params.some(p => ['fast', 'cyber'].includes(p.id) && p.value !== 'false'), `${key} : fast/cyber désactivés`); }
  assert.throws(() => agents.resolveSelection(config, 'sonnet'), /Sélection inconnue/);
  assert.throws(() => agents.validateSelections({ formatVersion: 2, provider: 'cursor', default: 'a', selections: { a: { modelId: 'x' } }, rules: { chosenOnceAtAttribution: true, keptForFollowups: true, fallback: 'first-available' } }), /fallback:none/);
  const script = await readFile(sources[`${orchestrationDir}/scripts/cursor-agents.mjs`], 'utf8');
  const imports = [...script.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.ok(imports.length > 0 && imports.every(i => i.startsWith('node:')), `le script doit rester autonome, sans import du kit : ${imports}`);
  assert.equal(script.split('${key}').length - 1, 1, 'la clé n’est interpolée que dans l’en-tête Authorization');
});

test('preflight validates the selection against a complete catalog variant, without fallback', async () => {
  const config = await selections(); const fableSel = agents.resolveSelection(config);
  const ok = recorder({ 'GET /v1/models': () => models([other, fable, opus, grok]) });
  const accepted = await agents.preflight({ selection: fableSel, key: KEY, fetchImpl: ok.fetchImpl });
  assert.equal(accepted.status, 'ok'); assert.equal(accepted.selection, 'fable'); assert.equal(accepted.fallback, 'none');
  assert.deepEqual(accepted.requested, { modelId: 'claude-fable-5-1', params: fableSel.params });
  assert.equal(accepted.catalog.validated, true); assert.equal(accepted.catalog.modelsListed, 4); assert.equal(accepted.catalog.variant, 'Fable 5.1 Thinking High 300k'); assert.match(accepted.catalog.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ok.calls.length, 1); assert.equal(ok.calls[0].headers.authorization, `Bearer ${KEY}`); assert.equal(ok.calls[0].redirect, 'manual'); assert.equal(ok.calls[0].url, 'https://api.cursor.com/v1/models');
  assertNoLeak(accepted);
  for (const [key, variant] of [['opus', 'Opus 5 Thinking Medium 300k'], ['grok', 'Grok 4.6 Medium']]) {
    const report = await agents.preflight({ selection: agents.resolveSelection(config, key), key: KEY, fetchImpl: ok.fetchImpl });
    assert.equal(report.status, 'ok', key); assert.equal(report.catalog.variant, variant, 'variante non-fast retenue, pas la variante par défaut du catalogue');
  }

  // Les anciens slugs ne sont pas les identifiants canoniques : absent, sans repli, candidats informatifs seulement.
  const absent = recorder({ 'GET /v1/models': () => models([other, { id: 'claude-fable-5-1-thinking-high', displayName: 'Fable (slug)' }, { id: 'claude-fable-5', displayName: 'Fable 5' }]) });
  const blocked = await agents.preflight({ selection: fableSel, key: KEY, fetchImpl: absent.fetchImpl });
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reason, 'model_absent'); assert.equal(blocked.catalog.validated, false); assert.deepEqual(blocked.candidates, ['claude-fable-5-1-thinking-high', 'claude-fable-5']);
  assert.equal(absent.calls.length, 1, 'aucun second appel ni sélection de remplacement');

  const alias = recorder({ 'GET /v1/models': () => models([{ ...fable, id: 'claude-fable-5-1-latest', aliases: ['claude-fable-5-1'] }]) });
  const aliased = await agents.preflight({ selection: fableSel, key: KEY, fetchImpl: alias.fetchImpl });
  assert.equal(aliased.status, 'blocked'); assert.equal(aliased.reason, 'alias_only'); assert.equal(aliased.canonicalId, 'claude-fable-5-1-latest');

  // Combinaison complète strictement égale : ni complétion, ni paramètre partiel, ni variante voisine.
  const without300k = { ...fable, variants: fable.variants.filter(v => !v.params.some(p => p.value === '300k')) };
  const invalid = await agents.preflight({ selection: fableSel, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([without300k]) }).fetchImpl });
  assert.equal(invalid.status, 'blocked'); assert.equal(invalid.reason, 'variant_invalid'); assert.equal(invalid.variants.length, 2, 'le catalogue est rapporté, aucune variante choisie à la place');
  const partial = await agents.preflight({ selection: { ...fableSel, params: fableSel.params.filter(p => p.id !== 'context') }, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([fable]) }).fetchImpl });
  assert.equal(partial.status, 'blocked'); assert.equal(partial.reason, 'variant_invalid', 'aucune complétion automatique du contexte');
  const grokContext = await agents.preflight({ selection: { ...agents.resolveSelection(config, 'grok'), params: [P('effort', 'medium'), P('fast', 'false'), P('context', '300k')] }, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([grok]) }).fetchImpl });
  assert.equal(grokContext.status, 'blocked'); assert.equal(grokContext.reason, 'variant_invalid', 'un contexte Grok inventé est refusé');
  const opusFastOnly = await agents.preflight({ selection: agents.resolveSelection(config, 'opus'), key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([{ ...opus, variants: [opus.variants[1]] }]) }).fetchImpl });
  assert.equal(opusFastOnly.status, 'blocked'); assert.equal(opusFastOnly.reason, 'variant_invalid', 'fast=false exigé, la variante fast n’est pas prise à la place');
  const noVariants = await agents.preflight({ selection: { ...fableSel, params: [] }, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([{ id: 'claude-fable-5-1', displayName: 'Fable' }]) }).fetchImpl });
  assert.equal(noVariants.status, 'ok'); assert.equal(noVariants.catalog.variant, 'Fable');
});

test('an unavailable Cursor API blocks explicitly, never substitutes a model and never leaks bodies or the key', async () => {
  const config = await selections(); const p = agents.resolveSelection(config);
  const cases = [
    [() => json({ error: { code: 'unauthorized', message: BODY_MARKER } }, 401), 'auth', 401],
    [() => json({ error: { code: 'forbidden', message: BODY_MARKER } }, 403), 'auth', 403],
    [() => json({ error: { code: 'rate_limit_exceeded' } }, 429, { 'retry-after': '30' }), 'quota', 429],
    [() => new Response(BODY_MARKER, { status: 503, headers: { 'content-type': 'text/plain' } }), 'server', 503],
    [() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' + BODY_MARKER } }), 'redirect', 302],
    [() => { throw new TypeError('fetch failed ' + BODY_MARKER); }, 'network', undefined],
    [() => new Response('<html>' + BODY_MARKER, { status: 200, headers: { 'content-type': 'text/html' } }), 'not_json', 200],
    [() => json({ items: [{ id: 42 }] }), 'invalid_response', 200],
  ];
  for (const [handler, reason, httpStatus] of cases) {
    const r = recorder({ 'GET /v1/models': handler });
    const report = await agents.preflight({ selection: p, key: KEY, fetchImpl: r.fetchImpl });
    assert.equal(report.status, 'unavailable', reason); assert.equal(report.reason, reason); assert.equal(report.httpStatus, httpStatus); assert.equal(report.requested.modelId, p.modelId); assert.equal(report.catalog.validated, false);
    if (reason === 'quota') assert.equal(report.retryAfterMs, 30_000);
    assert.equal(r.calls.length, 1, 'aucune redirection suivie, aucun renvoi');
    assertNoLeak(report);
  }
  const slow = { fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) };
  const timedOut = await agents.preflight({ selection: p, key: KEY, fetchImpl: slow.fetchImpl, timeoutMs: 50 });
  assert.equal(timedOut.status, 'unavailable'); assert.equal(timedOut.reason, 'timeout');
  const big = await agents.preflight({ selection: p, key: KEY, fetchImpl: async () => new Response('x'.repeat(3_000_000), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '3000000' } }) });
  assert.equal(big.status, 'unavailable'); assert.equal(big.reason, 'too_large');
  const missing = await agents.preflight({ selection: p, key: null, fetchImpl: () => { throw new Error('ne doit pas être appelé'); } });
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.reason, 'credential_missing');
  assert.equal(agents.readKey({ CURSOR_API_KEY: ' bad key ' }), null); assert.equal(agents.readKey({}), null); assert.equal(agents.readKey({ CURSOR_API_KEY: KEY }), KEY);
});

test('launch deduplicates missions, fixes the selection once in the payload and registry, reconciles 409 and uncertain calls', async () => {
  const config = await selections(); const p = agents.resolveSelection(config);
  await withTemp('lite-orch-launch-', async (temp) => {
    const registryFile = join(temp, 'private', 'registry.json');
    const brief = `Mission O01 — ${PROMPT_MARKER}`;
    const base = { mission: 'O01', repo: REPO + '.git', ref: 'agents/O01-standard', promptText: brief, config, key: KEY, registryFile };
    assert.equal(AGENT, agents.missionAgentId('https://github.com/example-org/example-app/', 'O01'), 'identifiant déterministe indépendant du suffixe .git');
    assert.notEqual(AGENT, agents.missionAgentId(REPO, 'O02'));

    const blocked = recorder({ 'GET /v1/models': () => models([other]) });
    const refused = await agents.launch({ ...base, fetchImpl: blocked.fetchImpl });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.preflight.reason, 'model_absent'); assert.equal(blocked.calls.length, 1, 'aucun POST après un préflight bloqué');
    assert.deepEqual((await agents.loadRegistry(registryFile)).missions, {}, 'aucune entrée écrite avant un préflight réussi');

    const created = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': (request) => json({ agent: agentRecord(), run: runRecord() }) });
    const launched = await agents.launch({ ...base, fetchImpl: created.fetchImpl, name: 'O01 — standard' });
    assert.equal(launched.status, 'launched'); assert.equal(launched.agentId, AGENT); assert.equal(launched.runId, RUN);
    assert.equal(launched.selection.key, 'fable'); assert.deepEqual(launched.selection.requested, { modelId: p.modelId, params: p.params });
    assert.equal(launched.selection.createAccepted, true); assert.equal(launched.selection.runAccepted, false); assert.equal(launched.selection.modelObserved, null); assert.match(launched.selection.catalog.checkedAt, /^\d{4}-/); assert.match(launched.selection.note, /ne prouve pas/);
    const post = created.calls[1];
    assert.equal(post.method, 'POST'); assert.equal(post.url, 'https://api.cursor.com/v1/agents');
    assert.deepEqual(post.body, { agentId: AGENT, prompt: { text: brief }, model: { id: 'claude-fable-5-1', params: p.params }, repos: [{ url: REPO, startingRef: 'agents/O01-standard' }], workOnCurrentBranch: true, autoCreatePR: false, name: 'O01 — standard' });
    assert.ok(!('envVars' in post.body) && !('mcpServers' in post.body));
    assertNoLeak(launched);
    let registry = await agents.loadRegistry(registryFile);
    assert.equal(registry.missions.O01.state, 'launched'); assert.equal(registry.missions.O01.runId, RUN); assertNoLeak(registry);
    assert.deepEqual({ key: registry.missions.O01.selection.key, modelId: registry.missions.O01.selection.modelId, params: registry.missions.O01.selection.params }, { key: 'fable', modelId: p.modelId, params: p.params }, 'sélection initiale conservée dans le registre');

    // Sélection explicite à l’attribution : opus/grok seulement pour une mission bornée ; fast désactivé quand exposé.
    const grokAgent = agents.missionAgentId(REPO, 'S02');
    const simple = recorder({ 'GET /v1/models': () => models([fable, grok]), 'POST /v1/agents': () => json({ agent: agentRecord({ id: grokAgent }), run: runRecord({ agentId: grokAgent }) }) });
    const bounded = await agents.launch({ ...base, mission: 'S02', select: 'grok', fetchImpl: simple.fetchImpl });
    assert.equal(bounded.status, 'launched'); assert.deepEqual(simple.calls[1].body.model, { id: 'grok-4.6', params: [P('effort', 'medium'), P('fast', 'false')] }); assert.equal(bounded.selection.catalog.variant, 'Grok 4.6 Medium');
    // pending orphelin (POST interrompu) : reconcile conseillé, jamais une nouvelle mission ni une reprise aveugle.
    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: { O01: { agentId: AGENT, repo: REPO, ref: 'agents/O01-standard', state: 'pending', updatedAt: 'x' } } });
    const orphan = await agents.launch({ ...base, fetchImpl: recorder({}).fetchImpl });
    assert.equal(orphan.status, 'deduplicated'); assert.equal(orphan.nextAction, 'reconcile');
    await assert.rejects(agents.followup({ mission: 'O01', registryFile, promptText: 'x', key: KEY, fetchImpl: recorder({}).fetchImpl }), /état pending : reconcile/);
    await assert.rejects(agents.launch({ ...base, mission: 'S03', select: 'sonnet', fetchImpl: recorder({}).fetchImpl }), /Sélection inconnue/);

    const again = recorder({});
    const dedup = await agents.launch({ ...base, fetchImpl: again.fetchImpl });
    assert.equal(dedup.status, 'deduplicated'); assert.equal(again.calls.length, 0, 'mission connue : aucun appel');

    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: {} });
    const conflict = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ error: { code: 'agent_id_conflict', message: BODY_MARKER } }, 409), [`GET /v1/agents/${AGENT}`]: () => json(agentRecord({ status: 'IDLE' })) });
    const existing = await agents.launch({ ...base, fetchImpl: conflict.fetchImpl });
    assert.equal(existing.status, 'existing'); assert.equal(existing.providerCode, 'agent_id_conflict'); assert.equal(existing.agent.status, 'IDLE');
    assert.deepEqual(conflict.calls.map(c => c.method), ['GET', 'POST', 'GET'], 'un seul POST, puis lecture de l’existant');
    assertNoLeak(existing);
    assert.equal((await agents.loadRegistry(registryFile)).missions.O01.state, 'reconciled');

    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: {} });
    const conflict404 = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ error: { code: 'agent_id_conflict', message: BODY_MARKER } }, 409), [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'not_found' } }, 404) });
    const conflictUnread = await agents.launch({ ...base, fetchImpl: conflict404.fetchImpl });
    assert.equal(conflictUnread.status, 'uncertain'); assert.equal(conflictUnread.reason, 'conflict_unreadable');
    assert.equal(conflictUnread.delivery.state, 'conflict'); assert.equal(conflictUnread.delivery.httpStatus, 409);
    assert.match(conflictUnread.nextAction, /existence revendiquée/); assert.match(conflictUnread.nextAction, /--confirm-absent inapplicable/);
    let conflictEntry = (await agents.loadRegistry(registryFile)).missions.O01;
    assert.equal(conflictEntry.state, 'uncertain'); assert.equal(conflictEntry.delivery.state, 'conflict'); assert.equal(conflictEntry.reason, 'conflict_unreadable');
    for (let i = 0; i < 3; i++) {
      const again = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: conflict404.fetchImpl });
      assert.equal(again.status, 'uncertain'); assert.equal(again.reason, 'conflict_unreadable'); assert.equal(again.delivery.state, 'conflict');
    }
    assert.equal((await agents.launch({ ...base, fetchImpl: conflict404.fetchImpl })).status, 'deduplicated', 'aucun POST tant que le conflit n’est pas lu');
    assert.equal(conflict404.calls.filter(c => c.method === 'POST').length, 1, 'un seul POST malgré 404 répétés');
    const noAttest = await agents.reconcile({ mission: 'O01', confirmAbsent: true, key: KEY, registryFile, fetchImpl: conflict404.fetchImpl });
    assert.equal(noAttest.status, 'blocked'); assert.equal(noAttest.reason, 'confirm_absent_not_applicable');
    assert.match(noAttest.nextAction, /409/); assert.equal((await agents.loadRegistry(registryFile)).missions.O01.state, 'uncertain');
    assert.equal((await agents.loadRegistry(registryFile)).missions.O01.delivery.state, 'conflict');

    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: {} });
    // Livraison inconnue (délai/réseau après le POST) puis 404 : le fournisseur a peut-être reçu la requête ; un 404 — immédiat ou répété — ne prouve pas l’absence.
    // L’entrée reste uncertain (raison de livraison persistée), launch se déduplique sans second POST, aucune borne de temps n’est inventée ; seule une attestation humaine explicite conclut.
    const lost = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => { throw new TypeError('socket hang up'); }, [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'not_found' } }, 404) });
    const unknownDelivery = await agents.launch({ ...base, fetchImpl: lost.fetchImpl });
    assert.equal(unknownDelivery.status, 'uncertain'); assert.equal(unknownDelivery.state, 'uncertain'); assert.equal(unknownDelivery.reason, 'not_found_after_unknown_delivery'); assert.equal(unknownDelivery.deliveryReason, 'network');
    assert.match(unknownDelivery.nextAction, /404 ne prouve pas l’absence/); assert.match(unknownDelivery.nextAction, /--confirm-absent/); assertNoLeak(unknownDelivery);
    let persisted = (await agents.loadRegistry(registryFile)).missions.O01;
    assert.equal(persisted.state, 'uncertain'); assert.deepEqual({ state: persisted.delivery.state, reason: persisted.delivery.reason }, { state: 'unknown', reason: 'network' });
    for (let i = 0; i < 3; i++) { const again = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: lost.fetchImpl }); assert.equal(again.status, 'uncertain'); assert.equal(again.reason, 'not_found_after_unknown_delivery'); assert.equal(again.delivery.state, 'unknown'); }
    assert.equal((await agents.launch({ ...base, fetchImpl: lost.fetchImpl })).status, 'deduplicated', 'aucun POST tant que la livraison est inconnue');
    assert.equal(lost.calls.filter(c => c.method === 'POST').length, 1, 'un seul POST malgré timeout, 404 répétés et reconcile répétés');
    const attested = await agents.reconcile({ mission: 'O01', confirmAbsent: true, key: KEY, registryFile, fetchImpl: lost.fetchImpl });
    assert.equal(attested.status, 'not_created'); assert.equal(attested.attested, true); assert.equal(attested.delivery.state, 'attested_absent'); assert.equal(attested.delivery.attestedBy, 'human'); assert.equal(attested.delivery.attestationKind, 'unverified_declaration'); assert.match(attested.nextAction, /attestée par l’orchestrateur/); assert.match(attested.nextAction, /déclaration non vérifiée/);
    persisted = (await agents.loadRegistry(registryFile)).missions.O01; assert.equal(persisted.state, 'not_created'); assert.equal(persisted.delivery.state, 'attested_absent', 'décision humaine tracée au registre');
    assert.equal(lost.calls.filter(c => c.method === 'POST').length, 1);
    const relaunch = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ agent: agentRecord(), run: runRecord() }) });
    assert.equal((await agents.launch({ ...base, fetchImpl: relaunch.fetchImpl })).status, 'launched', 'not_created attesté autorise une relance sur la même clé');
    // Refus fournisseur explicite (4xx reçu au POST) : rien n’a été créé, aucune lecture 404 nécessaire ; distinct d’une livraison inconnue.
    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: {} });
    const refusedPost = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ error: { code: 'invalid_request', message: BODY_MARKER } }, 400) });
    const explicit = await agents.launch({ ...base, fetchImpl: refusedPost.fetchImpl });
    assert.equal(explicit.status, 'blocked'); assert.equal(explicit.reason, 'rejected'); assert.equal(explicit.httpStatus, 400); assert.deepEqual(refusedPost.calls.map(c => c.method), ['GET', 'POST']); assertNoLeak(explicit);
    assert.equal((await agents.loadRegistry(registryFile)).missions.O01.state, 'failed');
    const notApplicable = await agents.reconcile({ mission: 'O01', confirmAbsent: true, key: KEY, registryFile, fetchImpl: recorder({}).fetchImpl });
    assert.equal(notApplicable.status, 'blocked'); assert.equal(notApplicable.reason, 'confirm_absent_not_applicable', 'l’attestation d’absence ne s’applique qu’à une livraison inconnue');

    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: {} });
    const unknown = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => { throw new TypeError('socket hang up'); }, [`GET /v1/agents/${AGENT}`]: () => json({}, 503) });
    const uncertain = await agents.launch({ ...base, fetchImpl: unknown.fetchImpl });
    assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.nextAction, 'reconcile');
    assert.equal((await agents.loadRegistry(registryFile)).missions.O01.state, 'uncertain');
    const stillUncertain = await agents.launch({ ...base, fetchImpl: recorder({}).fetchImpl });
    assert.equal(stillUncertain.status, 'deduplicated'); assert.equal(stillUncertain.nextAction, 'reconcile', 'un appel incertain n’est jamais relancé');
    const settled = recorder({ [`GET /v1/agents/${AGENT}`]: () => json(agentRecord()) });
    const reconciled = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: settled.fetchImpl });
    assert.equal(reconciled.status, 'reconciled'); assert.equal(reconciled.agent.latestRunId, RUN);
    assert.equal((await agents.loadRegistry(registryFile)).missions.O01.runId, RUN);

    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: {} });
    const foreign = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ agent: agentRecord({ id: 'bc-ffffffff-ffff-4fff-8fff-ffffffffffff' }), run: runRecord({ agentId: 'bc-ffffffff-ffff-4fff-8fff-ffffffffffff' }) }) });
    const mismatch = await agents.launch({ ...base, fetchImpl: foreign.fetchImpl });
    assert.equal(mismatch.status, 'uncertain'); assert.equal(mismatch.reason, 'identity_mismatch');

    await assert.rejects(agents.launch({ ...base, mission: 'bad key/with slash', fetchImpl: recorder({}).fetchImpl }), agents.UsageError);
    await assert.rejects(agents.launch({ ...base, repo: 'https://gitlab.com/x/y', fetchImpl: recorder({}).fetchImpl }), /GitHub/);
    await assert.rejects(agents.launch({ ...base, ref: 'bad ref', fetchImpl: recorder({}).fetchImpl }), /branche/);
    await assert.rejects(agents.launch({ ...base, registryFile: undefined }), /registry/);
  });
});

test('status polls progressively, reports only changes, truncates results and never fetches full logs', async () => {
  assert.deepEqual([0, 15_000, 30_000, 60_000, 120_000, 300_000].map(agents.nextInterval), [15_000, 30_000, 60_000, 120_000, 300_000, 300_000]);
  assert.deepEqual(agents.diffRun(null, { status: 'RUNNING' }), ['premier relevé']);
  assert.deepEqual(agents.diffRun({ status: 'RUNNING', branches: [] }, { status: 'RUNNING', branches: [] }), []);
  await withTemp('lite-orch-status-', async (temp) => {
    const stateFile = join(temp, 'state', 'O01.json');
    let record = runRecord({ status: 'RUNNING' });
    const r = recorder({ [`GET /v1/agents/${AGENT}/runs/${RUN}`]: () => json(record) });
    const first = await agents.status({ agentId: AGENT, runId: RUN, stateFile, key: KEY, fetchImpl: r.fetchImpl });
    assert.equal(first.status, 'ok'); assert.equal(first.changed, true); assert.equal(first.terminal, false);
    const second = await agents.status({ agentId: AGENT, runId: RUN, stateFile, key: KEY, fetchImpl: r.fetchImpl });
    assert.equal(second.changed, false); assert.deepEqual(second.changes, []);
    record = runRecord({ status: 'FINISHED', durationMs: 1234, result: 'R'.repeat(5000), git: { branches: [{ repoUrl: 'github.com/example-org/example-app', branch: 'agents/O01-standard', prUrl: 'https://github.com/example-org/example-app/pull/1' }] } });
    const third = await agents.status({ agentId: AGENT, runId: RUN, stateFile, key: KEY, fetchImpl: r.fetchImpl });
    assert.equal(third.terminal, true); assert.deepEqual(third.changes, ['statut RUNNING → FINISHED', 'branches/PR modifiées', 'résultat final disponible']);
    assert.ok(third.run.result.length < 1300 && third.run.result.includes('[tronqué 5000 caractères]')); assert.equal(third.run.branches[0].prUrl, 'https://github.com/example-org/example-app/pull/1');
    assert.ok(r.calls.every(c => !c.url.includes('/stream')), 'aucun flux d’événements');
    const notFound = await agents.status({ agentId: AGENT, runId: RUN, key: KEY, fetchImpl: recorder({ [`GET /v1/agents/${AGENT}/runs/${RUN}`]: () => json({ error: { code: 'not_found' } }, 404) }).fetchImpl });
    assert.equal(notFound.status, 'blocked'); assert.equal(notFound.httpStatus, 404);
    await assert.rejects(agents.status({ agentId: 'bc-not-valid', runId: RUN, key: KEY }), agents.UsageError);

    const logs = []; let slept = [];
    const follow = recorder({ [`GET /v1/agents/${AGENT}/runs/${RUN}`]: () => json(logs.length >= 1 ? runRecord({ status: 'FINISHED' }) : runRecord({ status: 'RUNNING' })) });
    const code = await agents.main(['status', '--agent', AGENT, '--run', RUN, '--follow', '--state', join(temp, 'follow.json')], { env: { CURSOR_API_KEY: KEY }, fetchImpl: follow.fetchImpl, sleep: async ms => { slept.push(ms); }, log: line => logs.push(JSON.parse(line)) });
    assert.equal(code, 0); assert.deepEqual(slept, [15_000]); assert.deepEqual(logs.map(l => l.run.status), ['RUNNING', 'FINISHED']);
  });
});

test('followup reads the real agent and its latest run before any POST, keeps the initial selection and sends no model field', async () => {
  const RUN2 = 'run-00000000-0000-4000-8000-000000000002', RUN3 = 'run-00000000-0000-4000-8000-000000000003', RUN4 = 'run-00000000-0000-4000-8000-000000000004', RUN5 = 'run-00000000-0000-4000-8000-000000000005';
  const methods = r => r.calls.map(c => `${c.method} ${new URL(c.url).pathname.replace(`/v1/agents/${AGENT}`, '~')}`);
  const noPost = r => assert.ok(r.calls.every(c => c.method !== 'POST'), `aucun POST attendu : ${methods(r)}`);
  const agentAt = (latestRunId) => json(agentRecord({ latestRunId }));

  // --agent seul : garde minimale — lire l’agent, lire son dernier run, exiger le terminal ; jamais de POST immédiat.
  const down = recorder({ [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'server' } }, 503) });
  const unavailable = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: down.fetchImpl });
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.persistent, false); noPost(down);
  const gone = recorder({ [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'not_found' } }, 404) });
  const notFound = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: gone.fetchImpl });
  assert.equal(notFound.status, 'blocked'); assert.equal(notFound.httpStatus, 404); noPost(gone);
  const active = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => json(runRecord({ id: RUN2, status: 'RUNNING' })) });
  const busyAgent = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: active.fetchImpl });
  assert.equal(busyAgent.status, 'blocked'); assert.equal(busyAgent.reason, 'run_active'); assert.equal(busyAgent.runId, RUN2); noPost(active); assert.deepEqual(methods(active), ['GET ~', 'GET ~/runs/' + RUN2]);
  const unknownRun = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: recorder({ [`GET /v1/agents/${AGENT}`]: () => json(agentRecord({ latestRunId: undefined })) }).fetchImpl });
  assert.equal(unknownRun.status, 'blocked'); assert.equal(unknownRun.reason, 'latest_run_unknown');
  const runError = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => { throw new TypeError('fetch failed'); } });
  const unreadable = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: runError.fetchImpl });
  assert.equal(unreadable.status, 'unavailable'); assert.equal(unreadable.reason, 'network'); noPost(runError);
  let body;
  const okAgent = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => json(runRecord({ id: RUN2, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: (request) => { body = request.body; return json({ run: runRecord({ id: RUN3 }) }); } });
  const launched = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: okAgent.fetchImpl });
  assert.equal(launched.status, 'launched'); assert.equal(launched.priorRunId, RUN2); assert.equal(launched.runId, RUN3); assert.deepEqual(body, { prompt: { text: PROMPT_MARKER } }); assert.deepEqual(methods(okAgent), ['GET ~', 'GET ~/runs/' + RUN2, 'POST ~/runs']);
  assert.equal(launched.persistent, false); assert.match(launched.note, /aucune idempotence/); assertNoLeak(launched);
  const busy = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => json(runRecord({ id: RUN2, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: () => json({ error: { code: 'agent_busy', message: BODY_MARKER } }, 409) });
  const rejected = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: busy.fetchImpl });
  assert.equal(rejected.status, 'blocked'); assert.equal(rejected.providerCode, 'agent_busy'); assert.equal(busy.calls.filter(c => c.method === 'POST').length, 1, '409 serveur : garde complémentaire, un seul POST'); assertNoLeak(rejected);
  const lostAgentOnly = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => json(runRecord({ id: RUN2, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: () => { throw new Error('reset'); } });
  const lost = await agents.followup({ agentId: AGENT, promptText: 'x', key: KEY, fetchImpl: lostAgentOnly.fetchImpl });
  assert.equal(lost.status, 'uncertain'); assert.equal(lost.priorRunId, RUN2); assert.match(lost.nextAction, /aucune répétition automatique/); assert.equal(lostAgentOnly.calls.filter(c => c.method === 'POST').length, 1);

  const config = await selections();
  await withTemp('lite-orch-followup-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const entryOf = async () => (await agents.loadRegistry(registryFile)).missions.O01;
    const created = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ agent: agentRecord(), run: runRecord() }) });
    const first = await agents.launch({ mission: 'O01', repo: REPO, ref: 'agents/O01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: created.fetchImpl });
    assert.equal(first.status, 'launched'); assert.equal((await entryOf()).runId, RUN);

    // (2) Registre périmé (RUN) alors que l’agent a un autre run actif (RUN2) : lecture réelle, refus, aucun POST, registre réaligné.
    const stale = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => json(runRecord({ id: RUN2, status: 'RUNNING' })) });
    const early = await agents.followup({ mission: 'O01', registryFile, promptText: 'suite', key: KEY, fetchImpl: stale.fetchImpl });
    assert.equal(early.status, 'blocked'); assert.equal(early.reason, 'run_active'); assert.equal(early.runId, RUN2); assert.equal(early.registryRunId, RUN); noPost(stale);
    assert.ok(stale.calls.every(c => !c.url.endsWith(`/runs/${RUN}`)), 'le run périmé du registre n’est pas consulté');
    assert.equal((await entryOf()).runId, RUN2); assert.equal((await entryOf()).followup, undefined);

    // Terminal réel ⇒ un seul POST sans champ model ; sélection initiale et catalogue daté conservés ; tentative persistée puis acceptée.
    let runBody;
    const later = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN2), [`GET /v1/agents/${AGENT}/runs/${RUN2}`]: () => json(runRecord({ id: RUN2, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: (request) => { runBody = request.body; return json({ run: runRecord({ id: RUN3 }) }); } });
    const resumed = await agents.followup({ mission: 'O01', registryFile, promptText: 'suite', key: KEY, fetchImpl: later.fetchImpl });
    assert.equal(resumed.status, 'launched'); assert.equal(resumed.priorRunId, RUN2); assert.equal(resumed.runId, RUN3); assert.equal(resumed.modelSent, false); assert.equal(resumed.persistent, true);
    assert.deepEqual(Object.keys(runBody), ['prompt'], 'le POST run ne porte aucun champ model');
    assert.deepEqual(resumed.selection.requested, first.selection.requested); assert.equal(resumed.selection.catalog.checkedAt, first.selection.catalog.checkedAt, 'sélection initiale et catalogue daté conservés, sans revalidation ni changement');
    assert.equal(resumed.selection.runAccepted, true); assert.equal(resumed.selection.modelObserved, null);
    let entry = await entryOf();
    assert.equal(entry.runId, RUN3); assert.equal(entry.followups, 1); assert.deepEqual({ state: entry.followup.state, priorRunId: entry.followup.priorRunId, runId: entry.followup.runId }, { state: 'accepted', priorRunId: RUN2, runId: RUN3 });
    assert.deepEqual({ modelId: entry.selection.modelId, params: entry.selection.params }, first.selection.requested);

    // (3) POST accepté mais réponse perdue : tentative persistée uncertain ; toute réémission refusée sans appel ; reconcile tranche via latestRunId
    // même si le run accepté (RUN4) s’est déjà terminé ; zéro second POST.
    const lostPost = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN3), [`GET /v1/agents/${AGENT}/runs/${RUN3}`]: () => json(runRecord({ id: RUN3, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: () => { throw new TypeError('socket hang up'); } });
    const uncertain = await agents.followup({ mission: 'O01', registryFile, promptText: 'suite 2', key: KEY, fetchImpl: lostPost.fetchImpl });
    assert.equal(uncertain.status, 'uncertain'); assert.equal(uncertain.priorRunId, RUN3); assert.match(uncertain.nextAction, /reconcile/);
    entry = await entryOf(); assert.equal(entry.followup.state, 'uncertain'); assert.equal(entry.followup.priorRunId, RUN3); assert.equal(entry.runId, RUN3, 'aucun succès prétendu sur l’ancien run');
    const silent = recorder({});
    const refused = await agents.followup({ mission: 'O01', registryFile, promptText: 'suite 2', key: KEY, fetchImpl: silent.fetchImpl });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.reason, 'followup_unresolved'); assert.equal(silent.calls.length, 0, 'réémission refusée sans aucun appel');
    const staleStatus = await agents.status({ mission: 'O01', registryFile, key: KEY, fetchImpl: recorder({ [`GET /v1/agents/${AGENT}/runs/${RUN3}`]: () => json(runRecord({ id: RUN3, status: 'FINISHED' })) }).fetchImpl });
    assert.equal(staleStatus.selection.runAccepted, false, 'la suite incertaine n’est pas présentée comme acceptée');
    const notFoundLater = recorder({ [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'not_found' } }, 404) });
    const still = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: notFoundLater.fetchImpl });
    assert.equal(still.status, 'uncertain'); assert.equal(still.reason, 'agent_not_found'); noPost(notFoundLater);
    entry = await entryOf(); assert.equal(entry.followup.state, 'uncertain', '404 n’autorise ni création ni réémission'); assert.equal(entry.runId, RUN3);
    const forbidden = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: recorder({ [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'forbidden' } }, 403) }).fetchImpl });
    assert.equal(forbidden.status, 'uncertain'); assert.equal((await entryOf()).followup.state, 'uncertain');
    const settled = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN4) });
    const reconciled = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: settled.fetchImpl });
    assert.equal(reconciled.status, 'reconciled'); assert.deepEqual(reconciled.followup, { state: 'accepted', priorRunId: RUN3, runId: RUN4 }); assert.match(reconciled.nextAction, /aucune réémission/); noPost(settled);
    entry = await entryOf(); assert.equal(entry.runId, RUN4); assert.equal(entry.followups, 2); assert.equal(entry.followup.state, 'accepted');
    const relecture = await agents.status({ mission: 'O01', registryFile, key: KEY, fetchImpl: recorder({ [`GET /v1/agents/${AGENT}/runs/${RUN4}`]: () => json(runRecord({ id: RUN4, status: 'FINISHED' })) }).fetchImpl });
    assert.equal(relecture.run.runId, RUN4); assert.equal(relecture.terminal, true);

    // Livraison inconnue puis reconcile sans nouveau run : not_created ⇒ réémission autorisée, un seul POST alors.
    const lostAgain = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN4), [`GET /v1/agents/${AGENT}/runs/${RUN4}`]: () => json(runRecord({ id: RUN4, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: () => { throw new TypeError('socket hang up'); } });
    assert.equal((await agents.followup({ mission: 'O01', registryFile, promptText: 'suite 3', key: KEY, fetchImpl: lostAgain.fetchImpl })).status, 'uncertain');
    const nothingNew = await agents.reconcile({ mission: 'O01', key: KEY, registryFile, fetchImpl: recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN4) }).fetchImpl });
    assert.deepEqual(nothingNew.followup, { state: 'not_created', priorRunId: RUN4 }); assert.match(nothingNew.nextAction, /followup --mission autorisé/);
    assert.equal((await entryOf()).followups, 2);
    const retry = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN4), [`GET /v1/agents/${AGENT}/runs/${RUN4}`]: () => json(runRecord({ id: RUN4, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: () => json({ run: runRecord({ id: RUN5 }) }) });
    const reissued = await agents.followup({ mission: 'O01', registryFile, promptText: 'suite 3', key: KEY, fetchImpl: retry.fetchImpl });
    assert.equal(reissued.status, 'launched'); assert.equal(reissued.priorRunId, RUN4); assert.equal(reissued.runId, RUN5); assert.equal(retry.calls.filter(c => c.method === 'POST').length, 1);
    assert.equal((await entryOf()).followups, 3);

    // Rejet serveur après contrôle client : persisté, pas de répétition ; usage.
    const busyMission = recorder({ [`GET /v1/agents/${AGENT}`]: () => agentAt(RUN5), [`GET /v1/agents/${AGENT}/runs/${RUN5}`]: () => json(runRecord({ id: RUN5, status: 'FINISHED' })), [`POST /v1/agents/${AGENT}/runs`]: () => json({ error: { code: 'agent_busy' } }, 409) });
    const rejectedMission = await agents.followup({ mission: 'O01', registryFile, promptText: 'x', key: KEY, fetchImpl: busyMission.fetchImpl });
    assert.equal(rejectedMission.status, 'blocked'); assert.equal((await entryOf()).followup.state, 'rejected'); assert.equal((await entryOf()).runId, RUN5);
    await assert.rejects(agents.followup({ mission: 'O01', agentId: 'bc-ffffffff-ffff-4fff-8fff-ffffffffffff', registryFile, promptText: 'x', key: KEY }), /pas celui de la mission/);
    entry = await entryOf(); await agents.saveRegistry(registryFile, { formatVersion: 1, missions: { O01: { ...entry, state: 'uncertain' } } });
    await assert.rejects(agents.followup({ mission: 'O01', registryFile, promptText: 'x', key: KEY }), /reconcile/);
  });
});

test('the CLI refuses to run without the environment key and maps outcomes to exit codes', async () => {
  const logs = [];
  await assert.rejects(agents.main(['preflight'], { env: {}, fetchImpl: () => { throw new Error('ne doit pas être appelé'); }, log: l => logs.push(l) }), /CURSOR_API_KEY/);
  assert.equal(await agents.main(['preflight'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: recorder({ 'GET /v1/models': () => models([fable]) }).fetchImpl, log: l => logs.push(l) }), 0);
  assert.equal(await agents.main(['preflight'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: recorder({ 'GET /v1/models': () => models([other]) }).fetchImpl, log: l => logs.push(l) }), 2);
  assert.equal(await agents.main(['preflight', '--select', 'opus'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: recorder({ 'GET /v1/models': () => models([opus]) }).fetchImpl, log: l => logs.push(l) }), 0);
  await assert.rejects(agents.main(['preflight', '--select', 'sonnet'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: () => { throw new Error('ne doit pas être appelé'); } }), /Sélection inconnue/);
  assert.equal(await agents.main(['preflight'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: recorder({ 'GET /v1/models': () => json({ error: { code: 'unauthorized' } }, 401) }).fetchImpl, log: l => logs.push(l) }), 3);
  for (const line of logs) { assert.ok(!line.includes(KEY)); JSON.parse(line); }
  await assert.rejects(agents.main(['launch', '--mission', 'O01', '--unknown'], { env: { CURSOR_API_KEY: KEY } }), agents.UsageError);
  const cli = spawnSync(process.execPath, [join(root, orchestrationDir, 'scripts/cursor-agents.mjs'), 'preflight'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(cli.status, 4); assert.match(cli.stderr, /CURSOR_API_KEY/); assert.equal(cli.stdout, '');
});

test('the generator installs the standard as an exact managed copy usable without the kit', async () => {
  await withTemp('lite-orch-create-', async (temp) => {
    const out = join(temp, 'app');
    await createApp({ out, spec: join(root, 'examples/services.json') });
    const manifest = JSON.parse(await readFile(join(out, orchestrationManifest), 'utf8'));
    const sources = await orchestrationSources();
    assert.equal(manifest.formatVersion, 1); assert.equal(manifest.owner, 'creezio-lite'); assert.equal(manifest.kitVersion, '0.14.2');
    assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(sources).sort());
    for (const [path, source] of Object.entries(sources)) {
      const copy = await readFile(join(out, path)), original = await readFile(source);
      assert.ok(copy.equals(original), `copie divergente : ${path}`);
      assert.equal(manifest.files[path], createHash('sha256').update(copy).digest('hex'));
    }
    const report = await doctor(out);
    assert.equal(report.ok, true); assert.deepEqual(report.orchestration, { status: 'current', installedVersion: '0.14.2', targetVersion: '0.14.2', conflicts: [] });
    const lock = JSON.parse(await readFile(join(out, 'lite.lock.json'), 'utf8'));
    assert.ok(!Object.keys(lock.runtimeFiles).some(f => f.includes('.cursor')), 'le verrou runtime ne couvre pas le standard');
    const standalone = join(temp, 'standalone');
    await cp(join(out, '.cursor'), join(standalone, '.cursor'), { recursive: true });
    const script = join(standalone, orchestrationDir, 'scripts/cursor-agents.mjs');
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', cwd: standalone, env: { PATH: process.env.PATH } });
    assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /preflight/);
    const check = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${script.replaceAll('\\', '/')}').then(async m=>{const config=await m.loadSelections();const selection=m.resolveSelection(config);console.log(JSON.stringify(await m.preflight({selection,config,key:'FAKE_TEST_KEY_NOT_A_SECRET',fetchImpl:async()=>new Response(JSON.stringify({items:[{id:selection.modelId,displayName:'Fable',variants:[{params:selection.params,displayName:'Fable'}]}]}),{status:200,headers:{'content-type':'application/json'}})})))})`], { encoding: 'utf8', cwd: standalone, env: { PATH: process.env.PATH } });
    assert.equal(check.status, 0, check.stderr); assert.equal(JSON.parse(check.stdout).status, 'ok');
    const skill = await readFile(join(standalone, orchestrationDir, 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: lite-orchestration\n/);
    assert.match(await readFile(join(standalone, orchestrationRule), 'utf8'), /alwaysApply: true/);
    assert.match(await readFile(join(out, 'AGENTS.md'), 'utf8'), /lite-orchestration/);
  });
});

test('adopt inspects, applies once, preserves local rules and unmanaged files, and refuses local conflicts', async () => {
  await withTemp('lite-orch-adopt-', async (temp) => {
    const app = join(temp, 'existing');
    await createApp({ out: app, spec: join(root, 'examples/catalogue.json') });
    await rm(join(app, '.cursor'), { recursive: true, force: true });
    await mkdir(join(app, '.cursor/rules'), { recursive: true });
    const localRule = '---\ndescription: règle métier locale\nalwaysApply: true\n---\nRègle métier de l’application.\n';
    await writeFile(join(app, '.cursor/rules/metier.mdc'), localRule);
    const localAgents = '# AGENTS de l’application\nRègles métier propres, sans mention du standard.\n';
    await writeFile(join(app, 'AGENTS.md'), localAgents);
    const before = await doctor(app);
    assert.equal(before.ok, true, 'l’absence du standard ne bloque pas doctor'); assert.equal(before.orchestration.status, 'missing');

    const inspection = await adopt(app);
    assert.equal(inspection.applied, false); assert.equal(inspection.status, 'missing'); assert.equal(inspection.changed, true); assert.equal(inspection.agentsMentionsStandard, false);
    assert.ok(Object.values(inspection.files).every(s => s === 'missing'));
    assert.ok(!(await readdir(join(app, '.cursor'))).includes('skills'), 'l’inspection n’écrit rien');

    const applied = await adopt(app, true);
    assert.equal(applied.applied, true); assert.deepEqual([...applied.written].sort(), DISTRIBUTED);
    const again = await adopt(app, true);
    assert.equal(again.applied, false); assert.equal(again.changed, false); assert.equal(again.status, 'current');
    assert.equal(await readFile(join(app, '.cursor/rules/metier.mdc'), 'utf8'), localRule);
    assert.equal(await readFile(join(app, 'AGENTS.md'), 'utf8'), localAgents);
    assert.equal((await doctor(app)).orchestration.status, 'current');

    const manifestPath = join(app, orchestrationManifest), skillPath = join(app, orchestrationDir, 'SKILL.md');
    const previous = await readFile(skillPath, 'utf8');
    await writeFile(skillPath, previous + '\nNote locale non autorisée.\n');
    await writeFile(join(app, orchestrationDir, 'notes-locales.md'), 'préservé\n');
    const conflict = await adopt(app);
    assert.equal(conflict.status, 'conflict'); assert.deepEqual(conflict.conflicts, [`${orchestrationDir}/SKILL.md`]); assert.deepEqual(conflict.unmanaged, [`${orchestrationDir}/notes-locales.md`]);
    await assert.rejects(adopt(app, true), /Conflit local .*SKILL\.md.*Aucune modification effectuée/);
    assert.match(await readFile(skillPath, 'utf8'), /Note locale non autorisée/);
    assert.equal(await readFile(join(app, orchestrationDir, 'notes-locales.md'), 'utf8'), 'préservé\n');
    assert.deepEqual((await doctor(app)).orchestration.conflicts, [`${orchestrationDir}/SKILL.md`]);

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files[`${orchestrationDir}/SKILL.md`] = createHash('sha256').update(await readFile(skillPath)).digest('hex'); manifest.kitVersion = '0.11.9';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const outdated = await adopt(app);
    assert.equal(outdated.status, 'outdated'); assert.equal(outdated.files[`${orchestrationDir}/SKILL.md`], 'outdated'); assert.equal(outdated.installedVersion, '0.11.9');
    const upgraded = await adopt(app, true);
    assert.deepEqual(upgraded.written, [`${orchestrationDir}/SKILL.md`]); assert.equal(await readFile(skillPath, 'utf8'), previous);
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).kitVersion, '0.14.2');
    assert.equal(await readFile(join(app, orchestrationDir, 'notes-locales.md'), 'utf8'), 'préservé\n');

    await writeFile(manifestPath, JSON.stringify({ formatVersion: 9 }) + '\n');
    await assert.rejects(adopt(app), /Manifeste/);
    await assert.rejects(adopt(root, true), /indépendante du kit/);
    await assert.rejects(adopt(temp), /brand\.json/);
    const cli = spawnSync(process.execPath, [join(root, 'bin/lite.mjs'), 'adopt', '--app', join(temp, 'nowhere')], { encoding: 'utf8' });
    assert.equal(cli.status, 1); assert.match(cli.stderr, /brand\.json/);
  });
});

// Un lien symbolique (ou une jonction) sur un chemin géré ou un de ses parents ferait écrire adopt hors de l’application : refus avant toute écriture.
test('adopt refuses symlinked managed paths and parents before any write, and reports a corrupt manifest without touching anything', async () => {
  await withTemp('lite-orch-symlink-', async (temp) => {
    const app = join(temp, 'app'), outside = join(temp, 'outside');
    await createApp({ out: app, spec: join(root, 'examples/catalogue.json') });
    await rm(join(app, '.cursor'), { recursive: true, force: true });
    await mkdir(join(app, '.cursor'), { recursive: true });
    const snapshot = async (dir) => { const out = {}; try { for (const f of await readdir(dir, { recursive: true })) { const path = join(dir, f); const info = await lstat(path); out[f] = info.isDirectory() ? 'dir' : info.isSymbolicLink() ? 'link' : createHash('sha256').update(await readFile(path)).digest('hex'); } } catch (error) { if (error.code !== 'ENOENT') throw error; return null; } return out; };
    const refused = async (pattern) => {
      const outsideBefore = await snapshot(outside), appBefore = await snapshot(join(app, '.cursor'));
      await assert.rejects(adopt(app), pattern); await assert.rejects(adopt(app, true), pattern);
      assert.deepEqual(await snapshot(outside), outsideBefore, 'cibles externes intactes'); assert.deepEqual(await snapshot(join(app, '.cursor')), appBefore, 'application intacte');
      assert.equal((await doctor(app)).orchestration.status, 'invalid');
    };

    // 1. .cursor/rules → dossier externe.
    await mkdir(join(outside, 'rules'), { recursive: true });
    await symlink(join(outside, 'rules'), join(app, '.cursor/rules'), 'dir');
    await refused(/Lien symbolique .*\.cursor[\\/]rules.*Aucune modification effectuée/);
    assert.deepEqual(await readdir(join(outside, 'rules')), []);
    await rm(join(app, '.cursor/rules'));

    // 2. .cursor/skills/lite-orchestration → dossier externe (parent déjà existant).
    await mkdir(join(app, '.cursor/skills'), { recursive: true }); await mkdir(join(outside, 'skill'), { recursive: true });
    await symlink(join(outside, 'skill'), join(app, '.cursor/skills/lite-orchestration'), 'dir');
    await refused(/Lien symbolique .*lite-orchestration.*Aucune modification effectuée/);
    assert.deepEqual(await readdir(join(outside, 'skill')), []);
    await rm(join(app, '.cursor/skills/lite-orchestration'));

    // 3. Fichier géré symlinké vers une cible externe, avec manifeste le déclarant outdated.
    const normal = await adopt(app, true); assert.equal(normal.applied, true); assert.deepEqual([...normal.written].sort(), DISTRIBUTED);
    const skillPath = join(app, orchestrationDir, 'SKILL.md'), target = join(outside, 'target.md');
    const stale = 'ancienne copie externe\n'; await writeFile(target, stale);
    await rm(skillPath); await symlink(target, skillPath, 'file');
    const manifestPath = join(app, orchestrationManifest), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files[`${orchestrationDir}/SKILL.md`] = createHash('sha256').update(stale).digest('hex'); manifest.kitVersion = '0.11.9';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    await refused(/Lien symbolique .*SKILL\.md.*Aucune modification effectuée/);
    assert.equal(await readFile(target, 'utf8'), stale, 'cible externe non écrasée');
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).kitVersion, '0.11.9', 'manifeste non réécrit');
    await rm(skillPath); await writeFile(skillPath, stale);
    const repaired = await adopt(app, true); assert.deepEqual(repaired.written, [`${orchestrationDir}/SKILL.md`]);
    assert.equal((await adopt(app, true)).changed, false, 'adoption normale et idempotence toujours vertes');

    // Manifeste JSON corrompu : erreur claire, aucune écriture.
    await writeFile(manifestPath, '{ "formatVersion": 1, "files": {');
    const before = await snapshot(join(app, '.cursor'));
    await assert.rejects(adopt(app, true), /Manifeste d’orchestration illisible .*JSON invalide.*Aucune modification effectuée/);
    assert.deepEqual(await snapshot(join(app, '.cursor')), before);
    assert.equal((await doctor(app)).orchestration.status, 'invalid');
  });
});

test('inspectOrchestration reads the kit sources without depending on template/runtime', async () => {
  const sources = await orchestrationSources();
  for (const path of Object.keys(sources)) assert.ok(path.startsWith('.cursor/'), path);
  assert.equal(sources[orchestrationRule], join(root, 'template', orchestrationRule));
  await withTemp('lite-orch-inspect-', async (temp) => {
    const report = await inspectOrchestration(temp);
    assert.equal(report.status, 'missing'); assert.equal(report.installedVersion, null); assert.deepEqual(report.unmanaged, []);
  });
});
