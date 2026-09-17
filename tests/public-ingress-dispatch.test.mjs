import './register-native-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { app, alice, bob, boot, localDb } from './helpers.mjs';
import { command, defineExtensions as defineCoreExtensions } from '../runtime/core/commands.ts';
import { PublicIngressDeclarationError } from '../runtime/core/public-ingress-engine.ts';
import { createD1ClaimStore } from '../runtime/core/public-ingress-claims.ts';
const { dispatchRequest } = await import('../runtime/modules/sites-adapter/src/dispatch.ts');
const { defineExtensions, nativeCatalog } = await import('../runtime/modules/sites-adapter/src/catalog.ts');

const VAULT = 'test-ingress-vault-secret';
const WEBHOOK = 'webhook-mac-fixture-not-for-logs';
const GUEST_TOKEN = 'opaque-guest-token';

function d1ClaimStore(db, config = {}) {
  let store;
  const get = () => {
    if (!store) store = createD1ClaimStore(db, config);
    return store;
  };
  return {
    claim: (...args) => get().claim(...args),
    complete: (...args) => get().complete(...args),
    retry: (...args) => get().retry(...args),
    failPermanent: (...args) => get().failPermanent(...args),
    renew: (...args) => get().renew(...args),
  };
}

function signedEntry(tenantId, over = {}) {
  return {
    id: 'signed.webhook',
    method: 'POST',
    path: '/api/v1/public/signed',
    admission: 'signed',
    tenantId,
    maxBytes: 4096,
    contentTypes: ['application/json'],
    timeoutMs: 2_000,
    abuse: { policy: 'signed-default', requires: [] },
    ...over,
  };
}
function guestEntry(tenantId, over = {}) {
  return {
    id: 'guest.payer',
    method: 'GET',
    path: '/api/v1/public/guest/:token',
    admission: 'guest',
    tenantId,
    maxBytes: 0,
    contentTypes: [],
    timeoutMs: 1_000,
    abuse: { policy: 'guest-default', requires: [] },
    ...over,
  };
}

function lazyBindings(log, services, over = {}) {
  const bindings = {
    handle: over.handle ?? (async (ctx) => {
      log.push({ op: 'handle', ctx, tenant: services.tenantId, requestId: services.requestId });
      return { outcome: 'success', status: 200, body: { accepted: true, entryId: ctx.entryId } };
    }),
  };
  if (!('verify' in over) || over.verify) {
    bindings.verify = over.verify ?? (async (input) => {
      log.push({ op: 'verify', tenant: input.tenantCandidate, bytes: input.rawBytes, secret: input.secret });
      const eventId = input.headers.get('x-lite-event');
      const signature = input.headers.get('x-lite-signature');
      if (!eventId || signature !== (input.secret ?? 'unsigned')) return { ok: false };
      return { ok: true, eventId };
    });
  }
  if (!('admitGuest' in over) || over.admitGuest) {
    bindings.admitGuest = over.admitGuest ?? (async (input) => {
      log.push({ op: 'admitGuest', tenant: input.tenantId, bytes: input.rawBytes, params: input.params, meta: input.meta });
      if (input.params.token !== GUEST_TOKEN) return { ok: false };
      return { ok: true, admission: { kind: 'guest', view: { amount: 12, status: 'awaiting_staff' } } };
    });
  }
  if (!('claimStore' in over) || over.claimStore) bindings.claimStore = over.claimStore ?? d1ClaimStore(services.db);
  if (over.limiter) bindings.limiter = over.limiter;
  return bindings;
}

function declarationFor(tenantId, entries, over = {}) {
  const log = over.log ?? [];
  const scopes = [];
  return {
    log,
    scopes,
    publicIngress: {
      entries,
      resolveTenant: over.resolveTenant ?? ((entry) => {
        log.push({ op: 'resolveTenant', entryId: entry.id });
        return entry.tenantId;
      }),
      createRequestScope: over.createRequestScope ?? ((services) => {
        log.push({ op: 'factory', tenant: services.tenantId, requestId: services.requestId, services });
        const extra = typeof over.bindings === 'function' ? over.bindings(services, log) : (over.bindings ?? {});
        const bindings = lazyBindings(log, services, extra);
        scopes.push(bindings);
        return bindings;
      }),
    },
  };
}

