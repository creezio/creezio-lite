import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, cp, readdir } from 'node:fs/promises';
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
const fable = { id: 'claude-fable-5-1-thinking-high', displayName: 'Claude Fable 5.1 (Thinking, high)', variants: [{ params: [], displayName: 'Claude Fable 5.1 (Thinking, high)', isDefault: true }] };
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
async function pin() { return agents.loadPinnedModel(); }
function assertNoLeak(value) {
  const text = JSON.stringify(value) + (value instanceof Error ? value.stack : '');
  for (const marker of [KEY, BODY_MARKER, PROMPT_MARKER, 'Bearer ']) assert.ok(!text.includes(marker), `fuite de « ${marker.trim()} » dans ${text.slice(0, 200)}`);
}
async function withTemp(prefix, run) { const temp = await mkdtemp(join(tmpdir(), prefix)); try { return await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }

test('the canonical skill has a valid frontmatter, a strict pinned model and no private data', async () => {
  const skill = await readFile(join(root, orchestrationDir, 'SKILL.md'), 'utf8');
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(front, 'frontmatter YAML attendu');
  assert.match(front[1], /^name: lite-orchestration$/m);
  const description = front[1].match(/^description: (.+)$/m); assert.ok(description && description[1].length > 40 && description[1].length <= 1024);
  for (const link of ['CONTRACT.md', 'cursor-model.json', 'scripts/cursor-agents.mjs']) assert.ok(skill.includes(link) && (await readdir(join(root, orchestrationDir, link.includes('/') ? 'scripts' : '.'))).includes(link.split('/').pop()));
  const sources = await orchestrationSources();
  assert.deepEqual(Object.keys(sources).sort(), [orchestrationRule, `${orchestrationDir}/CONTRACT.md`, `${orchestrationDir}/SKILL.md`, `${orchestrationDir}/cursor-model.json`, `${orchestrationDir}/scripts/cursor-agents.mjs`].sort());
  for (const source of Object.values(sources)) {
    const content = await readFile(source, 'utf8');
    assert.doesNotMatch(content, /bc-[0-9a-f]{8}-[0-9a-f]{4}|run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|\/home\/|\/Users\/|[A-Z]:\\|key_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}/, `donnée privée dans ${source}`);
    assert.ok(!content.includes('Codex ') || /pas de|aucun|ni /i.test(content));
  }
  const model = agents.validatePinnedModel(JSON.parse(await readFile(sources[`${orchestrationDir}/cursor-model.json`], 'utf8')));
  assert.equal(model.modelId, 'claude-fable-5-1-thinking-high'); assert.equal(model.effectiveModelName, model.modelId);
  assert.throws(() => agents.validatePinnedModel({ formatVersion: 1, provider: 'cursor', modelId: 'x', params: [], effectiveModelName: 'x', matching: 'exact-id', fallback: 'first-available' }), /fallback none/);
  const script = await readFile(sources[`${orchestrationDir}/scripts/cursor-agents.mjs`], 'utf8');
  const imports = [...script.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.ok(imports.length > 0 && imports.every(i => i.startsWith('node:')), `le script doit rester autonome, sans import du kit : ${imports}`);
  assert.equal(script.split('${key}').length - 1, 1, 'la clé n’est interpolée que dans l’en-tête Authorization');
});

test('preflight accepts only the exact pinned identifier with its parameters, without fallback', async () => {
  const p = await pin();
  const ok = recorder({ 'GET /v1/models': () => models([other, fable]) });
  const accepted = await agents.preflight({ pin: p, key: KEY, fetchImpl: ok.fetchImpl });
  assert.equal(accepted.status, 'ok'); assert.equal(accepted.matchedBy, 'id'); assert.equal(accepted.fallback, 'none'); assert.equal(accepted.modelsListed, 2);
  assert.equal(ok.calls.length, 1); assert.equal(ok.calls[0].headers.authorization, `Bearer ${KEY}`); assert.equal(ok.calls[0].redirect, 'manual'); assert.equal(ok.calls[0].url, 'https://api.cursor.com/v1/models');
  assertNoLeak(accepted);

  const absent = recorder({ 'GET /v1/models': () => models([other, { id: 'claude-fable-5-1-thinking', displayName: 'Fable' }, { id: 'claude-fable-5-thinking-high', displayName: 'Fable 5' }]) });
  const blocked = await agents.preflight({ pin: p, key: KEY, fetchImpl: absent.fetchImpl });
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reason, 'model_absent'); assert.deepEqual(blocked.candidates, ['claude-fable-5-1-thinking', 'claude-fable-5-thinking-high']);
  assert.equal(absent.calls.length, 1, 'aucun second appel ni sélection de remplacement');

  const alias = recorder({ 'GET /v1/models': () => models([{ id: 'claude-fable-5-1-thinking', displayName: 'Fable', aliases: [p.modelId] }]) });
  const aliased = await agents.preflight({ pin: p, key: KEY, fetchImpl: alias.fetchImpl });
  assert.equal(aliased.status, 'blocked'); assert.equal(aliased.reason, 'alias_only'); assert.equal(aliased.canonicalId, 'claude-fable-5-1-thinking');

  const needsParams = recorder({ 'GET /v1/models': () => models([{ ...fable, variants: other.variants }]) });
  const required = await agents.preflight({ pin: p, key: KEY, fetchImpl: needsParams.fetchImpl });
  assert.equal(required.status, 'blocked'); assert.equal(required.reason, 'params_required'); assert.equal(required.variants.length, 2);

  const withParams = { ...p, params: [{ id: 'fast', value: 'true' }] };
  const unsupported = await agents.preflight({ pin: withParams, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([fable]) }).fetchImpl });
  assert.equal(unsupported.status, 'blocked'); assert.equal(unsupported.reason, 'param_unsupported'); assert.equal(unsupported.param, 'fast');
  const unknownVariant = await agents.preflight({ pin: { ...p, params: [{ id: 'fast', value: 'false' }] }, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([{ ...fable, parameters: other.parameters, variants: [other.variants[0]] }]) }).fetchImpl });
  assert.equal(unknownVariant.status, 'blocked'); assert.equal(unknownVariant.reason, 'variant_unknown');
  const variantOk = await agents.preflight({ pin: { ...p, params: [{ id: 'fast', value: 'true' }] }, key: KEY, fetchImpl: recorder({ 'GET /v1/models': () => models([{ ...fable, parameters: other.parameters, variants: other.variants }]) }).fetchImpl });
  assert.equal(variantOk.status, 'ok'); assert.equal(variantOk.variant, 'Other fast');
});

