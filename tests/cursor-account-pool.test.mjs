import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as pool from '../scripts/cursor-account-pool.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// Fixtures fictives : aucun vrai blob DPAPI, aucune vraie clé, identifiants génériques.
const BLOB_A = Buffer.from('FAKE_BLOB_A_NOT_A_SECRET_0123456789abcdef').toString('base64');
const BLOB_B = Buffer.from('FAKE_BLOB_B_NOT_A_SECRET_0123456789abcdef').toString('base64');
const KEY_A = 'FAKE_KEY_A_NOT_A_SECRET_0123456789';
const KEY_B = 'FAKE_KEY_B_NOT_A_SECRET_0123456789';
const MESSAGE_MARKER = 'PROVIDER_MESSAGE_MARKER@example.test';
const credentialsFixture = (accounts = [{ id: 'acct-a', secretDpapi: BLOB_A }, { id: 'acct-b', secretDpapi: BLOB_B }]) => ({ formatVersion: 1, encryption: 'windows-dpapi-current-user', createdAt: '2026-09-16T00:00:00.000Z', accounts });
const fakeDecrypt = async (blob) => { if (blob === BLOB_A) return KEY_A; if (blob === BLOB_B) return KEY_B; throw new Error('blob inconnu ' + blob); };
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
  const text = JSON.stringify(value) + (value instanceof Error ? `${value.message}\n${value.stack}` : '');
  for (const marker of [KEY_A, KEY_B, BLOB_A, BLOB_B, MESSAGE_MARKER, INCLUDED, PLAN, HARD_LIMIT]) assert.ok(!text.includes(marker), `fuite de « ${marker.slice(0, 24)}… » dans ${text.slice(0, 200)}`);
}

test('credentials: resolved from CURSOR_CREDENTIALS_FILE then LOCALAPPDATA, parsed strictly, decrypted on demand without leaking blobs or keys', async () => {
  assert.equal(pool.credentialsPath({}), null);
  assert.match(pool.credentialsPath({ LOCALAPPDATA: join('fake-local') }), /fake-local[\\/]Creezio[\\/]cursor[\\/]credentials\.json$/);
  assert.match(pool.credentialsPath({ LOCALAPPDATA: 'ignored', CURSOR_CREDENTIALS_FILE: join('explicit', 'c.json') }), /explicit[\\/]c\.json$/);
  const paths = pool.poolPaths(join('dir', 'credentials.json'));
  assert.match(paths.stateFile, /dir[\\/]pool-state\.json$/); assert.match(paths.lockFile, /dir[\\/]pool-state\.lock$/);

  const parsed = pool.parseCredentials(credentialsFixture());
  assert.deepEqual(parsed.accounts.map(a => a.id), ['acct-a', 'acct-b']); assert.equal(parsed.createdAt, '2026-09-16T00:00:00.000Z');
  for (const [raw, pattern] of [[{ formatVersion: 2 }, /formatVersion 1/], [{ ...credentialsFixture(), encryption: 'plain' }, /windows-dpapi-current-user/], [credentialsFixture([]), /1 à 32/], [credentialsFixture([{ id: 'bad id', secretDpapi: BLOB_A }]), /n°1/], [credentialsFixture([{ id: 'acct-a', secretDpapi: BLOB_A }, { id: 'acct-a', secretDpapi: BLOB_B }]), /dupliqué/], [credentialsFixture([{ id: 'acct-a', secretDpapi: 'not base64 !!' }]), /blob DPAPI/]]) {
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

test('dpapi decryptor: refused outside Windows; on Windows the blob travels by stdin and the secret by stdout, never by argv', async () => {
  await assert.rejects(pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'linux' }), error => error.code === 'dpapi_unavailable');
  const spawned = [];
  const fakeSpawn = (exitCode, output) => (command, args, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const written = []; child.stdin.on('data', chunk => written.push(chunk)); child.stdin.on('finish', () => { spawned.push({ command, args, options, stdin: Buffer.concat(written).toString('utf8') }); if (output) child.stdout.write(output); child.stdout.end(); setImmediate(() => child.emit('close', exitCode)); });
    return child;
  };
  const clear = await pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'win32', spawnImpl: fakeSpawn(0, KEY_A) });
  assert.equal(clear, KEY_A);
  assert.equal(spawned[0].command, 'powershell.exe'); assert.equal(spawned[0].stdin, BLOB_A); assert.ok(spawned[0].args.every(a => !a.includes(BLOB_A) && !a.includes(KEY_A)), 'aucun secret ni blob sur la ligne de commande');
  assert.deepEqual(spawned[0].options.stdio, ['pipe', 'pipe', 'pipe']); assert.match(spawned[0].args.join(' '), /ProtectedData\]::Unprotect/); assert.match(spawned[0].args.join(' '), /CurrentUser/);
  let failure; try { await pool.dpapiUnprotectCurrentUser(BLOB_A, { platform: 'win32', spawnImpl: fakeSpawn(1, '') }); } catch (error) { failure = error; }
  assert.equal(failure.code, 'decrypt_failed'); assertNoSecret(failure);
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
    const modulePath = join(root, 'scripts', 'cursor-account-pool.mjs');
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
  assert.deepEqual(state.accounts[1].modelPools, { custom: 'probe_passed_balance_unknown', standard: 'recheck_required' }, 'plafond de création : aucune inférence de solde'); assert.equal(state.accounts[1].status, 'active');
  pool.applyEvidence(state, 'acct-b', pool.classifyResult({ callKind: 'run', modelId: 'claude-fable-5-1', at, result: rejected(503, undefined, MESSAGE_MARKER) }));
  assert.deepEqual(state.accounts[1].modelPools, { custom: 'probe_passed_balance_unknown', standard: 'recheck_required' }); assert.equal(state.accounts[1].status, 'active');
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
  const inactiveProven = allConfirmed(); inactiveProven.accounts[0].standardProof = { at: '2026-09-16T11:00:00.000Z', modelId: 'grok-4.6', kind: 'create_accepted' };
  decision = route(inactiveProven); assert.equal(decision.status, 'exception'); assert.equal(decision.accountId, 'acct-a', 'compte inactif (épuisé custom) réutilisé pour standard avec preuve');
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
  const relaxed = allConfirmed(); relaxed.routingPolicy.requireStandardValidation = false;
  decision = route(relaxed); assert.equal(decision.status, 'exception'); assert.equal(decision.accountId, 'acct-a'); assert.equal(decision.proof, null);

  // Sélection standard explicite à l’attribution : route sur le pool standard (inactif réutilisable), sans exception ni preuve préalable.
  decision = pool.decide(allConfirmed(), { selection: grok, now });
  assert.equal(decision.status, 'route'); assert.equal(decision.pool, 'standard'); assert.equal(decision.accountId, 'acct-a'); assert.equal(decision.selection, 'initial');
  const noStandard = stateFixture([account('acct-a', { modelPools: { custom: 'probe_passed_balance_unknown', standard: 'exhaustion_reported' } })]);
  assert.equal(pool.decide(noStandard, { selection: grok, now }).reason, 'no_standard_account');
  assert.throws(() => pool.decide(base(), { selection: {} }), error => error.code === 'selection_invalid');
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
