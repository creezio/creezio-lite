#!/usr/bin/env node
/**
 * Gate E1 — configureAuth({ userAdminPermission }) : gestion des
 * collaborateurs gardée par permission (POST/PATCH /api/v1/platform/users).
 *
 * Prouve, sur une surface plateforme réelle (core.db temporaire) :
 *  1. option ABSENTE → comportement historique owner-only inchangé :
 *     collaborateur (même avec permissions nav) → 403 sur POST et PATCH ;
 *  2. option déclarée + collaborateur SANS la permission → 403 ;
 *  3. option déclarée + collaborateur AVEC la permission → crée un user
 *     (201, login immédiat), PATCH (reset password) OK, GET /meta OK ;
 *  4. anti-escalade : un userAdmin non-owner ne peut pas accorder une
 *     permission owner-only (strippée au POST comme au PATCH) ;
 *  5. le owner reste intégralement fonctionnel (non-régression).
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "gate-user-admin-secret";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-useradmin-gate-"));
process.env.CREEZIO_CORE_DB_PATH = path.join(tmp, "core.db");

const { mountBrandPlatformSurface, createPlatformTasksBrandAdapters } =
  await import("../packages/app-runtime/dist/index.js");
const { configureAuth, migrateBrandCredentialsToKit } = await import(
  "../packages/auth/dist/index.js"
);
const { configureTasksBrand } = await import(
  "../packages/tasks/dist/index.js"
);

const USER_ADMIN_PERM = "platform.users.manage";
const OWNER_PERMS = ["nav.a", "nav.b", "nav.admin", USER_ADMIN_PERM];
const DEFAULTS = ["nav.a"];
const baseAuthConfig = {
  cookieName: "gateua_session",
  ownerPermissions: OWNER_PERMS,
  collaboratorDefaultPermissions: DEFAULTS,
  collaboratorAssignablePermissions: ["nav.a", "nav.b", USER_ADMIN_PERM],
  ownerOnlyPermissions: ["nav.admin"],
};

/* Phase 1 : option ABSENTE — owner-only historique. */
configureAuth(baseAuthConfig);

await migrateBrandCredentialsToKit({
  username: "owner@gate.local",
  password: "gate-owner-pass",
  displayName: "Owner Gate",
});

let baseUrl = "";
const surface = mountBrandPlatformSurface({
  brandId: "gateua",
  coreDbPath: process.env.CREEZIO_CORE_DB_PATH,
  baseUrl: () => baseUrl,
});

