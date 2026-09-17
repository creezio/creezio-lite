import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { coreOperations } from '../runtime/core/operations.ts';
import { defineApp } from '../runtime/core/validation.ts';
import {
  PublicIngressDeclarationError,
  admitPublicIngress,
  createPublicIngressAdmission,
  inboundMailRouteKey,
  isPublicTenantId,
  publicAdmissionKinds,
  publicCapabilityIds,
  publicIngressLimits,
  validatePublicIngressDeclaration,
} from '../runtime/core/public-ingress-engine.ts';
import * as engine from '../runtime/core/public-ingress-engine.ts';

const TENANT_A = 'ws_' + 'a'.repeat(32);
const TENANT_B = 'ws_' + 'b'.repeat(32);
const SOURCE = readFileSync(fileURLToPath(new URL('../runtime/core/public-ingress-engine.ts', import.meta.url)), 'utf8');
const SECRET = 'vault-secret-fixture-do-not-leak';
const MARKER = 'LEAK-COOKIE=abc; Authorization=Bearer leaked';
const app = defineApp({
  id: 'ingress-fixture',
  name: 'Ingress fixture',
  description: 'Catalogue privé pour collisions de routes',
  modules: [{ id: 'clients', name: 'Clients', singular: 'Client', description: 'Module', titleField: 'name', fields: [{ key: 'name', label: 'Nom', type: 'text', required: true }] }],
});
const operations = coreOperations(app);

function inertDb() {
  return { prepare() { throw new Error('db interdite dans ce lot'); } };
}
function inertEnv(db = inertDb()) {
  return { DB: db, LITE_INTEGRATION_SECRET: SECRET };
}
function digest(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}
function equalBytes(a, b) {
  return a.byteLength === b.byteLength && a.every((value, i) => value === b[i]);
}
function memoryClaimStore(log) {
  const rows = new Map();
  const keyOf = (key) => `${key.tenantId}\0${key.entryId}\0${key.eventId}`;
  const sameFence = (row, fence) => row && fence && fence.token === row.token && fence.generation === row.generation
    && fence.key.tenantId === row.key.tenantId && fence.key.entryId === row.key.entryId && fence.key.eventId === row.key.eventId;
  return {
    async claim(key, payloadDigest) {
      log.push({ op: 'claim', key: { ...key }, digest: payloadDigest });
      const id = keyOf(key);
      const row = rows.get(id);
      if (!row) {
        const fence = { key: { ...key }, generation: 1, token: randomUUID() };
        rows.set(id, { key: fence.key, digest: payloadDigest.slice(), state: 'processing', generation: 1, token: fence.token, snapshot: undefined });
        return { kind: 'acquired', fence };
      }
      if (!equalBytes(row.digest, payloadDigest)) return { kind: 'digest_collision' };
      if (row.state === 'completed') return { kind: 'completed', snapshot: row.snapshot };
      if (row.state === 'permanent_failure') return { kind: 'permanent_failure', snapshot: row.snapshot };
      if (row.state === 'processing') return { kind: 'busy' };
      const fence = { key: { ...row.key }, generation: row.generation + 1, token: randomUUID() };
      row.state = 'processing'; row.generation = fence.generation; row.token = fence.token;
      return { kind: 'acquired', fence };
    },
    async complete(fence, snapshot) {
      log.push({ op: 'complete', fence: { ...fence, key: { ...fence.key } }, snapshot });
      const row = rows.get(keyOf(fence.key));
      if (!sameFence(row, fence) || row.state !== 'processing') return false;
      row.state = 'completed'; row.snapshot = snapshot; return true;
    },
    async retry(fence) {
      log.push({ op: 'retry', fence: { ...fence, key: { ...fence.key } } });
      const row = rows.get(keyOf(fence.key));
      if (!sameFence(row, fence) || row.state !== 'processing') return false;
      row.state = 'retryable'; return true;
    },
    async failPermanent(fence, snapshot) {
      log.push({ op: 'failPermanent', fence: { ...fence, key: { ...fence.key } }, snapshot });
      const row = rows.get(keyOf(fence.key));
      if (!sameFence(row, fence) || row.state !== 'processing') return false;
      row.state = 'permanent_failure'; row.snapshot = snapshot; return true;
    },
    async renew(fence) {
      log.push({ op: 'renew', fence: { ...fence, key: { ...fence.key } } });
      const row = rows.get(keyOf(fence.key));
      return sameFence(row, fence) && row.state === 'processing';
    },
    rows,
  };
}

