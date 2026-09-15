/**
 * Tests locaux du Creezio Server Admin (spawn serveur éphémère).
 *
 * Ne requiert PAS docker : CREEZIO_DOCKER_SOCK pointe sur un chemin
 * inexistant → état docker "unknown" attendu pour les instances du registre.
 */
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_USER = "admin";
const ADMIN_PASS = "test-admin-pass";
const BASIC =
  "Basic " + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");

// Port éphémère : réservé par l'OS puis libéré pour le serveur admin.
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}
const PORT = await ephemeralPort();
// Ports des instances fixture : éphémères aussi (aucun vrai serveur ne doit
// écouter dessus — le test attend un 504 sur le proxy boot-status).
const INSTANCE_PORT_1 = await ephemeralPort();
const INSTANCE_PORT_2 = await ephemeralPort();

// Fixture : brandRoot avec registre servers.json (2 instances).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-server-admin-"));
const BRAND_ROOT = path.join(TMP, "testbrand");
fs.mkdirSync(path.join(BRAND_ROOT, "docker-data", "servers", "demo"), {
  recursive: true,
});
fs.writeFileSync(
  path.join(BRAND_ROOT, "package.json"),
  JSON.stringify({ name: "@creezio/app-testbrand" }, null, 2),
);
fs.writeFileSync(
  path.join(BRAND_ROOT, "docker-data", "servers.json"),
  JSON.stringify(
    {
      version: 1,
      brandId: "testbrand",
      image: "creezio-server-testbrand:local",
      instances: [
        {
          name: "demo",
          containerName: "testbrand-server-demo",
          port: INSTANCE_PORT_1,
          bind: "127.0.0.1",
          dataDir: "docker-data/servers/demo",
          createdAt: "2026-08-04T00:00:00.000Z",
          env: { CREEZIO_NATIVE_WARM: "1" },
        },
        {
          name: "second",
          containerName: "testbrand-server-second",
          port: INSTANCE_PORT_2,
          bind: "127.0.0.1",
          dataDir: "docker-data/servers/second",
          createdAt: "2026-08-04T00:00:00.000Z",
        },
      ],
    },
    null,
    2,
  ),
);
// Événements ops JSONL pour l'instance demo.
const opsDir = path.join(BRAND_ROOT, "docker-data", "servers", "demo", "ops");
fs.mkdirSync(opsDir, { recursive: true });
fs.writeFileSync(
  path.join(opsDir, "boot-test.jsonl"),
  [
    JSON.stringify({ ts: "2026-08-04T00:00:01Z", kind: "boot.start", seq: 1 }),
    JSON.stringify({ ts: "2026-08-04T00:00:02Z", kind: "boot.done", seq: 2 }),
    "ligne invalide pas du json",
  ].join("\n") + "\n",
);

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

