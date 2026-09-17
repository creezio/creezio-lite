import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as agents from '../.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs';
import * as pool from '../.cursor/skills/lite-orchestration/scripts/cursor-account-pool.mjs';

const KEY = 'FAKE_TEST_KEY_NOT_A_SECRET_0123456789';
const KEY_A = 'FAKE_KEY_A_NOT_A_SECRET_0123456789';
const KEY_B = 'FAKE_KEY_B_NOT_A_SECRET_0123456789';
const BLOB_A = Buffer.from('FAKE_SECURESTRING_A_NOT_A_SECRET_').toString('hex').padEnd(716, '0').slice(0, 716);
const BLOB_B = Buffer.from('FAKE_SECURESTRING_B_NOT_A_SECRET_').toString('hex').padEnd(716, '0').slice(0, 716);
const BODY_MARKER = 'PROVIDER_BODY_MARKER@example.test';
const PROMPT_MARKER = 'BRIEF_PRIVATE_MARKER@example.test';
const REPO = 'https://github.com/example-org/example-app';
const SRC_A = 'https://github.com/example-org/example-source-a';
const SRC_Z = 'https://github.com/example-org/example-source-z';
const SHA_A = 'a'.repeat(40);
const SHA_Z = 'c'.repeat(40);
const SHA_OTHER = 'd'.repeat(40);
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const P = (id, value) => ({ id, value });
const values = (...list) => list.map(value => ({ value }));
const fable = { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', parameters: [{ id: 'thinking', values: values('true', 'false') }, { id: 'context', values: values('200k', '300k') }, { id: 'effort', values: values('low', 'medium', 'high') }],
  variants: [{ params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'high')], displayName: 'Fable 5.1 Thinking High 300k' }] };