function signedEntry(over = {}) {
  return {
    id: 'signed.webhook',
    method: 'POST',
    path: '/api/v1/public/signed',
    admission: 'signed',
    tenantId: TENANT_A,
    maxBytes: 4096,
    contentTypes: ['application/json'],
    timeoutMs: 1000,
    vaultRef: { integrationId: 'int_signed' },
    abuse: { policy: 'signed-default', requires: [] },
    ...over,
  };
}
function guestEntry(over = {}) {
  return {
    id: 'guest.payer',
    method: 'GET',
    path: '/api/v1/payer/:token',
    admission: 'guest',
    tenantId: TENANT_A,
    maxBytes: 0,
    contentTypes: [],
    timeoutMs: 1000,
    abuse: { policy: 'guest-default', requires: [] },
    ...over,
  };
}

function sequenceBindings(log, over = {}) {
  const bindings = {
    handle: 'handle' in over ? over.handle : (async (ctx) => {
      log.push({ op: 'handle', ctx });
      return { outcome: 'success', status: 200, body: { accepted: true, entryId: ctx.entryId } };
    }),
  };
  if (!('verify' in over) || over.verify) {
    bindings.verify = over.verify ?? (async (input) => {
      log.push({ op: 'verify', tenant: input.tenantCandidate, bytes: input.rawBytes, secret: input.secret, nowMs: input.nowMs });
      return { ok: true, eventId: 'evt_ok' };
    });
  }
  if (!('admitGuest' in over) || over.admitGuest) {
    bindings.admitGuest = over.admitGuest ?? (async (input) => {
      log.push({ op: 'admitGuest', tenant: input.tenantId, bytes: input.rawBytes, params: input.params, meta: input.meta });
      return { ok: true, admission: { kind: 'guest', view: { amount: 12 } } };
    });
  }
  if (!('claimStore' in over) || over.claimStore) bindings.claimStore = over.claimStore ?? memoryClaimStore(log);
  if (over.limiter) bindings.limiter = over.limiter;
  if ('identity' in over) bindings.identity = over.identity;
  return bindings;
}

function declaration(entries, over = {}) {
  const log = over.log ?? [];
  const scopes = [];
  const sharedStore = over.store ?? memoryClaimStore(log);
  const factory = over.createRequestScope ?? ((services) => {
    log.push({ op: 'factory', tenant: services.tenantId, requestId: services.requestId, services });
    const extra = typeof over.bindings === 'function' ? over.bindings(services, log) : (over.bindings ?? {});
    const bindings = sequenceBindings(log, { claimStore: sharedStore, ...extra });
    scopes.push(bindings);
    return bindings;
  });
  return {
    log,
    scopes,
    declaration: {
      entries,
      resolveTenant: over.resolveTenant ?? ((entry) => {
        log.push({ op: 'resolveTenant', entryId: entry.id, tenant: entry.tenantId });
        return entry.tenantId;
      }),
      createRequestScope: factory,
    },
  };
}

function input(over = {}) {
  const body = over.rawBytes ?? new TextEncoder().encode(over.bodyText ?? '{"ok":true}');
  return {
    method: over.method ?? 'POST',
    path: over.path ?? '/api/v1/public/signed',
    headers: over.headers ?? { 'content-type': 'application/json' },
    rawBytes: body,
    query: over.query ?? {},
    nowMs: over.nowMs ?? 1_700_000_000_000,
    requestId: over.requestId ?? 'req-1',
  };
}

function kit(over = {}) {
  const db = over.db ?? inertDb();
  return {
    db,
    env: over.env ?? inertEnv(db),
    vault: over.vault ?? {
      ready: () => true,
      async decrypt({ tenantId, integrationId, aad }) {
        if (over.vaultLog) over.vaultLog.push({ tenantId, integrationId, aad });
        return SECRET;
      },
    },
  };
}

function ops(extra = []) {
  return { operations: [...operations, ...extra] };
}

function opsOf(d) {
  return validatePublicIngressDeclaration(d, ops());
}