configureTasksBrand({
  productName: "GateUA",
  productDomain: "gate",
  hermesSourceLabel: "GateUA",
  hermesSkill: "gate",
  envPrefix: "GATEUA_AI",
  idempotencyPrefix: "gateua",
  assistantIdempotencyPrefix: "gateua-asst",
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

const owner = await login("owner@gate.local", "gate-owner-pass");
assert.equal(owner.status, 200, "login owner");

/* Le owner crée deux collaborateurs : un futur userAdmin, un simple. */
const mkCollab = async (username, password, permissions) => {
  const r = await api("POST", "/api/v1/platform/users", owner.cookie, {
    username,
    password,
    kind: "human",
    permissions,
  });
  assert.equal(r.status, 201, `création ${username} (${JSON.stringify(r.body)})`);
  return r.body.user;
};
const adminUser = await mkCollab("useradmin", "useradmin-pass", [
  "nav.a",
  USER_ADMIN_PERM,
]);
await mkCollab("simple", "simple-pass", ["nav.a"]);
const adminSession = await login("useradmin", "useradmin-pass");
assert.equal(adminSession.status, 200, "login userAdmin");
const simpleSession = await login("simple", "simple-pass");
assert.equal(simpleSession.status, 200, "login simple");

/* 1. Option ABSENTE → owner-only inchangé, même avec la permission en poche. */
for (const [label, cookie] of [
  ["userAdmin", adminSession.cookie],
  ["simple", simpleSession.cookie],
]) {
  const post = await api("POST", "/api/v1/platform/users", cookie, {
    username: `refus-${label}`,
    password: "refus-pass-1",
  });
  assert.equal(post.status, 403, `option absente : POST ${label} → 403`);
  const patch = await api(
    "PATCH",
    `/api/v1/platform/users/${adminUser.id}`,
    cookie,
    { permissions: ["nav.a"] },
  );
  assert.equal(patch.status, 403, `option absente : PATCH ${label} → 403`);
}

/* Phase 2 : la marque déclare userAdminPermission. */
configureAuth({ ...baseAuthConfig, userAdminPermission: USER_ADMIN_PERM });

/* 2. Collaborateur SANS la permission → toujours 403. */
const stillForbidden = await api(
  "POST",
  "/api/v1/platform/users",
  simpleSession.cookie,
  { username: "intrus", password: "intrus-pass" },
);
assert.equal(stillForbidden.status, 403, "sans permission → 403");

/* 3. Collaborateur AVEC la permission → crée un user logable. */
const meta = await api(
  "GET",
  "/api/v1/platform/users/meta",
  adminSession.cookie,
);
assert.equal(meta.status, 200, "meta accessible au userAdmin");

const created = await api(
  "POST",
  "/api/v1/platform/users",
  adminSession.cookie,
  { username: "cree-par-admin", password: "cree-pass-1", kind: "human" },
);
assert.equal(
  created.status,
  201,
  `userAdmin crée un user (${JSON.stringify(created.body)})`,
);
const createdId = created.body?.user?.id;
assert.ok(createdId, "id user créé");
assert.equal(
  (await login("cree-par-admin", "cree-pass-1")).status,
  200,
  "user créé par userAdmin logable",
);

/* PATCH par userAdmin : reset password. */
const reset = await api(
  "PATCH",
  `/api/v1/platform/users/${createdId}`,
  adminSession.cookie,
  { password: "cree-pass-2" },
);
assert.equal(reset.status, 200, "userAdmin reset password");
assert.equal(
  (await login("cree-par-admin", "cree-pass-1")).status,
  401,
  "ancien mot de passe rejeté",
);
assert.equal(
  (await login("cree-par-admin", "cree-pass-2")).status,
  200,
  "nouveau mot de passe accepté",
);

/* 4. Anti-escalade : owner-only strippée pour un userAdmin non-owner. */
const escalPost = await api(
  "POST",
  "/api/v1/platform/users",
  adminSession.cookie,
  {
    username: "escalade",
    password: "escalade-pass",
    permissions: ["nav.a", "nav.admin"],
  },
);
assert.equal(escalPost.status, 201, "POST escalade accepté mais filtré");
assert.deepEqual(
  escalPost.body.user.permissions,
  ["nav.a"],
  "owner-only strippée au POST",
);
const escalPatch = await api(
  "PATCH",
  `/api/v1/platform/users/${createdId}`,
  adminSession.cookie,
  { permissions: ["nav.b", "nav.admin"] },
);
assert.equal(escalPatch.status, 200, "PATCH escalade accepté mais filtré");
assert.deepEqual(
  escalPatch.body.user.permissions,
  ["nav.b"],
  "owner-only strippée au PATCH",
);

/* 5. Non-régression : le owner accorde owner-only sans filtre. */
const ownerGrant = await api(
  "PATCH",
  `/api/v1/platform/users/${createdId}`,
  owner.cookie,
  { permissions: ["nav.a", "nav.admin"] },
);
assert.equal(ownerGrant.status, 200, "owner PATCH");
assert.deepEqual(
  ownerGrant.body.user.permissions,
  ["nav.a", "nav.admin"],
  "owner non filtré",
);

surface.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  "OK test-phase-platform-user-admin — E1 userAdminPermission (option absente = owner-only, avec permission = gestion users, anti-escalade owner-only)",
);
