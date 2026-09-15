#!/usr/bin/env node
/**
 * Smoke live — surface plateforme + sidecar navigateur IA (hors Docker).
 *
 * Prouve sur ce poste :
 *  1. mountBrandPlatformSurface : login owner (kit-first), création collab IA ;
 *  2. startBrandBrowserSidecar : Chromium up, session IA (page CRM sidecar) ;
 *  3. routage B3 : dispatchSupplierAction ciblé IA → exécuteur in-process
 *     (external_click / external_read OK sans bridge Electron) ;
 *  4. screencast : frames publiées sur le hub + stream SSE
 *     /api/v1/tasks/screencast/<ai>/stream consommable.
 *
 * Usage :
 *   CREEZIO_CHROMIUM_BIN=/snap/bin/chromium \
 *   CREEZIO_BROWSER_DATA_DIR=$HOME/snap/chromium/common/creezio-smoke \
 *   node packages/app-runtime/scripts/smoke-platform-surface.mjs
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "smoke-secret";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-platform-smoke-"));
process.env.CREEZIO_CORE_DB_PATH = path.join(tmp, "core.db");

const { mountBrandPlatformSurface, startBrandBrowserSidecar, createPlatformTasksBrandAdapters } =
  await import("../dist/index.js");
const { migrateBrandCredentialsToKit } = await import("@creezio/auth");
const { configureTasksBrand } = await import("@creezio/tasks");
const { dispatchSupplierAction } = await import("@creezio/assistant");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    process.exitCode = 1;
  }
};

/* 1. Owner kit + surface */
await migrateBrandCredentialsToKit({
  username: "owner@smoke.local",
  password: "smoke-password-1",
  displayName: "Owner Smoke",
});

let baseUrl = "";
const surface = mountBrandPlatformSurface({
  brandId: "smokebrand",
  coreDbPath: process.env.CREEZIO_CORE_DB_PATH,
  baseUrl: () => baseUrl,
});

configureTasksBrand({
  productName: "SmokeBrand",
  productDomain: "smoke",
  hermesSourceLabel: "SmokeBrand",
  hermesSkill: "smoke",
  envPrefix: "SMOKE_AI",
  idempotencyPrefix: "smoke",
  assistantIdempotencyPrefix: "smoke-asst",
  taskHref: "/taches",
  examplePaths: ["/taches"],
  navigation: {
    permissionForPath: () => null,
    hasPermission: () => true,
  },
  externalTabs: {
    resolve: (input) => ({
      ok: true,
      url: String(input.url || ""),
      title: String(input.title || input.url || ""),
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
    body: ["GET", "HEAD"].includes(req.method || "GET") || !body.length ? undefined : body,
  });
  const response = await surface.app.fetch(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res);
  else res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
baseUrl = `http://127.0.0.1:${server.address().port}`;
console.log(`surface sur ${baseUrl}`);

/* 2. Login owner (kit-first) */
const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "owner@smoke.local", password: "smoke-password-1" }),
});
const setCookie = loginRes.headers.get("set-cookie") || "";
const cookie = setCookie.split(";")[0];
check("login owner kit-first", loginRes.status === 200 && cookie.includes("session"), `status=${loginRes.status} cookie=${cookie.slice(0, 40)}…`);

const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { cookie } });
const me = await meRes.json().catch(() => ({}));
check("GET /auth/me owner", meRes.status === 200 && me?.role === "owner", JSON.stringify(me).slice(0, 120));

/* 3. Création collaborateur IA */
const aiRes = await fetch(`${baseUrl}/api/v1/platform/users`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ username: "Jarvis", kind: "ai" }),
});
const aiBody = await aiRes.json();
const aiUserId = aiBody?.user?.id || "";
check("création collab IA", aiRes.status === 201 && aiUserId.startsWith("ai-"), `id=${aiUserId}`);

