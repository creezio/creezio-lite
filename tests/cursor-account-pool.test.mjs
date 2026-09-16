import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as pool from '../.cursor/skills/lite-orchestration/scripts/cursor-account-pool.mjs';
import * as agents from '../.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillDir = join(root, '.cursor/skills/lite-orchestration');
const poolModulePath = join(skillDir, 'scripts', 'cursor-account-pool.mjs');

// Fixtures fictives : aucune vraie chaîne SecureString, aucune vraie clé, identifiants génériques. Le coffre réel contient des sorties ConvertFrom-SecureString
// (hexadécimal, 716 caractères observés) ; ici des hexadécimaux fictifs de même forme.
const fakeSecureHex = (marker, length = 716) => Buffer.from(`FAKE_SECURESTRING_${marker}_NOT_A_SECRET_`).toString('hex').padEnd(length, '0').slice(0, length);
const BLOB_A = fakeSecureHex('A');
const BLOB_B = fakeSecureHex('B');
const BLOB_C = fakeSecureHex('C');
const KEY_A = 'FAKE_KEY_A_NOT_A_SECRET_0123456789';
const KEY_B = 'FAKE_KEY_B_NOT_A_SECRET_0123456789';
const KEY_C = 'FAKE_KEY_C_NOT_A_SECRET_0123456789';
const KEY_ENV = 'FAKE_ENV_KEY_NOT_A_SECRET_0123456789';
const MESSAGE_MARKER = 'PROVIDER_MESSAGE_MARKER@example.test';
const PROMPT_MARKER = 'BRIEF_PRIVATE_MARKER@example.test';
const credentialsFixture = (accounts = [{ id: 'acct-a', secretDpapi: BLOB_A }, { id: 'acct-b', secretDpapi: BLOB_B }]) => ({ formatVersion: 1, encryption: 'windows-dpapi-current-user', createdAt: '2026-09-16T00:00:00.000Z', accounts });
const fakeDecrypt = async (blob) => { if (blob === BLOB_A) return KEY_A; if (blob === BLOB_B) return KEY_B; if (blob === BLOB_C) return KEY_C; throw new Error('blob inconnu ' + blob); };
const T0 = '2026-09-16T12:00:00.000Z';
const now = () => T0;
const account = (id, extra = {}) => ({ id, status: 'active', inactiveReason: null, inactiveAt: null, evidence: [], modelPools: { custom: 'probe_passed_balance_unknown', standard: 'recheck_required' }, ...extra });
const stateFixture = (accounts, policy = {}) => ({ formatVersion: 1, revision: 3, updatedAt: '2026-09-15T00:00:00.000Z', activeAccountId: 'acct-a', order: accounts.map(a => a.id), accounts, routingPolicy: { priorityAccountIds: [], preferredModel: 'claude-fable-5-1', fallbackModel: 'grok-4.6', fallbackWhen: 'all_custom_accounts_confirmed_unavailable', reuseInactiveForStandard: true, requireStandardValidation: true, neverFallbackToComposer: true, preserveRunningMissions: true, ...policy } });
const fable = { key: 'fable', modelId: 'claude-fable-5-1', params: [{ id: 'thinking', value: 'true' }, { id: 'context', value: '300k' }, { id: 'effort', value: 'high' }] };
const grok = { key: 'grok', modelId: 'grok-4.6', params: [{ id: 'effort', value: 'medium' }, { id: 'fast', value: 'false' }] };
const rejected = (status, providerCode, providerMessage, extra = {}) => ({ outcome: status >= 500 ? 'unavailable' : status === 429 || status === 401 || status === 403 ? 'unavailable' : 'rejected', status, providerCode, providerMessage, reason: status === 429 ? 'quota' : status === 401 || status === 403 ? 'auth' : status >= 500 ? 'server' : undefined, ...extra });
const INCLUDED = "You've used all included Cloud Agent usage: Enable on-demand usage to continue using Cloud Agents";
const PLAN = 'Cloud Agent is not available for free users. Please upgrade to Pro.';
const HARD_LIMIT = 'You need to increase your hard limit. Background Agent requires at least $2 remaining until your hard limit. Manage it at https://www.cursor.com/dashboard?tab=settings.';
async function withTemp(prefix, run) { const temp = await mkdtemp(join(tmpdir(), prefix)); try { return await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }
function assertNoSecret(value) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value)) + (value instanceof Error ? `${value.message}\n${value.stack}` : '');
  for (const marker of [KEY_A, KEY_B, KEY_C, KEY_ENV, BLOB_A, BLOB_B, BLOB_C, MESSAGE_MARKER, PROMPT_MARKER, INCLUDED, PLAN, HARD_LIMIT, 'Bearer ']) assert.ok(!text.includes(marker), `fuite de « ${marker.slice(0, 24)}… » dans ${text.slice(0, 200)}`);
}

// Transport simulé : chaque route reçoit la requête (dont l’en-tête Authorization) ; aucun réseau.
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const providerError = (status, code, message) => json({ error: { code, message } }, status);
const REPO = 'https://github.com/example-org/example-app';
const P = (id, value) => ({ id, value });
const values = (...list) => list.map(value => ({ value }));
const catalog = () => json({ items: [
  { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', parameters: [{ id: 'thinking', values: values('true', 'false') }, { id: 'context', values: values('200k', '300k') }, { id: 'effort', values: values('low', 'medium', 'high') }], variants: [{ params: [P('thinking', 'true'), P('context', '300k'), P('effort', 'high')], displayName: 'Fable 5.1 Thinking High 300k' }, { params: [P('thinking', 'true'), P('context', '200k'), P('effort', 'high')], displayName: 'Fable 5.1 Thinking High', isDefault: true }] },
  { id: 'grok-4.6', displayName: 'Grok 4.6', parameters: [{ id: 'effort', values: values('low', 'medium', 'high') }, { id: 'fast', values: values('true', 'false') }], variants: [{ params: [P('effort', 'medium'), P('fast', 'false')], displayName: 'Grok 4.6 Medium' }, { params: [P('effort', 'medium'), P('fast', 'true')], displayName: 'Grok 4.6 Medium Fast', isDefault: true }] },
] });
function recorder(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const request = { method: init.method ?? 'GET', url: String(url), path: new URL(String(url)).pathname, key: String(init.headers?.authorization ?? '').replace(/^Bearer /, ''), body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(request);
    const handler = routes[`${request.method} ${request.path}`] ?? routes[`${request.method} *`];
    if (!handler) throw new Error(`Route de test inattendue : ${request.method} ${request.url}`);
    return handler(request);
  };
  return { calls, fetchImpl, keysUsed: () => [...new Set(calls.map(c => c.key))], posts: () => calls.filter(c => c.method === 'POST') };
}
const runOf = (agentId, runId, status = 'CREATING') => ({ id: runId, agentId, status, createdAt: T0 });
const agentOf = (agentId, latestRunId, status = 'ACTIVE') => ({ id: agentId, status, url: `https://cursor.com/agents/${agentId}`, latestRunId, createdAt: T0 });
const RUN1 = 'run-00000000-0000-4000-8000-000000000101', RUN2 = 'run-00000000-0000-4000-8000-000000000102';
async function openVault(temp, ids = ['acct-a', 'acct-b', 'acct-c']) {
  const dir = join(temp, 'Creezio', 'cursor'); await mkdir(dir, { recursive: true });
  const blobs = { 'acct-a': BLOB_A, 'acct-b': BLOB_B, 'acct-c': BLOB_C };
  await writeFile(join(dir, 'credentials.json'), JSON.stringify(credentialsFixture(ids.map(id => ({ id, secretDpapi: blobs[id] })))));
  const env = { CURSOR_CREDENTIALS_FILE: join(dir, 'credentials.json') };
  const access = await agents.resolveAccess({ env, adapter: pool, decrypt: fakeDecrypt, now });
  const stateOf = async () => JSON.parse(await readFile(access.pool.stateFile, 'utf8'));
  return { env, access, stateOf, registryFile: join(temp, 'private', 'registry.json'), accountOf: async id => (await stateOf()).accounts.find(a => a.id === id) };
}

test('credentials: resolved from CURSOR_CREDENTIALS_FILE then LOCALAPPDATA, parsed strictly, decrypted on demand without leaking blobs or keys', async () => {
  assert.equal(pool.credentialsPath({}), null);
  assert.match(pool.credentialsPath({ LOCALAPPDATA: join('fake-local') }), /fake-local[\\/]Creezio[\\/]cursor[\\/]credentials\.json$/);
  assert.match(pool.credentialsPath({ LOCALAPPDATA: 'ignored', CURSOR_CREDENTIALS_FILE: join('explicit', 'c.json') }), /explicit[\\/]c\.json$/);
  const paths = pool.poolPaths(join('dir', 'credentials.json'));
  assert.match(paths.stateFile, /dir[\\/]pool-state\.json$/); assert.match(paths.lockFile, /dir[\\/]pool-state\.lock$/);

  const parsed = pool.parseCredentials(credentialsFixture());
  assert.deepEqual(parsed.accounts.map(a => a.id), ['acct-a', 'acct-b']); assert.equal(parsed.createdAt, '2026-09-16T00:00:00.000Z');
  for (const [raw, pattern] of [[{ formatVersion: 2 }, /formatVersion 1/], [{ ...credentialsFixture(), encryption: 'plain' }, /windows-dpapi-current-user/], [credentialsFixture([]), /1 à 32/], [credentialsFixture([{ id: 'bad id', secretDpapi: BLOB_A }]), /n°1/], [credentialsFixture([{ id: 'acct-a', secretDpapi: BLOB_A }, { id: 'acct-a', secretDpapi: BLOB_B }]), /dupliqué/], [credentialsFixture([{ id: 'acct-a', secretDpapi: 'not hex !!' }]), /SecureString hexadécimale/], [credentialsFixture([{ id: 'acct-a', secretDpapi: Buffer.from('FAKE_BASE64_BLOB_NOT_A_SECRET_0123456789abcdef').toString('base64') }]), /SecureString hexadécimale/], [credentialsFixture([{ id: 'acct-a', secretDpapi: BLOB_A.slice(0, 715) }]), /SecureString hexadécimale/]]) {
    let caught; try { pool.parseCredentials(raw); } catch (error) { caught = error; }
    assert.ok(caught instanceof pool.PoolError, 'PoolError attendue'); assert.equal(caught.code, 'credentials_invalid'); assert.match(caught.message, pattern); assertNoSecret(caught);
  }

  let decrypts = 0;
  const vault = await pool.loadCredentials({ raw: JSON.stringify(credentialsFixture()), decrypt: async blob => { decrypts++; return fakeDecrypt(blob); } });
  assert.deepEqual(vault.ids, ['acct-a', 'acct-b']); assert.equal(decrypts, 0, 'aucun déchiffrement avant usage');
  assert.equal(await vault.keyFor('acct-a'), KEY_A); assert.equal(await vault.keyFor('acct-a'), KEY_A); assert.equal(decrypts, 1, 'un seul déchiffrement par compte utilisé');
  assert.ok(!JSON.stringify(vault).includes(KEY_A) && !JSON.stringify(vault).includes(BLOB_A), 'le coffre sérialisé n’expose ni blob ni clé');
  await assert.rejects(vault.keyFor('acct-z'), error => error.code === 'account_unknown' && error.accountId === 'acct-z');
  await assert.rejects(vault.keyFor(undefined), error => error.code === 'account_unknown');

  const failing = await pool.loadCredentials({ raw: JSON.stringify(credentialsFixture()), decrypt: async () => { throw new Error('DPAPI refused ' + BLOB_A); } });
  let failure; try { await failing.keyFor('acct-b'); } catch (error) { failure = error; }
  assert.equal(failure.code, 'decrypt_failed'); assert.equal(failure.accountId, 'acct-b'); assertNoSecret(failure);
  const blank = await pool.loadCredentials({ raw: JSON.stringify(credentialsFixture()), decrypt: async () => 'bad key with spaces' });
  await assert.rejects(blank.keyFor('acct-a'), error => error.code === 'credential_invalid');
  await assert.rejects(pool.loadCredentials({ raw: '{not json' }), error => error.code === 'credentials_invalid');
  await assert.rejects(pool.loadCredentials({ file: join(tmpdir(), 'nowhere-creezio', 'credentials.json') }), error => error.code === 'credentials_missing');
  await assert.rejects(pool.loadCredentials({}), error => error.code === 'credentials_missing');
});

test('dpapi decryptor: SecureString hex by stdin, ConvertTo-SecureString (DPAPI CurrentUser) then clear text by stdout, never by argv; refused outside Windows (mocks do not prove DPAPI)', async () => {
  await assert.rejects(pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'linux' }), error => error.code === 'dpapi_unavailable');
  assert.ok(pool.isSecureStringHex(BLOB_A) && BLOB_A.length === 716, 'fixture de même forme que le coffre réel');
  assert.ok(!pool.isSecureStringHex(Buffer.from('x').toString('base64')) && !pool.isSecureStringHex('abc') && !pool.isSecureStringHex(BLOB_A + 'g'));
  let spawnedBad = 0;
  await assert.rejects(pool.dpapiUnprotectCurrentUser('not-hex', { platform: 'win32', spawnImpl: () => { spawnedBad++; throw new Error('should not spawn'); } }), error => error.code === 'credentials_invalid');
  assert.equal(spawnedBad, 0, 'aucun déchiffreur lancé pour une chaîne non hexadécimale');
  assert.match(pool.dpapiPowershellScript, /ConvertTo-SecureString -String \$hex/); assert.doesNotMatch(pool.dpapiPowershellScript, /-Key|-SecureKey|FromBase64String|ProtectedData/, 'DPAPI CurrentUser implicite, format SecureString, pas de blob base64');
  assert.match(pool.dpapiPowershellScript, /NetworkCredential\]::new\('',\$secure\)\.Password/); assert.match(pool.dpapiPowershellScript, /OutputEncoding=\[Text\.Encoding\]::UTF8/); assert.match(pool.dpapiPowershellScript, /\[Console\]::In\.ReadToEnd\(\)/);
  const spawned = [];
  const fakeSpawn = (exitCode, output) => (command, args, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const written = []; child.stdin.on('data', chunk => written.push(chunk)); child.stdin.on('finish', () => { spawned.push({ command, args, options, stdin: Buffer.concat(written).toString('utf8') }); if (output) child.stdout.write(output); child.stdout.end(); setImmediate(() => child.emit('close', exitCode)); });
    return child;
  };
  const clear = await pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'win32', spawnImpl: fakeSpawn(0, KEY_A) });
  assert.equal(clear, KEY_A);
  assert.equal(spawned[0].command, 'powershell.exe'); assert.equal(spawned[0].stdin, BLOB_A); assert.ok(spawned[0].args.every(a => !a.includes(BLOB_A) && !a.includes(KEY_A)), 'aucun secret ni blob sur la ligne de commande');
  assert.deepEqual(spawned[0].options.stdio, ['pipe', 'pipe', 'pipe']); assert.deepEqual(spawned[0].args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']); assert.equal(spawned[0].args[3], pool.dpapiPowershellScript);
  let failure; try { await pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'win32', spawnImpl: fakeSpawn(1, '') }); } catch (error) { failure = error; }
  assert.equal(failure.code, 'decrypt_failed'); assertNoSecret(failure); assert.match(failure.message, /autre utilisateur|altérée|session/);
  let rejected; try { await pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'win32', spawnImpl: fakeSpawn(3, '') }); } catch (error) { rejected = error; }
  assert.equal(rejected.code, 'decrypt_failed'); assert.match(rejected.message, /format/); assertNoSecret(rejected);
});