const child = spawn(
  process.execPath,
  // SoT @creezio/fleet (les wrappers .mjs de compat ont été retirés en 0.19) —
  // exige le dist construit : npm run build -w @creezio/fleet.
  [
    path.join(
      __dirname,
      "../../fleet/dist/bin/server-admin-main.js",
    ),
  ],
  {
    env: {
      ...process.env,
      CREEZIO_ADMIN_PORT: String(PORT),
      CREEZIO_ADMIN_HOST: "127.0.0.1",
      CREEZIO_ADMIN_USER: ADMIN_USER,
      CREEZIO_ADMIN_PASS: ADMIN_PASS,
      CREEZIO_ADMIN_BRAND_ROOTS: BRAND_ROOT,
      // Socket inexistant → docker indisponible (le test n'exige PAS docker).
      CREEZIO_DOCKER_SOCK: path.join(TMP, "nonexistent-docker.sock"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

// Readiness : poll (un sleep fixe flake quand la machine est chargée).
{
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      await req("GET", "/admin/api/health", null, { Authorization: BASIC });
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("admin pas prêt en 10s");
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

try {
  // 401 sans auth (UI + API).
  const unauthUi = await req("GET", "/admin");
  assert.equal(unauthUi.status, 401);
  assert.ok(
    String(unauthUi.raw).includes("unauthorized") ||
      unauthUi.json?.error === "unauthorized",
  );
  const unauthApi = await req("GET", "/admin/api/servers");
  assert.equal(unauthApi.status, 401);
  const badCreds = await req("GET", "/admin/api/servers", null, {
    Authorization:
      "Basic " + Buffer.from(`${ADMIN_USER}:wrong`).toString("base64"),
  });
  assert.equal(badCreds.status, 401);

  // 200 + HTML sur /admin avec Basic auth.
  const ui = await req("GET", "/admin", null, { Authorization: BASIC });
  assert.equal(ui.status, 200);
  assert.ok(String(ui.raw).includes("<!DOCTYPE html>"));
  assert.ok(String(ui.raw).includes("Creezio Server Admin"));

  // Health.
  const health = await req("GET", "/admin/api/health", null, {
    Authorization: BASIC,
  });
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);
  assert.equal(health.json.service, "creezio-server-admin");
  assert.deepEqual(health.json.brandRoots, [BRAND_ROOT]);
  assert.equal(health.json.docker, false);

  // Servers : instances du registre, état docker "unknown" (docker absent).
  const servers = await req("GET", "/admin/api/servers", null, {
    Authorization: BASIC,
  });
  assert.equal(servers.status, 200);
  assert.equal(servers.json.ok, true);
  assert.equal(servers.json.docker, false);
  assert.equal(servers.json.servers.length, 2);
  const demo = servers.json.servers.find((s) => s.name === "demo");
  assert.ok(demo, "instance demo présente");
  assert.equal(demo.brandId, "testbrand");
  assert.equal(demo.containerName, "testbrand-server-demo");
  assert.equal(demo.port, INSTANCE_PORT_1);
  assert.equal(demo.orphan, false);
  assert.equal(demo.docker.state, "unknown");
  assert.equal(demo.bootStatus, null);
  assert.equal(demo.env.CREEZIO_NATIVE_WARM, "1");
  const second = servers.json.servers.find((s) => s.name === "second");
  assert.equal(second.docker.state, "unknown");

  // Snapshot flotte (F1) : refreshedAt présent, snapshot servi tel quel
  // (2e appel immédiat = même refreshedAt), ?fresh=1 = collecte immédiate.
  assert.ok(servers.json.refreshedAt, "refreshedAt attendu sur /servers");
  const serversAgain = await req("GET", "/admin/api/servers", null, {
    Authorization: BASIC,
  });
  assert.equal(
    serversAgain.json.refreshedAt,
    servers.json.refreshedAt,
    "sans fresh=1 le snapshot est servi tel quel (pas de recollecte)",
  );
  await new Promise((r) => setTimeout(r, 15));
  const serversFresh = await req("GET", "/admin/api/servers?fresh=1", null, {
    Authorization: BASIC,
  });
  assert.equal(serversFresh.status, 200);
  assert.equal(serversFresh.json.servers.length, 2);
  assert.ok(
    serversFresh.json.refreshedAt > servers.json.refreshedAt,
    "?fresh=1 force une collecte immédiate (refreshedAt avance)",
  );

  // Hosts : snapshot + refreshedAt (aucun hôte enrôlé dans la fixture).
  const hosts = await req("GET", "/admin/api/hosts", null, {
    Authorization: BASIC,
  });
  assert.equal(hosts.status, 200);
  assert.equal(hosts.json.ok, true);
  assert.deepEqual(hosts.json.hosts, []);
  assert.ok(hosts.json.refreshedAt, "refreshedAt attendu sur /hosts");

  // agent up pousse l'URL dédiée (POST /admin/api/hosts/agent-url, pas de Basic).
  const tok = await req(
    "POST",
    "/admin/api/hosts/enroll-token",
    JSON.stringify({ label: "gate-agenturl" }),
    { Authorization: BASIC },
  );
  assert.equal(tok.status, 200);
  assert.ok(tok.json.enrollToken);
  const enroll = await req(
    "POST",
    "/admin/api/enroll",
    JSON.stringify({
      enrollToken: tok.json.enrollToken,
      hostId: "host-gate",
      label: "gate",
      agentUrl: "https://agent.resto.example.test",
      agentToken: "agent-tok-gate-1",
    }),
  );
  assert.equal(enroll.status, 200, enroll.raw);
  assert.equal(enroll.json.ok, true);
  const pushUrl = await req(
    "POST",
    "/admin/api/hosts/agent-url",
    JSON.stringify({
      hostId: "host-gate",
      agentUrl: "https://agent-resto.example.test/",
      agentToken: "agent-tok-gate-1",
    }),
  );
  assert.equal(pushUrl.status, 200, pushUrl.raw);
  assert.equal(pushUrl.json.ok, true);
  assert.equal(pushUrl.json.agentUrl, "https://agent-resto.example.test");
  assert.equal(pushUrl.json.changed, true);
  const hostsFile = JSON.parse(
    fs.readFileSync(path.join(BRAND_ROOT, "docker-data", "fleet-hosts.json"), "utf8"),
  );
  assert.equal(
    hostsFile.hosts[0].agentUrl,
    "https://agent-resto.example.test",
    "fleet-hosts.json : plus l'URL nested partagée",
  );
  const badTok = await req(
    "POST",
    "/admin/api/hosts/agent-url",
    JSON.stringify({
      hostId: "host-gate",
      agentUrl: "https://agent-resto.example.test",
      agentToken: "wrong",
    }),
  );
  assert.equal(badTok.status, 401);
  const noHttps = await req(
    "POST",
    "/admin/api/hosts/agent-url",
    JSON.stringify({
      hostId: "host-gate",
      agentUrl: "http://agent-resto.example.test",
      agentToken: "agent-tok-gate-1",
    }),
  );
  assert.equal(noHttps.status, 400);

  // Ops JSONL : événements parsés, lignes invalides ignorées.
  const ops = await req(
    "GET",
    "/admin/api/servers/testbrand/demo/ops?limit=100",
    null,
    { Authorization: BASIC },
  );
  assert.equal(ops.status, 200);
  assert.equal(ops.json.ok, true);
  assert.equal(ops.json.events.length, 2);
  assert.equal(ops.json.events[0].kind, "boot.start");
  // Instance sans ops/ → vide, pas d'erreur.
  const opsEmpty = await req(
    "GET",
    "/admin/api/servers/testbrand/second/ops",
    null,
    { Authorization: BASIC },
  );
  assert.equal(opsEmpty.status, 200);
  assert.deepEqual(opsEmpty.json.events, []);

  // Disk : tailles par instance + filesystem.
  const disk = await req("GET", "/admin/api/disk", null, {
    Authorization: BASIC,
  });
  assert.equal(disk.status, 200);
  assert.equal(disk.json.ok, true);
  assert.equal(disk.json.instances.length, 2);
  assert.ok(
    disk.json.instances.find((d) => d.name === "demo").sizeBytes > 0,
    "taille data demo > 0 (fixtures ops)",
  );
  assert.ok(disk.json.filesystem.freeBytes > 0);
  assert.ok(disk.json.refreshedAt, "refreshedAt attendu sur /disk");
  await new Promise((r) => setTimeout(r, 15));
  const diskFresh = await req("GET", "/admin/api/disk?fresh=1", null, {
    Authorization: BASIC,
  });
  assert.equal(diskFresh.status, 200);
  assert.ok(
    diskFresh.json.refreshedAt > disk.json.refreshedAt,
    "?fresh=1 force un scan disque immédiat",
  );

  // Instance inconnue → 404.
  const notFound = await req(
    "GET",
    "/admin/api/servers/testbrand/nope/ops",
    null,
    { Authorization: BASIC },
  );
  assert.equal(notFound.status, 404);

  // Create : brandRoot hors CREEZIO_ADMIN_BRAND_ROOTS refusé.
  const badRoot = await req(
    "POST",
    "/admin/api/servers",
    JSON.stringify({ brandRoot: "/etc", name: "evil" }),
    { Authorization: BASIC },
  );
  assert.equal(badRoot.status, 400);
  // Create : nom invalide refusé.
  const badName = await req(
    "POST",
    "/admin/api/servers",
    JSON.stringify({ brandRoot: BRAND_ROOT, name: "Bad_Name!" }),
    { Authorization: BASIC },
  );
  assert.equal(badName.status, 400);
  // Create : nom déjà pris → 409 (avant tout appel docker).
  const dup = await req(
    "POST",
    "/admin/api/servers",
    JSON.stringify({ brandRoot: BRAND_ROOT, name: "demo" }),
    { Authorization: BASIC },
  );
  assert.equal(dup.status, 409);

  // Boot-status proxy : serveur injoignable → 504.
  const bs = await req(
    "GET",
    "/admin/api/servers/testbrand/demo/boot-status",
    null,
    { Authorization: BASIC },
  );
  assert.equal(bs.status, 504);

  // 0 domaine marque hardcodé dans l'UI admin servie (SoT fleet + collector).
  const src =
    fs.readFileSync(
      path.join(__dirname, "../../fleet/public/admin.html"),
      "utf8",
    ) + fs.readFileSync(path.join(__dirname, "public", "admin.html"), "utf8");
  assert.ok(!/tempoflow\.fr|certivan\.creez\.io/i.test(src));

  console.log("OK — server-admin (@creezio/observability)");
} finally {
  child.kill("SIGTERM");
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ── backupInstanceData : archive vérifiée (gzip -t), jamais de warning
// silencieux. Piège vécu : GNU tar exit 1 (« file changed as we read it »)
// sur volume vivant = archive VALIDE, l'ancien code la jetait en
// « backup indisponible (tar) » alors que le .tar.gz complet existait.
{
  const { backupInstanceData, backupsDir } = await import("./server-lib.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-backup-"));
  try {
    const brandRoot = path.join(tmp, "brand");
    const dataDir = path.join("docker-data", "servers", "demo");
    fs.mkdirSync(path.join(brandRoot, dataDir, "sub"), { recursive: true });
    fs.writeFileSync(
      path.join(brandRoot, dataDir, "sub", "core.db"),
      "contenu-test",
    );
    const inst = { name: "demo", dataDir };

    const ok = await backupInstanceData(brandRoot, inst);
    assert.equal(ok.ok, true, `backup attendu OK: ${ok.detail}`);
    assert.ok(fs.existsSync(ok.file), "archive .tar.gz absente");
    assert.ok(fs.statSync(ok.file).size > 0, "archive vide");
    assert.match(ok.detail, /gzip vérifié/);
    assert.ok(ok.file.startsWith(backupsDir(brandRoot)));

    // Volume introuvable → échec PROPRE avec détail (pas de null muet).
    const ko = await backupInstanceData(brandRoot, {
      name: "fantome",
      dataDir: path.join("docker-data", "servers", "fantome"),
    });
    assert.equal(ko.ok, false);
    assert.match(ko.detail, /introuvable/);
    console.log("OK — backupInstanceData (archive gzip vérifiée)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── updateServer : défaut backup=false, pas de prune des archives existantes
{
  const { updateServer } = await import("./server-lib.mjs");
  // P2.b : server-lib.mjs est un wrapper compat — lire la source RÉELLE
  // (dist @creezio/fleet, résolu comme à l'exécution).
  const src = fs.readFileSync(
    new URL(import.meta.resolve("@creezio/fleet/server-lib")),
    "utf8",
  );
  assert.match(src, /backup = false/);
  assert.match(src, /pas de nouveau backup \(défaut\)/);
  assert.match(src, /if \(backup\)/);
  // Politique propriétaire : ne pas purger les backups de référence à l'update.
  assert.doesNotMatch(src, /pruneBackups\(brandRoot, inst\.name\)/);
  // 0.10.3 : update ne droppe plus un sidecar / hostname public.
  assert.match(src, /resolveStackUpdatePolicy/);
  assert.match(src, /preserve-sidecar/);
  assert.equal(typeof updateServer, "function");
  console.log("OK — updateServer défaut sans backup + archives conservées");
}

// ── dirSizeBytes / buildDiskReport asynchrones (F1) : fs.promises, plus de
// readdirSync/statSync récursifs qui gèlent l'event loop mono-thread.
{
  const { dirSizeBytes, buildDiskReport } = await import("./server-lib.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-disk-"));
  try {
    fs.mkdirSync(path.join(tmp, "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "a.bin"), "12345");
    fs.writeFileSync(path.join(tmp, "sub", "b.bin"), "1234567890");
    const p = dirSizeBytes(tmp);
    assert.ok(p instanceof Promise, "dirSizeBytes doit être asynchrone");
    assert.equal(await p, 15);
    const report = buildDiskReport([]);
    assert.ok(report instanceof Promise, "buildDiskReport doit être asynchrone");
    assert.equal((await report).ok, true);
    console.log("OK — dirSizeBytes/buildDiskReport async");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── createFleetSnapshotPoller (F1) : jamais réentrant (cycle en cours
// réutilisé), refresh forcé après cycle, scan disque séparé.
{
  const { createFleetSnapshotPoller } = await import("./server-lib.mjs");
  let coreCalls = 0;
  let diskCalls = 0;
  let release;
  const gate = new Promise((r) => (release = r));
  const poller = createFleetSnapshotPoller({
    collectServersView: async () => {
      coreCalls += 1;
      await gate;
      return { docker: true, servers: [{ name: "x" }] };
    },
    collectHostsView: async () => [{ hostId: "h1" }],
    collectDiskView: async () => {
      diskCalls += 1;
      return { ok: true, instances: [], filesystem: null };
    },
    intervalMs: 3_600_000,
  });
  // 3 refresh concurrents pendant qu'un cycle est en cours → 1 seule collecte.
  const p1 = poller.refreshCore();
  const p2 = poller.refreshCore();
  const p3 = poller.refreshCore();
  assert.equal(coreCalls, 1, "cycle en cours réutilisé (jamais réentrant)");
  release();
  await Promise.all([p1, p2, p3]);
  assert.equal(coreCalls, 1);
  assert.equal(poller.snapshot.servers.docker, true);
  assert.deepEqual(poller.snapshot.hosts, [{ hostId: "h1" }]);
  assert.ok(poller.snapshot.refreshedAt);
  // Cycle terminé : un nouveau refresh relance bien une collecte.
  await poller.refreshCore();
  assert.equal(coreCalls, 2);
  // Scan disque indépendant du cycle core (cadence 1/N côté poller).
  assert.equal(diskCalls, 0);
  await poller.refreshDisk();
  assert.equal(diskCalls, 1);
  assert.ok(poller.snapshot.diskRefreshedAt);
  poller.stop();
  console.log("OK — createFleetSnapshotPoller (non réentrant, snapshot)");
}
