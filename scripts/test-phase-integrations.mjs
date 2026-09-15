#!/usr/bin/env node
/**
 * Gate — intégrations / clés API tierces (ADR-integrations-store).
 *
 * Prouve, sur une surface plateforme réelle (core.db + brand.db temporaires,
 * faux n8n HTTP) :
 *  1. CRUD owner sur /api/v1/platform/integrations (create/list/rename/
 *     remplacement de clé/suppression) — jamais de secret dans les listings ;
 *  2. chiffrement au repos : secret_enc AES-256-GCM (`enc:v1:`), le clair
 *     n'apparaît ni en DB ni dans le fichier core.db ;
 *  3. résolution par référence `integration://<slug>` : owner OU clé API
 *     service (`api_keys` brand.db — le canal Hermes/plugins) ; collaborateur
 *     et clé invalide refusés ;
 *  4. sync n8n push : create → POST /credentials (type mappé, nom
 *     `creezio:<slug>`), remplacement → PATCH, suppression → DELETE ;
 *     rename seul ne re-pousse pas ;
 *  5. secret illisible (AUTH_SECRET changé) → resolve 409 `unreadable`.
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "gate-integrations-secret";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-integr-gate-"));
process.env.CREEZIO_CORE_DB_PATH = path.join(tmp, "core.db");
const brandDbPath = path.join(tmp, "brand.db");

const { mountBrandPlatformSurface } = await import(
  "../packages/app-runtime/dist/index.js"
);
const {
  configureAuth,
  migrateBrandCredentialsToKit,
  openNodeSqliteDatabase,
} = await import("../packages/auth/dist/index.js");
const {
  parseIntegrationReference,
  formatIntegrationReference,
  getIntegrationProvider,
} = await import("../packages/integrations/dist/index.js");

/* ── unités référence ── */
assert.equal(parseIntegrationReference("integration://openai"), "openai");
assert.equal(parseIntegrationReference("openai"), "openai");
assert.equal(parseIntegrationReference("integration://Bad Slug!"), null);
assert.equal(parseIntegrationReference(""), null);
assert.equal(formatIntegrationReference("notion"), "integration://notion");

/* ── brand.db avec api_keys + clé service (canal Hermes) ── */
const SERVICE_KEY = "gatebrand_live_hermes-service-key-0123456789";
{
  const db = openNodeSqliteDatabase(brandDbPath);
  db.exec(`CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    prefix TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT 'full',
    user_id TEXT,
    revoked_at TEXT
  );`);
  db.prepare(
    `INSERT INTO api_keys (name, key_hash, prefix, scopes) VALUES (?, ?, ?, 'full')`,
  ).run(
    "Gate Hermes (service)",
    crypto.createHash("sha256").update(SERVICE_KEY, "utf8").digest("hex"),
    SERVICE_KEY.slice(0, 20),
  );
  db.close?.();
}

/* ── faux n8n : enregistre les appels API credentials ── */
const n8nCalls = [];
const fakeN8n = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : null;
  n8nCalls.push({ method: req.method, url: req.url, body });
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/api/v1/credentials") {
    res.end(
      JSON.stringify({ id: `n8n-cred-${n8nCalls.length}`, name: body?.name }),
    );
    return;
  }
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((r) => fakeN8n.listen(0, "127.0.0.1", r));
const n8nApiUrl = `http://127.0.0.1:${fakeN8n.address().port}/api/v1`;

/* ── surface plateforme ── */
configureAuth({
  cookieName: "gatebrand_session",
  ownerPermissions: ["nav.admin"],
});
await migrateBrandCredentialsToKit({
  username: "owner@gate.local",
  password: "gate-owner-pass",
  displayName: "Owner Gate",
});