test('pool state: created once from the vault, unknown fields/accounts/order preserved, revision monotonic, concurrent edits and foreign locks refused', async () => {
  await withTemp('lite-pool-state-', async (temp) => {
    const paths = pool.poolPaths(join(temp, 'credentials.json'));
    const created = await pool.withPoolState(paths, state => ({ changed: false, value: state.accounts.map(a => a.id) }), { accountIds: ['acct-a', 'acct-b'], now });
    assert.deepEqual(created, ['acct-a', 'acct-b']);
    let raw = JSON.parse(await readFile(paths.stateFile, 'utf8'));
    assert.equal(raw.formatVersion, 1); assert.equal(raw.revision, 1); assert.deepEqual(raw.order, ['acct-a', 'acct-b']); assert.equal(raw.routingPolicy.fallbackModel, 'grok-4.6'); assert.equal(raw.routingPolicy.neverFallbackToComposer, true);
    assert.deepEqual(raw.accounts[0].modelPools, { custom: 'recheck_required', standard: 'recheck_required' }, 'aucun solde supposé');
    await assert.rejects(stat(paths.lockFile), { code: 'ENOENT' }, 'verrou relâché');

    // Fichier existant avec champs inconnus et ordre propre : rien n’est réécrit sauf la révision, la date et la mutation demandée.
    const existing = { ...stateFixture([account('acct-b', { note: 'garde-moi', modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required', extra: 'x' } }), account('acct-a')]), extraTop: { keep: true }, revision: 7 };
    await writeFile(paths.stateFile, JSON.stringify(existing, null, 2));
    const unchanged = await pool.withPoolState(paths, state => ({ changed: false, value: state.revision }), { accountIds: ['acct-a', 'acct-b'], now });
    assert.equal(unchanged, 7); assert.equal(JSON.parse(await readFile(paths.stateFile, 'utf8')).revision, 7, 'lecture seule : aucune écriture');
    const mutated = await pool.withPoolState(paths, state => { state.accounts[1].status = 'inactive'; return { changed: true, value: 'ok' }; }, { accountIds: ['acct-a', 'acct-b', 'acct-c'], now });
    assert.equal(mutated, 'ok');
    raw = JSON.parse(await readFile(paths.stateFile, 'utf8'));
    assert.equal(raw.revision, 8); assert.equal(raw.updatedAt, T0); assert.deepEqual(raw.extraTop, { keep: true }); assert.equal(raw.activeAccountId, 'acct-a');
    assert.deepEqual(raw.accounts.map(a => a.id), ['acct-b', 'acct-a', 'acct-c'], 'ordre préservé, nouveau compte du coffre ajouté en fin'); assert.deepEqual(raw.order, ['acct-b', 'acct-a', 'acct-c']);
    assert.equal(raw.accounts[0].note, 'garde-moi'); assert.equal(raw.accounts[0].modelPools.extra, 'x'); assert.equal(raw.accounts[1].status, 'inactive');
    assert.deepEqual(Object.keys(raw), Object.keys(existing), 'ordre des champs racine conservé');

    // Modification concurrente hors verrou pendant la section critique : refus, aucune écriture.
    await assert.rejects(pool.withPoolState(paths, async state => { const other = JSON.parse(await readFile(paths.stateFile, 'utf8')); other.revision = 99; await writeFile(paths.stateFile, JSON.stringify(other)); state.activeAccountId = 'acct-b'; return { changed: true }; }, { now }), error => error.code === 'concurrent_modification');
    raw = JSON.parse(await readFile(paths.stateFile, 'utf8')); assert.equal(raw.revision, 99); assert.equal(raw.activeAccountId, 'acct-a', 'la modification concurrente n’est pas écrasée');
    await assert.rejects(stat(paths.lockFile), { code: 'ENOENT' });

    // Verrou détenu par autrui : attente bornée puis refus explicite ; le verrou n’est ni volé ni supprimé.
    await writeFile(paths.lockFile, JSON.stringify({ pid: 424242, at: T0 }));
    let slept = 0;
    let locked; try { await pool.withPoolState(paths, () => ({ changed: true }), { now, waitMs: 100, stepMs: 10, sleep: async () => { slept++; }, clock: (() => { let t = 0; return () => (t += 30); })() }); } catch (error) { locked = error; }
    assert.equal(locked.code, 'pool_locked'); assert.deepEqual(locked.holder, { pid: 424242, at: T0 }); assert.ok(slept >= 1); assert.match(locked.message, /aucun vol/);
    assert.equal(await readFile(paths.lockFile, 'utf8'), JSON.stringify({ pid: 424242, at: T0 }), 'verrou étranger intact');
    assert.equal(JSON.parse(await readFile(paths.stateFile, 'utf8')).revision, 99);
    await rm(paths.lockFile);
    await writeFile(paths.stateFile, '{ broken');
    await assert.rejects(pool.withPoolState(paths, () => ({ changed: true }), { now }), error => error.code === 'pool_state_unreadable');
    assert.equal(await readFile(paths.stateFile, 'utf8'), '{ broken', 'fichier invalide jamais réécrit');
    await writeFile(paths.stateFile, JSON.stringify({ formatVersion: 1, revision: 'x', accounts: [], order: [] }));
    await assert.rejects(pool.withPoolState(paths, () => ({ changed: false }), { now }), error => error.code === 'pool_state_invalid');
  });
});

test('two real processes update the shared state under the lock without losing an increment or leaving a lock behind', async () => {
  await withTemp('lite-pool-concurrent-', async (temp) => {
    const paths = pool.poolPaths(join(temp, 'credentials.json'));
    await pool.withPoolState(paths, state => { state.counter = 0; return { changed: true }; }, { accountIds: ['acct-a'], now });
    const modulePath = poolModulePath;
    const script = `import { withPoolState } from ${JSON.stringify(modulePath)}; const paths = ${JSON.stringify(paths)}; for (let i = 0; i < 25; i++) { await withPoolState(paths, state => { state.counter += 1; return { changed: true }; }, { waitMs: 20000 }); } console.log('done');`;
    const runChild = () => new Promise((resolvePromise, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }); let out = '', err = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; }); child.on('close', code => (code === 0 ? resolvePromise(out) : reject(new Error(`code ${code}: ${err}`)))); });
    const results = await Promise.all([runChild(), runChild()]);
    assert.ok(results.every(r => r.includes('done')));
    const raw = JSON.parse(await readFile(paths.stateFile, 'utf8'));
    assert.equal(raw.counter, 50, 'aucun incrément perdu'); assert.equal(raw.revision, 51, 'une révision par écriture');
    await assert.rejects(stat(paths.lockFile), { code: 'ENOENT' });
  });
});

test('classification: exact provider signatures only; generic 429/402/403/5xx/network/timeout stay undetermined; messages are never stored', () => {
  const at = T0;
  const included = pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(429, 'rate_limit_exceeded', INCLUDED) });
  assert.deepEqual(included, { at, callKind: 'create', modelId: 'claude-fable-5-1', classification: 'included_usage_exhausted', reason: 'quota', httpStatus: 429, providerCode: 'rate_limit_exceeded', messageMatched: true });
  assert.equal(pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(429, 'rate_limit_exceeded', INCLUDED + '\n') }).classification, 'included_usage_exhausted', 'espace final toléré, rien d’autre');
  assert.equal(pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(403, 'plan_required', PLAN) }).classification, 'plan_required');
  const hard = pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(400, 'usage_limit_exceeded', HARD_LIMIT) });
  assert.equal(hard.classification, 'hard_limit_start_refused'); assert.equal(hard.httpStatus, 400);
  const generic = [
    rejected(429, 'rate_limit_exceeded', 'Too many requests ' + MESSAGE_MARKER),
    rejected(429, 'rate_limit_exceeded', INCLUDED.replace('all', 'most')),
    rejected(429, 'other_code', INCLUDED),
    rejected(400, 'rate_limit_exceeded', INCLUDED),
    rejected(402, 'payment_required', MESSAGE_MARKER),
    rejected(403, 'forbidden', MESSAGE_MARKER),
    rejected(403, 'plan_required', PLAN + ' Really.'),
    rejected(400, 'usage_limit_exceeded', HARD_LIMIT.replace('$2', '$5')),
    rejected(400, 'bad_request', MESSAGE_MARKER),
    rejected(503, undefined, MESSAGE_MARKER),
    { outcome: 'unavailable', reason: 'network', delivery: 'unknown' },
    { outcome: 'unavailable', reason: 'timeout', delivery: 'unknown' },
    { outcome: 'invalid_response', reason: 'not_json', status: 200 },
  ];
  for (const result of generic) {
    const evidence = pool.classifyResult({ callKind: 'run', modelId: 'claude-fable-5-1', at, result });
    assert.equal(evidence.classification, 'undetermined', JSON.stringify(result).slice(0, 80)); assert.notEqual(evidence.messageMatched, true); assertNoSecret(evidence);
    assert.ok(!('providerMessage' in evidence));
  }
  const accepted = pool.classifyResult({ callKind: 'run', modelId: 'grok-4.6', at, agentId: 'bc-00000000-0000-4000-8000-000000000001', result: { outcome: 'ok', status: 200, data: {} } });
  assert.deepEqual(accepted, { at, callKind: 'run', modelId: 'grok-4.6', agentId: 'bc-00000000-0000-4000-8000-000000000001', classification: 'accepted', httpStatus: 200 });
  assert.equal(pool.classifyResult({ callKind: 'models', modelId: 'claude-fable-5-1', at, result: undefined }).classification, 'undetermined');
  assert.throws(() => pool.classifyResult({ callKind: 'probe', modelId: 'x', result: {} }), error => error.code === 'evidence_invalid');
  assert.deepEqual([pool.poolFor('claude-fable-5-1'), pool.poolFor('claude-opus-5'), pool.poolFor('grok-4.6'), pool.poolFor('gpt-x'), pool.poolFor(undefined)], ['custom', 'custom', 'standard', null, null]);
});