test('an unavailable Cursor API blocks explicitly, never substitutes a model and never leaks bodies or the key', async () => {
  const p = await pin();
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
    const report = await agents.preflight({ pin: p, key: KEY, fetchImpl: r.fetchImpl });
    assert.equal(report.status, 'unavailable', reason); assert.equal(report.reason, reason); assert.equal(report.httpStatus, httpStatus); assert.equal(report.modelId, p.modelId);
    if (reason === 'quota') assert.equal(report.retryAfterMs, 30_000);
    assert.equal(r.calls.length, 1, 'aucune redirection suivie, aucun renvoi');
    assertNoLeak(report);
  }
  const slow = { fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) };
  const timedOut = await agents.preflight({ pin: p, key: KEY, fetchImpl: slow.fetchImpl, timeoutMs: 50 });
  assert.equal(timedOut.status, 'unavailable'); assert.equal(timedOut.reason, 'timeout');
  const big = await agents.preflight({ pin: p, key: KEY, fetchImpl: async () => new Response('x'.repeat(3_000_000), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '3000000' } }) });
  assert.equal(big.status, 'unavailable'); assert.equal(big.reason, 'too_large');
  const missing = await agents.preflight({ pin: p, key: null, fetchImpl: () => { throw new Error('ne doit pas être appelé'); } });
  assert.equal(missing.status, 'unavailable'); assert.equal(missing.reason, 'credential_missing');
  assert.equal(agents.readKey({ CURSOR_API_KEY: ' bad key ' }), null); assert.equal(agents.readKey({}), null); assert.equal(agents.readKey({ CURSOR_API_KEY: KEY }), KEY);
});