const models = () => json({ items: [fable] });
const AGENT = agents.missionAgentId(REPO, 'R01');
const RUN = 'run-00000000-0000-4000-8000-000000000001';
const RUN2 = 'run-00000000-0000-4000-8000-000000000002';
const agentRecord = (id = AGENT, extra = {}) => ({ id, status: 'ACTIVE', url: `https://cursor.com/agents/${id}`, latestRunId: extra.latestRunId ?? RUN, createdAt: '2026-09-16T00:00:00.000Z', ...extra });
const runRecord = (agentId = AGENT, extra = {}) => ({ id: extra.id ?? RUN, agentId, status: extra.status ?? 'CREATING', createdAt: '2026-09-16T00:00:00.000Z', ...extra });
function recorder(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    const request = { method: init.method ?? 'GET', url: String(url), path: parsed.pathname, cursor: parsed.searchParams.get('cursor'), headers: init.headers ?? {}, body: init.body === undefined ? undefined : JSON.parse(init.body), key: String(init.headers?.authorization ?? '').replace(/^Bearer /, '') };
    calls.push(request);
    const handler = routes[`${request.method} ${request.path}`] ?? routes[`${request.method} *`];
    if (!handler) throw new Error(`Route de test inattendue : ${request.method} ${request.url}`);
    return handler(request);
  };
  return { calls, fetchImpl, posts: () => calls.filter(c => c.method === 'POST'), keysUsed: () => [...new Set(calls.map(c => c.key))] };
}
function assertNoLeak(value) {
  const text = JSON.stringify(value) + (value instanceof Error ? `${value.message}\n${value.stack}` : '');
  for (const marker of [KEY, KEY_A, KEY_B, BLOB_A, BLOB_B, BODY_MARKER, PROMPT_MARKER, 'Bearer ']) assert.ok(!text.includes(marker), `fuite de « ${marker.slice(0, 24)} »`);
}
async function withTemp(prefix, run) { const temp = await mkdtemp(join(tmpdir(), prefix)); try { return await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }
async function selections() { return agents.loadSelections(); }
const sourcesAz = () => [{ url: SRC_Z, sha: SHA_Z }, { url: SRC_A, sha: SHA_A }];
const canonicalAz = () => [{ url: SRC_A, sha: SHA_A }, { url: SRC_Z, sha: SHA_Z }];
const catalogItems = (...urls) => json({ items: urls.map(url => ({ url, extraPermissionField: 'ignored' })) });

test('parseSecondaryReferences: valid set is canonical; URL/SHA/count/duplicate/target rejections', () => {
  assert.deepEqual(agents.parseSecondaryReferences(sourcesAz(), { targetUrl: REPO }), canonicalAz());
  assert.deepEqual(agents.parseSecondaryReferences([{ url: SRC_A + '.git/', sha: SHA_A.toUpperCase() }], { targetUrl: REPO }), [{ url: SRC_A, sha: SHA_A }]);
  assert.equal(agents.inputFingerprint({ repo: REPO, ref: 'agents/R01', sources: canonicalAz() }), agents.inputFingerprint({ repo: REPO + '.git', ref: 'agents/R01', sources: sourcesAz() }));
  const rejects = [
    [{ url: SRC_A, sha: SHA_A, branch: 'main' }, /uniquement \{url,sha\}/],
    [{ url: SRC_A, sha: SHA_A, prUrl: 'https://github.com/example-org/example-source-a/pull/1' }, /uniquement \{url,sha\}/],
    [{ url: SRC_A, sha: 'main' }, /40 hexadécimaux/],
    [{ url: SRC_A, sha: 'v1.0.0' }, /40 hexadécimaux/],
    [{ url: 'https://user:pw@github.com/example-org/example-source-a', sha: SHA_A }, /GitHub HTTPS/],
    [{ url: 'https://github.com/example-org/example-source-a?x=1', sha: SHA_A }, /GitHub HTTPS/],
    [{ url: 'https://github.com/example-org/example-source-a#frag', sha: SHA_A }, /GitHub HTTPS/],
    [{ url: REPO, sha: SHA_A }, /dépôt cible/],
  ];
  for (const [entry, pattern] of rejects) assert.throws(() => agents.parseSecondaryReferences([entry], { targetUrl: REPO }), pattern);
  assert.throws(() => agents.parseSecondaryReferences({ sources: sourcesAz() }, { targetUrl: REPO }), /tableau JSON/);
  assert.throws(() => agents.parseSecondaryReferences([{ url: SRC_A, sha: SHA_A }, { url: SRC_A + '.git', sha: SHA_OTHER }], { targetUrl: REPO }), /dupliqué/);
  assert.throws(() => agents.parseSecondaryReferences(Array.from({ length: 20 }, (_, i) => ({ url: `https://github.com/example-org/src-${i}`, sha: SHA_A })), { targetUrl: REPO }), /19 sources/);
  const nineteen = agents.parseSecondaryReferences(Array.from({ length: 19 }, (_, i) => ({ url: `https://github.com/example-org/src-${String(i).padStart(2, '0')}`, sha: SHA_A })), { targetUrl: REPO });
  assert.equal(nineteen.length, 19);
  assert.ok(nineteen.every((s, i) => i === 0 || s.url > nineteen[i - 1].url), 'ordre canonique par URL');
});

test('single-repo launch is unchanged: one repo, no catalog GET, prompt untouched', async () => {
  const config = await selections();
  await withTemp('lite-refs-single-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const r = recorder({ 'GET /v1/models': models, 'POST /v1/agents': () => json({ agent: agentRecord(), run: runRecord() }) });
    const launched = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: `brief ${PROMPT_MARKER}`, config, key: KEY, registryFile, fetchImpl: r.fetchImpl });
    assert.equal(launched.status, 'launched');
    assert.equal(launched.repositories, undefined);
    assert.deepEqual(r.calls.map(c => `${c.method} ${c.path}`), ['GET /v1/models', 'POST /v1/agents']);
    assert.deepEqual(r.posts()[0].body.repos, [{ url: REPO, startingRef: 'agents/R01' }]);
    assert.equal(r.posts()[0].body.prompt.text, `brief ${PROMPT_MARKER}`);
    const entry = (await agents.loadRegistry(registryFile)).missions.R01;
    assert.equal(entry.references, undefined);
    assertNoLeak(launched); assertNoLeak(entry);
  });
});