test('evidence effects: included-usage marks only the called pool exhausted, plan_required both, hard limit and generic nothing; acceptance records probe/proof', () => {
  const at = T0;
  const state = stateFixture([account('acct-a'), account('acct-b', { evidence: 'not-an-array' }), account('acct-c', { modelPools: { custom: 'recheck_required', standard: 'exhaustion_reported' } })]);
  const included = pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(429, 'rate_limit_exceeded', INCLUDED) });
  const summary = pool.applyEvidence(state, 'acct-a', included);
  assert.deepEqual(state.accounts[0].modelPools, { custom: 'exhaustion_reported', standard: 'recheck_required' }, 'custom épuisé, standard à revérifier, pas d’épuisement global');
  assert.equal(state.accounts[0].status, 'inactive'); assert.equal(state.accounts[0].inactiveReason, 'included_usage_exhausted'); assert.equal(state.accounts[0].inactiveAt, at);
  assert.equal(state.accounts[0].evidence.length, 1); assert.deepEqual(state.accounts[0].lastEvidence, { at, callKind: 'create', modelId: 'claude-fable-5-1', classification: 'included_usage_exhausted', httpStatus: 429, providerCode: 'rate_limit_exceeded', reason: 'quota' });
  assert.equal(summary.status, 'inactive'); assertNoSecret(state);
  // Un standard déjà confirmé n’est pas rétrogradé en recheck_required.
  pool.applyEvidence(state, 'acct-c', included); assert.deepEqual(state.accounts[2].modelPools, { custom: 'exhaustion_reported', standard: 'exhaustion_reported' });
  // Champ evidence non tabulaire : préservé, lastEvidence porte la trace.
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(400, 'usage_limit_exceeded', HARD_LIMIT) }));
  assert.equal(state.accounts[1].evidence, 'not-an-array'); assert.equal(state.accounts[1].lastEvidence.classification, 'hard_limit_start_refused');
  assert.deepEqual(state.accounts[1].modelPools, { custom: 'probe_passed_balance_unknown', standard: 'recheck_required' }, 'plafond de dépenses : aucune inférence de solde, pools inchangés'); assert.equal(state.accounts[1].status, 'active');
  assert.deepEqual(state.accounts[1].startBlock, { at, reason: 'hard_limit_start_refused', callKind: 'create', modelId: 'claude-fable-5-1', httpStatus: 400, providerCode: 'usage_limit_exceeded' }, 'nouveaux départs bloqués jusqu’à validation explicite');
  assert.equal(state.accounts[1].lastRefusalAt, at); assert.ok(pool.startBlocked(state.accounts[1]));
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'run', modelId: 'claude-fable-5-1', at: '2026-09-16T12:30:00.000Z', result: rejected(503, undefined, MESSAGE_MARKER) }));
  assert.deepEqual(state.accounts[1].modelPools, { custom: 'probe_passed_balance_unknown', standard: 'recheck_required' }); assert.equal(state.accounts[1].status, 'active'); assert.equal(state.accounts[1].lastRefusalAt, '2026-09-16T12:30:00.000Z', 'tout refus daté est retenu');
  assert.equal(state.accounts[1].startBlock.at, at, 'un refus générique ne modifie pas le blocage');
  // Un GET lisible (agent/run) n’est ni un départ ni un refus : le blocage reste, le propriétaire garde ses lectures.
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'agent', modelId: 'claude-fable-5-1', at: '2026-09-16T12:31:00.000Z', result: { outcome: 'ok', status: 200 } }));
  assert.ok(pool.startBlocked(state.accounts[1])); assert.equal(state.accounts[1].lastRefusalAt, '2026-09-16T12:30:00.000Z');
  // Départ accepté (atteint seulement par validation explicite --account) : blocage levé, date conservée.
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at: '2026-09-16T12:40:00.000Z', result: { outcome: 'ok', status: 201 } }));
  assert.equal(state.accounts[1].startBlock, null); assert.equal(state.accounts[1].startBlockClearedAt, '2026-09-16T12:40:00.000Z'); assert.ok(!pool.startBlocked(state.accounts[1]));
  // Un refus de plafond sur GET /models (hors départ) n’installe pas de blocage : seuls create/run sont des départs.
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'models', modelId: 'claude-fable-5-1', at: '2026-09-16T12:41:00.000Z', result: rejected(400, 'usage_limit_exceeded', HARD_LIMIT) }));
  assert.equal(state.accounts[1].startBlock, null);
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'run', modelId: 'claude-fable-5-1', at: '2026-09-16T12:42:00.000Z', result: rejected(400, 'usage_limit_exceeded', HARD_LIMIT) }));
  assert.equal(state.accounts[1].startBlock.callKind, 'run');
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at, result: rejected(403, 'plan_required', PLAN) }));
  assert.deepEqual(state.accounts[1].modelPools, { custom: 'unavailable_plan', standard: 'unavailable_plan' }); assert.equal(state.accounts[1].inactiveReason, 'plan_required');
  // Acceptation réelle : sonde passée (solde inconnu) ; sur standard, preuve datée liée au compte, au modèle et à l’agent.
  const fresh = stateFixture([account('acct-d', { status: 'inactive', inactiveReason: 'included_usage_exhausted', modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } })]);
  pool.applyEvidence(fresh, 'acct-d', pool.classifyResult({ callKind: 'run', modelId: 'grok-4.6', at, agentId: 'bc-00000000-0000-4000-8000-000000000002', result: { outcome: 'ok', status: 200 } }));
  assert.deepEqual(fresh.accounts[0].modelPools, { custom: 'exhaustion_reported', standard: 'probe_passed_balance_unknown' });
  assert.deepEqual(fresh.accounts[0].standardProof, { at, modelId: 'grok-4.6', kind: 'run_accepted', agentId: 'bc-00000000-0000-4000-8000-000000000002' });
  assert.equal(fresh.accounts[0].status, 'inactive', 'une acceptation ne réactive pas un compte épuisé sur custom');
  pool.applyEvidence(fresh, 'acct-d', pool.classifyResult({ callKind: 'models', modelId: 'grok-4.6', at: '2026-09-16T13:00:00.000Z', result: { outcome: 'ok', status: 200 } }));
  assert.equal(fresh.accounts[0].standardProof.at, at, 'GET /models accepté n’est pas une preuve d’accès');
  const bounded = stateFixture([account('acct-e')]);
  for (let i = 0; i < 25; i++) pool.applyEvidence(bounded, 'acct-e', pool.classifyResult({ callKind: 'run', modelId: 'claude-fable-5-1', at, result: { outcome: 'ok', status: 200 } }));
  assert.equal(bounded.accounts[0].evidence.length, 20); assert.deepEqual(bounded.accounts[0].modelPools, { custom: 'probe_passed_balance_unknown', standard: 'recheck_required' });
  assert.throws(() => pool.applyEvidence(bounded, 'acct-z', included), error => error.code === 'account_unknown');
});

test('decision: same model on the first eligible premium account in configured order; exception only after every premium account is confirmed unavailable and a fresh standard proof exists; never Composer', () => {
  const route = (state, extra = {}) => pool.decide(state, { selection: fable, fallbackSelection: grok, now, ...extra });
  const base = () => stateFixture([account('acct-a'), account('acct-b'), account('acct-c', { modelPools: { custom: 'recheck_required', standard: 'recheck_required' } })]);
  let decision = route(base());
  assert.equal(decision.status, 'route'); assert.equal(decision.accountId, 'acct-a'); assert.equal(decision.modelId, 'claude-fable-5-1'); assert.equal(decision.pool, 'custom'); assert.equal(decision.selection, 'initial');
  assert.deepEqual(decision.accounts.map(a => a.id), ['acct-a', 'acct-b', 'acct-c']); assert.ok(decision.accounts.every(a => !('secretDpapi' in a)));
  const prioritized = base(); prioritized.routingPolicy.priorityAccountIds = ['acct-c'];
  assert.equal(route(prioritized).accountId, 'acct-c', 'priorityAccountIds avant order');
  assert.equal(route(base(), { excludeAccountIds: ['acct-a'] }).accountId, 'acct-b', 'propriétaire exclu ⇒ compte premium suivant, même modèle');
  const exhaustedA = base(); exhaustedA.accounts[0] = account('acct-a', { status: 'inactive', inactiveReason: 'included_usage_exhausted', modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } });
  assert.equal(route(exhaustedA).accountId, 'acct-b', 'un compte épuisé est sauté, la sélection ne change pas');
  const only = stateFixture([account('acct-a'), account('acct-b', { modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } })]);
  decision = route(only, { excludeAccountIds: ['acct-a'] });
  assert.equal(decision.status, 'blocked'); assert.equal(decision.reason, 'only_excluded_account_eligible'); assert.match(decision.nextAction, /followup/);

  // Tous non éligibles mais pas tous confirmés : refus explicite, aucun repli.
  const unknown = stateFixture([account('acct-a', { status: 'inactive', inactiveReason: 'manual', modelPools: { custom: 'recheck_required', standard: 'recheck_required' } }), account('acct-b', { status: 'inactive', modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } })]);
  decision = route(unknown);
  assert.equal(decision.status, 'blocked'); assert.equal(decision.reason, 'custom_availability_unknown'); assert.deepEqual(decision.unknown, ['acct-a']); assert.deepEqual(decision.confirmed, ['acct-b']); assert.match(decision.nextAction, /aucun repli/);

  // Tous confirmés indisponibles : la preuve standard datée et liée au compte est exigée ; GET /models ne compte pas ; sonde payante jamais automatique.
  const allConfirmed = () => stateFixture([account('acct-a', { status: 'inactive', inactiveReason: 'included_usage_exhausted', modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } }), account('acct-b', { status: 'inactive', inactiveReason: 'plan_required', modelPools: { custom: 'unavailable_plan', standard: 'unavailable_plan' } }), account('acct-c', { status: 'active', modelPools: { custom: 'exhaustion_reported', standard: 'probe_passed_balance_unknown' } })]);
  decision = route(allConfirmed());
  assert.equal(decision.status, 'blocked'); assert.equal(decision.reason, 'standard_access_unproven'); assert.deepEqual(decision.confirmed, ['acct-a', 'acct-b', 'acct-c']); assert.deepEqual(decision.standardCandidates, ['acct-a', 'acct-c'], 'acct-b (plan) exclu, acct-a inactif réutilisable pour standard');
  assert.match(decision.nextAction, /GET \/models n’en est pas une/); assert.match(decision.nextAction, /--select grok --account/); assert.match(decision.nextAction, /Aucune sonde payante/);
  const proven = allConfirmed(); proven.accounts[2].standardProof = { at: '2026-09-16T10:00:00.000Z', modelId: 'grok-4.6', kind: 'run_accepted' };
  decision = route(proven);
  assert.equal(decision.status, 'exception'); assert.equal(decision.accountId, 'acct-c'); assert.equal(decision.modelId, 'grok-4.6'); assert.equal(decision.selection, 'fallback'); assert.equal(decision.reason, 'all_custom_accounts_confirmed_unavailable'); assert.equal(decision.proof.ageMs, 7_200_000);
  const stale = allConfirmed(); stale.accounts[2].standardProof = { at: '2026-09-14T10:00:00.000Z', modelId: 'grok-4.6', kind: 'run_accepted' };
  assert.equal(route(stale).reason, 'standard_access_unproven', 'preuve trop ancienne');
  const wrongModel = allConfirmed(); wrongModel.accounts[2].standardProof = { at: '2026-09-16T10:00:00.000Z', modelId: 'grok-4.5', kind: 'run_accepted' };
  assert.equal(route(wrongModel).reason, 'standard_access_unproven', 'preuve d’un autre modèle');
  const future = allConfirmed(); future.accounts[2].standardProof = { at: '2026-09-17T10:00:00.000Z', modelId: 'grok-4.6', kind: 'run_accepted' };
  assert.equal(route(future).reason, 'standard_access_unproven', 'horodatage futur refusé');
  const inactiveProven = allConfirmed(); inactiveProven.accounts[0].standardProof = { at: '2026-09-16T11:00:00.000Z', modelId: 'grok-4.6', kind: 'create_accepted' }; inactiveProven.accounts[0].modelPools.standard = 'probe_passed_balance_unknown';
  decision = route(inactiveProven); assert.equal(decision.status, 'exception'); assert.equal(decision.accountId, 'acct-a', 'compte inactif (épuisé custom) réutilisé pour standard avec preuve cohérente avec l’état');
  const noReuse = allConfirmed(); noReuse.routingPolicy.reuseInactiveForStandard = false; noReuse.accounts[2].status = 'inactive';
  assert.equal(route(noReuse).reason, 'no_standard_account');
  const disabled = allConfirmed(); disabled.routingPolicy.fallbackWhen = 'never';
  assert.equal(route(disabled).reason, 'fallback_policy_disabled');
  const composer = proven; composer.routingPolicy.fallbackModel = 'composer-2.5';
  decision = route(composer); assert.equal(decision.status, 'blocked'); assert.equal(decision.reason, 'fallback_model_forbidden');
  composer.routingPolicy.fallbackModel = 'grok-4.6';
  assert.equal(route(composer, { fallbackSelection: { key: 'composer', modelId: 'composer-2.5', params: [] } }).reason, 'fallback_model_forbidden', 'sélection de repli Composer refusée même si la politique dit grok');
  assert.equal(route(composer, { fallbackSelection: null }).reason, 'fallback_model_forbidden', 'aucune entrée grok dans le catalogue ⇒ pas de repli');
  composer.routingPolicy.neverFallbackToComposer = false;
  assert.equal(route(composer).reason, 'fallback_model_forbidden', 'la garde anti-Composer ne se désactive pas');
  assert.equal(route(proven, { selection: { key: 'x', modelId: 'composer-2.5', params: [] } }).reason, 'composer_forbidden');
  assert.equal(route(base(), { selection: { key: 'x', modelId: 'gpt-x', params: [] } }).reason, 'model_pool_unknown');
  assert.equal(route(stateFixture([])).reason, 'no_accounts');
  // requireStandardValidation=false n’est pas un interrupteur : jamais d’exception avec proof:null.
  const relaxed = allConfirmed(); relaxed.routingPolicy.requireStandardValidation = false;
  decision = route(relaxed); assert.equal(decision.status, 'blocked'); assert.equal(decision.reason, 'standard_access_unproven'); assert.equal(decision.requireStandardValidation, 'always'); assert.deepEqual(decision.proofStatus, { 'acct-a': 'no_proof', 'acct-c': 'no_proof' });
  const relaxedProven = allConfirmed(); relaxedProven.routingPolicy.requireStandardValidation = false; relaxedProven.accounts[2].standardProof = { at: '2026-09-16T10:00:00.000Z', modelId: 'grok-4.6', kind: 'run_accepted' };
  decision = route(relaxedProven); assert.equal(decision.status, 'exception'); assert.ok(decision.proof && decision.proof.at === '2026-09-16T10:00:00.000Z', 'exception seulement avec une preuve réelle');

  // Sélection standard explicite à l’attribution : route sur le pool standard (inactif réutilisable), sans exception ni preuve préalable.
  decision = pool.decide(allConfirmed(), { selection: grok, now });
  assert.equal(decision.status, 'route'); assert.equal(decision.pool, 'standard'); assert.equal(decision.accountId, 'acct-a'); assert.equal(decision.selection, 'initial');
  const noStandard = stateFixture([account('acct-a', { modelPools: { custom: 'probe_passed_balance_unknown', standard: 'exhaustion_reported' } })]);
  assert.equal(pool.decide(noStandard, { selection: grok, now }).reason, 'no_standard_account');
  assert.throws(() => pool.decide(base(), { selection: {} }), error => error.code === 'selection_invalid');
});