test('le port public n’a aucun effet à l’import et n’embarque ni HMAC Stripe ni Identity', () => {
  assert.deepEqual([...publicAdmissionKinds], ['signed', 'guest']);
  assert.deepEqual([...publicCapabilityIds], ['verify', 'admitGuest', 'claimStore', 'vault', 'limiter']);
  assert.match(inboundMailRouteKey, /^POST \/api\/v1\/email\/inbound\/:\*$/);
  assert.equal(engine.admitPublicIngress.name, 'admitPublicIngress');
  assert.equal(SOURCE.includes('createHmac'), false);
  assert.equal(SOURCE.includes('stripe-signature'), false);
  assert.equal(SOURCE.includes('timingSafeEqual'), false);
  assert.equal(SOURCE.includes('utf8(bytes)'), false);
  assert.equal(isPublicTenantId(TENANT_A), true);
  assert.equal(isPublicTenantId(randomUUID()), true);
  assert.equal(isPublicTenantId('workspace-1'), false);
});

test('déclaration signed valide : sonde échantillon, pas de preuve universelle, coffre kit seulement', () => {
  const { declaration: d } = declaration([signedEntry()]);
  const validated = opsOf(d);
  assert.equal(validated.probe.provesEveryCall, false);
  assert.equal(validated.probe.reason, 'factory_sample_is_not_universal');
  assert.equal(validated.probe.operationsCatalog, 'checked');
  assert.equal(validated.probe.inboundMail, 'reserved');
  assert.equal(validated.probe.vaultPort, 'runtime_kit_port');
  assert.equal(validated.probe.crossTenantProbe, 'not_applicable_single_tenant');
  assert.ok(validated.probe.sampledAllocations >= 2);
  assert.equal(validated.probe.requestIdsProbed.length, 2);
});

test('catalogue d’opérations omis : refus précis, pas une unicité silencieuse', () => {
  const { declaration: d } = declaration([signedEntry()]);
  assert.throws(() => validatePublicIngressDeclaration(d), error => error instanceof PublicIngressDeclarationError && error.code === 'operations_catalog_required');
});

test('refus de déclaration : kind, collisions, callbacks signed/guest, singleton, circularité, Identity', () => {
  const cases = [
    ['bounded_kind_forbidden', () => declaration([{ ...signedEntry(), admission: 'bounded' }]).declaration],
    ['signed_verify_required', () => declaration([signedEntry()], { bindings: { verify: undefined } }).declaration],
    ['signed_claim_store_required', () => declaration([signedEntry()], { bindings: { claimStore: undefined } }).declaration],
    ['guest_admit_required', () => declaration([guestEntry()], { bindings: { admitGuest: undefined, claimStore: undefined } }).declaration],
    ['guest_claim_store_forbidden', () => declaration([guestEntry()], { bindings: { claimStore: memoryClaimStore([]) } }).declaration],
    ['inbound_mail_collision', () => declaration([signedEntry({ path: '/api/v1/email/inbound/:orgId' })]).declaration],
    ['route_collision', () => declaration([signedEntry({ method: 'GET', path: '/api/v1/health', maxBytes: 0, contentTypes: [] })]).declaration],
    ['duplicate_entry', () => declaration([signedEntry(), signedEntry({ path: '/api/v1/public/other' })]).declaration],
    ['duplicate_route', () => declaration([signedEntry(), signedEntry({ id: 'signed.other' })]).declaration],
    ['identity_forbidden', () => declaration([signedEntry()], { bindings: { identity: { userId: 'x' } } }).declaration],
    ['capability_missing', () => declaration([signedEntry({ abuse: { policy: 'need-limiter', requires: ['limiter'] } })]).declaration],
  ];
  for (const [code, build] of cases) {
    assert.throws(() => opsOf(build()), error => error instanceof PublicIngressDeclarationError && error.code === code, code);
  }
  const singleton = declaration([signedEntry()]);
  const shared = sequenceBindings(singleton.log);
  singleton.declaration.createRequestScope = () => shared;
  assert.throws(() => opsOf(singleton.declaration), error => error.code === 'singleton_factory');
  const circular = declaration([signedEntry()]);
  circular.declaration.resolveTenant = (entry) => {
    circular.declaration.createRequestScope({ db: inertDb(), env: inertEnv(), requestId: 'x', tenantId: entry.tenantId });
    return entry.tenantId;
  };
  assert.throws(() => opsOf(circular.declaration), error => error.code === 'circular_tenant_factory');
});

