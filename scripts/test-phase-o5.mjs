#!/usr/bin/env node
/**
 * Phase O5 — Admin request-logs / api-endpoints → @creezio/observability (kit only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");
const pkg = path.join(root, "packages/observability");
const src = path.join(pkg, "src/request-logs");
const ui = path.join(pkg, "ui");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const BRANDS = ["tempoflow2", "certivan-app", "fidu"];

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkTs(p));
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

test("O5.1 PHASE-O5.md + PLAN-O O5", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-O5.md"), "utf8");
  assert.match(phase, /request-logs|RequestLogsClient/i);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-o5/);
  assert.match(phase, /configureRequestLogs|createRequestLogsRoutes/);
  assert.doesNotMatch(phase, PAPERCLIP_RE);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-O.md"), "utf8");
  assert.match(plan, /## O5 — Admin request-logs/);
  assert.match(plan, /PHASE-O5\.md/);
  assert.match(plan, /O5 — Admin request-logs.*✅|## O5 —[\s\S]*?✅/);
});

test("O5.2 src/request-logs + exports kit", () => {
  for (const f of [
    "request-logs.ts",
    "middleware.ts",
    "http-routes.ts",
    "config.ts",
    "index.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(src, f)), `manquant: ${f}`);
  }

  const body = fs.readFileSync(path.join(src, "request-logs.ts"), "utf8");
  assert.match(body, /export function pushRequestLog/);
  assert.match(body, /export function listRequestLogs/);
  assert.match(body, /export function redactSecrets/);
  assert.match(body, /resolveFleetStateDir/);
  assert.doesNotMatch(body, /from ["']@\//);
  assert.doesNotMatch(body, /tf2_live_/); // générique [a-z0-9]+_live_

  const mw = fs.readFileSync(path.join(src, "middleware.ts"), "utf8");
  assert.match(mw, /export const requestLogApiMiddleware/);
  assert.match(mw, /export const requestLogMcpMiddleware/);
  assert.doesNotMatch(mw, /from ["']@\//);

  const routes = fs.readFileSync(path.join(src, "http-routes.ts"), "utf8");
  assert.match(routes, /export function createRequestLogsRoutes/);

  const index = fs.readFileSync(path.join(pkg, "src/index.ts"), "utf8");
  assert.match(index, /createRequestLogsRoutes/);
  assert.match(index, /requestLogApiMiddleware/);
  assert.match(index, /configureRequestLogs/);
  assert.match(index, /RequestLogEntry/);
});

test("O5.3 UI clients + exports ./ui", () => {
  assert.ok(fs.existsSync(path.join(ui, "request-logs-client.tsx")));
  assert.ok(fs.existsSync(path.join(ui, "api-endpoints-client.tsx")));
  const rl = fs.readFileSync(path.join(ui, "request-logs-client.tsx"), "utf8");
  assert.match(rl, /export function RequestLogsClient/);
  assert.doesNotMatch(rl, /from ["']@\//);
  const ae = fs.readFileSync(path.join(ui, "api-endpoints-client.tsx"), "utf8");
  assert.match(ae, /export function ApiEndpointsClient/);
  assert.doesNotMatch(ae, /from ["']@\//);

  const uiIndex = fs.readFileSync(path.join(ui, "index.ts"), "utf8");
  assert.match(uiIndex, /RequestLogsClient/);
  assert.match(uiIndex, /ApiEndpointsClient/);
});

test("O5.4 pas de Paperclip + corpus sans @/", () => {
  const corpus = [
    ...walkTs(src),
    path.join(ui, "request-logs-client.tsx"),
    path.join(ui, "api-endpoints-client.tsx"),
  ]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  assert.doesNotMatch(corpus, PAPERCLIP_RE);
  assert.doesNotMatch(corpus, /from ["']@\//);
  assert.doesNotMatch(corpus, /tempoflow2-crm|getOrCreatePanier/);
});

test("O5.5 cutover délégué O5p (jumeaux absents post-cutover)", () => {
  // O5 extract-only ; O5p a supprimé les jumeaux — assert absences.
  for (const brand of BRANDS) {
    for (const rel of [
      "crm/src/lib/request-logs.ts",
      "crm/src/server/request-log-middleware.ts",
      "crm/src/server/routes/request-logs.ts",
      "crm/src/components/admin/request-logs-client.tsx",
    ]) {
      const p = path.join(dockerRoot, brand, rel);
      assert.ok(!fs.existsSync(p), `${brand}: jumeau encore présent ${rel}`);
    }
  }
  for (const brand of ["tempoflow2", "certivan-app"]) {
    const p = path.join(
      dockerRoot,
      brand,
      "crm/src/components/admin/api-endpoints-client.tsx",
    );
    assert.ok(!fs.existsSync(p), `${brand}: api-endpoints-client encore présent`);
  }
});

test("O5.6 build dist + smoke export", async () => {
  assert.ok(
    fs.existsSync(path.join(pkg, "dist/request-logs/request-logs.js")),
    "dist/request-logs/request-logs.js manquant — rebuild @creezio/observability",
  );
  assert.ok(
    fs.existsSync(path.join(pkg, "dist-cjs/index.js")),
    "dist-cjs manquant — build-cjs",
  );
  const mod = await import(path.join(pkg, "dist/index.js"));
  assert.equal(typeof mod.pushRequestLog, "function");
  assert.equal(typeof mod.listRequestLogs, "function");
  assert.equal(typeof mod.createRequestLogsRoutes, "function");
  assert.equal(typeof mod.requestLogApiMiddleware, "function");
  assert.equal(typeof mod.requestLogMcpMiddleware, "function");
  assert.equal(typeof mod.configureRequestLogs, "function");
  assert.equal(typeof mod.redactSecrets, "function");

  mod._resetRequestLogsForTests(10);
  const entry = mod.pushRequestLog({
    ts: new Date().toISOString(),
    source: "api",
    method: "GET",
    path: "/api/v1/ping",
    status: 200,
    durationMs: 1,
    detail: { ok: true },
  });
  assert.ok(entry.id);
  const listed = mod.listRequestLogs({ limit: 5 });
  assert.ok(listed.logs.length >= 1);
  assert.equal(mod.redactSecrets({ token: "secret", x: "tf2_live_abc123" }).token, "[redacted]");
  assert.match(String(mod.redactSecrets("tf2_live_abc123")), /redacted/);
});

test("O5.7 gate enregistrée npm test", () => {
  const pkgJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkgJson, /test-phase-o5\.mjs/);
});