test('standard proof is bound to account, model and current state: refusal, hard limit, recheck_required or start block after the proof invalidate it even under 24 h', () => {
  const route = (state, extra = {}) => pool.decide(state, { selection: fable, fallbackSelection: grok, now, ...extra });
  const proofAt = '2026-09-16T10:00:00.000Z';
  const confirmed = (extra = {}) => stateFixture([account('acct-a', { status: 'inactive', inactiveReason: 'included_usage_exhausted', modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } }), account('acct-c', { status: 'active', modelPools: { custom: 'exhaustion_reported', standard: 'probe_passed_balance_unknown' }, standardProof: { at: proofAt, modelId: 'grok-4.6', kind: 'run_accepted' }, ...extra })]);
  const maxAge = 24 * 3_600_000; const nowMs = Date.parse(T0);
  assert.equal(route(confirmed()).status, 'exception', 'preuve fraîche, cohérente, sans refus postérieur');
  assert.deepEqual(pool.standardProofStatus(confirmed().accounts[1], 'grok-4.6', nowMs, maxAge).valid, true);
  // Refus fournisseur daté après la preuve (générique ou signature) : preuve caduque même à 2 h d’âge.
  let d = route(confirmed({ lastRefusalAt: '2026-09-16T11:00:00.000Z' }));
  assert.equal(d.status, 'blocked'); assert.equal(d.reason, 'standard_access_unproven'); assert.equal(d.proofStatus['acct-c'], 'refusal_after_proof'); assert.match(d.nextAction, /acct-c \(refusal_after_proof\)/);
  assert.equal(route(confirmed({ lastRefusalAt: '2026-09-16T09:00:00.000Z' })).status, 'exception', 'un refus antérieur à la preuve ne la touche pas');
  assert.equal(route(confirmed({ lastRefusalAt: proofAt })).status, 'exception', 'même horodatage édité à la main : c’est l’ordre des événements enregistrés qui tranche (ci-dessous)');
  // Passage à recheck_required après la preuve, ou état courant non « probe_passed » : caduque.
  d = route(confirmed({ standardRecheckAt: '2026-09-16T11:30:00.000Z' })); assert.equal(d.proofStatus['acct-c'], 'recheck_after_proof');
  d = route(confirmed({ modelPools: { custom: 'exhaustion_reported', standard: 'recheck_required' } })); assert.equal(d.proofStatus['acct-c'], 'standard_pool_recheck_required');
  d = route(confirmed({ inactiveAt: '2026-09-16T11:30:00.000Z', status: 'inactive', inactiveReason: 'manual' })); assert.equal(d.proofStatus['acct-c'], 'inactive_after_proof');
  // Blocage de départ (plafond) sur le seul compte prouvé : ni preuve valable ni compte éligible pour lui ; explication et validation explicite demandées.
  d = route(confirmed({ startBlock: { at: '2026-09-16T11:45:00.000Z', reason: 'hard_limit_start_refused' } }));
  assert.equal(d.status, 'blocked'); assert.equal(d.reason, 'standard_access_unproven'); assert.deepEqual(d.startBlocked, ['acct-c']); assert.deepEqual(d.standardCandidates, ['acct-a']); assert.deepEqual(d.proofStatus, { 'acct-a': 'no_proof' }); assert.match(d.nextAction, /hard_limit_start_refused/); assert.match(d.nextAction, /--account <id>/); assert.match(d.nextAction, /aucun solde inféré/);
  assert.equal(pool.standardProofStatus(confirmed({ startBlock: { at: '2026-09-16T11:45:00.000Z', reason: 'hard_limit_start_refused' } }).accounts[1], 'grok-4.6', nowMs, maxAge).reason, 'start_blocked');
  // Le flux réel : preuve enregistrée, puis refus de plafond sur un run grok ⇒ startBlock + lastRefusalAt + preuve invalidée par l’événement (même à horodatage égal) ;
  // un départ accepté après validation explicite la restaure.
  const live = confirmed(); const c = live.accounts[1];
  pool.applyEvidence(live, 'acct-c', pool.classifyResult({ callKind: 'run', modelId: 'grok-4.6', at: proofAt, result: rejected(400, 'usage_limit_exceeded', HARD_LIMIT) }));
  assert.deepEqual(c.modelPools, { custom: 'exhaustion_reported', standard: 'probe_passed_balance_unknown' }, 'le plafond ne marque pas le crédit standard épuisé');
  assert.equal(c.standardProof.at, proofAt, 'la preuve n’est pas effacée'); assert.deepEqual(c.standardProof.invalidatedBy, { at: proofAt, reason: 'hard_limit_start_refused' });
  d = route(live); assert.equal(d.reason, 'standard_access_unproven'); assert.equal(d.proofStatus['acct-c'], undefined, 'compte bloqué : plus candidat'); assert.deepEqual(d.startBlocked, ['acct-c']);
  assert.equal(pool.standardProofStatus(c, 'grok-4.6', nowMs, maxAge).reason, 'invalidated_hard_limit_start_refused'); assert.equal(pool.summarizeAccount(c).standardProof.invalidatedBy.reason, 'hard_limit_start_refused');
  pool.applyEvidence(live, 'acct-c', pool.classifyResult({ callKind: 'create', modelId: 'grok-4.6', at: '2026-09-16T11:50:00.000Z', result: { outcome: 'ok', status: 201 } }));
  assert.equal(c.startBlock, null); assert.equal(c.standardProof.at, '2026-09-16T11:50:00.000Z'); assert.equal(c.standardProof.invalidatedBy, undefined); d = route(live); assert.equal(d.status, 'exception'); assert.equal(d.proof.at, '2026-09-16T11:50:00.000Z');
  // Refus générique daté (503) après la preuve : invalidée par l’événement même sans changement de pool.
  pool.applyEvidence(live, 'acct-c', pool.classifyResult({ callKind: 'run', modelId: 'grok-4.6', at: '2026-09-16T11:50:00.000Z', result: rejected(503, undefined, MESSAGE_MARKER) }));
  assert.equal(c.standardProof.invalidatedBy.reason, 'refusal_503'); assert.equal(route(live).proofStatus['acct-c'], 'invalidated_refusal_503'); assert.equal(c.startBlock, null, 'un 503 n’est pas un blocage de départ');
  // Une erreur réseau sans statut n’est pas un refus fournisseur : rien n’est invalidé.
  const net = confirmed(); pool.applyEvidence(net, 'acct-c', pool.classifyResult({ callKind: 'run', modelId: 'grok-4.6', at: '2026-09-16T11:00:00.000Z', result: { outcome: 'unavailable', reason: 'network' } }));
  assert.equal(net.accounts[1].standardProof.invalidatedBy, undefined); assert.equal(net.accounts[1].lastRefusalAt, undefined); assert.equal(route(net).status, 'exception');
  // Un compte bloqué n’est jamais choisi automatiquement, ni pour custom ni pour standard ; l’ordre configuré est respecté pour le suivant.
  const premium = stateFixture([account('acct-a', { startBlock: { at: T0, reason: 'hard_limit_start_refused' } }), account('acct-b')]);
  assert.equal(route(premium).accountId, 'acct-b');
  assert.equal(pool.decide(premium, { selection: grok, now }).accountId, 'acct-b');
  const onlyBlocked = stateFixture([account('acct-a', { startBlock: { at: T0, reason: 'hard_limit_start_refused' } })]);
  d = route(onlyBlocked); assert.equal(d.status, 'blocked'); assert.equal(d.reason, 'custom_availability_unknown'); assert.deepEqual(d.startBlocked, ['acct-a']); assert.match(d.nextAction, /validation explicite/);
  d = pool.decide(onlyBlocked, { selection: grok, now }); assert.equal(d.reason, 'no_standard_account'); assert.deepEqual(d.startBlocked, ['acct-a']);
  // included_usage_exhausted sur custom date le passage du standard en recheck_required.
  const dated = stateFixture([account('acct-a', { modelPools: { custom: 'probe_passed_balance_unknown', standard: 'probe_passed_balance_unknown' }, standardProof: { at: proofAt, modelId: 'grok-4.6', kind: 'run_accepted' } })]);
  pool.applyEvidence(dated, 'acct-a', pool.classifyResult({ callKind: 'create', modelId: 'claude-fable-5-1', at: '2026-09-16T11:00:00.000Z', result: rejected(429, 'rate_limit_exceeded', INCLUDED) }));
  assert.equal(dated.accounts[0].standardRecheckAt, '2026-09-16T11:00:00.000Z'); assert.equal(dated.accounts[0].modelPools.standard, 'recheck_required'); assert.equal(pool.standardProofStatus(dated.accounts[0], 'grok-4.6', nowMs, maxAge).reason, 'invalidated_included_usage_exhausted');
  const summary = pool.summarizeAccount(onlyBlocked.accounts[0]); assert.deepEqual(summary.startBlock, { at: T0, reason: 'hard_limit_start_refused', callKind: null }); assert.equal(summary.lastRefusalAt, null);
});