test('valid references: catalog pagination, canonical serialization, receipt distinguishes catalog from pod checkout', async () => {
  const config = await selections();
  await withTemp('lite-refs-ok-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const refsFile = join(temp, 'refs.json');
    await writeFile(refsFile, JSON.stringify(sourcesAz()));
    const r = recorder({
      'GET /v1/models': models,
      'GET /v1/repositories': (request) => {
        if (!request.cursor) return json({ items: [{ url: REPO, permission: 'admin' }], nextCursor: 'page-2' });
        assert.equal(request.cursor, 'page-2');
        return json({ items: [{ url: SRC_Z }, { url: SRC_A }] });
      },
      'POST /v1/agents': () => json({ agent: agentRecord(), run: runRecord() }),
    });
    const loaded = await agents.loadReferencesFile(refsFile, { targetUrl: REPO });
    const launched = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: `brief ${PROMPT_MARKER}`, config, key: KEY, registryFile, fetchImpl: r.fetchImpl, references: loaded });
    assert.equal(launched.status, 'launched');
    assert.deepEqual(r.calls.map(c => `${c.method} ${c.path}${c.cursor ? '?' + c.cursor : ''}`), ['GET /v1/models', 'GET /v1/repositories', 'GET /v1/repositories?page-2', 'POST /v1/agents']);
    assert.ok(r.calls.filter(c => c.path === '/v1/repositories').every(c => c.key === KEY));
    const post = r.posts()[0].body;
    assert.deepEqual(post.repos, [{ url: REPO, startingRef: 'agents/R01' }, { url: SRC_A, startingRef: SHA_A }, { url: SRC_Z, startingRef: SHA_Z }]);
    assert.match(post.prompt.text, /lecture seule/);
    assert.match(post.prompt.text, /pas une ACL fournisseur/);
    assert.match(post.prompt.text, /bloquer la mission/);
    assert.ok(post.prompt.text.endsWith(`brief ${PROMPT_MARKER}`));
    assert.equal(launched.repositories.checkout.observed, null);
    assert.equal(launched.repositories.sourceAccess.kind, 'instruction');
    assert.equal(launched.repositories.sourceAccess.providerAcl, null);
    assert.deepEqual(launched.repositories.demanded.sources, canonicalAz());
    assert.deepEqual(launched.repositories.attached, post.repos);
    assert.deepEqual(launched.repositories.visible.urls.sort(), [REPO, SRC_A, SRC_Z].sort());
    const entry = (await agents.loadRegistry(registryFile)).missions.R01;
    assert.deepEqual(entry.references, canonicalAz());
    assert.equal(entry.repo, REPO);
    assertNoLeak(launched); assertNoLeak(entry);
  });
});

test('missing catalog ref blocks with zero POST; catalog visibility is not a pod proof', async () => {
  const config = await selections();
  await withTemp('lite-refs-missing-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const r = recorder({ 'GET /v1/models': models, 'GET /v1/repositories': () => catalogItems(REPO, 'https://github.com/example-org/other') });
    const blocked = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: r.fetchImpl, references: canonicalAz() });
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.reason, 'repository_not_visible');
    assert.deepEqual(blocked.missing.sort(), [SRC_A, SRC_Z].sort());
    assert.equal(r.posts().length, 0);
    assert.equal(blocked.repositories.checkout.observed, null);
    assert.deepEqual((await agents.loadRegistry(registryFile)).missions, {});
    assertNoLeak(blocked);
  });
});

test('paginated catalog that never lists a source does not POST; truncated catalog is unavailable not missing', async () => {
  const config = await selections();
  await withTemp('lite-refs-pages-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const paged = recorder({
      'GET /v1/models': models,
      'GET /v1/repositories': (request) => request.cursor ? json({ items: [{ url: SRC_Z }] }) : json({ items: [{ url: REPO }], nextCursor: 'only-z' }),
    });
    const missingA = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: paged.fetchImpl, references: canonicalAz() });
    assert.equal(missingA.status, 'blocked'); assert.equal(missingA.reason, 'repository_not_visible'); assert.deepEqual(missingA.missing, [SRC_A]);
    assert.equal(paged.posts().length, 0);

    let pages = 0;
    const truncated = recorder({
      'GET /v1/models': models,
      'GET /v1/repositories': () => { pages += 1; return json({ items: [{ url: REPO }], nextCursor: `p${pages}` }); },
    });
    const report = await agents.launch({ mission: 'R02', repo: REPO, ref: 'agents/R02', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: truncated.fetchImpl, references: [{ url: SRC_A, sha: SHA_A }] });
    assert.equal(report.status, 'unavailable'); assert.equal(report.reason, 'catalog_truncated');
    assert.equal(truncated.posts().length, 0);
    assert.equal(pages, agents.repositoryCatalogLimits.maxPages);
  });
});

