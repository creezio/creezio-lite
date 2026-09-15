#!/usr/bin/env node
/**
 * Gate — rôle métier marque en session (configureAuth.resolveBrandRole).
 *
 * Prouve, sur une surface plateforme réelle (core.db temporaire + db brand
 * factice) :
 *  1. Resolver ABSENT → GET /api/v1/auth/me renvoie brand_role null
 *     (rétrocompatible octet-pour-octet : aucune erreur, champ null) ;
 *  2. Resolver déclaré → /me.brand_role = rôle métier résolu depuis la db
 *     brand passée par la surface (brandDb) — owner vs collaborateur ;
 *  3. IMPERSONATION → /me.brand_role suit la CIBLE (sub impersonné) ;
 *  4. Resolver qui THROW → /me 200 avec brand_role null (jamais de 500).
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "gate-brand-role-secret";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-brand-role-gate-"));
process.env.CREEZIO_CORE_DB_PATH = path.join(tmp, "core.db");

const { mountBrandPlatformSurface } = await import(
  "../packages/app-runtime/dist/index.js"
);
const { configureAuth, migrateBrandCredentialsToKit } = await import(
  "../packages/auth/dist/index.js"
);

/** Db brand factice : user_roles en mémoire (forme SqliteHandle minimale). */
const ROLES_BY_USER = new Map();
const fakeBrandDb = {
  path: path.join(tmp, "brand.db"),
  prepare: (sql) => ({
    all: () => [],
    run: () => ({}),
    get: (userId) => {
      assert.ok(
        String(sql).includes("user_roles"),
        "le resolver interroge user_roles",
      );
      const role = ROLES_BY_USER.get(String(userId));
      return role ? { role } : undefined;
    },
  }),
};

/* Phase A : configureAuth SANS resolveBrandRole (rétrocompatibilité). */
configureAuth({
  cookieName: "gaterole_session",
  ownerPermissions: ["nav.a"],
  collaboratorDefaultPermissions: ["nav.a"],
  collaboratorAssignablePermissions: ["nav.a"],
  ownerOnlyPermissions: [],
});

await migrateBrandCredentialsToKit({
  username: "owner@role.gate",
  password: "gate-owner-pass",
  displayName: "Owner Role Gate",
});

let baseUrl = "";
const surface = mountBrandPlatformSurface({
  brandId: "gaterole",
  coreDbPath: process.env.CREEZIO_CORE_DB_PATH,
  baseUrl: () => baseUrl,
  brandDb: () => fakeBrandDb,
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

/* ---------- Phase A : resolver absent → brand_role null ------------------ */
const owner = await login("owner@role.gate", "gate-owner-pass");
assert.equal(owner.status, 200, "login owner");
const meSans = await api("GET", "/api/v1/auth/me", owner.cookie);
assert.equal(meSans.status, 200, "me 200 sans resolver");
assert.equal(
  meSans.body.brand_role ?? null,
  null,
  "brand_role null sans resolver (rétrocompatible)",
);

/* ---------- Phase B : resolver déclaré (lit la db brand) ----------------- */
configureAuth({
  cookieName: "gaterole_session",
  resolveBrandRole: (userId, db) => {
    if (!db) return null;
    const row = db
      .prepare("SELECT role FROM user_roles WHERE user_id = ?")
      .get(userId);
    return row?.role ?? null;
  },
});

const ownerId = meSans.body.user_id;
assert.ok(ownerId, "user_id owner exposé par /me");
ROLES_BY_USER.set(String(ownerId), "backoffice");

const meAvec = await api("GET", "/api/v1/auth/me", owner.cookie);
assert.equal(meAvec.status, 200, "me 200 avec resolver");
assert.equal(
  meAvec.body.brand_role,
  "backoffice",
  "brand_role résolu depuis la db brand (owner)",
);

/* Collaborateur avec un rôle métier différent */
const created = await api("POST", "/api/v1/users", owner.cookie, {
  username: "collab-role",
  password: "collab-pass-1",
  kind: "human",
});
assert.equal(created.status, 201, "création collaborateur");
const collabId = created.body?.user?.id;
assert.ok(collabId, "id collaborateur");
ROLES_BY_USER.set(String(collabId), "pos");

const collab = await login("collab-role", "collab-pass-1");
assert.equal(collab.status, 200, "login collaborateur");
const meCollab = await api("GET", "/api/v1/auth/me", collab.cookie);
assert.equal(
  meCollab.body.brand_role,
  "pos",
  "brand_role du collaborateur (rôle distinct du owner)",
);

/* ---------- Phase C : impersonation → rôle de la CIBLE ------------------- */
/* Le swap de session passe par le cookie posé par la route (set-cookie). */
const impRes = await fetch(`${baseUrl}/api/v1/auth/impersonate`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: owner.cookie },
  body: JSON.stringify({ userId: collabId }),
});
assert.equal(impRes.status, 200, "impersonate 200");
const impersonatedCookie = (impRes.headers.get("set-cookie") || "").split(
  ";",
)[0];
assert.ok(impersonatedCookie.includes("gaterole_session"), "cookie swap posé");
const meImp = await api("GET", "/api/v1/auth/me", impersonatedCookie);
assert.equal(meImp.status, 200, "me 200 en impersonation");
assert.equal(meImp.body.impersonating, true, "impersonating true");
assert.equal(
  meImp.body.brand_role,
  "pos",
  "brand_role suit la CIBLE en impersonation",
);
/* ---------- Phase D : resolver qui throw → null, jamais de 500 ----------- */
configureAuth({
  cookieName: "gaterole_session",
  resolveBrandRole: () => {
    throw new Error("boom volontaire");
  },
});
const meThrow = await api("GET", "/api/v1/auth/me", owner.cookie);
assert.equal(meThrow.status, 200, "me 200 malgré resolver en échec");
assert.equal(
  meThrow.body.brand_role ?? null,
  null,
  "brand_role null quand le resolver throw",
);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  "OK — brand_role : absent→null, résolu (db brand), impersonation→cible, throw→null",
);
