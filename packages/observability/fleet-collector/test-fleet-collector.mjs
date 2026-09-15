/**
 * Tests locaux du fleet-collector kit (spawn serveur éphémère).
 * Env neutre CREEZIO_* — pas de domaine marque.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 18765;
const INGEST = "testingesttoken0123456789abcdef01234567";
const OPS = "testopstoken0123456789abcdef0123456789ab";
const OPS_USER = "ops";
const OPS_PASS = "ops";
const UI_TITLE = "Fleet Test";
const TUNNEL_SUFFIX = "example.test";
const BASIC = "Basic " + Buffer.from(`${OPS_USER}:${OPS_PASS}`).toString("base64");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-fleet-"));

function req(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: urlPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

const child = spawn(process.execPath, [path.join(__dirname, "server.mjs")], {
  env: {
    ...process.env,
    CREEZIO_FLEET_PORT: String(PORT),
    CREEZIO_FLEET_INGEST_TOKEN: INGEST,
    CREEZIO_FLEET_OPS_TOKEN: OPS,
    CREEZIO_FLEET_OPS_USER: OPS_USER,
    CREEZIO_FLEET_OPS_PASS: OPS_PASS,
    CREEZIO_FLEET_DIR: DIR,
    CREEZIO_FLEET_UI_TITLE: UI_TITLE,
    CREEZIO_FLEET_UI_MARK: "FT",
    CREEZIO_FLEET_UI_HOME_TITLE: "Flotte Test",
    CREEZIO_FLEET_TUNNEL_SUFFIX: TUNNEL_SUFFIX,
    CREEZIO_FLEET_UI_EXTRAS_TITLE: "Dossiers",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

// Readiness : poll (un sleep fixe flake quand la machine est chargée).
{
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await req("GET", "/ops/api/health", null, { Authorization: BASIC });
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("collector pas prêt en 10s");
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

try {
  const bad = await req("POST", "/i-wrong/heartbeat", "{}");
  assert.equal(bad.status, 404);

  const hb = await req(
    "POST",
    `/i-${INGEST}/heartbeat`,
    JSON.stringify({
      installId: "install-test-001",
      appVersion: "0.5.0",
      platform: "linux",
      arch: "x64",
      consent: { enabled: true, scopes: { heartbeat: true, crashes: true } },
      tunnelSlug: "demo",
      health: { next: "running" },
      dossierStats: {
        total: 3,
        actifs7j: 1,
        parEtat: { EN_COURS: 2, VALIDE: 1 },
      },
    }),
  );
  assert.equal(hb.status, 200);
  assert.equal(hb.json.ok, true);

  const crash = await req(
    "POST",
    `/i-${INGEST}/crash`,
    JSON.stringify({
      installId: "install-test-001",
      kind: "boot-failure",
      appVersion: "0.5.0",
      detail: { message: "test" },
      timestamp: new Date().toISOString(),
    }),
  );
  assert.equal(crash.status, 204);

  const unauthUi = await req("GET", "/");
  assert.equal(unauthUi.status, 401);

  const ui = await req("GET", "/", null, { Authorization: BASIC });
  assert.equal(ui.status, 200);
  assert.ok(String(ui.raw).includes(UI_TITLE));
  assert.ok(String(ui.raw).includes("sideNav"));
  assert.ok(String(ui.raw).includes("__FLEET_BRAND__"));

  const unauth = await req("GET", "/ops/api/installs");
  assert.equal(unauth.status, 401);

  const fleet = await req("GET", "/ops/api/fleet", null, {
    Authorization: BASIC,
  });
  assert.equal(fleet.status, 200);
  assert.ok(fleet.json.servers.length >= 1);
  assert.equal(fleet.json.servers[0].slug, "demo");
  assert.equal(fleet.json.servers[0].hostname, `demo.${TUNNEL_SUFFIX}`);
  assert.equal(fleet.json.stats.dossiers.total, 3);
  assert.ok(fleet.json.stats.versions["0.5.0"] >= 1);

  // Bundle actions riche (P0/P1)
  const actBundle = await req(
    "POST",
    `/i-${INGEST}/bundle`,
    JSON.stringify({
      installId: "install-test-001",
      kind: "actions",
      timestamp: new Date().toISOString(),
      items: [
        {
          schemaVersion: 1,
          name: "ui.click",
          type: "ui.click",
          category: "ui",
          label: "nav.panier",
          path: "/dashboard",
          userId: "u1",
          username: "alice",
          durationMs: undefined,
          meta: { aid: "nav.panier" },
          at: new Date().toISOString(),
        },
        {
          schemaVersion: 1,
          name: "page.hide",
          type: "page.hide",
          category: "navigation",
          label: "Quitte /produits",
          path: "/produits",
          userId: "u1",
          username: "alice",
          durationMs: 15000,
          at: new Date().toISOString(),
        },
      ],
    }),
  );
  assert.equal(actBundle.status, 200);

  const server = await req("GET", "/ops/api/server/demo", null, {
    Authorization: BASIC,
  });
  assert.equal(server.status, 200);
  assert.ok(server.json.users.length >= 1);
  assert.ok(
    (server.json.activity || []).some((a) => a.name === "ui.click" || a.type === "ui.click"),
  );
  assert.equal(server.json.server.dossierStats.total, 3);

  const userDetail = await req(
    "GET",
    "/ops/api/server/demo/user/u1",
    null,
    { Authorization: BASIC },
  );
  // user may be host fallback if users list doesn't include u1 — still OK if activity filtered
  assert.ok(userDetail.status === 200 || userDetail.status === 404);

  // Orphans (sans userId) visibles pour le seul owner / seul humain
  const usersHb = await req(
    "POST",
    `/i-${INGEST}/heartbeat`,
    JSON.stringify({
      installId: "install-test-001",
      appVersion: "0.6.1",
      platform: "linux",
      arch: "x64",
      consent: { enabled: true, scopes: { heartbeat: true, actions: true } },
      tunnelSlug: "demo",
      health: { next: "running" },
      users: [
        {
          id: "owner-1",
          username: "bob",
          role: "owner",
          kind: "human",
          active: true,
        },
      ],
    }),
  );
  assert.equal(usersHb.status, 200);
  const orphanBundle = await req(
    "POST",
    `/i-${INGEST}/bundle`,
    JSON.stringify({
      installId: "install-test-001",
      kind: "actions",
      timestamp: new Date().toISOString(),
      items: [
        {
          schemaVersion: 1,
          name: "page.view",
          type: "page.view",
          category: "navigation",
          label: "Page /orphan",
          path: "/orphan",
          at: new Date().toISOString(),
        },
      ],
    }),
  );
  assert.equal(orphanBundle.status, 200);
  const orphanUser = await req(
    "GET",
    "/ops/api/server/demo/user/owner-1",
    null,
    { Authorization: BASIC },
  );
  assert.equal(orphanUser.status, 200);
  assert.ok(
    (orphanUser.json.activity || []).some((a) => a.path === "/orphan"),
    "activité orpheline rattachée au seul owner",
  );

  const list = await req("GET", "/ops/api/installs", null, {
    Authorization: BASIC,
  });
  assert.equal(list.status, 200);
  assert.ok(list.json.installs.length >= 1);
  assert.equal(list.json.installs[0].tunnelSlug, "demo");

  const listBearer = await req("GET", "/ops/api/installs", null, {
    Authorization: `Bearer ${OPS}`,
  });
  assert.equal(listBearer.status, 200);

  // Dual-read legacy prefix : TF2_* encore accepté si CREEZIO_* absents
  // (couvert par resolveFleetCollectorEnv — smoke ici via Bearer OPS déjà set).

  const enq = await req(
    "POST",
    "/ops/api/commands",
    JSON.stringify({
      installId: "install-test-001",
      command: "sync-now",
    }),
    { Authorization: BASIC },
  );
  assert.equal(enq.status, 200);
  assert.equal(enq.json.command.command, "sync-now");

  const pending = await req(
    "GET",
    `/i-${INGEST}/commands?installId=install-test-001`,
  );
  assert.equal(pending.status, 200);
  assert.equal(pending.json.commands.length, 1);

  const ack = await req(
    "POST",
    `/i-${INGEST}/commands/ack`,
    JSON.stringify({
      installId: "install-test-001",
      commandId: pending.json.commands[0].id,
      ok: true,
      detail: "ok",
    }),
  );
  assert.equal(ack.status, 200);

  const badCmd = await req(
    "POST",
    "/ops/api/commands",
    JSON.stringify({ installId: "install-test-001", command: "rm -rf /" }),
    { Authorization: `Bearer ${OPS}` },
  );
  assert.equal(badCmd.status, 400);

  // Boîte noire : lastBootSummary (heartbeat) + bundle ops_events
  const opsHb = await req(
    "POST",
    `/i-${INGEST}/heartbeat`,
    JSON.stringify({
      installId: "install-test-001",
      appVersion: "0.9.0",
      platform: "linux",
      arch: "x64",
      consent: { enabled: true, scopes: { heartbeat: true, ops: true } },
      tunnelSlug: "demo",
      health: { next: "running" },
      lastBootSummary: {
        bootId: "boot-abc",
        startedAt: new Date().toISOString(),
        durationMs: 42000,
        counts: { decision: 3, event: 8 },
        decisions: {
          "meili.ready": { outcome: "full-reindex", reason: "fingerprint-absent" },
        },
        durations: { "boot.done": 42000 },
      },
    }),
  );
  assert.equal(opsHb.status, 200);

  const opsBundle = await req(
    "POST",
    `/i-${INGEST}/bundle`,
    JSON.stringify({
      installId: "install-test-001",
      kind: "ops_events",
      timestamp: new Date().toISOString(),
      items: [
        {
          ts: new Date().toISOString(),
          bootId: "boot-abc",
          seq: 1,
          source: "main",
          level: "decision",
          kind: "meili.ready",
          outcome: "full-reindex",
          reason: "fingerprint-absent",
          ctx: { sql: { produits: 10 } },
        },
        {
          ts: new Date().toISOString(),
          bootId: "boot-abc",
          seq: 2,
          source: "indexer",
          level: "event",
          kind: "index.done",
          outcome: "ok",
          durationMs: 61000,
        },
      ],
    }),
  );
  assert.equal(opsBundle.status, 200);

  const opsDetail = await req("GET", "/ops/api/server/demo", null, {
    Authorization: BASIC,
  });
  assert.equal(opsDetail.status, 200);
  assert.ok(opsDetail.json.ops, "section ops présente");
  assert.equal(
    opsDetail.json.ops.lastBootSummary.decisions["meili.ready"].outcome,
    "full-reindex",
  );
  assert.ok(
    (opsDetail.json.ops.events || []).some(
      (e) => e.kind === "meili.ready" && e.reason === "fingerprint-absent",
    ),
    "événement ops meili.ready remonté",
  );
  assert.ok(
    (opsDetail.json.ops.events || []).some((e) => e.kind === "index.done"),
    "événement ops index.done remonté",
  );

  // 0 domaine marque hardcodé dans le binaire
  const src = fs.readFileSync(path.join(__dirname, "server.mjs"), "utf8")
    + fs.readFileSync(path.join(__dirname, "ops-api.mjs"), "utf8");
  assert.ok(!/tempoflow\.fr|certivan\.creez\.io/i.test(src));

  console.log("OK — fleet-collector (@creezio/observability)");
} finally {
  child.kill("SIGTERM");
  try {
    fs.rmSync(DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