test('launch deduplicates missions, pins the model in the payload, reconciles 409 and uncertain calls', async () => {
  const p = await pin();
  await withTemp('lite-orch-launch-', async (temp) => {
    const registryFile = join(temp, 'private', 'registry.json');
    const brief = `Mission O01 — ${PROMPT_MARKER}`;
    const base = { mission: 'O01', repo: REPO + '.git', ref: 'agents/O01-standard', promptText: brief, pin: p, key: KEY, registryFile };
    assert.equal(AGENT, agents.missionAgentId('https://github.com/example-org/example-app/', 'O01'), 'identifiant déterministe indépendant du suffixe .git');
    assert.notEqual(AGENT, agents.missionAgentId(REPO, 'O02'));

    const blocked = recorder({ 'GET /v1/models': () => models([other]) });
    const refused = await agents.launch({ ...base, fetchImpl: blocked.fetchImpl });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.preflight.reason, 'model_absent'); assert.equal(blocked.calls.length, 1, 'aucun POST après un préflight bloqué');
    assert.deepEqual((await agents.loadRegistry(registryFile)).missions, {}, 'aucune entrée écrite avant un préflight réussi');

    const created = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': (request) => json({ agent: agentRecord(), run: runRecord() }) });
    const launched = await agents.launch({ ...base, fetchImpl: created.fetchImpl, name: 'O01 — standard' });
    assert.equal(launched.status, 'launched'); assert.equal(launched.agentId, AGENT); assert.equal(launched.runId, RUN); assert.equal(launched.modelId, p.modelId);
    const post = created.calls[1];
    assert.equal(post.method, 'POST'); assert.equal(post.url, 'https://api.cursor.com/v1/agents');
    assert.deepEqual(post.body, { agentId: AGENT, prompt: { text: brief }, model: { id: p.modelId }, repos: [{ url: REPO, startingRef: 'agents/O01-standard' }], workOnCurrentBranch: true, autoCreatePR: false, name: 'O01 — standard' });
    assert.ok(!('envVars' in post.body) && !('mcpServers' in post.body));
    assertNoLeak(launched);
    let registry = await agents.loadRegistry(registryFile);
    assert.equal(registry.missions.O01.state, 'launched'); assert.equal(registry.missions.O01.runId, RUN); assertNoLeak(registry);

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
    const lost = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => { throw new TypeError('socket hang up'); }, [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'not_found' } }, 404) });
    const notCreated = await agents.launch({ ...base, fetchImpl: lost.fetchImpl });
    assert.equal(notCreated.status, 'unavailable'); assert.equal(notCreated.state, 'not_created'); assert.equal(notCreated.reason, 'network');
    assert.equal((await agents.loadRegistry(registryFile)).missions.O01.state, 'not_created');
    const relaunch = recorder({ 'GET /v1/models': () => models([fable]), 'POST /v1/agents': () => json({ agent: agentRecord(), run: runRecord() }) });
    assert.equal((await agents.launch({ ...base, fetchImpl: relaunch.fetchImpl })).status, 'launched', 'not_created autorise une relance sur la même clé');

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

test('followup reuses the same agent and surfaces agent_busy without retry', async () => {
  const busy = recorder({ [`POST /v1/agents/${AGENT}/runs`]: () => json({ error: { code: 'agent_busy', message: BODY_MARKER } }, 409) });
  const blocked = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: busy.fetchImpl });
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.providerCode, 'agent_busy'); assert.equal(busy.calls.length, 1); assertNoLeak(blocked);
  const ok = recorder({ [`POST /v1/agents/${AGENT}/runs`]: (request) => { assert.deepEqual(request.body, { prompt: { text: PROMPT_MARKER } }); return json({ run: runRecord({ id: 'run-00000000-0000-4000-8000-000000000002' }) }); } });
  const launched = await agents.followup({ agentId: AGENT, promptText: PROMPT_MARKER, key: KEY, fetchImpl: ok.fetchImpl });
  assert.equal(launched.status, 'launched'); assert.equal(launched.runId, 'run-00000000-0000-4000-8000-000000000002'); assertNoLeak(launched);
  const lost = await agents.followup({ agentId: AGENT, promptText: 'x', key: KEY, fetchImpl: recorder({ [`POST /v1/agents/${AGENT}/runs`]: () => { throw new Error('reset'); } }).fetchImpl });
  assert.equal(lost.status, 'uncertain'); assert.match(lost.nextAction, /latestRunId/);
});