const brandDbHandle = openNodeSqliteDatabase(brandDbPath);
let baseUrl = "";
const surface = mountBrandPlatformSurface({
  brandId: "gatebrand",
  coreDbPath: process.env.CREEZIO_CORE_DB_PATH,
  baseUrl: () => baseUrl,
  brandDb: () => ({
    path: brandDbPath,
    prepare: (sql) => brandDbHandle.prepare(sql),
  }),
  n8nBridge: () => ({ apiUrl: n8nApiUrl, apiKey: "gate-n8n-key" }),
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
  return {
    status: res.status,
    cookie: (res.headers.get("set-cookie") || "").split(";")[0],
  };
}

async function api(method, p, auth, body) {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const owner = await login("owner@gate.local", "gate-owner-pass");
assert.equal(owner.status, 200, "login owner");

/* 1. catalog + création OpenAI/Notion */
const catalog = await api(
  "GET",
  "/api/v1/platform/integrations/catalog",
  owner,
);
assert.equal(catalog.status, 200, "catalog 200");
assert.ok(
  catalog.body.providers.some((p) => p.id === "openai"),
  "provider openai au catalogue",
);

const OPENAI_SECRET = "sk-gate-openai-secret-0123456789abcdef";
const created = await api("POST", "/api/v1/platform/integrations", owner, {
  provider: "openai",
  label: "OpenAI test",
  secret: OPENAI_SECRET,
});
assert.equal(created.status, 201, `create openai (${JSON.stringify(created.body)})`);
const openaiId = created.body.integration.id;
assert.equal(created.body.integration.reference, "integration://openai");
assert.equal(created.body.integration.secretHint.includes("…"), true);
assert.equal(
  JSON.stringify(created.body).includes(OPENAI_SECRET),
  false,
  "le secret ne sort jamais du POST",
);

const NOTION_SECRET = "ntn-gate-notion-secret-9876543210";
const notion = await api("POST", "/api/v1/platform/integrations", owner, {
  provider: "notion",
  label: "Notion test",
  secret: NOTION_SECRET,
});
assert.equal(notion.status, 201, "create notion");
assert.equal(notion.body.integration.reference, "integration://notion");

/* slug dupliqué refusé */
const dup = await api("POST", "/api/v1/platform/integrations", owner, {
  provider: "openai",
  label: "Doublon",
  secret: "sk-dup",
});
assert.equal(dup.status, 400, "slug openai dupliqué refusé");

/* 2. sync n8n : POST reçus avec type/nom/data mappés */
const n8nCreates = n8nCalls.filter(
  (c) => c.method === "POST" && c.url === "/api/v1/credentials",
);
assert.equal(n8nCreates.length, 2, "2 credentials poussées vers n8n");
const openaiPush = n8nCreates.find((c) => c.body.name === "creezio:openai");
assert.ok(openaiPush, "credential creezio:openai poussée");
assert.equal(openaiPush.body.type, "openAiApi");
assert.equal(openaiPush.body.data.apiKey, OPENAI_SECRET);
const notionPush = n8nCreates.find((c) => c.body.name === "creezio:notion");
assert.equal(notionPush.body.type, "notionApi");
assert.equal(
  created.body.integration.n8nCredentialId,
  "n8n-cred-1",
  "id n8n mémorisé dès la réponse du create",
);

/* 3. listing session : métadonnées + statut n8n, jamais de secret */
const list = await api("GET", "/api/v1/platform/integrations", owner);
assert.equal(list.status, 200, "list 200");
assert.equal(list.body.integrations.length, 2);
const listedOpenai = list.body.integrations.find((i) => i.slug === "openai");
assert.ok(listedOpenai.n8nCredentialId, "n8nCredentialId mémorisé");
assert.equal(
  JSON.stringify(list.body).includes(OPENAI_SECRET) ||
    JSON.stringify(list.body).includes(NOTION_SECRET),
  false,
  "aucun secret dans le listing",
);

/* 4. au repos : chiffré AES-256-GCM, pas de clair dans core.db */
{
  const db = openNodeSqliteDatabase(process.env.CREEZIO_CORE_DB_PATH);
  const row = db
    .prepare(`SELECT secret_enc FROM creezio_integrations WHERE slug='openai'`)
    .get();
  assert.ok(String(row.secret_enc).startsWith("enc:v1:"), "format enc:v1:");
  assert.equal(String(row.secret_enc).includes(OPENAI_SECRET), false);
  db.close?.();
  const rawDb = fs.readFileSync(process.env.CREEZIO_CORE_DB_PATH, "latin1");
  assert.equal(
    rawDb.includes(OPENAI_SECRET),
    false,
    "le clair n'est pas dans le fichier core.db",
  );
}

/* 5. résolution par référence : owner, clé service (Hermes), refus */
const resolveOwner = await api(
  "POST",
  "/api/v1/platform/integrations/resolve",
  owner,
  { reference: "integration://openai" },
);
assert.equal(resolveOwner.status, 200, "resolve owner 200");
assert.equal(resolveOwner.body.integration.secret, OPENAI_SECRET);

const resolveService = await api(
  "POST",
  "/api/v1/platform/integrations/resolve",
  { bearer: SERVICE_KEY },
  { reference: "integration://notion" },
);
assert.equal(
  resolveService.status,
  200,
  `resolve clé service 200 (${JSON.stringify(resolveService.body)})`,
);
assert.equal(resolveService.body.integration.secret, NOTION_SECRET);
assert.equal(resolveService.body.integration.provider, "notion");

const badKey = await api(
  "POST",
  "/api/v1/platform/integrations/resolve",
  { bearer: "gatebrand_live_wrong-key" },
  { reference: "integration://openai" },
);
assert.equal(badKey.status, 401, "clé service invalide refusée");

const unknownRef = await api(
  "POST",
  "/api/v1/platform/integrations/resolve",
  owner,
  { reference: "integration://inconnue" },
);
assert.equal(unknownRef.status, 404, "référence inconnue → 404");

/* collaborateur : list ok, mutation/resolve refusées */
const collabCreate = await api("POST", "/api/v1/users", owner, {
  username: "collab-integr",
  password: "collab-pass-1",
  kind: "human",
});
assert.equal(collabCreate.status, 201, "création collab");
const collab = await login("collab-integr", "collab-pass-1");
assert.equal(
  (await api("GET", "/api/v1/platform/integrations", collab)).status,
  200,
  "collaborateur voit les métadonnées",
);
assert.equal(
  (
    await api("POST", "/api/v1/platform/integrations", collab, {
      provider: "openai",
      label: "x",
      secret: "y",
    })
  ).status,
  403,
  "mutation réservée au owner",
);
assert.equal(
  (
    await api("POST", "/api/v1/platform/integrations/resolve", collab, {
      reference: "integration://openai",
    })
  ).status,
  401,
  "resolve refusé au collaborateur (owner ou clé service uniquement)",
);

/* 6. rename seul : pas de re-push n8n ; remplacement secret : PATCH n8n */
const callsBefore = n8nCalls.length;
const renamed = await api(
  "PATCH",
  `/api/v1/platform/integrations/${openaiId}`,
  owner,
  { label: "OpenAI renommée" },
);
assert.equal(renamed.status, 200, "rename 200");
assert.equal(renamed.body.integration.label, "OpenAI renommée");
assert.equal(n8nCalls.length, callsBefore, "rename seul ne re-pousse pas");

const NEW_SECRET = "sk-gate-openai-REPLACED-secret";
const replaced = await api(
  "PATCH",
  `/api/v1/platform/integrations/${openaiId}`,
  owner,
  { secret: NEW_SECRET },
);
assert.equal(replaced.status, 200, "remplacement secret 200");
const patchCall = n8nCalls
  .slice(callsBefore)
  .find((c) => c.method === "PATCH");
assert.ok(patchCall, "PATCH n8n émis au remplacement");
assert.equal(patchCall.body.data.apiKey, NEW_SECRET);
const resolveNew = await api(
  "POST",
  "/api/v1/platform/integrations/resolve",
  owner,
  { reference: "integration://openai" },
);
assert.equal(resolveNew.body.integration.secret, NEW_SECRET, "nouveau secret résolu");

/* 7. secret illisible (AUTH_SECRET changé) → 409 unreadable */
{
  const db = openNodeSqliteDatabase(process.env.CREEZIO_CORE_DB_PATH);
  db.prepare(
    `UPDATE creezio_integrations SET secret_enc='enc:v1:AAAA:BBBB:CCCC' WHERE slug='notion'`,
  ).run();
  db.close?.();
  const unreadable = await api(
    "POST",
    "/api/v1/platform/integrations/resolve",
    owner,
    { reference: "integration://notion" },
  );
  assert.equal(unreadable.status, 409, "secret illisible → 409");
  assert.equal(unreadable.body.code, "unreadable");
  const relisted = await api("GET", "/api/v1/platform/integrations", owner);
  assert.equal(
    relisted.body.integrations.find((i) => i.slug === "notion").readable,
    false,
    "readable=false signalé dans le listing",
  );
}

/* 8. suppression → DELETE n8n + référence introuvable */
const delCallsBefore = n8nCalls.length;
const deleted = await api(
  "DELETE",
  `/api/v1/platform/integrations/${openaiId}`,
  owner,
);
assert.equal(deleted.status, 200, "delete 200");
assert.ok(
  n8nCalls.slice(delCallsBefore).some((c) => c.method === "DELETE"),
  "DELETE n8n émis",
);
assert.equal(
  (
    await api("POST", "/api/v1/platform/integrations/resolve", owner, {
      reference: "integration://openai",
    })
  ).status,
  404,
  "référence supprimée → 404",
);

/* 9. providers mails (MA3) : resend/smtp/imap au catalogue + mapping n8n */
{
  const cat = await api("GET", "/api/v1/platform/integrations/catalog", owner);
  for (const id of ["resend", "smtp", "imap"]) {
    assert.ok(
      cat.body.providers.some((p) => p.id === id),
      `provider ${id} au catalogue`,
    );
  }

  const RESEND_SECRET = "re_gate_resend_secret_0123456789";
  const resendCreated = await api(
    "POST",
    "/api/v1/platform/integrations",
    owner,
    { provider: "resend", label: "Resend mails", secret: RESEND_SECRET },
  );
  assert.equal(resendCreated.status, 201, "create resend");
  assert.equal(
    resendCreated.body.integration.reference,
    "integration://resend",
  );
  const resendPush = n8nCalls.find(
    (c) => c.method === "POST" && c.body?.name === "creezio:resend",
  );
  assert.ok(resendPush, "credential creezio:resend poussée vers n8n");
  assert.equal(resendPush.body.type, "httpHeaderAuth");
  assert.equal(resendPush.body.data.value, `Bearer ${RESEND_SECRET}`);

  // Mapping n8n smtp/imap : user/host/port depuis meta, password = secret.
  const smtpData = getIntegrationProvider("smtp").n8n.buildData("pw-smtp", {
    user: "api_token",
    host: "smtp.mx.cloudflare.net",
    port: 465,
  });
  assert.deepEqual(smtpData, {
    user: "api_token",
    password: "pw-smtp",
    host: "smtp.mx.cloudflare.net",
    port: 465,
    secure: true,
  });
  const imapData = getIntegrationProvider("imap").n8n.buildData("pw-imap", {
    user: "compte@brand.test",
    host: "imap.example.test",
    secure: false,
  });
  assert.equal(imapData.port, 993);
  assert.equal(imapData.secure, false);
  assert.equal(imapData.password, "pw-imap");
}

surface.close();
server.close();
fakeN8n.close();
brandDbHandle.close?.();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(
  "OK test-phase-integrations — store chiffré, CRUD owner, résolution par référence (owner + clé service Hermes), sync n8n push (create/patch/delete)",
);