test('factory qui touche db/env en construction : factory_probe_business_effect', () => {
  const { declaration: d } = declaration([signedEntry()], {
    createRequestScope(services) {
      services.db.prepare('SELECT 1');
      return sequenceBindings([]);
    },
  });
  assert.throws(() => opsOf(d), error => error instanceof PublicIngressDeclarationError && error.code === 'factory_probe_business_effect');
  const vaulty = declaration([signedEntry()], {
    createRequestScope(services) {
      return sequenceBindings([], { secret: services.env.LITE_INTEGRATION_SECRET });
    },
  });
  assert.throws(() => opsOf(vaulty.declaration), error => ['factory_probe_business_effect', 'identity_forbidden'].includes(error.code));
});

test('échantillon ≠ universel : bindings valides à la sonde, verify absent à l’appel réel', async () => {
  const log = [];
  let calls = 0;
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined })], {
    log,
    createRequestScope(services) {
      calls += 1;
      log.push({ op: 'factory', tenant: services.tenantId, requestId: services.requestId, n: calls });
      if (String(services.requestId).startsWith('ingress-probe:')) return sequenceBindings(log, { claimStore: memoryClaimStore(log) });
      const bindings = sequenceBindings(log, { claimStore: memoryClaimStore(log) });
      delete bindings.verify;
      return bindings;
    },
  });
  const validated = opsOf(d);
  assert.equal(validated.probe.provesEveryCall, false);
  const result = await admitPublicIngress(d, input({ rawBytes: new TextEncoder().encode('{"a":1}') }), kit({ vault: undefined }));
  assert.equal(result.kind, 'response');
  assert.equal(result.status, 503);
  assert.equal(result.code, 'verify_unavailable');
  assert.equal(log.some(e => e.op === 'handle'), false);
  assert.equal(log.some(e => e.op === 'verify'), false);
});

test('octets non mutés, même référence jusqu’à verify et handle ; UTF-8 invalide intact', async () => {
  const log = [];
  const rawBytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined })], { log });
  opsOf(d);
  const result = await admitPublicIngress(d, input({ rawBytes, headers: { 'content-type': 'application/json' } }), kit({ vault: undefined }));
  assert.equal(result.kind, 'response');
  assert.equal(result.status, 200);
  const verified = log.find(e => e.op === 'verify');
  const handled = log.find(e => e.op === 'handle');
  assert.equal(verified.bytes, rawBytes);
  assert.equal(handled.ctx.rawBytes, rawBytes);
  assert.deepEqual([...rawBytes], [0x7b, 0xff, 0xfe, 0x7d]);
  assert.equal(log.find(e => e.op === 'claim').digest.length, 32);
  assert.deepEqual([...log.find(e => e.op === 'claim').digest], [...digest(rawBytes)]);
});

test('coffre avant preuve : decrypt puis verify avec secret ; handle et snapshot sans secret', async () => {
  const log = [];
  const vaultLog = [];
  const { declaration: d } = declaration([signedEntry()], {
    log,
    bindings: {
      verify: async (input) => {
        log.push({ op: 'verify', secret: input.secret, tenant: input.tenantCandidate });
        assert.equal(input.secret, SECRET);
        assert.equal(input.tenantCandidate, TENANT_A);
        return { ok: true, eventId: 'evt_secret' };
      },
      handle: async (ctx) => {
        log.push({ op: 'handle', ctx });
        return { outcome: 'success', status: 201, body: { ok: true, cookie: MARKER, authorization: 'nope' } };
      },
    },
  });
  opsOf(d);
  const result = await admitPublicIngress(d, input(), kit({ vaultLog }));
  assert.equal(vaultLog.length, 1);
  assert.equal(vaultLog[0].tenantId, TENANT_A);
  assert.equal(vaultLog[0].aad, `${TENANT_A}:int_signed`);
  const order = log.map(e => e.op);
  assert.ok(order.indexOf('factory') < order.indexOf('verify'));
  assert.equal(order.indexOf('verify') < order.indexOf('claim'), true);
  assert.equal(order.indexOf('claim') < order.indexOf('handle'), true);
  assert.equal(result.status, 422);
  assert.equal(result.code, 'snapshot_invalid');
  const serialized = JSON.stringify(result) + JSON.stringify(log.find(e => e.op === 'handle').ctx);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes(MARKER), false);
  assert.equal('secret' in log.find(e => e.op === 'handle').ctx, false);
  assert.equal('db' in log.find(e => e.op === 'handle').ctx, false);
});

