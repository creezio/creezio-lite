import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp, upgrade } from '../bin/lite.mjs';
import { DatabaseSync } from 'node:sqlite';
import { root, migrationSql } from './helpers.mjs';
import { createD1ClaimStore, sanitizeClaimSnapshot } from '../runtime/core/public-ingress-claims.ts';

const TENANT_A = 'ws_' + 'a'.repeat(32);
const TENANT_B = 'ws_' + 'b'.repeat(32);
const PRIOR_SQL = Object.freeze({
  '0000_new_jane_foster.sql': 'cd3de741a34292dce7f4e3ce28c87950cceecebb6c357c1df9b8a4f6b7e655a3',
  '0001_strange_praxagora.sql': 'f85703e2def09c6dbb36803ed1c10f297011b05eca49f366fc184ebf76a325be',
  '0002_search_registry.sql': '01b09bc581fea78c0157e2d84ab13a36de4e049497929e33c4783163c52090d6',
  '0003_search_index.sql': '638ffacae0f4e9665ad0ded65c4f31cfad5f1ef7f15229ccc4d5124ce33f1b88',
  '0004_api_access.sql': '342a6cbba232ebed5788a56e52179715172f097527008def87da397443558172',
  '0005_admin_operations.sql': '227711bd31c0581f99fa1d52e7bb71b9fc900e80e4092c5303ba587e4341d4f2',
  '0006_assistant_integrations.sql': '59042b242c008804f830206f5a441a13fd790437d6cb28bdc0a1a355f51d1e69',
  '0007_mail_native.sql': '95943221ad21bf1b98dc7a88430d588ea4f170567d7e018c9ca666c602fda91a',
  '0008_assistant_ui_cursor.sql': '3b0dee9016b0af7b0949730fe04284bc779706703f19f4a5d5b865f4c1fe70a8',
  '0009_mcp_oauth.sql': '72ededa4a9da2d3caa1b39b7f197caf0a9462cc458f32219c81dce64d883b31a',
  '0010_browser_relay.sql': 'c6a9a2672f415eb366166e96f6f9215d587cdc4af52f4b5f5faf6a686c2d53eb',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function migrationBytes(bytes) {
  return Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
}
function digest(text) {
  return new Uint8Array(createHash('sha256').update(text).digest());
}
function key(over = {}) {
  return { tenantId: TENANT_A, entryId: 'signed.webhook', eventId: 'evt_1', ...over };
}
async function seedOrg(db, id) {
  await db.prepare('INSERT INTO lite_orgs(id,name,created_at) VALUES(?,?,?)').bind(id, id, '2026-09-17T00:00:00.000Z').run();
}
async function claimSqlite() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE lite_orgs(id text PRIMARY KEY NOT NULL, name text NOT NULL, created_at text NOT NULL);');
  db.exec(await readFile(join(root, 'template/drizzle/0011_public_ingress_claims.sql'), 'utf8'));
  function prepared(sql, values = []) {
    return {
      bind(...args) { return prepared(sql, args); },
      async first(column) {
        const row = db.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      async all() { return { results: db.prepare(sql).all(...values), success: true }; },
      runSync() {
        const statement = db.prepare(sql);
        if (/^\s*SELECT\b/i.test(sql)) return { success: true, results: statement.all(...values), meta: { changes: 0 } };
        const result = statement.run(...values);
        return { success: true, results: [], meta: { changes: Number(result.changes) } };
      },
      async run() { return this.runSync(); },
    };
  }
  return {
    prepare: sql => prepared(sql),
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(s.runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    close: () => db.close(),
    raw: db,
  };
}
function clockStore(db, over = {}) {
  let now = 1_700_000_000_000;
  const store = createD1ClaimStore(db, {
    leaseTtlMs: 1_000,
    maxAttempts: 2,
    snapshotMaxBytes: 2_048,
    nowMs: () => now,
    ...over,
  });
  return { store, setNow(ms) { now = ms; }, advance(ms) { now += ms; }, now: () => now };
}

test('0000-0010 SQL matches the published baseline including the authorized 0003 whitespace fix; 0011 is additive claims-only', async () => {
  for (const [name, want] of Object.entries(PRIOR_SQL)) {
    const got = sha256(migrationBytes(await readFile(join(root, 'template/drizzle', name))));
    assert.equal(got, want, name);
  }
  const sql = await readFile(join(root, 'template/drizzle/0011_public_ingress_claims.sql'), 'utf8');
  assert.equal(/ALTER TABLE/i.test(sql), false);
  assert.match(sql, /CREATE TABLE `lite_public_ingress_claims`/);
  assert.equal(/guest|payer|token_hash|request_body|raw_body/i.test(sql), false);
  const journal = JSON.parse(await readFile(join(root, 'template/drizzle/meta/_journal.json'), 'utf8'));
  assert.equal(journal.entries[10].tag, '0010_browser_relay');
  assert.equal(journal.entries[11].tag, '0011_public_ingress_claims');
  assert.equal(journal.entries.length, 14);
});

test('node:sqlite : acquire, busy, complete, replay snapshot stable, no secrets', async () => {
  const db = await claimSqlite();
  try {
    await seedOrg(db, TENANT_A);
    const { store } = clockStore(db);
    const payload = digest('{"ok":true}');
    const first = await store.claim(key(), payload);
    assert.equal(first.kind, 'acquired');
    assert.equal(first.fence.generation, 1);
    assert.equal(typeof first.fence.token, 'string');
    const busy = await store.claim(key(), payload);
    assert.equal(busy.kind, 'busy');
    assert.equal(await store.complete(first.fence, { ok: true, status: 200, body: { token: 'secret' } }), false);
    assert.equal(await store.complete(first.fence, { ok: false, status: 422, body: { error: { code: 'nope' } } }), false);
    const snapshot = { ok: true, status: 201, body: { accepted: true, count: 2 } };
    assert.equal(await store.complete(first.fence, snapshot), true);
    const replay = await store.claim(key(), payload);
    assert.equal(replay.kind, 'completed');
    assert.deepEqual(replay.snapshot, snapshot);
    const replay2 = await store.claim(key(), payload);
    assert.deepEqual(replay2.snapshot, replay.snapshot);
    assert.equal(await store.complete(first.fence, snapshot), false);
    const cols = db.raw.prepare('PRAGMA table_info(lite_public_ingress_claims)').all().map(c => c.name);
    assert.deepEqual(cols, ['tenant_id', 'entry_id', 'event_id', 'digest_hex', 'state', 'generation', 'token', 'attempts', 'lease_until', 'snapshot_json', 'created_at', 'updated_at']);
    assert.equal(cols.includes('guest_token'), false);
  } finally { db.close(); }
});

test('node:sqlite : digest collision, tenant isolation, retry, permanent, exhausted', async () => {
  const db = await claimSqlite();
  try {
    await seedOrg(db, TENANT_A);
    await seedOrg(db, TENANT_B);
    const { store, advance } = clockStore(db, { maxAttempts: 2 });
    const a = digest('payload-a');
    const other = digest('payload-b');
    const acquired = await store.claim(key(), a);
    assert.equal(acquired.kind, 'acquired');
    const isolated = await store.claim(key({ tenantId: TENANT_B }), a);
    assert.equal(isolated.kind, 'acquired');
    assert.equal(await store.complete(isolated.fence, { ok: true, status: 200, body: { tenant: 'b' } }), true);

    const collision = await store.claim(key(), other);
    assert.equal(collision.kind, 'digest_collision');
    assert.equal(await store.retry(acquired.fence), true);
    assert.equal(await store.complete(acquired.fence, { ok: true, status: 200, body: { late: true } }), false);

    const second = await store.claim(key(), a);
    assert.equal(second.kind, 'acquired');
    assert.equal(second.fence.generation, 2);
    assert.notEqual(second.fence.token, acquired.fence.token);
    assert.equal(await store.retry(second.fence), true);
    const exhausted = await store.claim(key(), a);
    assert.equal(exhausted.kind, 'attempts_exhausted');

    const permaKey = key({ eventId: 'evt_perm' });
    const held = await store.claim(permaKey, a);
    const failSnap = { ok: false, status: 422, body: { error: { code: 'rejected' } } };
    assert.equal(await store.failPermanent(held.fence, failSnap), true);
    const again = await store.claim(permaKey, a);
    assert.equal(again.kind, 'permanent_failure');
    assert.deepEqual(again.snapshot, failSnap);
    assert.equal(await store.complete(held.fence, { ok: true, status: 200, body: { promoted: true } }), false);

    advance(5_000);
    assert.equal(await store.complete(held.fence, { ok: true, status: 200, body: { stale: true } }), false);
  } finally { db.close(); }
});

test('node:sqlite : stale takeover generation+1 ; ancien fence refuse complete/retry/fail/renew', async () => {
  const db = await claimSqlite();
  try {
    await seedOrg(db, TENANT_A);
    const { store, setNow, now } = clockStore(db, { leaseTtlMs: 1_000, maxAttempts: 8 });
    const payload = digest('stale');
    const first = await store.claim(key({ eventId: 'evt_stale' }), payload);
    assert.equal(first.kind, 'acquired');
    assert.equal(first.fence.generation, 1);
    const start = now();
    setNow(start + 1_001);
    assert.equal(await store.complete(first.fence, { ok: true, status: 200, body: { tooLate: true } }), false);
    assert.equal(await store.retry(first.fence), false);
    assert.equal(await store.failPermanent(first.fence), false);
    assert.equal(await store.renew(first.fence), false);
    const second = await store.claim(key({ eventId: 'evt_stale' }), payload);
    assert.equal(second.kind, 'acquired');
    assert.equal(second.fence.generation, 2);
    assert.notEqual(second.fence.token, first.fence.token);
    assert.equal(await store.complete(first.fence, { ok: true, status: 200, body: { oldFence: true } }), false);
    assert.equal(await store.renew(second.fence), true);
    setNow(now() + 500);
    assert.equal(await store.complete(second.fence, { ok: true, status: 202, body: { ok: true } }), true);
    const replay = await store.claim(key({ eventId: 'evt_stale' }), payload);
    assert.equal(replay.kind, 'completed');
    assert.equal(replay.snapshot.status, 202);
  } finally { db.close(); }
});

test('snapshotMaxBytes compte les octets UTF-8 : accent/emoji refusés sans muter l’état', async () => {
  const db = await claimSqlite();
  try {
    await seedOrg(db, TENANT_A);
    const utf8 = (text) => new TextEncoder().encode(text).byteLength;
    const overSnap = { ok: true, status: 200, body: { note: `${'é'.repeat(8)}😀` } };
    const overJson = JSON.stringify(overSnap);
    const maxBytes = overJson.length;
    assert.ok(overJson.length <= maxBytes, 'avant : json.length tiendrait dans le plafond');
    assert.ok(utf8(overJson) > maxBytes, 'après : les octets UTF-8 dépassent le plafond');

    const { store } = clockStore(db, { snapshotMaxBytes: maxBytes, maxAttempts: 8 });
    const payload = digest('utf8-bound');
    const claimed = key({ eventId: 'evt_utf8' });
    const held = await store.claim(claimed, payload);
    assert.equal(held.kind, 'acquired');
    assert.equal(await store.failPermanent(held.fence, { ok: false, status: 422, body: { note: overSnap.body.note } }), false);
    assert.equal(await store.complete(held.fence, overSnap), false);
    const frozen = db.raw.prepare('SELECT state, snapshot_json FROM lite_public_ingress_claims WHERE tenant_id=? AND entry_id=? AND event_id=?')
      .get(claimed.tenantId, claimed.entryId, claimed.eventId);
    assert.equal(frozen.state, 'processing');
    assert.equal(frozen.snapshot_json, null);
    assert.equal((await store.claim(claimed, payload)).kind, 'busy');

    let underNote = 'é';
    while (utf8(JSON.stringify({ ok: true, status: 200, body: { note: underNote + 'a' } })) <= maxBytes) underNote += 'a';
    const underSnap = { ok: true, status: 200, body: { note: underNote } };
    const underJson = JSON.stringify(underSnap);
    assert.ok(utf8(underJson) <= maxBytes);
    assert.ok(utf8(JSON.stringify({ ok: true, status: 200, body: { note: underNote + 'a' } })) > maxBytes);
    assert.equal(await store.complete(held.fence, underSnap), true);
    const replay = await store.claim(claimed, payload);
    assert.equal(replay.kind, 'completed');
    assert.deepEqual(replay.snapshot, underSnap);
  } finally { db.close(); }
});

test('sanitizeClaimSnapshot refuse secrets, cookies et corps de requête', () => {
  assert.equal(sanitizeClaimSnapshot({ ok: true, status: 200, body: { token: 'abc' } }), undefined);
  assert.equal(sanitizeClaimSnapshot({ ok: true, status: 200, body: { Authorization: 'Bearer x' } }), undefined);
  assert.equal(sanitizeClaimSnapshot({ ok: true, status: 200, body: { rawBytes: 'payload' } }), undefined);
  assert.equal(sanitizeClaimSnapshot({ ok: true, status: 200, body: { cookie: 'sid' } }), undefined);
  assert.deepEqual(sanitizeClaimSnapshot({ ok: true, status: 200, body: { accepted: true } }), { ok: true, status: 200, body: { accepted: true } });
  assert.equal(sanitizeClaimSnapshot({ ok: true, status: 500, body: {} }), undefined);
});

test('upgrade refuse un schemaHash différent : fusion applicative requise, garde intacte', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'lite-claim-upgrade-'));
  try {
    const out = join(temp, 'app');
    await createApp({ out, spec: join(root, 'examples/services.json') });
    const lockPath = join(out, 'lite.lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.schemaHash = '0'.repeat(64);
    await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
    await assert.rejects(() => upgrade(out), /migration applicative explicite requise avant upgrade/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('Miniflare D1 : concurrence, collision, stale complete, replay', async () => {
  const templateRequire = createRequire(join(root, 'template/package.json'));
  const wranglerRequire = createRequire(templateRequire.resolve('wrangler/package.json'));
  const { Miniflare } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch(){return new Response("ok")} }',
    compatibilityDate: '2026-05-15',
    d1Databases: ['DB'],
    cf: false,
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const sql of (await migrationSql()).split('--> statement-breakpoint').map(x => x.trim()).filter(Boolean)) {
      await db.prepare(sql).run();
    }
    await seedOrg(db, TENANT_A);
    let now = 1_700_000_000_000;
    const store = createD1ClaimStore(db, { leaseTtlMs: 1_000, maxAttempts: 4, nowMs: () => now });
    const payload = digest('d1-real');
    const claimed = key({ eventId: 'evt_d1' });
    const [left, right] = await Promise.all([store.claim(claimed, payload), store.claim(claimed, payload)]);
    const kinds = [left.kind, right.kind].sort();
    assert.deepEqual(kinds, ['acquired', 'busy']);
    const won = left.kind === 'acquired' ? left : right;
    const collision = await store.claim(claimed, digest('other'));
    assert.equal(collision.kind, 'digest_collision');
    now += 1_001;
    const takeover = await store.claim(claimed, payload);
    assert.equal(takeover.kind, 'acquired');
    assert.equal(takeover.fence.generation, won.fence.generation + 1);
    assert.equal(await store.complete(won.fence, { ok: true, status: 200, body: { stale: true } }), false);
    assert.equal(await store.complete(takeover.fence, { ok: true, status: 200, body: { persisted: true } }), true);
    const replay = await store.claim(claimed, payload);
    assert.equal(replay.kind, 'completed');
    assert.deepEqual(replay.snapshot, { ok: true, status: 200, body: { persisted: true } });
  } finally {
    await mf.dispose();
  }
});