/* 4. Sidecar Chromium */
const sidecar = await startBrandBrowserSidecar({
  dataDir: tmp,
  sessionCookieName: surface.runtime.sessionCookieName,
  baseUrl: () => baseUrl,
  store: surface.runtime.store,
  onLog: (l) => console.log(`  [sidecar] ${l}`),
});
surface.attachSidecar(sidecar);
check("sidecar démarré", Boolean(sidecar.chromiumBinary), `bin=${sidecar.chromiumBinary} display=${sidecar.display || "headless"}`);

/* 5. Session IA : page CRM sidecar */
const ensure = await sidecar.host.ensure({ aiUserId, label: "Jarvis" });
check("session IA (page CRM sidecar)", ensure?.ready === true, JSON.stringify(ensure).slice(0, 140));

/* 6. Onglet externe + routage in-process (dispatch ciblé IA, pas de bridge) */
const opened = await dispatchSupplierAction(
  "ai_workspace_open_tab",
  { ai_user_id: aiUserId, site_id: 1, url: "https://example.com/", title: "Example" },
  undefined,
  { targetUserId: aiUserId, requireTargetOnline: true },
);
check("dispatch ai_workspace_open_tab → exécuteur in-process", opened?.ok === true, JSON.stringify(opened).slice(0, 140));

const read = await dispatchSupplierAction(
  "ai_workspace_web_action",
  { ai_user_id: aiUserId, web_type: "external_read", web_params: {} },
  undefined,
  { targetUserId: aiUserId, requireTargetOnline: true },
);
const readText = JSON.stringify(read);
check("external_read via exécuteur in-process", read?.ok === true && /Example Domain/i.test(readText), readText.slice(0, 140));

const targets = await dispatchSupplierAction(
  "ai_workspace_web_action",
  { ai_user_id: aiUserId, web_type: "external_list_targets", web_params: {} },
  undefined,
  { targetUserId: aiUserId, requireTargetOnline: true },
);
const firstRef = targets?.targets?.[0]?.ref || "";
check("external_list_targets (≥1 cible)", targets?.ok === true && Boolean(firstRef), JSON.stringify(targets?.targets || []).slice(0, 140));

const click = await dispatchSupplierAction(
  "ai_workspace_web_action",
  { ai_user_id: aiUserId, web_type: "external_click", web_params: { ref: firstRef } },
  undefined,
  { targetUserId: aiUserId, requireTargetOnline: true },
);
check("external_click via exécuteur in-process", click?.ok === true, JSON.stringify(click).slice(0, 140));

/* 7. Screencast : SSE tasks (démarre au 1er spectateur) */
const sseController = new AbortController();
const sseRes = await fetch(`${baseUrl}/api/v1/tasks/screencast/${aiUserId}/stream`, {
  headers: { cookie, accept: "text/event-stream" },
  signal: sseController.signal,
});
check("SSE screencast status 200", sseRes.status === 200, `content-type=${sseRes.headers.get("content-type")}`);

let frames = 0;
let sawStatusOk = false;
const reader = sseRes.body.getReader();
const deadline = Date.now() + 20_000;
let buf = "";
while (Date.now() < deadline && frames < 3) {
  const { value, done } = await Promise.race([
    reader.read(),
    new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 1500)),
  ]);
  if (done) break;
  if (!value) continue;
  buf += Buffer.from(value).toString("utf8");
  const events = buf.split("\n\n");
  buf = events.pop() || "";
  for (const evt of events) {
    if (/event: status/.test(evt) && /"ok":\s*true/.test(evt)) sawStatusOk = true;
    if (/event: frame/.test(evt) && /"data":"/.test(evt)) frames += 1;
  }
}
sseController.abort();
check("SSE status ok", sawStatusOk);
check("frames screencast reçues (≥1)", frames >= 1, `frames=${frames}`);

/* Nettoyage */
await sidecar.close();
surface.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks OK`);
process.exit(failed.length ? 1 : 0);