test('tenant = config ; ?workspace= et JSON n’isolent pas ; claim clé du candidat', async () => {
  const log = [];
  const rawBytes = new TextEncoder().encode('{"workspaceId":"ws_' + 'c'.repeat(32) + '"}');
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined })], { log });
  opsOf(d);
  const result = await admitPublicIngress(d, input({
    rawBytes,
    query: { workspace: TENANT_B },
    headers: { 'content-type': 'application/json', cookie: 'workspace=' + TENANT_B },
  }), kit({ vault: undefined }));
  assert.equal(result.status, 200);
  assert.equal(log.find(e => e.op === 'verify').tenant, TENANT_A);
  assert.equal(log.find(e => e.op === 'handle').ctx.tenantId, TENANT_A);
  assert.equal(log.find(e => e.op === 'claim').key.tenantId, TENANT_A);
  assert.equal(log.find(e => e.op === 'factory').tenant, TENANT_A);
  assert.equal('workspace' in (log.find(e => e.op === 'admitGuest')?.meta?.query ?? {}), false);
});

test('guest deny, retry et permanent : aucun claimStore ; GET sans JSON', async () => {
  const log = [];
  const { declaration: d } = declaration([guestEntry()], {
    log,
    bindings: {
      claimStore: undefined,
      admitGuest: async (input) => {
        log.push({ op: 'admitGuest', bytes: input.rawBytes, params: input.params });
        return { ok: false };
      },
    },
  });
  opsOf(d);
  const denied = await admitPublicIngress(d, input({
    method: 'GET', path: '/api/v1/payer/opaque-token-1', rawBytes: new Uint8Array(), headers: {},
  }), kit({ vault: undefined }));
  assert.equal(denied.status, 403);
  assert.equal(denied.code, 'guest_denied');
  assert.equal(log.some(e => e.op === 'handle' || e.op === 'claim' || e.op === 'complete'), false);

  const retryLog = [];
  const retrying = declaration([guestEntry()], {
    log: retryLog,
    bindings: {
      claimStore: undefined,
      handle: async () => {
        retryLog.push({ op: 'handle' });
        return { outcome: 'retry' };
      },
    },
  });
  opsOf(retrying.declaration);
  const retried = await admitPublicIngress(retrying.declaration, input({
    method: 'GET', path: '/api/v1/payer/opaque-token-1', rawBytes: new Uint8Array(), headers: {},
  }), kit({ vault: undefined }));
  assert.equal(retried.status, 503);
  assert.equal(retried.code, 'retry');
  assert.equal(retryLog.some(e => e.op === 'claim' || e.op === 'retry' || e.op === 'complete'), false);

  const permLog = [];
  const permanent = declaration([guestEntry()], {
    log: permLog,
    bindings: {
      claimStore: undefined,
      handle: async () => ({ outcome: 'permanent', status: 404, body: { error: { code: 'missing' } } }),
    },
  });
  opsOf(permanent.declaration);
  const gone = await admitPublicIngress(permanent.declaration, input({
    method: 'GET', path: '/api/v1/payer/opaque-token-1', rawBytes: new Uint8Array(), headers: {},
  }), kit({ vault: undefined }));
  assert.equal(gone.status, 404);
  assert.equal(permLog.some(e => e.op === 'failPermanent' || e.op === 'claim'), false);
});

test('signed sans claimStore à l’exécution : 503 avant handle', async () => {
  const log = [];
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined })], {
    log,
    createRequestScope(services) {
      const bindings = sequenceBindings(log);
      if (services.requestId === 'req-live') delete bindings.claimStore;
      return bindings;
    },
  });
  opsOf(d);
  const result = await admitPublicIngress(d, input({ requestId: 'req-live' }), kit({ vault: undefined }));
  assert.equal(result.status, 503);
  assert.equal(result.code, 'claim_store_unavailable');
  assert.equal(log.some(e => e.op === 'handle' || e.op === 'verify'), false);
});