test('persistence, uncertain retry and input_changed: same fingerprint dedups, different input refuses without a second POST', async () => {
  const config = await selections();
  await withTemp('lite-refs-idem-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const lost = recorder({
      'GET /v1/models': models,
      'GET /v1/repositories': () => catalogItems(REPO, SRC_A, SRC_Z),
      'POST /v1/agents': () => { throw new TypeError('socket hang up'); },
      [`GET /v1/agents/${AGENT}`]: () => json({ error: { code: 'not_found' } }, 404),
    });
    const unknown = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: lost.fetchImpl, references: sourcesAz() });
    assert.equal(unknown.status, 'uncertain');
    const persisted = (await agents.loadRegistry(registryFile)).missions.R01;
    assert.equal(persisted.state, 'uncertain');
    assert.deepEqual(persisted.references, canonicalAz());
    const silent = recorder({});
    const dedup = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: silent.fetchImpl, references: canonicalAz() });
    assert.equal(dedup.status, 'deduplicated'); assert.equal(silent.calls.length, 0);
    const changed = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: silent.fetchImpl, references: [{ url: SRC_A, sha: SHA_OTHER }] });
    assert.equal(changed.status, 'blocked'); assert.equal(changed.reason, 'input_changed'); assert.equal(silent.calls.length, 0);
    const added = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: silent.fetchImpl });
    assert.equal(added.status, 'blocked'); assert.equal(added.reason, 'input_changed');
    assert.equal(lost.posts().length, 1);
    const settled = recorder({ [`GET /v1/agents/${AGENT}`]: () => json(agentRecord()) });
    assert.equal((await agents.reconcile({ mission: 'R01', key: KEY, registryFile, fetchImpl: settled.fetchImpl })).status, 'reconciled');
    assert.deepEqual((await agents.loadRegistry(registryFile)).missions.R01.references, canonicalAz());
  });
});

test('legacy entry without references still deduplicates a single-repo relaunch; adding sources conflicts', async () => {
  const config = await selections();
  await withTemp('lite-refs-legacy-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: { O01: { agentId: AGENT, repo: REPO, ref: 'agents/O01-standard', state: 'launched', updatedAt: 'x' } } });
    const silent = recorder({});
    const same = await agents.launch({ mission: 'O01', repo: REPO, ref: 'agents/O01-standard', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: silent.fetchImpl });
    assert.equal(same.status, 'deduplicated'); assert.equal(silent.calls.length, 0);
    const withRefs = await agents.launch({ mission: 'O01', repo: REPO, ref: 'agents/O01-standard', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: silent.fetchImpl, references: [{ url: SRC_A, sha: SHA_A }] });
    assert.equal(withRefs.status, 'blocked'); assert.equal(withRefs.reason, 'input_changed'); assert.equal(silent.calls.length, 0);
  });
});

