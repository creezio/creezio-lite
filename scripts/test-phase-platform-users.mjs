#!/usr/bin/env node
/**
 * Gate — référentiel utilisateurs UNIQUE (API plateforme users).
 *
 * Prouve, sur une surface plateforme réelle (core.db temporaire) :
 *  1. /api/v1/users est une route PLATEFORME (alias de /api/v1/platform/users) :
 *     une page marque type Collaborateurs parle directement au référentiel kit ;
 *  2. POST owner → collaborateur humain créé AVEC credentials kit
 *     (login /api/v1/auth/login 200 immédiat, permissions par défaut de la
 *     marque via configureAuth) ;
 *  3. GET /meta expose les ACL déclarées par la marque (assignables,
 *     owner-only, défauts) ;
 *  4. PATCH : reset mot de passe (ancien 401, nouveau 200) et désactivation
 *     (login 401) ;
 *  5. garde-fous : humain sans mot de passe → 400 ; non-owner → 403.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "gate-platform-users-secret";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-users-gate-"));
process.env.CREEZIO_CORE_DB_PATH = path.join(tmp, "core.db");

const { mountBrandPlatformSurface, createPlatformTasksBrandAdapters } =
  await import("../packages/app-runtime/dist/index.js");
const { configureAuth, migrateBrandCredentialsToKit } = await import(
  "../packages/auth/dist/index.js"
);
const { configureTasksBrand } = await import(
  "../packages/tasks/dist/index.js"
);
const { initOpsJournal, track } = await import(
  "../packages/observability/dist/index.js"
);

const OWNER_PERMS = ["nav.a", "nav.b", "nav.c", "nav.admin"];
const DEFAULTS = ["nav.a", "nav.b"];
configureAuth({
  cookieName: "gatebrand_session",
  ownerPermissions: OWNER_PERMS,
  collaboratorDefaultPermissions: DEFAULTS,
  collaboratorAssignablePermissions: ["nav.a", "nav.b", "nav.c"],
  ownerOnlyPermissions: ["nav.admin"],
});

await migrateBrandCredentialsToKit({
  username: "owner@gate.local",
  password: "gate-owner-pass",
  displayName: "Owner Gate",
});

let baseUrl = "";
/** Pont BYOK factice (miroir du store local-config du harness headless). */
const llmStore = { openai: null, anthropic: null };
/** Pont tunnel factice (miroir du tunnelService headless). */
const tunnelState = { online: false, reserved: null };
const tunnelBridge = {
  getTunnelStatus: () => ({
    configured: Boolean(tunnelState.reserved),
    online: tunnelState.online,
    slug: tunnelState.reserved,
    hostname: tunnelState.reserved ? `${tunnelState.reserved}.gate.local` : null,
    publicUrl: tunnelState.reserved
      ? `https://${tunnelState.reserved}.gate.local`
      : null,
  }),
  checkTunnelSlug: async (slug) => ({
    available: slug !== "pris",
    ...(slug === "pris" ? { reason: "déjà réservé" } : {}),
  }),
  reserveTunnel: async (slug) => {
    tunnelState.reserved = slug;
    return { ok: true, hostname: `${slug}.gate.local`, publicUrl: `https://${slug}.gate.local` };
  },
  configureTunnelIngress: async () => {},
  startCloudflared: async () => {
    tunnelState.online = true;
  },
  stopCloudflared: () => {
    tunnelState.online = false;
  },
};
/** Pont recherche factice (miroir du searchBridge harness). */
const searchState = { reindexed: 0 };
const searchBridge = {
  health: async () => ({
    configured: true,
    health: { ok: true },
    coherence: {
      stale: false,
      sql: { produits: 3 },
      meili: { catalog_products: 3 },
    },
  }),
  reindex: async () => {
    searchState.reindexed += 1;
    return { ok: true, ready: true, indexed: { catalog_products: 3 } };
  },
};
const surface = mountBrandPlatformSurface({
  brandId: "gatebrand",
  coreDbPath: process.env.CREEZIO_CORE_DB_PATH,
  baseUrl: () => baseUrl,
  llmKeys: {
    get: () => ({
      openai: Boolean(llmStore.openai),
      anthropic: Boolean(llmStore.anthropic),
    }),
    set: (provider, key) => {
      llmStore[provider] = key;
      const envKey =
        provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
      if (key) process.env[envKey] = key;
      else delete process.env[envKey];
    },
  },
  tunnelBridge: () => tunnelBridge,
  localPort: () => 18790,
  searchBridge: () => searchBridge,
});