test('pannes factory, coffre, limiter : aucun 2xx, handle non appelé', async () => {
  const log = [];
  const exploding = declaration([signedEntry({ vaultRef: undefined })], {
    log,
    createRequestScope(services) {
      if (services.requestId === 'boom') throw new Error('factory down');
      return sequenceBindings(log);
    },
  });
  opsOf(exploding.declaration);
  const factoryDown = await admitPublicIngress(exploding.declaration, input({ requestId: 'boom' }), kit({ vault: undefined }));
  assert.equal(factoryDown.status, 503);
  assert.equal(factoryDown.code, 'factory_unavailable');
  assert.equal(log.some(e => e.op === 'handle'), false);

  const vaultLog = [];
  const withVault = declaration([signedEntry()], { log: vaultLog });
  opsOf(withVault.declaration);
  const vaultDown = await admitPublicIngress(withVault.declaration, input(), kit({
    vault: { ready: () => false, async decrypt() { return SECRET; } },
  }));
  assert.equal(vaultDown.status, 503);
  assert.equal(vaultDown.code, 'vault_unavailable');
  assert.equal(vaultLog.some(e => e.op === 'verify' || e.op === 'handle'), false);
  const vaultThrow = await admitPublicIngress(withVault.declaration, input(), kit({
    vault: { ready: () => true, async decrypt() { throw new Error('unreadable'); } },
  }));
  assert.equal(vaultThrow.status, 503);
  assert.equal(vaultThrow.code, 'vault_unavailable');

  const limiterLog = [];
  const limited = declaration([signedEntry({ vaultRef: undefined, abuse: { policy: 'rate', requires: ['limiter'] } })], {
    log: limiterLog,
    bindings: { limiter: { ready: () => true, async admit() { return 'unavailable'; } } },
  });
  opsOf(limited.declaration);
  const limitedOut = await admitPublicIngress(limited.declaration, input(), kit({ vault: undefined }));
  assert.equal(limitedOut.status, 503);
  assert.equal(limitedOut.code, 'limiter_unavailable');
  assert.equal(limiterLog.some(e => e.op === 'verify' || e.op === 'handle'), false);
  const policyOnly = declaration([signedEntry({ vaultRef: undefined, abuse: { policy: 'text-only', requires: [] } })], {
    log: [],
    bindings: { limiter: { ready: () => false, async admit() { return 'ok'; } } },
  });
  opsOf(policyOnly.declaration);
  const allowed = await admitPublicIngress(policyOnly.declaration, input(), kit({ vault: undefined }));
  assert.equal(allowed.status, 200);
});

test('CAS complete false : pas de 2xx ; replay completed sans complete ni handle', async () => {
  const log = [];
  const store = memoryClaimStore(log);
  store.complete = async (fence, snapshot) => {
    log.push({ op: 'complete', fence: { ...fence, key: { ...fence.key } }, snapshot });
    return false;
  };
  const fencing = declaration([signedEntry({ vaultRef: undefined })], { log, bindings: { claimStore: store } });
  opsOf(fencing.declaration);
  const denied = await admitPublicIngress(fencing.declaration, input(), kit({ vault: undefined }));
  assert.equal(denied.status, 503);
  assert.equal(denied.code, 'fencing_failed');
  assert.equal(log.some(e => e.op === 'handle'), true);
  assert.equal(log.filter(e => e.op === 'complete').length, 1);

  const replayLog = [];
  const replayStore = memoryClaimStore(replayLog);
  const first = declaration([signedEntry({ vaultRef: undefined })], { log: replayLog, bindings: { claimStore: replayStore } });
  opsOf(first.declaration);
  const bytes = new TextEncoder().encode('{"replay":true}');
  const created = await admitPublicIngress(first.declaration, input({ rawBytes: bytes }), kit({ vault: undefined }));
  assert.equal(created.status, 200);
  const handleCount = replayLog.filter(e => e.op === 'handle').length;
  const completeCount = replayLog.filter(e => e.op === 'complete').length;
  const replayed = await admitPublicIngress(first.declaration, input({ rawBytes: bytes, requestId: 'req-2' }), kit({ vault: undefined }));
  assert.equal(replayed.status, 200);
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.body, { accepted: true, entryId: 'signed.webhook' });
  assert.equal(replayLog.filter(e => e.op === 'handle').length, handleCount);
  assert.equal(replayLog.filter(e => e.op === 'complete').length, completeCount);
});