test('followup keeps the initial repo set; a new references file is an explicit conflict, not a successor', async () => {
  const config = await selections();
  await withTemp('lite-refs-followup-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const created = recorder({
      'GET /v1/models': models,
      'GET /v1/repositories': () => catalogItems(REPO, SRC_A, SRC_Z),
      'POST /v1/agents': () => json({ agent: agentRecord(), run: runRecord() }),
    });
    assert.equal((await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, key: KEY, registryFile, fetchImpl: created.fetchImpl, references: canonicalAz() })).status, 'launched');
    const ok = recorder({
      [`GET /v1/agents/${AGENT}`]: () => json(agentRecord(AGENT, { latestRunId: RUN, status: 'IDLE' })),
      [`GET /v1/agents/${AGENT}/runs/${RUN}`]: () => json(runRecord(AGENT, { status: 'FINISHED' })),
      [`POST /v1/agents/${AGENT}/runs`]: (request) => { assert.deepEqual(Object.keys(request.body), ['prompt']); return json({ run: runRecord(AGENT, { id: RUN2 }) }); },
    });
    const resumed = await agents.followup({ mission: 'R01', registryFile, promptText: `suite ${PROMPT_MARKER}`, key: KEY, fetchImpl: ok.fetchImpl, references: sourcesAz() });
    assert.equal(resumed.status, 'launched');
    assert.equal(resumed.modelSent, false);
    assert.deepEqual(resumed.repositories.demanded.sources, canonicalAz());
    assert.equal(resumed.repositories.attached, 'unchanged');
    assert.equal(resumed.repositories.checkout.observed, null);
    assert.match(ok.posts()[0].body.prompt.text, /lecture seule/);
    assert.ok(!('repos' in ok.posts()[0].body));
    const silent = recorder({});
    const changed = await agents.followup({ mission: 'R01', registryFile, promptText: 'autre', key: KEY, fetchImpl: silent.fetchImpl, references: [{ url: SRC_A, sha: SHA_OTHER }] });
    assert.equal(changed.status, 'blocked'); assert.equal(changed.reason, 'input_changed');
    assert.match(changed.nextAction, /nouvelle mission/);
    assert.match(changed.nextAction, /pas de successeur abusif/);
    assert.equal(silent.calls.length, 0);
    assertNoLeak(resumed); assertNoLeak(changed);
  });
});

test('CLI --references-file launches with catalog then POST; no secrets in JSON', async () => {
  const logs = [];
  await withTemp('lite-refs-cli-', async (temp) => {
    const registry = join(temp, 'r.json');
    const prompt = join(temp, 'brief.txt');
    const refs = join(temp, 'refs.json');
    await writeFile(prompt, `Mission R01 ${PROMPT_MARKER}`);
    await writeFile(refs, JSON.stringify([{ url: SRC_A, sha: SHA_A }]));
    const r = recorder({
      'GET /v1/models': models,
      'GET /v1/repositories': () => catalogItems(REPO, SRC_A),
      'POST /v1/agents': () => json({ agent: agentRecord(agents.missionAgentId(REPO, 'R01')), run: runRecord(agents.missionAgentId(REPO, 'R01')) }),
    });
    const code = await agents.main(['launch', '--mission', 'R01', '--repo', REPO, '--ref', 'agents/R01', '--prompt-file', prompt, '--registry', registry, '--references-file', refs], { env: { CURSOR_API_KEY: KEY }, fetchImpl: r.fetchImpl, log: line => logs.push(line) });
    assert.equal(code, 0);
    const report = JSON.parse(logs[0]);
    assert.equal(report.status, 'launched');
    assert.deepEqual(r.posts()[0].body.repos[1], { url: SRC_A, startingRef: SHA_A });
    for (const line of logs) { assert.ok(!line.includes(KEY) && !line.includes(PROMPT_MARKER)); JSON.parse(line); }
    assertNoLeak(report);
  });
});