configureTasksBrand({
  productName: "GateBrand",
  productDomain: "gate",
  hermesSourceLabel: "GateBrand",
  hermesSkill: "gate",
  envPrefix: "GATE_AI",
  idempotencyPrefix: "gate",
  assistantIdempotencyPrefix: "gate-asst",
  taskHref: "/taches",
  examplePaths: ["/taches"],
  navigation: { permissionForPath: () => null, hasPermission: () => true },
  externalTabs: {
    resolve: (input) => ({
      ok: true,
      url: String(input.url || ""),
      title: String(input.title || ""),
    }),
    toWorkspaceParams: (r) => ({ url: r.url, title: r.title }),
  },
  ...createPlatformTasksBrandAdapters(),
});

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url || "/", baseUrl || "http://127.0.0.1");
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else headers.set(k, v);
  }
  const request = new Request(url.toString(), {
    method: req.method || "GET",
    headers,
    body:
      ["GET", "HEAD"].includes(req.method || "GET") || !body.length
        ? undefined
        : body,
  });
  const response = await surface.app.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
baseUrl = `http://127.0.0.1:${server.address().port}`;

async function login(email, password) {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  return { status: res.status, cookie };
}

async function api(method, p, cookie, body) {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/* 1. owner login */
const owner = await login("owner@gate.local", "gate-owner-pass");
assert.equal(owner.status, 200, "login owner");
assert.ok(owner.cookie.includes("gatebrand_session"), "cookie marque");

/* 2. meta = ACL déclarées par la marque */
const meta = await api("GET", "/api/v1/users/meta", owner.cookie);
assert.equal(meta.status, 200, "meta 200");
assert.deepEqual(meta.body.permission_keys, ["nav.a", "nav.b", "nav.c"]);
assert.deepEqual(meta.body.owner_only, ["nav.admin"]);
assert.deepEqual(meta.body.defaults, DEFAULTS);

/* 3. humain sans mot de passe → 400 (pas de compte fantôme non logable) */
const noPass = await api("POST", "/api/v1/users", owner.cookie, {
  username: "sans-pass",
  kind: "human",
});
assert.equal(noPass.status, 400, "humain sans password refusé");

/* 4. création collaborateur via l'ALIAS /api/v1/users → login immédiat */
const created = await api("POST", "/api/v1/users", owner.cookie, {
  username: "collab-gate",
  password: "collab-pass-1",
  kind: "human",
});
assert.equal(created.status, 201, `création collab (${JSON.stringify(created.body)})`);
const collabId = created.body?.user?.id;
assert.ok(collabId, "id collaborateur");
assert.deepEqual(
  created.body.user.permissions,
  DEFAULTS,
  "permissions par défaut marque",
);

const collab = await login("collab-gate", "collab-pass-1");
assert.equal(collab.status, 200, "login collaborateur créé via l'API");
const me = await api("GET", "/api/v1/auth/me", collab.cookie);
assert.equal(me.body?.role, "collaborator", "rôle collaborateur");
assert.deepEqual(me.body?.permissions, DEFAULTS, "permissions session");

/* 5. non-owner ne gère pas les comptes */
const forbidden = await api("POST", "/api/v1/users", collab.cookie, {
  username: "intrus",
  password: "intrus-pass",
});
assert.equal(forbidden.status, 403, "création réservée au owner");

/* 6. liste visible via les DEUX montages (alias + platform) */
for (const p of ["/api/v1/users", "/api/v1/platform/users"]) {
  const list = await api("GET", p, owner.cookie);
  assert.equal(list.status, 200, `liste ${p}`);
  assert.ok(
    (list.body.users || []).some((u) => u.id === collabId),
    `collaborateur listé via ${p}`,
  );
}

/* 7. PATCH : reset mot de passe */
const reset = await api("PATCH", `/api/v1/users/${collabId}`, owner.cookie, {
  password: "collab-pass-2",
});
assert.equal(reset.status, 200, "reset password");
assert.equal(
  (await login("collab-gate", "collab-pass-1")).status,
  401,
  "ancien mot de passe rejeté",
);
assert.equal(
  (await login("collab-gate", "collab-pass-2")).status,
  200,
  "nouveau mot de passe accepté",
);

/* 8. PATCH : permissions + désactivation → login 401 */
const patched = await api("PATCH", `/api/v1/users/${collabId}`, owner.cookie, {
  permissions: ["nav.c"],
  active: false,
});
assert.equal(patched.status, 200, "patch permissions/active");
assert.deepEqual(patched.body.user.permissions, ["nav.c"]);
assert.equal(patched.body.user.active, false);
assert.equal(
  (await login("collab-gate", "collab-pass-2")).status,
  401,
  "compte désactivé → login refusé",
);

/* 9. Clés IA BYOK headless : owner-only, write-through env process */
delete process.env.OPENAI_API_KEY;
const llmAnon = await api("GET", "/api/v1/platform/llm-keys", "");
assert.equal(llmAnon.status, 403, "llm-keys sans session → 403");
const llmForbidden = await api(
  "GET",
  "/api/v1/platform/llm-keys",
  collab.cookie,
);
assert.equal(llmForbidden.status, 403, "llm-keys collaborateur → 403");
const llmEmpty = await api("GET", "/api/v1/platform/llm-keys", owner.cookie);
assert.equal(llmEmpty.status, 200, "llm-keys owner 200");
assert.equal(llmEmpty.body.openai.stored, false, "openai non stockée");
assert.equal(llmEmpty.body.assistantReady, false, "assistant pas prêt");
const llmSet = await api("PUT", "/api/v1/platform/llm-keys", owner.cookie, {
  provider: "openai",
  key: "sk-gate-test-123",
});
assert.equal(llmSet.status, 200, "PUT llm-keys openai");
assert.equal(llmSet.body.openai.stored, true, "openai stockée");
assert.equal(llmSet.body.openai.active, true, "openai active (env hydraté)");
assert.equal(llmSet.body.assistantReady, true, "assistant prêt après PUT");
assert.equal(process.env.OPENAI_API_KEY, "sk-gate-test-123", "env process posé");
const llmClear = await api("PUT", "/api/v1/platform/llm-keys", owner.cookie, {
  provider: "openai",
  key: null,
});
assert.equal(llmClear.body.openai.stored, false, "openai supprimée");
assert.equal(process.env.OPENAI_API_KEY, undefined, "env process nettoyé");
const llmBad = await api("PUT", "/api/v1/platform/llm-keys", owner.cookie, {
  provider: "pigeon",
});
assert.equal(llmBad.status, 400, "provider inconnu → 400");

/* 10. Tunnel headless : owner-only, cycle check → reserve → start/stop */
const tunAnon = await api("POST", "/api/v1/platform/tunnel/stop", "");
assert.equal(tunAnon.status, 403, "tunnel stop sans session → 403");
const tunCollab = await api(
  "POST",
  "/api/v1/platform/tunnel/stop",
  collab.cookie,
);
assert.equal(tunCollab.status, 403, "tunnel stop collaborateur → 403");
const slugTaken = await api(
  "POST",
  "/api/v1/platform/tunnel/check-slug",
  owner.cookie,
  { slug: "pris" },
);
assert.equal(slugTaken.body.available, false, "slug pris refusé");
const slugFree = await api(
  "POST",
  "/api/v1/platform/tunnel/check-slug",
  owner.cookie,
  { slug: "chez-gate" },
);
assert.equal(slugFree.body.available, true, "slug libre accepté");
const slugInvalid = await api(
  "POST",
  "/api/v1/platform/tunnel/check-slug",
  owner.cookie,
  { slug: "Mauvais Slug!!" },
);
assert.equal(slugInvalid.body.available, false, "slug invalide refusé");
const reserve = await api(
  "POST",
  "/api/v1/platform/tunnel/reserve",
  owner.cookie,
  { slug: "chez-gate" },
);
assert.equal(reserve.status, 200, `reserve (${JSON.stringify(reserve.body)})`);
assert.equal(reserve.body.ok, true, "tunnel réservé");
assert.equal(tunnelState.online, true, "cloudflared démarré après reserve");
const stopTun = await api(
  "POST",
  "/api/v1/platform/tunnel/stop",
  owner.cookie,
);
assert.equal(stopTun.status, 200, "stop tunnel");
assert.equal(tunnelState.online, false, "cloudflared arrêté");
const startTun = await api(
  "POST",
  "/api/v1/platform/tunnel/start",
  owner.cookie,
);
assert.equal(startTun.status, 200, "start tunnel");
assert.equal(tunnelState.online, true, "cloudflared relancé");

/* 11. Recherche headless : health + reindex owner-only */
const searchAnon = await api("GET", "/api/v1/platform/search/health", "");
assert.equal(searchAnon.status, 403, "search health sans session → 403");
const searchHealth = await api(
  "GET",
  "/api/v1/platform/search/health",
  owner.cookie,
);
assert.equal(searchHealth.status, 200, "search health owner 200");
assert.equal(searchHealth.body.coherence.stale, false, "index cohérent");
const reindex = await api(
  "POST",
  "/api/v1/platform/search/reindex",
  owner.cookie,
);
assert.equal(reindex.status, 200, "reindex owner 200");
assert.equal(searchState.reindexed, 1, "réindexation exécutée");

/* 12. Journal ops headless : owner-only, événements du boot courant */
initOpsJournal(tmp, "0.0.0-gate");
track({ level: "decision", kind: "gate.check", outcome: "ok" });
track({ level: "error", kind: "gate.boom", reason: "volontaire" });
const opsAnon = await api("GET", "/api/v1/platform/ops/events", "");
assert.equal(opsAnon.status, 403, "ops events sans session → 403");
const ops = await api("GET", "/api/v1/platform/ops/events", owner.cookie);
assert.equal(ops.status, 200, "ops events owner 200");
assert.equal(ops.body.available, true, "journal disponible");
assert.ok(
  (ops.body.events || []).some((e) => e.kind === "gate.boom"),
  "événement error lu dans le journal",
);
const opsErrors = await api(
  "GET",
  "/api/v1/platform/ops/events?level=error",
  owner.cookie,
);
assert.ok(
  (opsErrors.body.events || []).every((e) => e.level === "error"),
  "filtre level=error respecté",
);
assert.ok(Array.isArray(ops.body.boots), "résumés de boots présents");

surface.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log("OK test-phase-platform-users — référentiel users unique (alias /api/v1/users, credentials kit, meta ACL, reset, désactivation, llm-keys owner, tunnel/search/ops headless)");