test('digest collision, busy, attempts_exhausted, permanent_failure : non-2xx sans handle succès', async () => {
  const log = [];
  const store = {
    async claim(key, payloadDigest) {
      log.push({ op: 'claim', key, payloadDigest });
      if (key.eventId === 'evt_ok') return { kind: 'digest_collision' };
      return { kind: 'busy' };
    },
    async complete() { log.push({ op: 'complete' }); return true; },
    async retry() { log.push({ op: 'retry' }); return true; },
    async failPermanent() { log.push({ op: 'failPermanent' }); return true; },
    async renew() { return true; },
  };
  const d = declaration([signedEntry({ vaultRef: undefined })], { log, bindings: { claimStore: store } });
  opsOf(d.declaration);
  const collision = await admitPublicIngress(d.declaration, input(), kit({ vault: undefined }));
  assert.equal(collision.status, 409);
  assert.equal(collision.code, 'digest_collision');
  assert.equal(log.some(e => e.op === 'handle'), false);

  const outcomes = [
    ['busy', 503, { kind: 'busy' }],
    ['attempts_exhausted', 503, { kind: 'attempts_exhausted' }],
    ['permanent_failure', 410, { kind: 'permanent_failure', snapshot: { ok: false, status: 410, body: { error: { code: 'gone' } } } }],
  ];
  for (const [label, status, claimed] of outcomes) {
    const local = [];
    const fixture = declaration([signedEntry({ vaultRef: undefined })], {
      log: local,
      bindings: {
        claimStore: {
          async claim() { return claimed; },
          async complete() { local.push({ op: 'complete' }); return true; },
          async retry() { local.push({ op: 'retry' }); return true; },
          async failPermanent() { local.push({ op: 'failPermanent' }); return true; },
          async renew() { return true; },
        },
      },
    });
    opsOf(fixture.declaration);
    const result = await admitPublicIngress(fixture.declaration, input({ requestId: label }), kit({ vault: undefined }));
    assert.equal(result.status, status, label);
    assert.ok(result.status < 200 || result.status > 299, label);
    assert.equal(local.some(e => e.op === 'handle'), false, label);
  }
});

test('limites d’entrée : GET avec corps, POST sans JSON, trop grand, méthode non appariée', async () => {
  const { declaration: d } = declaration([guestEntry(), signedEntry({ vaultRef: undefined })]);
  opsOf(d);
  const getBody = await admitPublicIngress(d, input({
    method: 'GET', path: '/api/v1/payer/token-1', rawBytes: new TextEncoder().encode('{"x":1}'), headers: { 'content-type': 'application/json' },
  }), kit({ vault: undefined }));
  assert.equal(getBody.status, 413);
  const postType = await admitPublicIngress(d, input({ headers: { 'content-type': 'text/plain' } }), kit({ vault: undefined }));
  assert.equal(postType.status, 415);
  const huge = await admitPublicIngress(d, input({ rawBytes: new Uint8Array(5000) }), kit({ vault: undefined }));
  assert.equal(huge.status, 413);
  const length = await admitPublicIngress(d, input({ headers: { 'content-type': 'application/json', 'content-length': '99999' }, rawBytes: new Uint8Array(1) }), kit({ vault: undefined }));
  assert.equal(length.status, 413);
  const miss = await admitPublicIngress(d, input({ method: 'POST', path: '/api/v1/unknown' }), kit({ vault: undefined }));
  assert.equal(miss.kind, 'unmatched');
});

test('timeout : non-2xx, effets déjà commis non annulés, complete non appelé', async () => {
  const log = [];
  let committed = false;
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined, timeoutMs: 20 })], {
    log,
    bindings: {
      handle: async () => {
        committed = true;
        log.push({ op: 'handle-commit' });
        await new Promise(resolve => setTimeout(resolve, 80));
        log.push({ op: 'handle-return' });
        return { outcome: 'success', status: 200, body: { late: true } };
      },
    },
  });
  opsOf(d);
  const result = await admitPublicIngress(d, input(), kit({ vault: undefined }));
  assert.equal(result.status, 503);
  assert.equal(result.code, 'timeout');
  assert.equal(committed, true);
  assert.equal(log.some(e => e.op === 'complete'), false);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(log.some(e => e.op === 'complete'), false);
});

test('handle retry/permanent signed : retry et failPermanent CAS, jamais completed success', async () => {
  const retryLog = [];
  const retrying = declaration([signedEntry({ vaultRef: undefined })], {
    log: retryLog,
    bindings: { handle: async () => ({ outcome: 'retry' }) },
  });
  opsOf(retrying.declaration);
  const retried = await admitPublicIngress(retrying.declaration, input(), kit({ vault: undefined }));
  assert.equal(retried.status, 503);
  assert.equal(retryLog.some(e => e.op === 'retry'), true);
  assert.equal(retryLog.some(e => e.op === 'complete'), false);

  const permLog = [];
  const permanent = declaration([signedEntry({ vaultRef: undefined })], {
    log: permLog,
    bindings: { handle: async () => ({ outcome: 'permanent', status: 409, body: { error: { code: 'conflict' } } }) },
  });
  opsOf(permanent.declaration);
  const conflicted = await admitPublicIngress(permanent.declaration, input(), kit({ vault: undefined }));
  assert.equal(conflicted.status, 409);
  assert.equal(permLog.some(e => e.op === 'failPermanent'), true);
  assert.equal(permLog.some(e => e.op === 'complete'), false);
});