test('the CLI refuses to run without the environment key and maps outcomes to exit codes', async () => {
  const logs = [];
  await assert.rejects(agents.main(['preflight'], { env: {}, fetchImpl: () => { throw new Error('ne doit pas être appelé'); }, log: l => logs.push(l) }), /CURSOR_API_KEY/);
  assert.equal(await agents.main(['preflight'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: recorder({ 'GET /v1/models': () => models([fable]) }).fetchImpl, log: l => logs.push(l) }), 0);
  assert.equal(await agents.main(['preflight'], { env: { CURSOR_API_KEY: KEY }, fetchImpl: recorder({ 'GET /v1/models': () => models([other]) }).fetchImpl, log: l => logs.push(l) }), 2);
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
    assert.equal(manifest.formatVersion, 1); assert.equal(manifest.owner, 'creezio-lite'); assert.equal(manifest.kitVersion, '0.12.0');
    assert.deepEqual(Object.keys(manifest.files).sort(), Object.keys(sources).sort());
    for (const [path, source] of Object.entries(sources)) {
      const copy = await readFile(join(out, path)), original = await readFile(source);
      assert.ok(copy.equals(original), `copie divergente : ${path}`);
      assert.equal(manifest.files[path], createHash('sha256').update(copy).digest('hex'));
    }
    const report = await doctor(out);
    assert.equal(report.ok, true); assert.deepEqual(report.orchestration, { status: 'current', installedVersion: '0.12.0', targetVersion: '0.12.0', conflicts: [] });
    const lock = JSON.parse(await readFile(join(out, 'lite.lock.json'), 'utf8'));
    assert.ok(!Object.keys(lock.runtimeFiles).some(f => f.includes('.cursor')), 'le verrou runtime ne couvre pas le standard');
    const standalone = join(temp, 'standalone');
    await cp(join(out, '.cursor'), join(standalone, '.cursor'), { recursive: true });
    const script = join(standalone, orchestrationDir, 'scripts/cursor-agents.mjs');
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', cwd: standalone, env: { PATH: process.env.PATH } });
    assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /preflight/);
    const check = spawnSync(process.execPath, ['--input-type=module', '-e', `import('${script.replaceAll('\\', '/')}').then(async m=>{const pin=await m.loadPinnedModel();console.log(JSON.stringify(await m.preflight({pin,key:'FAKE_TEST_KEY_NOT_A_SECRET',fetchImpl:async()=>new Response(JSON.stringify({items:[{id:pin.modelId,displayName:'Fable'}]}),{status:200,headers:{'content-type':'application/json'}})})))})`], { encoding: 'utf8', cwd: standalone, env: { PATH: process.env.PATH } });
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
    assert.equal(applied.applied, true); assert.equal(applied.written.length, 5);
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
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).kitVersion, '0.12.0');
    assert.equal(await readFile(join(app, orchestrationDir, 'notes-locales.md'), 'utf8'), 'préservé\n');

    await writeFile(manifestPath, JSON.stringify({ formatVersion: 9 }) + '\n');
    await assert.rejects(adopt(app), /Manifeste/);
    await assert.rejects(adopt(root, true), /indépendante du kit/);
    await assert.rejects(adopt(temp), /brand\.json/);
    const cli = spawnSync(process.execPath, [join(root, 'bin/lite.mjs'), 'adopt', '--app', join(temp, 'nowhere')], { encoding: 'utf8' });
    assert.equal(cli.status, 1); assert.match(cli.stderr, /brand\.json/);
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