test('openAccountPool: absent without a vault, explicit missing file refused, then keys on demand plus read/decide/record under the lock', async () => {
  assert.equal(await pool.openAccountPool({ env: {} }), null);
  await withTemp('lite-pool-open-', async (temp) => {
    assert.equal(await pool.openAccountPool({ env: { LOCALAPPDATA: temp } }), null, 'coffre absent au chemin par défaut : pool indisponible, pas une erreur');
    await assert.rejects(pool.openAccountPool({ env: { CURSOR_CREDENTIALS_FILE: join(temp, 'missing.json') } }), error => error.code === 'credentials_missing');
    const dir = join(temp, 'Creezio', 'cursor'); await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'credentials.json'), JSON.stringify(credentialsFixture()));
    const opened = await pool.openAccountPool({ env: { LOCALAPPDATA: temp }, decrypt: fakeDecrypt, now });
    assert.equal(opened.mode, 'pool'); assert.deepEqual(opened.accountIds, ['acct-a', 'acct-b']); assert.equal(opened.stateFile, join(dir, 'pool-state.json')); assert.equal(opened.fallbackModel, 'grok-4.6');
    assert.equal(await opened.keyFor('acct-b'), KEY_B); assertNoSecret(opened);
    const summary = await opened.read();
    assert.equal(summary.revision, 1); assert.deepEqual(summary.order, ['acct-a', 'acct-b']); assert.equal(summary.accounts[0].modelPools.custom, 'recheck_required');
    const decision = await opened.decide({ selection: fable, fallbackSelection: grok });
    assert.equal(decision.status, 'route'); assert.equal(decision.accountId, 'acct-a');
    const recorded = await opened.record('acct-a', opened.classify({ callKind: 'create', modelId: 'claude-fable-5-1', result: rejected(429, 'rate_limit_exceeded', INCLUDED) }));
    assert.equal(recorded.status, 'inactive'); assert.equal(recorded.modelPools.custom, 'exhaustion_reported');
    assert.equal((await opened.decide({ selection: fable, fallbackSelection: grok })).accountId, 'acct-b', 'décision déterministe relue depuis l’état partagé');
    await opened.record('acct-b', opened.classify({ callKind: 'create', modelId: 'claude-fable-5-1', agentId: 'bc-00000000-0000-4000-8000-000000000003', result: { outcome: 'ok', status: 200 } }), { activate: true });
    const after = await opened.read(); assert.equal(after.activeAccountId, 'acct-b'); assert.equal(after.revision, 3);
    const raw = await readFile(opened.stateFile, 'utf8'); assertNoSecret(raw); assert.ok(!raw.includes(INCLUDED));
    await assert.rejects(stat(opened.lockFile), { code: 'ENOENT' });
  });
});

test('transport access: CURSOR_API_KEY keeps the legacy single-account mode; the pool is optional and any credential failure blocks without a call or a leak', async () => {
  const env = await agents.resolveAccess({ env: { CURSOR_API_KEY: KEY_ENV } });
  assert.equal(env.mode, 'env'); assert.equal(await env.keyFor(undefined), KEY_ENV); assert.equal(await env.keyFor('acct-a'), KEY_ENV, 'un seul compte implicite, aucun état de pool');
  await assert.rejects(agents.resolveAccess({ env: {}, adapter: null }), /CURSOR_API_KEY absente et aucun coffre/);
  await assert.rejects(agents.resolveAccess({ env: {}, adapter: pool }), /CURSOR_API_KEY absente/);
  assert.equal(await agents.loadAccountAdapter({}), pool, 'adaptateur du kit résolu depuis la compétence');
  assert.equal(await agents.loadAccountAdapter({ CURSOR_ACCOUNT_POOL_MODULE: poolModulePath }), pool);
  await assert.rejects(agents.loadAccountAdapter({ CURSOR_ACCOUNT_POOL_MODULE: join(root, 'scripts', 'absent-adapter.mjs') }), /CURSOR_ACCOUNT_POOL_MODULE/);
  await withTemp('lite-pool-access-', async (temp) => {
    const { env: poolEnv, access } = await openVault(temp);
    assert.equal(access.mode, 'pool'); assert.equal(await access.keyFor('acct-b'), KEY_B);
    await assert.rejects(access.keyFor(undefined), /propriétaire inconnu/);
    await assert.rejects(access.keyFor('acct-z'), error => error.code === 'account_unknown');
    const mixed = await agents.resolveAccess({ env: { ...poolEnv, CURSOR_API_KEY: KEY_ENV }, adapter: pool, decrypt: fakeDecrypt });
    assert.equal(mixed.mode, 'env', 'la clé d’environnement explicite prime : compatibilité');
    // Déchiffrement refusé : indisponibilité explicite (code 3), aucun appel, aucun secret dans la sortie.
    const logs = []; const silent = recorder({});
    const code = await agents.main(['preflight'], { env: poolEnv, adapter: pool, decrypt: async () => { throw new Error('DPAPI refused ' + BLOB_A); }, fetchImpl: silent.fetchImpl, log: l => logs.push(l) });
    assert.equal(code, 3); assert.equal(silent.calls.length, 0);
    const report = JSON.parse(logs[0]); assert.equal(report.status, 'unavailable'); assert.equal(report.reason, 'decrypt_failed'); assert.equal(report.accountId, 'acct-a'); assertNoSecret(logs.join('\n'));
    // Verrou étranger : indisponible, jamais volé.
    await writeFile(access.pool.lockFile, JSON.stringify({ pid: 4242, at: T0 }));
    const lockedAccess = await pool.openAccountPool({ env: poolEnv, decrypt: fakeDecrypt, now, waitMs: 30, sleep: async () => {} });
    const lockedLogs = [];
    assert.equal(await agents.main(['accounts'], { env: poolEnv, adapter: { openAccountPool: async () => lockedAccess }, fetchImpl: silent.fetchImpl, log: l => lockedLogs.push(l) }), 3);
    assert.equal(JSON.parse(lockedLogs[0]).reason, 'pool_locked'); assert.deepEqual(JSON.parse(lockedLogs[0]).holder, { pid: 4242, at: T0 }); assert.ok(await stat(access.pool.lockFile));
    await rm(access.pool.lockFile);
    const cli = spawn(process.execPath, [join(root, '.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs'), 'preflight'], { env: { PATH: process.env.PATH, CURSOR_CREDENTIALS_FILE: join(temp, 'absent', 'credentials.json') } });
    const stderr = await new Promise(resolvePromise => { let err = ''; cli.stderr.on('data', c => { err += c; }); cli.on('close', code => resolvePromise({ code, err })); });
    assert.equal(stderr.code, 3, stderr.err); assert.equal(stderr.err, '', 'PoolError émise en JSON sur stdout, pas une pile');
  });
});