test('verify non-HMAC (callback machine) accepté ; isolation deux tenants', async () => {
  const log = [];
  const entries = [
    signedEntry({ vaultRef: undefined, tenantId: TENANT_A }),
    signedEntry({ id: 'signed.b', path: '/api/v1/public/signed-b', vaultRef: undefined, tenantId: TENANT_B }),
  ];
  const { declaration: d } = declaration(entries, {
    log,
    bindings: (services) => ({
      verify: async (input) => {
        log.push({ op: 'verify', tenant: input.tenantCandidate });
        return { ok: true, eventId: 'evt_' + services.tenantId.slice(-2) };
      },
    }),
  });
  const validated = opsOf(d);
  assert.equal(validated.probe.crossTenantProbe, 'compared');
  const a = await admitPublicIngress(d, input({ path: '/api/v1/public/signed', requestId: 'a' }), kit({ vault: undefined }));
  const b = await admitPublicIngress(d, input({ path: '/api/v1/public/signed-b', requestId: 'b' }), kit({ vault: undefined }));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const claims = log.filter(e => e.op === 'claim');
  assert.equal(claims[0].key.tenantId, TENANT_A);
  assert.equal(claims[1].key.tenantId, TENANT_B);
  assert.notEqual(claims[0].key.tenantId, claims[1].key.tenantId);
});

test('createPublicIngressAdmission fige la validation et ré-évalue les bindings à chaque appel', async () => {
  let ready = true;
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined, abuse: { policy: 'lim', requires: ['limiter'] } })], {
    bindings: { limiter: { ready: () => ready, async admit() { return 'ok'; } } },
  });
  const admission = createPublicIngressAdmission(d, kit({ vault: undefined }), ops());
  assert.equal(admission.validation.probe.provesEveryCall, false);
  const ok = await admission.admit(input({ requestId: 'one' }));
  assert.equal(ok.status, 200);
  ready = false;
  const down = await admission.admit(input({ requestId: 'two' }));
  assert.equal(down.status, 503);
  assert.equal(down.code, 'limiter_unavailable');
});

test('snapshot replay sans cookie/auth/jeton ; services non sérialisés par le moteur', async () => {
  const log = [];
  const store = memoryClaimStore(log);
  const { declaration: d } = declaration([signedEntry({ vaultRef: undefined })], {
    log,
    bindings: {
      claimStore: store,
      handle: async () => ({ outcome: 'success', status: 202, body: { accepted: true, id: 'rec_1' } }),
    },
  });
  opsOf(d);
  const first = await admitPublicIngress(d, input(), kit({ vault: undefined }));
  const replay = await admitPublicIngress(d, input({ requestId: 'r2' }), kit({ vault: undefined }));
  assert.equal(first.status, 202);
  assert.equal(replay.replayed, true);
  const wire = JSON.stringify(replay);
  assert.equal(/cookie|authorization|secret|token|Bearer/i.test(wire), false);
  assert.equal(wire.includes(SECRET), false);
  const factoryEvent = log.find(e => e.op === 'factory');
  assert.throws(() => JSON.stringify(factoryEvent.services), /sérialisables|not.serializable|db, env/i);
});

test('plafonds d’entrée GET/POST côté déclaration', () => {
  assert.throws(() => opsOf(declaration([guestEntry({ maxBytes: 10 })]).declaration), error => error.code === 'entry_invalid');
  assert.throws(() => opsOf(declaration([signedEntry({ maxBytes: publicIngressLimits.maxBytesCeiling + 1 })]).declaration), error => error.code === 'entry_invalid');
  assert.throws(() => opsOf(declaration([signedEntry({ method: 'POST', contentTypes: [] })]).declaration), error => error.code === 'entry_invalid');
  assert.throws(() => opsOf(declaration([signedEntry({ tenantId: 'not-a-tenant' })]).declaration), error => error.code === 'entry_invalid');
});