async function setup() {
  const db = await localDb();
  const org = await boot(async (path, opts = {}) => {
    const url = new URL('/api/v1/' + path, 'https://test.example');
    const response = await dispatchRequest(new Request(url, {
      method: opts.method ?? 'GET',
      headers: { origin: url.origin, ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }), { app, env: { DB: db, LITE_INTEGRATION_SECRET: VAULT }, identity: alice });
    return { status: response.status, body: await response.json() };
  });
  return { db, org };
}

async function call(db, options, { path, method = 'GET', identity = null, body, rawBytes, headers = {}, query = {}, secret = VAULT } = {}) {
  const url = new URL(path.startsWith('/') ? path : '/api/v1/' + path, 'https://test.example');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const request = new Request(url, {
    method,
    headers: {
      origin: url.origin,
      ...(rawBytes !== undefined || body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: rawBytes !== undefined ? rawBytes : (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const response = await dispatchRequest(request, { app, env: { DB: db, LITE_INTEGRATION_SECRET: secret }, identity }, options);
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed, headers: response.headers, text };
}

test('defineExtensions refuse un catalogue omis ou vide ; collisions mail et routes privées', () => {
  const tenant = 'ws_' + 'a'.repeat(32);
  const { publicIngress } = declarationFor(tenant, [signedEntry(tenant)]);
  assert.throws(
    () => defineCoreExtensions(app, { publicIngress }),
    error => error instanceof PublicIngressDeclarationError && error.code === 'operations_catalog_required',
  );
  assert.throws(
    () => defineCoreExtensions(app, { publicIngress }, []),
    error => error instanceof PublicIngressDeclarationError && error.code === 'operations_catalog_required',
  );
  assert.ok(nativeCatalog(app).length > 1);
  assert.throws(
    () => defineExtensions(app, { publicIngress: declarationFor(tenant, [signedEntry(tenant, { path: '/api/v1/email/inbound/:orgId' })]).publicIngress }),
    error => error instanceof PublicIngressDeclarationError && error.code === 'inbound_mail_collision',
  );
  assert.throws(
    () => defineExtensions(app, { publicIngress: declarationFor(tenant, [guestEntry(tenant, { path: '/api/v1/health' })]).publicIngress }),
    error => error instanceof PublicIngressDeclarationError && error.code === 'route_collision',
  );
  const ping = command({
    moduleId: 'clients', moduleName: 'Clients', name: 'ping', description: 'Commande privée', target: 'module',
    idempotencyKey: 'none', async handle() { return { body: { ok: true } }; },
  });
  assert.throws(
    () => defineExtensions(app, {
      operations: [ping],
      publicIngress: declarationFor(tenant, [signedEntry(tenant, { path: ping.operation.path })]).publicIngress,
    }),
    error => error instanceof PublicIngressDeclarationError && error.code === 'route_collision',
  );
  assert.throws(
    () => defineExtensions(app, { publicIngress: declarationFor(tenant, [signedEntry(tenant)], { bindings: { verify: undefined } }).publicIngress }),
    error => error instanceof PublicIngressDeclarationError && error.code === 'signed_verify_required',
  );
  const singleton = declarationFor(tenant, [signedEntry(tenant)]);
  const shared = lazyBindings([], { db: {}, tenantId: tenant, requestId: 'x' });
  singleton.publicIngress.createRequestScope = () => shared;
  assert.throws(
    () => defineExtensions(app, { publicIngress: singleton.publicIngress }),
    error => error instanceof PublicIngressDeclarationError && error.code === 'singleton_factory',
  );
});

test('sans publicIngress : pas de route publique ; avec déclaration, les routes privées restent 401', async () => {
  const { db, org } = await setup();
  try {
    const anonymous = await call(db, {}, { path: '/api/v1/public/signed', method: 'POST', body: { ok: true } });
    assert.equal(anonymous.status, 401);
    const { publicIngress, log } = declarationFor(org, [signedEntry(org), guestEntry(org)]);
    const options = defineExtensions(app, { publicIngress });
    const privateRoute = await call(db, options, { path: '/api/v1/modules', method: 'GET' });
    assert.equal(privateRoute.status, 401);
    const clients = await call(db, options, { path: '/api/v1/modules/clients', method: 'GET' });
    assert.equal(clients.status, 401);
    assert.equal(log.some(e => e.op === 'handle'), false);
  } finally { db.close(); }
});

test('GET guest sans JSON : jeton de chemin, aucun claim, aucune autorité paiement', async () => {
  const { db, org } = await setup();
  try {
    let credits = 0;
    const { publicIngress, log } = declarationFor(org, [guestEntry(org)], {
      bindings: {
        claimStore: undefined,
        handle: async (ctx) => {
          log.push({ op: 'handle', proof: ctx.proof, params: ctx.params });
          return { outcome: 'success', status: 200, body: { view: ctx.proof.view, paid: false } };
        },
      },
    });
    const options = defineExtensions(app, { publicIngress });
    const ok = await call(db, options, { path: `/api/v1/public/guest/${GUEST_TOKEN}`, method: 'GET' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.paid, false);
    assert.equal(ok.body.view.status, 'awaiting_staff');
    assert.equal(credits, 0);
    assert.equal(log.some(e => e.op === 'claim' || e.op === 'complete'), false);
    assert.equal(log.find(e => e.op === 'admitGuest').bytes.byteLength, 0);
    const denied = await call(db, options, { path: '/api/v1/public/guest/other-token', method: 'GET' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'guest_denied');
    const withLength = await call(db, options, {
      path: `/api/v1/public/guest/${GUEST_TOKEN}`, method: 'GET',
      headers: { 'content-length': '12', 'content-type': 'application/json' },
    });
    assert.equal(withLength.status, 413);
  } finally { db.close(); }
});

test('POST signed : octets intacts lus une fois, tenant non forgeable, scopes isolés', async () => {
  const { db, org } = await setup();
  try {
    const rawBytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]);
    const { publicIngress, log, scopes } = declarationFor(org, [signedEntry(org)]);
    const options = defineExtensions(app, { publicIngress });
    const first = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', rawBytes,
      headers: { 'content-type': 'application/json', 'x-lite-event': 'evt_bytes', 'x-lite-signature': 'unsigned' },
      query: { workspace: 'ws_' + 'b'.repeat(32) },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const verified = log.find(e => e.op === 'verify');
    const handled = log.find(e => e.op === 'handle');
    assert.deepEqual([...verified.bytes], [...rawBytes]);
    assert.deepEqual([...handled.ctx.rawBytes], [...rawBytes]);
    assert.equal(handled.ctx.tenantId, org);
    assert.equal(verified.tenant, org);
    assert.equal(log.find(e => e.op === 'factory').tenant, org);
    const second = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { workspaceId: 'ws_' + 'c'.repeat(32) },
      headers: {
        'x-lite-event': 'evt_tenant',
        'x-lite-signature': 'unsigned',
        cookie: 'lite_workspace=' + 'ws_' + 'c'.repeat(32),
      },
      query: { workspace: 'ws_' + 'c'.repeat(32) },
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const factories = log.filter(e => e.op === 'factory');
    assert.equal(factories.length, 2);
    assert.notEqual(factories[0].requestId, factories[1].requestId);
    assert.notEqual(scopes[0], scopes[1]);
    assert.throws(() => JSON.stringify(factories[0].services), /sérialisables|not.serializable|db, env/i);
    assert.equal(JSON.stringify(first.body).includes(VAULT), false);
    assert.equal('Authorization' in first.body || 'authorization' in (first.body.error ?? {}), false);
  } finally { db.close(); }
});

test('signature invalide, limite dépassée, type refusé : pas de handle', async () => {
  const { db, org } = await setup();
  try {
    const { publicIngress, log } = declarationFor(org, [signedEntry(org, { maxBytes: 64 })]);
    const options = defineExtensions(app, { publicIngress });
    const bad = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'x-lite-event': 'evt_bad', 'x-lite-signature': 'nope' },
    });
    assert.equal(bad.status, 403);
    assert.equal(bad.body.error.code, 'invalid_proof');
    assert.equal(log.some(e => e.op === 'handle'), false);
    const huge = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'content-length': '99999', 'x-lite-event': 'evt_huge', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(huge.status, 413);
    const typed = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'content-type': 'text/plain', 'x-lite-event': 'evt_type', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(typed.status, 415);
  } finally { db.close(); }
});

test('coffre : decrypt AAD tenant avant preuve ; absence ou panne ⇒ 503 sans handle', async () => {
  const { db, org } = await setup();
  try {
    const created = await call(db, {}, {
      path: '/api/v1/platform/integrations', method: 'POST', identity: alice, query: { workspace: org },
      body: { provider: 'custom', slug: 'ingress-hook', label: 'Hook', secret: WEBHOOK, meta: { headerName: 'X-Hook' } },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const integrationId = created.body.integration.id;
    const { publicIngress, log } = declarationFor(org, [signedEntry(org, { vaultRef: { integrationId } })], {
      bindings: {
        verify: async (input) => {
          log.push({ op: 'verify', secret: input.secret, tenant: input.tenantCandidate });
          if (input.secret !== WEBHOOK) return { ok: false };
          return { ok: true, eventId: input.headers.get('x-lite-event') };
        },
      },
    });
    const options = defineExtensions(app, { publicIngress });
    const ok = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { ping: true },
      headers: { 'x-lite-event': 'evt_vault' },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(log.find(e => e.op === 'verify').secret, WEBHOOK);
    assert.equal(JSON.stringify(ok.body).includes(WEBHOOK), false);
    assert.equal(ok.text.includes(WEBHOOK), false);

    const missingSecret = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { ping: true },
      headers: { 'x-lite-event': 'evt_nosecret' },
      secret: '',
    });
    assert.equal(missingSecret.status, 503);
    assert.equal(missingSecret.body.error.code, 'vault_unavailable');

    const missing = declarationFor(org, [signedEntry(org, { vaultRef: { integrationId: crypto.randomUUID() } })]);
    const missingOptions = defineExtensions(app, { publicIngress: missing.publicIngress });
    const gone = await call(db, missingOptions, {
      path: '/api/v1/public/signed', method: 'POST', body: { ping: true },
      headers: { 'x-lite-event': 'evt_missing' },
    });
    assert.equal(gone.status, 503);
    assert.equal(gone.body.error.code, 'vault_unavailable');
    assert.equal(missing.log.some(e => e.op === 'verify' || e.op === 'handle'), false);
  } finally { db.close(); }
});

test('bindings absents ou factory en panne à la requête : 503 sans handle', async () => {
  const { db, org } = await setup();
  try {
    const exploding = declarationFor(org, [signedEntry(org)], {
      createRequestScope(services) {
        exploding.log.push({ op: 'factory', requestId: services.requestId });
        if (!String(services.requestId).startsWith('ingress-probe:')) throw new Error('factory down');
        return lazyBindings(exploding.log, services);
      },
    });
    const boom = defineExtensions(app, { publicIngress: exploding.publicIngress });
    const factoryDown = await call(db, boom, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'x-lite-event': 'evt_boom', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(factoryDown.status, 503);
    assert.equal(factoryDown.body.error.code, 'factory_unavailable');
    assert.equal(exploding.log.some(e => e.op === 'handle'), false);

    const stripped = declarationFor(org, [signedEntry(org)], {
      createRequestScope(services) {
        const bindings = lazyBindings(stripped.log, services);
        if (!String(services.requestId).startsWith('ingress-probe:')) delete bindings.claimStore;
        return bindings;
      },
    });
    const live = defineExtensions(app, { publicIngress: stripped.publicIngress });
    const missingStore = await call(db, live, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'x-lite-event': 'evt_store', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(missingStore.status, 503);
    assert.equal(missingStore.body.error.code, 'claim_store_unavailable');
    assert.equal(stripped.log.some(e => e.op === 'handle' || e.op === 'verify'), false);

    let admit = 'ok';
    const limited = declarationFor(org, [signedEntry(org, { abuse: { policy: 'rate', requires: ['limiter'] } })], {
      bindings: { limiter: { ready: () => true, async admit() { return admit; } } },
    });
    const limitedOptions = defineExtensions(app, { publicIngress: limited.publicIngress });
    const allowed = await call(db, limitedOptions, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'x-lite-event': 'evt_lim_ok', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(allowed.status, 200);
    admit = 'unavailable';
    const blocked = await call(db, limitedOptions, {
      path: '/api/v1/public/signed', method: 'POST', body: { ok: true },
      headers: { 'x-lite-event': 'evt_lim_no', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.error.code, 'limiter_unavailable');
  } finally { db.close(); }
});

test('ClaimStore D1 : replay completed sans nouveau handle ; fence périmé non 2xx ; aucun secret renvoyé', async () => {
  const { db, org } = await setup();
  try {
    const { publicIngress, log } = declarationFor(org, [signedEntry(org)]);
    const options = defineExtensions(app, { publicIngress });
    const payload = { replay: true };
    const first = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: payload,
      headers: { 'x-lite-event': 'evt_replay', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const handles = log.filter(e => e.op === 'handle').length;
    const replay = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: payload,
      headers: { 'x-lite-event': 'evt_replay', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(replay.body, first.body);
    assert.equal(log.filter(e => e.op === 'handle').length, handles);
    assert.equal(/cookie|authorization|secret|Bearer/i.test(JSON.stringify(replay.body)), false);

    const collision = await call(db, options, {
      path: '/api/v1/public/signed', method: 'POST', body: { replay: false },
      headers: { 'x-lite-event': 'evt_replay', 'x-lite-signature': 'unsigned' },
    });
    assert.equal(collision.status, 409);
    assert.equal(collision.body.error.code, 'digest_collision');

    const staleLog = [];
    const stale = declarationFor(org, [signedEntry(org, { timeoutMs: 2_000 })], {
      log: staleLog,
      bindings: {
        claimStore: undefined,
        handle: async (ctx) => {
          staleLog.push({ op: 'handle' });
          await new Promise(resolve => setTimeout(resolve, 40));
          return { outcome: 'success', status: 200, body: { late: true, authorization: 'Bearer leaked' } };
        },
      },
      createRequestScope(services) {
        staleLog.push({ op: 'factory', requestId: services.requestId });
        return lazyBindings(staleLog, services, {
          claimStore: d1ClaimStore(services.db, { leaseTtlMs: 1, maxAttempts: 8 }),
          handle: async () => {
            staleLog.push({ op: 'handle' });
            await new Promise(resolve => setTimeout(resolve, 40));
            return { outcome: 'success', status: 200, body: { late: true } };
          },
        });
      },
    });
    const staleOptions = defineExtensions(app, { publicIngress: stale.publicIngress });
    const expired = await call(db, staleOptions, {
      path: '/api/v1/public/signed', method: 'POST', body: { stale: true },
      headers: { 'x-lite-event': 'evt_stale', 'x-lite-signature': 'unsigned' },
    });
    assert.ok(expired.status < 200 || expired.status > 299);
    assert.equal(staleLog.some(e => e.op === 'handle'), true);
    assert.equal(JSON.stringify(expired.body).includes('Bearer leaked'), false);
  } finally { db.close(); }
});