test('launch in pool mode: deterministic account in configured order, owner attached, exact 429/403/400 signatures classified and recorded, generic refusals never infer exhaustion', async () => {
  const config = await agents.loadSelections();
  await withTemp('lite-pool-launch-', async (temp) => {
    const { access, stateOf, accountOf, registryFile } = await openVault(temp);
    const M1 = agents.missionAgentId(REPO, 'M1');
    const base = { repo: REPO, ref: 'agents/M1', promptText: `Brief ${PROMPT_MARKER}`, config, access, registryFile, now };
    // acct-a : usage inclus épuisé sur Fable (signature exacte) ; l’agent n’a pas été créé (GET 404 via la même clé).
    const first = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': r => (r.key === KEY_A ? providerError(429, 'rate_limit_exceeded', INCLUDED) : json({ agent: agentOf(M1, RUN1), run: runOf(M1, RUN1) })), [`GET /v1/agents/${M1}`]: () => providerError(404, 'not_found', MESSAGE_MARKER) });
    const exhausted = await agents.launch({ ...base, mission: 'M1', fetchImpl: first.fetchImpl });
    assert.equal(exhausted.status, 'unavailable'); assert.equal(exhausted.state, 'not_created'); assert.equal(exhausted.account.id, 'acct-a'); assert.equal(exhausted.account.pool, 'custom');
    assert.deepEqual(exhausted.evidence, { classification: 'included_usage_exhausted', recorded: true, httpStatus: 429 }); assert.match(exhausted.nextAction, /compte premium suivant/); assertNoSecret(exhausted);
    assert.deepEqual(first.calls.map(c => `${c.method} ${c.path}`), ['GET /v1/models', 'POST /v1/agents', `GET /v1/agents/${M1}`]); assert.deepEqual(first.keysUsed(), [KEY_A], 'préflight, POST et réconciliation avec la clé du compte décidé');
    let a = await accountOf('acct-a');
    assert.deepEqual(a.modelPools, { custom: 'exhaustion_reported', standard: 'recheck_required' }); assert.equal(a.status, 'inactive'); assert.equal(a.inactiveReason, 'included_usage_exhausted');
    assert.equal(a.lastEvidence.callKind, 'create'); assert.equal(a.lastEvidence.agentId, M1); assertNoSecret(await readFile(access.pool.stateFile, 'utf8'));
    // Relance sur la même clé : compte suivant, mêmes modèle et paramètres, propriétaire attaché, compte actif du pool mis à jour.
    const second = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => json({ agent: agentOf(M1, RUN1), run: runOf(M1, RUN1) }) });
    const launched = await agents.launch({ ...base, mission: 'M1', fetchImpl: second.fetchImpl });
    assert.equal(launched.status, 'launched'); assert.equal(launched.account.id, 'acct-b'); assert.equal(launched.evidence.classification, 'accepted');
    assert.deepEqual(second.keysUsed(), [KEY_B]); assert.deepEqual(second.posts()[0].body.model, { id: 'claude-fable-5-1', params: fable.params }); assert.equal(second.posts()[0].body.agentId, M1);
    assert.equal(launched.selection.key, 'fable'); assert.equal(launched.selection.currentSelection, undefined, 'aucune exception : pas de sélection courante distincte');
    let registry = await agents.loadRegistry(registryFile);
    assert.equal(registry.missions.M1.accountId, 'acct-b'); assert.equal(registry.missions.M1.state, 'launched'); assertNoSecret(registry);
    assert.equal((await stateOf()).activeAccountId, 'acct-b'); assert.equal((await accountOf('acct-b')).modelPools.custom, 'probe_passed_balance_unknown');

    // Tous les GET de la mission utilisent le propriétaire (acct-b), y compris une fois ce compte inactif pour la dépense ; jamais la clé d’un autre compte.
    const owner = recorder({ [`GET /v1/agents/${M1}/runs/${RUN1}`]: () => json(runOf(M1, RUN1, 'FINISHED')), [`GET /v1/agents/${M1}`]: () => json(agentOf(M1, RUN1)), [`POST /v1/agents/${M1}/runs`]: () => providerError(429, 'rate_limit_exceeded', INCLUDED) });
    const seen = await agents.status({ mission: 'M1', registryFile, access, fetchImpl: owner.fetchImpl });
    assert.equal(seen.status, 'ok'); assert.equal(seen.terminal, true); assert.equal(seen.account.id, 'acct-b');
    const resumed = await agents.followup({ mission: 'M1', registryFile, promptText: 'suite', access, fetchImpl: owner.fetchImpl });
    assert.equal(resumed.status, 'uncertain'); assert.equal(resumed.reason, 'quota'); assert.equal(resumed.evidence.classification, 'included_usage_exhausted'); assert.match(resumed.nextAction, /reconcile --mission ; aucune réémission avant ; usage inclus épuisé/);
    assert.deepEqual(owner.keysUsed(), [KEY_B]); assert.equal(owner.posts().length, 1);
    const b = await accountOf('acct-b'); assert.equal(b.status, 'inactive'); assert.equal(b.modelPools.custom, 'exhaustion_reported'); assert.equal(b.lastEvidence.callKind, 'run');
    const settled = await agents.reconcile({ mission: 'M1', registryFile, access, fetchImpl: owner.fetchImpl });
    assert.equal(settled.status, 'reconciled'); assert.deepEqual(settled.followup, { state: 'not_created', priorRunId: RUN1 }); assert.equal(settled.account.id, 'acct-b');
    assert.ok(owner.calls.every(c => c.key === KEY_B), 'réconciliation avec le propriétaire inactif, jamais une autre clé');
    const refused = await agents.followup({ mission: 'M1', registryFile, promptText: 'suite', access, fetchImpl: owner.fetchImpl });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.reason, 'owner_pool_unavailable'); assert.equal(refused.poolState, 'exhaustion_reported'); assert.match(refused.nextAction, /successor --mission/); assert.equal(owner.posts().length, 1, 'aucun POST voué à l’échec');
    await assert.rejects(agents.followup({ mission: 'M1', account: 'acct-a', registryFile, promptText: 'suite', access, fetchImpl: owner.fetchImpl }), /jamais de reprise avec une autre clé/);
    await assert.rejects(agents.status({ mission: 'M1', account: 'acct-a', registryFile, access, fetchImpl: owner.fetchImpl }), /propriétaire/);

    // acct-c : plafond de dépenses (400 exact) ⇒ départ refusé, aucune inférence, pools inchangés, compte toujours actif (ses GET restent possibles), mais nouveaux
    // départs bloqués sur ce compte : la relance automatique ne le choisit plus et l’explique ; seul « --account acct-c » (validation humaine) peut y redémarrer.
    const M2 = agents.missionAgentId(REPO, 'M2');
    const hard = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => providerError(400, 'usage_limit_exceeded', HARD_LIMIT) });
    const capped = await agents.launch({ ...base, mission: 'M2', ref: 'agents/M2', fetchImpl: hard.fetchImpl });
    assert.equal(capped.status, 'blocked'); assert.equal(capped.reason, 'rejected'); assert.equal(capped.httpStatus, 400); assert.equal(capped.providerCode, 'usage_limit_exceeded'); assert.equal(capped.account.id, 'acct-c');
    assert.equal(capped.evidence.classification, 'hard_limit_start_refused'); assert.match(capped.nextAction, /plafond de dépenses/); assert.match(capped.nextAction, /nouveaux départs bloqués/); assert.match(capped.nextAction, /--account acct-c/); assert.match(capped.nextAction, /aucune inférence sur le solde standard/); assertNoSecret(capped);
    let c = await accountOf('acct-c'); assert.deepEqual(c.modelPools, { custom: 'recheck_required', standard: 'recheck_required' }); assert.equal(c.status, 'active'); assert.equal(c.lastEvidence.classification, 'hard_limit_start_refused');
    assert.deepEqual(c.startBlock, { at: T0, reason: 'hard_limit_start_refused', callKind: 'create', modelId: 'claude-fable-5-1', httpStatus: 400, providerCode: 'usage_limit_exceeded' }); assert.equal(c.lastRefusalAt, T0);
    assert.equal((await agents.loadRegistry(registryFile)).missions.M2.state, 'failed');
    const silentRetry = recorder({});
    const notRetried = await agents.launch({ ...base, mission: 'M2', ref: 'agents/M2', fetchImpl: silentRetry.fetchImpl });
    assert.equal(notRetried.status, 'blocked'); assert.equal(notRetried.reason, 'custom_availability_unknown'); assert.deepEqual(notRetried.decision.startBlocked, ['acct-c']); assert.deepEqual(notRetried.decision.unknown, ['acct-c']); assert.match(notRetried.nextAction, /hard_limit_start_refused/); assert.equal(silentRetry.calls.length, 0, 'aucun appel, aucune relance automatique sur un compte bloqué');
    assert.equal((await agents.accounts({ config, access })).accounts.find(x => x.id === 'acct-c').startBlock.reason, 'hard_limit_start_refused');
    // Validation explicite (--account) : le départ est tenté ; un refus générique ne lève pas le blocage et n’infère rien.
    const nearMiss = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => providerError(429, 'rate_limit_exceeded', 'Too many requests ' + MESSAGE_MARKER), [`GET /v1/agents/${M2}`]: () => providerError(404, 'not_found', '') });
    const generic = await agents.launch({ ...base, mission: 'M2', ref: 'agents/M2', account: 'acct-c', fetchImpl: nearMiss.fetchImpl });
    assert.equal(generic.status, 'unavailable'); assert.equal(generic.account.id, 'acct-c'); assert.equal(generic.account.explicitValidation, 'start_block'); assert.equal(generic.evidence.classification, 'undetermined'); assert.equal(generic.nextAction, undefined, 'aucune consigne d’épuisement sur un 429 générique');
    c = await accountOf('acct-c'); assert.equal(c.status, 'active'); assert.deepEqual(c.modelPools, { custom: 'recheck_required', standard: 'recheck_required' }, 'aucune inférence d’épuisement'); assert.equal(c.startBlock.at, T0, 'blocage maintenu tant qu’aucun départ n’est accepté');
    for (const handler of [() => providerError(402, 'payment_required', MESSAGE_MARKER), () => providerError(403, 'forbidden', MESSAGE_MARKER), () => json({}, 503), () => { throw new TypeError('socket hang up'); }]) {
      const r = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': handler, [`GET /v1/agents/${M2}`]: () => providerError(404, 'not_found', '') });
      const out = await agents.launch({ ...base, mission: 'M2', ref: 'agents/M2', account: 'acct-c', fetchImpl: r.fetchImpl });
      assert.equal(out.account.id, 'acct-c'); assert.notEqual(out.status, 'launched'); assertNoSecret(out);
      c = await accountOf('acct-c'); assert.equal(c.status, 'active'); assert.deepEqual(c.modelPools, { custom: 'recheck_required', standard: 'recheck_required' }); assert.ok(c.startBlock);
    }
    // Plan manquant (403 exact) ⇒ deux pools indisponibles.
    const plan = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => providerError(403, 'plan_required', PLAN), [`GET /v1/agents/${M2}`]: () => providerError(404, 'not_found', '') });
    const noPlan = await agents.launch({ ...base, mission: 'M2', ref: 'agents/M2', account: 'acct-c', fetchImpl: plan.fetchImpl });
    assert.equal(noPlan.evidence.classification, 'plan_required'); assert.match(noPlan.nextAction, /sans plan/);
    c = await accountOf('acct-c'); assert.deepEqual(c.modelPools, { custom: 'unavailable_plan', standard: 'unavailable_plan' }); assert.equal(c.inactiveReason, 'plan_required');

    // Tous les comptes premium confirmés indisponibles, aucune preuve standard : refus honnête sans appel ; la décision à blanc dit la même chose.
    const silent = recorder({});
    const unproven = await agents.launch({ ...base, mission: 'M3', ref: 'agents/M3', fetchImpl: silent.fetchImpl });
    assert.equal(unproven.status, 'blocked'); assert.equal(unproven.reason, 'standard_access_unproven'); assert.deepEqual(unproven.decision.confirmed, ['acct-a', 'acct-b', 'acct-c']); assert.deepEqual(unproven.decision.standardCandidates, ['acct-a', 'acct-b']);
    assert.match(unproven.nextAction, /GET \/models n’en est pas une/); assert.equal(silent.calls.length, 0); assert.equal((await agents.loadRegistry(registryFile)).missions.M3, undefined, 'aucune entrée sans décision');
    const view = await agents.accounts({ config, access });
    assert.equal(view.mode, 'pool'); assert.equal(view.decision.status, 'blocked'); assert.equal(view.decision.reason, 'standard_access_unproven'); assert.deepEqual(view.accounts.map(x => [x.id, x.status, x.modelPools.custom]), [['acct-a', 'inactive', 'exhaustion_reported'], ['acct-b', 'inactive', 'exhaustion_reported'], ['acct-c', 'inactive', 'unavailable_plan']]); assertNoSecret(view);
    // GET /models réussi sur grok ne crée aucune preuve.
    const probe = await agents.preflight({ selection: grok, access, accountId: 'acct-a', fetchImpl: recorder({ 'GET /v1/models': catalog }).fetchImpl });
    assert.equal(probe.status, 'ok'); assert.equal((await accountOf('acct-a')).standardProof, undefined);
    assert.equal((await agents.launch({ ...base, mission: 'M3', ref: 'agents/M3', fetchImpl: silent.fetchImpl })).reason, 'standard_access_unproven');
    // Action explicite et humaine : mission bornée grok sur un compte imposé (coût réel) ; l’acceptation devient la preuve datée.
    const G = agents.missionAgentId(REPO, 'G1');
    const explicit = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => json({ agent: agentOf(G, RUN1), run: runOf(G, RUN1) }) });
    await assert.rejects(agents.launch({ ...base, mission: 'G1', ref: 'agents/G1', select: 'grok', account: 'bad id', fetchImpl: explicit.fetchImpl }), /compte invalide/);
    const forbidden = await agents.launch({ ...base, mission: 'G1', ref: 'agents/G1', select: 'grok', account: 'acct-c', fetchImpl: explicit.fetchImpl });
    assert.equal(forbidden.status, 'blocked'); assert.equal(forbidden.reason, 'account_pool_unavailable'); assert.equal(explicit.calls.length, 0);
    const proof = await agents.launch({ ...base, mission: 'G1', ref: 'agents/G1', select: 'grok', account: 'acct-a', fetchImpl: explicit.fetchImpl });
    assert.equal(proof.status, 'launched'); assert.equal(proof.account.id, 'acct-a'); assert.equal(proof.account.pool, 'standard'); assert.deepEqual(explicit.posts()[0].body.model, { id: 'grok-4.6', params: grok.params }); assert.deepEqual(explicit.keysUsed(), [KEY_A]);
    a = await accountOf('acct-a'); assert.deepEqual(a.standardProof, { at: T0, modelId: 'grok-4.6', kind: 'create_accepted', agentId: G }); assert.equal(a.modelPools.standard, 'probe_passed_balance_unknown'); assert.equal(a.status, 'inactive', 'toujours inactif pour la dépense premium');
    // Exception désormais possible : Fable demandée, Grok 4.6 sur acct-a, sélection initiale et courante distinctes, jamais Composer.
    const M3 = agents.missionAgentId(REPO, 'M3');
    const fallback = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => json({ agent: agentOf(M3, RUN1), run: runOf(M3, RUN1) }) });
    const exception = await agents.launch({ ...base, mission: 'M3', ref: 'agents/M3', fetchImpl: fallback.fetchImpl });
    assert.equal(exception.status, 'launched'); assert.equal(exception.account.id, 'acct-a'); assert.equal(exception.account.decision, 'exception'); assert.deepEqual(fallback.posts()[0].body.model, { id: 'grok-4.6', params: grok.params }); assert.deepEqual(fallback.keysUsed(), [KEY_A]);
    assert.deepEqual(exception.selection.requested, { modelId: 'claude-fable-5-1', params: fable.params }, 'sélection initiale rappelée telle quelle'); assert.deepEqual(exception.selection.currentSelection.requested, { modelId: 'grok-4.6', params: grok.params }); assert.equal(exception.selection.exception.reason, 'all_custom_accounts_confirmed_unavailable'); assert.equal(exception.selection.exception.proof.modelId, 'grok-4.6');
    registry = await agents.loadRegistry(registryFile);
    assert.equal(registry.missions.M3.selection.modelId, 'claude-fable-5-1'); assert.equal(registry.missions.M3.currentSelection.modelId, 'grok-4.6'); assert.equal(registry.missions.M3.accountId, 'acct-a'); assertNoSecret(registry);
    const modelIds = [...JSON.stringify(registry).matchAll(/"modelId":"([^"]+)"/g), ...JSON.stringify(await stateOf()).matchAll(/"modelId":"([^"]+)"/g)].map(m => m[1]);
    assert.ok(modelIds.length > 0 && modelIds.every(id => !/composer/i.test(id)), `jamais Composer : ${modelIds}`);
    const followGrok = recorder({ [`GET /v1/agents/${M3}`]: () => json(agentOf(M3, RUN1)), [`GET /v1/agents/${M3}/runs/${RUN1}`]: () => json(runOf(M3, RUN1, 'FINISHED')), [`POST /v1/agents/${M3}/runs`]: () => json({ run: runOf(M3, RUN2) }) });
    const continued = await agents.followup({ mission: 'M3', registryFile, promptText: 'suite', access, fetchImpl: followGrok.fetchImpl });
    assert.equal(continued.status, 'launched'); assert.deepEqual(Object.keys(followGrok.posts()[0].body), ['prompt'], 'aucun champ model à la reprise'); assert.equal(continued.selection.currentSelection.requested.modelId, 'grok-4.6'); assert.equal(continued.evidence.classification, 'accepted');
    assert.equal((await accountOf('acct-a')).standardProof.kind, 'run_accepted');
  });
});