test('successor recopies immutable source SHAs, rechecks catalog on the target account, keeps model and lineage', async () => {
  const config = await selections();
  const T0 = '2026-09-16T12:00:00.000Z';
  const INCLUDED = "You've used all included Cloud Agent usage: Enable on-demand usage to continue using Cloud Agents";
  await withTemp('lite-refs-succ-', async (temp) => {
    const dir = join(temp, 'Creezio', 'cursor'); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'credentials.json'), JSON.stringify({ formatVersion: 1, encryption: 'windows-dpapi-current-user', createdAt: T0, accounts: [{ id: 'acct-a', secretDpapi: BLOB_A }, { id: 'acct-b', secretDpapi: BLOB_B }] }));
    const decrypt = async blob => { if (blob === BLOB_A) return KEY_A; if (blob === BLOB_B) return KEY_B; throw new Error('blob'); };
    const access = await agents.resolveAccess({ env: { CURSOR_CREDENTIALS_FILE: join(dir, 'credentials.json') }, adapter: pool, decrypt, now: () => T0 });
    const registryFile = join(temp, 'registry.json');
    const R01 = agents.missionAgentId(REPO, 'R01');
    const R01b = agents.missionAgentId(REPO, 'R01~s1');
    const created = recorder({
      'GET /v1/models': () => json({ items: [fable] }),
      'GET /v1/repositories': request => { assert.equal(request.key, KEY_A); return catalogItems(REPO, SRC_A, SRC_Z); },
      'POST /v1/agents': request => { assert.equal(request.key, KEY_A); return json({ agent: agentRecord(R01), run: runRecord(R01) }); },
    });
    const launched = await agents.launch({ mission: 'R01', repo: REPO, ref: 'agents/R01', promptText: 'brief', config, access, registryFile, now: () => T0, fetchImpl: created.fetchImpl, references: canonicalAz() });
    assert.equal(launched.status, 'launched');
    await access.pool.record('acct-a', access.pool.classify({ callKind: 'run', modelId: 'claude-fable-5-1', result: { outcome: 'unavailable', status: 429, reason: 'quota', providerCode: 'rate_limit_exceeded', providerMessage: INCLUDED } }));
    const missing = recorder({
      [`GET /v1/agents/${R01}`]: request => { assert.equal(request.key, KEY_A); return json(agentRecord(R01, { status: 'IDLE', latestRunId: RUN })); },
      [`GET /v1/agents/${R01}/runs/${RUN}`]: () => json(runRecord(R01, { status: 'FINISHED' })),
      'GET /v1/models': () => json({ items: [fable] }),
      'GET /v1/repositories': request => { assert.equal(request.key, KEY_B); return catalogItems(REPO); },
    });
    const blocked = await agents.successor({ mission: 'R01', registryFile, promptText: `suite ${PROMPT_MARKER}`, checkpoint: SHA_OTHER, config, access, fetchImpl: missing.fetchImpl });
    assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reason, 'repository_not_visible');
    assert.equal(missing.posts().length, 0);
    assert.equal((await agents.loadRegistry(registryFile)).missions.R01.agentId, R01);
    const ok = recorder({
      [`GET /v1/agents/${R01}`]: request => { assert.equal(request.key, KEY_A); return json(agentRecord(R01, { status: 'IDLE', latestRunId: RUN })); },
      [`GET /v1/agents/${R01}/runs/${RUN}`]: () => json(runRecord(R01, { status: 'FINISHED' })),
      'GET /v1/models': () => json({ items: [fable] }),
      'GET /v1/repositories': request => { assert.equal(request.key, KEY_B); return catalogItems(REPO, SRC_A, SRC_Z); },
      'POST /v1/agents': request => {
        assert.equal(request.key, KEY_B);
        assert.equal(request.body.agentId, R01b);
        assert.deepEqual(request.body.model, { id: 'claude-fable-5-1', params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'high')] });
        assert.deepEqual(request.body.repos, [{ url: REPO, startingRef: 'agents/R01' }, { url: SRC_A, startingRef: SHA_A }, { url: SRC_Z, startingRef: SHA_Z }]);
        assert.match(request.body.prompt.text, /lecture seule/);
        return json({ agent: agentRecord(R01b, { latestRunId: RUN2 }), run: runRecord(R01b, { id: RUN2 }) });
      },
    });
    const succeeded = await agents.successor({ mission: 'R01', registryFile, promptText: `suite ${PROMPT_MARKER}`, checkpoint: SHA_OTHER, config, access, fetchImpl: ok.fetchImpl });
    assert.equal(succeeded.status, 'launched');
    assert.equal(succeeded.selection.requested.modelId, 'claude-fable-5-1');
    assert.equal(succeeded.repositories.checkout.observed, null);
    assert.deepEqual(succeeded.repositories.demanded.sources, canonicalAz());
    const entry = (await agents.loadRegistry(registryFile)).missions.R01;
    assert.equal(entry.agentId, R01b);
    assert.equal(entry.accountId, 'acct-b');
    assert.equal(entry.successorOf, R01);
    assert.equal(entry.predecessors.length, 1);
    assert.deepEqual(entry.references, canonicalAz());
    assert.equal(entry.ref, 'agents/R01');
    assertNoLeak(succeeded); assertNoLeak(entry); assertNoLeak(blocked);
  });
});