test('successor: only after the predecessor is terminal, reconciled through its owner and checkpointed; new linked agent on the next premium account with the same selection; refused attempts retried deterministically', async () => {
  const config = await agents.loadSelections();
  await withTemp('lite-pool-successor-', async (temp) => {
    const { access, accountOf, registryFile } = await openVault(temp);
    const S1 = agents.missionAgentId(REPO, 'S1'), S1b = agents.missionAgentId(REPO, 'S1~s1'), S1c = agents.missionAgentId(REPO, 'S1~s2');
    const SHA = 'a'.repeat(40);
    const launched = await agents.launch({ mission: 'S1', repo: REPO, ref: 'agents/S1', promptText: 'brief', config, access, registryFile, now, fetchImpl: recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => json({ agent: agentOf(S1, RUN1), run: runOf(S1, RUN1) }) }).fetchImpl });
    assert.equal(launched.account.id, 'acct-a');
    const entryOf = async () => (await agents.loadRegistry(registryFile)).missions.S1;
    const base = { mission: 'S1', registryFile, promptText: `suite ${PROMPT_MARKER}`, checkpoint: SHA, config, access, now };
    await assert.rejects(agents.successor({ ...base, access: agents.envAccess(KEY_ENV) }), /exige le pool/);
    await assert.rejects(agents.successor({ ...base, checkpoint: 'abc' }), /--checkpoint/);
    await assert.rejects(agents.successor({ ...base, checkpoint: undefined }), /--checkpoint/);
    // Mission active : jamais interrompue.
    const active = recorder({ [`GET /v1/agents/${S1}`]: () => json(agentOf(S1, RUN1)), [`GET /v1/agents/${S1}/runs/${RUN1}`]: () => json(runOf(S1, RUN1, 'RUNNING')) });
    const running = await agents.successor({ ...base, fetchImpl: active.fetchImpl });
    assert.equal(running.status, 'blocked'); assert.equal(running.reason, 'run_active'); assert.equal(active.posts().length, 0); assert.deepEqual(active.keysUsed(), [KEY_A]);
    // Reprise incertaine du prédécesseur : successeur refusé sans appel jusqu’à reconcile.
    const lost = recorder({ [`GET /v1/agents/${S1}`]: () => json(agentOf(S1, RUN1)), [`GET /v1/agents/${S1}/runs/${RUN1}`]: () => json(runOf(S1, RUN1, 'FINISHED')), [`POST /v1/agents/${S1}/runs`]: () => { throw new TypeError('socket hang up'); } });
    assert.equal((await agents.followup({ mission: 'S1', registryFile, promptText: 'x', access, fetchImpl: lost.fetchImpl })).status, 'uncertain');
    const silent = recorder({});
    const unresolved = await agents.successor({ ...base, fetchImpl: silent.fetchImpl });
    assert.equal(unresolved.status, 'blocked'); assert.equal(unresolved.reason, 'followup_unresolved'); assert.equal(silent.calls.length, 0);
    // Le POST perdu avait en fait été accepté (RUN2) : reconcile l’attribue, puis ce run doit être terminal.
    const accepted = recorder({ [`GET /v1/agents/${S1}`]: () => json(agentOf(S1, RUN2)) });
    assert.deepEqual((await agents.reconcile({ mission: 'S1', registryFile, access, fetchImpl: accepted.fetchImpl })).followup, { state: 'accepted', priorRunId: RUN1, runId: RUN2 });
    // acct-a épuisé (usage inclus) pendant RUN2 : le propriétaire inactif reste celui qui lit l’agent ; un autre compte ne le verrait pas (404).
    await access.pool.record('acct-a', access.pool.classify({ callKind: 'run', modelId: 'claude-fable-5-1', result: { outcome: 'unavailable', status: 429, reason: 'quota', providerCode: 'rate_limit_exceeded', providerMessage: INCLUDED } }));
    assert.equal((await accountOf('acct-a')).status, 'inactive');
    const owner = recorder({ [`GET /v1/agents/${S1}`]: r => (r.key === KEY_A ? json(agentOf(S1, RUN2, 'IDLE')) : providerError(404, 'not_found', MESSAGE_MARKER)), [`GET /v1/agents/${S1}/runs/${RUN2}`]: r => (r.key === KEY_A ? json(runOf(S1, RUN2, 'ERROR')) : providerError(404, 'not_found', '')), 'GET /v1/models': catalog, 'POST /v1/agents': r => { assert.equal(r.key, KEY_B); assert.equal(r.body.agentId, S1b); return json({ agent: agentOf(S1b, RUN1), run: runOf(S1b, RUN1) }); } });
    const succeeded = await agents.successor({ ...base, name: 'S1 successeur', fetchImpl: owner.fetchImpl });
    assert.equal(succeeded.status, 'launched'); assert.equal(succeeded.agentId, S1b); assert.equal(succeeded.account.id, 'acct-b'); assert.equal(succeeded.attempt, 1);
    assert.deepEqual(succeeded.predecessor, { agentId: S1, accountId: 'acct-a', runId: RUN2, runStatus: 'ERROR', checkpoint: SHA });
    assert.deepEqual(owner.calls.map(c => `${c.method} ${c.path.replace(S1b, 'NEW').replace(S1, 'OLD')} ${c.key === KEY_A ? 'A' : 'B'}`), ['GET /v1/agents/OLD A', `GET /v1/agents/OLD/runs/${RUN2} A`, 'GET /v1/models B', 'POST /v1/agents B'], 'prédécesseur lu par son propriétaire, création par le successeur');
    const post = owner.posts()[0].body;
    assert.deepEqual(post.model, { id: 'claude-fable-5-1', params: fable.params }, 'même sélection et mêmes paramètres sur l’autre compte'); assert.deepEqual(post.repos, [{ url: REPO, startingRef: 'agents/S1' }]); assert.equal(post.prompt.text, `suite ${PROMPT_MARKER}`); assert.equal(post.name, 'S1 successeur');
    assert.equal(succeeded.selection.requested.modelId, 'claude-fable-5-1'); assert.equal(succeeded.selection.currentSelection, undefined); assertNoSecret(succeeded);
    let entry = await entryOf();
    assert.equal(entry.agentId, S1b); assert.equal(entry.accountId, 'acct-b'); assert.equal(entry.state, 'launched'); assert.equal(entry.runId, RUN1); assert.equal(entry.successorOf, S1); assert.equal(entry.successorAttempts, 1); assert.equal(entry.followup, undefined);
    assert.equal(entry.predecessors.length, 1); assert.deepEqual({ ...entry.predecessors[0], endedAt: undefined }, { agentId: S1, accountId: 'acct-a', runId: RUN2, runStatus: 'ERROR', url: `https://cursor.com/agents/${S1}`, checkpoint: { sha: SHA, ref: 'agents/S1', providedBy: 'orchestrator' }, followups: 1, endedAt: undefined });
    assert.equal(entry.selection.modelId, 'claude-fable-5-1'); assertNoSecret(entry);
    // La mission continue sur le successeur avec la clé de son propriétaire.
    const next = recorder({ [`GET /v1/agents/${S1b}/runs/${RUN1}`]: r => { assert.equal(r.key, KEY_B); return json(runOf(S1b, RUN1, 'RUNNING')); } });
    assert.equal((await agents.status({ mission: 'S1', registryFile, access, fetchImpl: next.fetchImpl })).account.id, 'acct-b');
    // Second successeur : acct-b épuisé, POST perdu et agent introuvable ⇒ not_created ; nouvelle tentative avec le même checkpoint et un identifiant distinct ; autre checkpoint refusé.
    await access.pool.record('acct-b', access.pool.classify({ callKind: 'run', modelId: 'claude-fable-5-1', result: { outcome: 'unavailable', status: 429, reason: 'quota', providerCode: 'rate_limit_exceeded', providerMessage: INCLUDED } }));
    const SHA2 = 'b'.repeat(40);
    const lostPost = recorder({ [`GET /v1/agents/${S1b}`]: () => json(agentOf(S1b, RUN1, 'IDLE')), [`GET /v1/agents/${S1b}/runs/${RUN1}`]: () => json(runOf(S1b, RUN1, 'FINISHED')), 'GET /v1/models': catalog, 'POST /v1/agents': () => { throw new TypeError('socket hang up'); }, [`GET /v1/agents/${S1c}`]: () => providerError(404, 'not_found', '') });
    const notCreated = await agents.successor({ ...base, checkpoint: SHA2, fetchImpl: lostPost.fetchImpl });
    assert.equal(notCreated.status, 'unavailable'); assert.equal(notCreated.state, 'not_created'); assert.equal(notCreated.account.id, 'acct-c'); assert.equal(notCreated.attempt, 2); assert.equal(lostPost.posts()[0].body.agentId, S1c);
    entry = await entryOf(); assert.equal(entry.state, 'not_created'); assert.equal(entry.predecessors.length, 2); assert.equal(entry.predecessors[1].agentId, S1b); assert.equal(entry.predecessors[1].checkpoint.sha, SHA2);
    await assert.rejects(agents.successor({ ...base, checkpoint: SHA, fetchImpl: silent.fetchImpl }), /Checkpoint différent/);
    const S1d = agents.missionAgentId(REPO, 'S1~s3');
    const retry = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': r => json({ agent: agentOf(r.body.agentId, RUN1), run: runOf(r.body.agentId, RUN1) }) });
    const retried = await agents.successor({ ...base, checkpoint: SHA2, fetchImpl: retry.fetchImpl });
    assert.equal(retried.status, 'launched'); assert.equal(retried.agentId, S1d); assert.equal(retried.attempt, 3); assert.equal(retried.account.id, 'acct-c'); assert.deepEqual(retry.keysUsed(), [KEY_C]);
    assert.deepEqual(retry.calls.map(c => `${c.method} ${c.path}`), ['GET /v1/models', 'POST /v1/agents'], 'prédécesseur déjà vérifié : aucune relecture');
    entry = await entryOf(); assert.equal(entry.predecessors.length, 2, 'aucun prédécesseur dupliqué'); assert.equal(entry.successorAttempts, 3); assert.equal(entry.state, 'launched');
    // Tous les comptes premium épuisés et aucune preuve standard : successeur refusé honnêtement, aucun POST.
    await access.pool.record('acct-c', access.pool.classify({ callKind: 'run', modelId: 'claude-fable-5-1', result: { outcome: 'unavailable', status: 429, reason: 'quota', providerCode: 'rate_limit_exceeded', providerMessage: INCLUDED } }));
    const done = recorder({ [`GET /v1/agents/${S1d}`]: () => json(agentOf(S1d, RUN1, 'IDLE')), [`GET /v1/agents/${S1d}/runs/${RUN1}`]: () => json(runOf(S1d, RUN1, 'FINISHED')) });
    const stuck = await agents.successor({ ...base, checkpoint: 'c'.repeat(40), fetchImpl: done.fetchImpl });
    assert.equal(stuck.status, 'blocked'); assert.equal(stuck.reason, 'standard_access_unproven'); assert.equal(done.posts().length, 0); assert.deepEqual(done.keysUsed(), [KEY_C]);
    assert.equal((await entryOf()).agentId, S1d, 'entrée inchangée');
    // Entrée héritée sans compte propriétaire (lancée avec CURSOR_API_KEY) : aucun successeur, aucun appel cross-compte.
    const legacy = await agents.loadRegistry(registryFile); legacy.missions.L1 = { agentId: agents.missionAgentId(REPO, 'L1'), repo: REPO, ref: 'agents/L1', selection: fable, state: 'launched', runId: RUN1, updatedAt: T0 }; await agents.saveRegistry(registryFile, legacy);
    const noOwner = await agents.successor({ ...base, mission: 'L1', fetchImpl: silent.fetchImpl });
    assert.equal(noOwner.status, 'blocked'); assert.equal(noOwner.reason, 'owner_unknown'); assert.equal(silent.calls.length, 0);
    await assert.rejects(agents.status({ mission: 'L1', registryFile, access, fetchImpl: silent.fetchImpl }), /propriétaire inconnu/);
  });
});

test('reconcile keeps an open followup uncertain when the agent has no latest run, and settles an orphan pending launch without any POST', async () => {
  const config = await agents.loadSelections();
  await withTemp('lite-pool-reconcile-', async (temp) => {
    const registryFile = join(temp, 'registry.json');
    const O1 = agents.missionAgentId(REPO, 'O1');
    const key = KEY_ENV;
    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: { O1: { agentId: O1, repo: REPO, ref: 'agents/O1', selection: fable, state: 'launched', runId: RUN1, followup: { state: 'uncertain', priorRunId: RUN1, reason: 'network' }, updatedAt: T0 } } });
    const noLatest = recorder({ [`GET /v1/agents/${O1}`]: () => json({ id: O1, status: 'IDLE', url: `https://cursor.com/agents/${O1}` }) });
    const report = await agents.reconcile({ mission: 'O1', key, registryFile, fetchImpl: noLatest.fetchImpl });
    assert.equal(report.status, 'reconciled'); assert.deepEqual(report.followup, { state: 'uncertain', priorRunId: RUN1, reason: 'latest_run_unknown' }); assert.match(report.nextAction, /toujours incertaine/); assert.match(report.nextAction, /aucune réémission/);
    let entry = (await agents.loadRegistry(registryFile)).missions.O1;
    assert.equal(entry.followup.state, 'uncertain'); assert.equal(entry.runId, RUN1, 'aucun succès prétendu');
    const silent = recorder({});
    const refused = await agents.followup({ mission: 'O1', registryFile, promptText: 'x', key, fetchImpl: silent.fetchImpl });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.reason, 'followup_unresolved'); assert.equal(silent.calls.length, 0);
    // pending orphelin : lancement interrompu avant enregistrement ; reconcile lit l’agent, jamais un POST.
    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: { O1: { agentId: O1, repo: REPO, ref: 'agents/O1', selection: fable, state: 'pending', updatedAt: T0 } } });
    const dedup = await agents.launch({ mission: 'O1', repo: REPO, ref: 'agents/O1', promptText: 'x', config, key, registryFile, fetchImpl: silent.fetchImpl });
    assert.equal(dedup.status, 'deduplicated'); assert.equal(dedup.nextAction, 'reconcile'); assert.equal(silent.calls.length, 0);
    const exists = recorder({ [`GET /v1/agents/${O1}`]: () => json(agentOf(O1, RUN1)) });
    const found = await agents.reconcile({ mission: 'O1', key, registryFile, fetchImpl: exists.fetchImpl });
    assert.equal(found.status, 'reconciled'); assert.equal(found.agent.latestRunId, RUN1); assert.equal(exists.posts().length, 0);
    entry = (await agents.loadRegistry(registryFile)).missions.O1; assert.equal(entry.state, 'reconciled'); assert.equal(entry.runId, RUN1);
    await agents.saveRegistry(registryFile, { formatVersion: 1, missions: { O1: { agentId: O1, repo: REPO, ref: 'agents/O1', selection: fable, state: 'pending', updatedAt: T0 } } });
    const gone = recorder({ [`GET /v1/agents/${O1}`]: () => providerError(404, 'not_found', '') });
    const absent = await agents.reconcile({ mission: 'O1', key, registryFile, fetchImpl: gone.fetchImpl });
    assert.equal(absent.status, 'not_created'); assert.match(absent.nextAction, /launch autorisé/); assert.equal(gone.posts().length, 0);
  });
});

test('hard limit on a followup blocks new starts for the owner until explicit --account validation; active runs and GETs are untouched; acceptance lifts the block', async () => {
  const config = await agents.loadSelections();
  await withTemp('lite-pool-startblock-', async (temp) => {
    const { access, accountOf, registryFile } = await openVault(temp, ['acct-a', 'acct-b']);
    const M1 = agents.missionAgentId(REPO, 'M1');
    const base = { repo: REPO, ref: 'agents/M1', promptText: 'brief', config, access, registryFile, now };
    const start = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => json({ agent: agentOf(M1, RUN1), run: runOf(M1, RUN1) }) });
    assert.equal((await agents.launch({ ...base, mission: 'M1', fetchImpl: start.fetchImpl })).account.id, 'acct-a');
    // Run actif : le plafond n’interrompt rien ; le refus survient sur une reprise après terminal.
    const capped = recorder({ [`GET /v1/agents/${M1}`]: () => json(agentOf(M1, RUN1)), [`GET /v1/agents/${M1}/runs/${RUN1}`]: () => json(runOf(M1, RUN1, 'FINISHED')), [`POST /v1/agents/${M1}/runs`]: () => providerError(400, 'usage_limit_exceeded', HARD_LIMIT) });
    const refused = await agents.followup({ mission: 'M1', registryFile, promptText: 'suite', access, fetchImpl: capped.fetchImpl });
    assert.equal(refused.status, 'blocked'); assert.equal(refused.reason, 'rejected'); assert.equal(refused.httpStatus, 400); assert.equal(refused.evidence.classification, 'hard_limit_start_refused'); assert.match(refused.nextAction, /--account acct-a/); assertNoSecret(refused);
    let a = await accountOf('acct-a'); assert.equal(a.startBlock.callKind, 'run'); assert.equal(a.status, 'active'); assert.equal(a.modelPools.custom, 'probe_passed_balance_unknown', 'aucun crédit marqué épuisé');
    assert.equal((await agents.loadRegistry(registryFile)).missions.M1.followup.state, 'rejected');
    // Lectures du propriétaire toujours possibles ; reprise implicite refusée avant tout POST ; successeur proposé.
    const reads = recorder({ [`GET /v1/agents/${M1}`]: () => json(agentOf(M1, RUN1)), [`GET /v1/agents/${M1}/runs/${RUN1}`]: () => json(runOf(M1, RUN1, 'FINISHED')), [`POST /v1/agents/${M1}/runs`]: () => json({ run: runOf(M1, RUN2) }) });
    const seen = await agents.status({ mission: 'M1', registryFile, access, fetchImpl: reads.fetchImpl }); assert.equal(seen.status, 'ok'); assert.equal(seen.account.id, 'acct-a');
    const gated = await agents.followup({ mission: 'M1', registryFile, promptText: 'suite', access, fetchImpl: reads.fetchImpl });
    assert.equal(gated.status, 'blocked'); assert.equal(gated.reason, 'owner_start_blocked'); assert.equal(gated.startBlock.reason, 'hard_limit_start_refused'); assert.match(gated.nextAction, /followup --mission … --account acct-a/); assert.match(gated.nextAction, /successor --mission/); assert.equal(reads.posts().length, 0, 'aucun POST');
    // Nouveau lancement automatique : acct-a sauté, acct-b choisi avec la même sélection.
    const other = recorder({ 'GET /v1/models': catalog, 'POST /v1/agents': () => json({ agent: agentOf(agents.missionAgentId(REPO, 'M2'), RUN1), run: runOf(agents.missionAgentId(REPO, 'M2'), RUN1) }) });
    const next = await agents.launch({ ...base, mission: 'M2', ref: 'agents/M2', fetchImpl: other.fetchImpl }); assert.equal(next.account.id, 'acct-b'); assert.deepEqual(other.keysUsed(), [KEY_B]);
    // Validation explicite après relèvement manuel du plafond : le run accepté lève le blocage et n’efface rien d’autre.
    const validated = await agents.followup({ mission: 'M1', account: 'acct-a', registryFile, promptText: 'suite', access, fetchImpl: reads.fetchImpl });
    assert.equal(validated.status, 'launched'); assert.equal(validated.runId, RUN2); assert.equal(reads.posts().length, 1); assert.deepEqual(reads.keysUsed(), [KEY_A]);
    a = await accountOf('acct-a'); assert.equal(a.startBlock, null); assert.equal(a.startBlockClearedAt, T0); assert.equal(a.lastRefusalAt, T0); assert.equal(a.modelPools.custom, 'probe_passed_balance_unknown');
    assert.equal((await agents.accounts({ config, access })).decision.accountId, 'acct-a', 'compte de nouveau éligible en tête de l’ordre');
  });
});

test('distributed copy: the adapter sits beside cursor-agents.mjs inside the skill folder and works outside the kit checkout', async () => {
  const { cp } = await import('node:fs/promises');
  await withTemp('lite-pool-standalone-', async (temp) => {
    const app = join(temp, 'app'); await cp(skillDir, join(app, '.cursor/skills/lite-orchestration'), { recursive: true });
    assert.equal((await readFile(join(app, '.cursor/skills/lite-orchestration/scripts/cursor-account-pool.mjs'), 'utf8')).length > 0, true);
    const { env } = await openVault(temp, ['acct-a', 'acct-b']);
    const script = join(app, '.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs');
    const run = (args, extraEnv = {}) => new Promise(resolvePromise => { const child = spawn(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, ...env, ...extraEnv } }); let out = '', err = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; }); child.on('close', code => resolvePromise({ code, out, err })); });
    const view = await run(['accounts']);
    assert.equal(view.code, 0, view.err); const report = JSON.parse(view.out.trim().split('\n').at(-1)); assert.equal(report.mode, 'pool'); assert.deepEqual(report.order, ['acct-a', 'acct-b']); assert.equal(report.decision.accountId, 'acct-a'); assertNoSecret(view.out);
    const standalone = await import(join(app, '.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs'));
    assert.equal(standalone.accountPoolModule.href.endsWith('/.cursor/skills/lite-orchestration/scripts/cursor-account-pool.mjs'), true); assert.notEqual(standalone.accountPoolModule.href, agents.accountPoolModule.href);
    const adapter = await standalone.loadAccountAdapter({}); assert.equal(typeof adapter.openAccountPool, 'function'); assert.notEqual(adapter, pool, 'copie distribuée chargée, pas celle du kit');
    // Copie sans adaptateur (application non encore mise à jour) : mode env intact, pool refusé explicitement, aucun appel.
    const app2 = join(temp, 'app2'); await cp(skillDir, join(app2, '.cursor/skills/lite-orchestration'), { recursive: true });
    await rm(join(app2, '.cursor/skills/lite-orchestration/scripts/cursor-account-pool.mjs'));
    const bare = await import(join(app2, '.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs'));
    assert.equal(await bare.loadAccountAdapter({}), null);
    await assert.rejects(bare.resolveAccess({ env }), /aucun coffre de comptes lisible/);
    assert.equal((await bare.resolveAccess({ env: { CURSOR_API_KEY: KEY_ENV } })).mode, 'env');
  });
});

test('CLI in pool mode: accounts view and preflight decision are JSON without secrets; exit codes map decisions', async () => {
  await withTemp('lite-pool-cli-', async (temp) => {
    const { env } = await openVault(temp, ['acct-a', 'acct-b']);
    const logs = []; const log = l => logs.push(l);
    const opts = { env, adapter: pool, decrypt: fakeDecrypt, log };
    assert.equal(await agents.main(['accounts'], { ...opts, fetchImpl: recorder({}).fetchImpl }), 0);
    let report = JSON.parse(logs.at(-1)); assert.equal(report.mode, 'pool'); assert.deepEqual(report.order, ['acct-a', 'acct-b']); assert.equal(report.decision.status, 'route'); assert.equal(report.decision.accountId, 'acct-a'); assert.equal(report.decision.accounts, undefined);
    assert.equal(await agents.main(['accounts', '--exclude', 'acct-a'], { ...opts, fetchImpl: recorder({}).fetchImpl }), 0);
    assert.equal(JSON.parse(logs.at(-1)).decision.accountId, 'acct-b');
    const models = recorder({ 'GET /v1/models': catalog });
    assert.equal(await agents.main(['preflight'], { ...opts, fetchImpl: models.fetchImpl }), 0);
    report = JSON.parse(logs.at(-1)); assert.equal(report.status, 'ok'); assert.equal(report.accountId, 'acct-a'); assert.deepEqual(models.keysUsed(), [KEY_A]);
    assert.equal(await agents.main(['preflight', '--account', 'acct-b'], { ...opts, fetchImpl: models.fetchImpl }), 0);
    assert.equal(JSON.parse(logs.at(-1)).accountId, 'acct-b'); assert.equal(models.calls.at(-1).key, KEY_B);
    assert.equal(await agents.main(['accounts'], { env: { CURSOR_API_KEY: KEY_ENV }, fetchImpl: recorder({}).fetchImpl, log }), 0);
    assert.equal(JSON.parse(logs.at(-1)).mode, 'env');
    await writeFile(join(temp, 'brief.txt'), 'suite');
    await assert.rejects(agents.main(['successor', '--mission', 'X', '--registry', join(temp, 'r.json'), '--prompt-file', join(temp, 'brief.txt')], { ...opts }), /--checkpoint/);
    await assert.rejects(agents.main(['launch', '--mission', 'X', '--repo', REPO, '--ref', 'agents/X', '--registry', join(temp, 'r.json'), '--prompt-file', join(temp, 'brief.txt'), '--account', 'acct-a'], { env: { CURSOR_API_KEY: KEY_ENV }, fetchImpl: recorder({}).fetchImpl, log }), /--account exige le pool/);
    for (const line of logs) { JSON.parse(line); assertNoSecret(line); }
  });
});
