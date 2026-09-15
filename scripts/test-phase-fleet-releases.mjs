#!/usr/bin/env node
/**
 * Gate — updates en PULL de la flotte (F5).
 *
 * Prouve, sur DB brand réelle (better-sqlite3, migrations admin) + mocks
 * admin/registre :
 *  1. migration admin_005_fleet_releases : admin_fleet_releases,
 *     admin_fleet_update_reports (UNIQUE release+serveur),
 *     admin_fleet_download_slots ;
 *  2. directives `next` filtrées : release rolling ∧ channel ∧ ¬hold ∧
 *     pin prioritaire ∧ vague (hash(server_id) mod 100 < wave_pct),
 *     cible identique à l'image courante → pas de directive ;
 *  3. auth agents : Bearer hostId:agentToken vérifié (mock verifier) —
 *     credential invalide → 401, hostId incohérent → 401 ;
 *  4. sémaphore de téléchargement : N slots, file (position/retryAfter),
 *     idempotence par serveur, lease expirée PURGÉE (horloge injectée),
 *     DELETE libère ;
 *  5. report : enregistré puis upserté par (release, serveur) + événement ;
 *  6. boucle agent (runAgentUpdateCycle, mock admin HTTP + mock
 *     updateServer) : slot → pull par digest → update → release slot →
 *     report done ; échec avec rollback → report rolled_back ; mutex
 *     update manuel respecté ;
 *  7. publish --release : declareFleetRelease poste la release (draft,
 *     digest, référence publique) — idempotent ;
 *  8. vérificateur par défaut (T4) : createBackendFleetCredentialVerifier
 *     délègue au client typé @creezio/fleet (POST /admin/api/hosts/verify,
 *     Basic) — valid/invalid + cache mémoire (pas de re-hit backend) +
 *     Basic manquant → refus local sans appel réseau.
 */
import http from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";

const {
  adminMigrations,
  computeFleetUpdateDirectives,
  createBackendFleetCredentialVerifier,
  createFleetReleasesMount,
  fleetWaveBucket,
  fleetWaveIncludes,
  purgeExpiredFleetSlots,
  upsertFleetServerStatus,
} = await import("../packages/admin/dist/index.js");
// SoT @creezio/fleet (wrappers fleet-collector retirés en 0.19) — dist requis.
const { runAgentUpdateCycle, imageRefWithDigest } = await import(
  "../packages/fleet/dist/agent-updates.js"
);
const { declareFleetRelease } = await import(
  "../packages/factory/dist/server-docker-cli.js"
);
const { default: Database } = await import("better-sqlite3");

function makeDb() {
  const db = new Database(":memory:");
  for (const m of adminMigrations()) db.exec(m.sql);
  return db;
}

const GOOD_KEY = "agent-token-vert";
const verifier = async (hostId, token) =>
  hostId === "host-a" && token === GOOD_KEY;

function seedServer(db, { hostId, brandId, name, image, variant }) {
  return upsertFleetServerStatus(db, {
    hostId,
    brandId,
    name,
    containerName: `${brandId}-server-${name}`,
    image,
    variant,
    dockerState: "running",
    source: "poller",
  });
}

function req(method, opts = {}) {
  return {
    method,
    body: opts.body,
    query: opts.query || {},
    headers: {
      ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
      ...(opts.headers || {}),
    },
  };
}

test("fleet-releases : migration + directives pin/hold/wave/channel", async () => {
  const db = makeDb();

  // 1. Migration : tables + UNIQUE (release, serveur) sur les reports.
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table'
       AND name IN ('admin_fleet_releases','admin_fleet_update_reports','admin_fleet_download_slots')
       ORDER BY name`,
    )
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, [
    "admin_fleet_download_slots",
    "admin_fleet_releases",
    "admin_fleet_update_reports",
  ]);

  // Serveurs de l'hôte host-a — variantes pin / hold / channel / vague.
  const sMain = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "main",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  const sHold = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "gele",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  const sPin = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "pinne",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  const sBeta = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "beta",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  const sUpToDate = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "a-jour",
    image: "reg/creezio-server-tf3:0.2.0",
  });
  seedServer(db, {
    hostId: "host-B", brandId: "tf3", name: "ailleurs",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  db.prepare(`UPDATE admin_fleet_servers SET hold = 1 WHERE id = ?`).run(sHold);
  db.prepare(
    `UPDATE admin_fleet_servers SET pinned_image = 'reg/creezio-server-tf3:0.0.9' WHERE id = ?`,
  ).run(sPin);
  db.prepare(`UPDATE admin_fleet_servers SET channel = 'beta' WHERE id = ?`).run(sBeta);

  // Pas de release rolling → seule la directive pin sort.
  let dirs = computeFleetUpdateDirectives(db, "host-a");
  assert.deepEqual(dirs.map((d) => [d.serverId, d.reason]), [[sPin, "pin"]]);
  assert.equal(dirs[0].image, "reg/creezio-server-tf3:0.0.9");

  // Release rolling stable, vague 100 %.
  db.prepare(
    `INSERT INTO admin_fleet_releases
     (id, created_at, updated_at, brand_id, tag, image, digest, variant, channel, status, wave_pct)
     VALUES ('rel1','2026-01-01','2026-01-01','tf3','0.2.0',
             'reg/creezio-server-tf3:0.2.0','sha256:${"a".repeat(64)}','base','stable','rolling',100)`,
  ).run();
  dirs = computeFleetUpdateDirectives(db, "host-a");
  const ids = dirs.map((d) => d.serverId);
  assert.ok(ids.includes(sMain), "serveur stable ciblé");
  assert.ok(!ids.includes(sHold), "hold exclu");
  assert.ok(!ids.includes(sBeta), "channel beta exclu de la release stable");
  assert.ok(!ids.includes(sUpToDate), "image déjà à jour → pas de directive");
  assert.ok(
    ids.includes(sPin) &&
      dirs.find((d) => d.serverId === sPin).image === "reg/creezio-server-tf3:0.0.9",
    "pin PRIORITAIRE sur la release",
  );
  const dMain = dirs.find((d) => d.serverId === sMain);
  assert.equal(dMain.digest, `sha256:${"a".repeat(64)}`, "digest transmis");
  assert.equal(dMain.releaseId, "rel1");

  // Vague : wave_pct sous le bucket du serveur → exclu ; au-dessus → inclus.
  const bucket = fleetWaveBucket(sMain);
  assert.ok(bucket >= 0 && bucket < 100);
  assert.equal(fleetWaveIncludes(sMain, bucket), false, "pct = bucket → exclu (strict)");
  assert.equal(fleetWaveIncludes(sMain, bucket + 1), true, "pct = bucket+1 → inclus");
  db.prepare(`UPDATE admin_fleet_releases SET wave_pct = ? WHERE id = 'rel1'`).run(bucket);
  dirs = computeFleetUpdateDirectives(db, "host-a");
  assert.ok(!dirs.some((d) => d.serverId === sMain), "hors vague → pas de directive");
  db.prepare(`UPDATE admin_fleet_releases SET wave_pct = ? WHERE id = 'rel1'`).run(bucket + 1);
  dirs = computeFleetUpdateDirectives(db, "host-a");
  assert.ok(dirs.some((d) => d.serverId === sMain), "dans la vague → directive");

  // paused → plus de directive release.
  db.prepare(`UPDATE admin_fleet_releases SET status = 'paused' WHERE id = 'rel1'`).run();
  dirs = computeFleetUpdateDirectives(db, "host-a");
  assert.ok(!dirs.some((d) => d.releaseId === "rel1"), "release paused ignorée");
});

test("fleet-releases : auth agents + sémaphore slots + purge lease + report", async () => {
  const db = makeDb();
  let fakeNow = Date.parse("2026-08-06T10:00:00Z");
  const mount = createFleetReleasesMount({
    verifyFleetCredential: verifier,
    maxDownloadSlots: 2,
    slotTtlSeconds: 900,
    nowMs: () => fakeNow,
  });
  const call = (method, subPath, opts) =>
    mount.handle({ req: req(method, opts), subPath, db });

  seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "main",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  db.prepare(
    `INSERT INTO admin_fleet_releases
     (id, created_at, updated_at, brand_id, tag, image, variant, channel, status, wave_pct)
     VALUES ('rel1','2026-01-01','2026-01-01','tf3','0.2.0',
             'reg/creezio-server-tf3:0.2.0','base','stable','rolling',100)`,
  ).run();

  // 3. Auth : anonyme, credential invalide, hostId incohérent → 401.
  for (const bearer of [undefined, "host-a:mauvais", `host-B:${GOOD_KEY}`]) {
    const r = await call("GET", "next", { query: { hostId: "host-a" }, bearer });
    assert.equal(r.status, 401, `bearer=${bearer || "aucun"} → 401`);
  }
  const next = await call("GET", "next", {
    query: { hostId: "host-a" },
    bearer: `host-a:${GOOD_KEY}`,
  });
  assert.equal(next.status, 200);
  assert.equal(next.body.updates.length, 1);
  assert.ok(next.body.pollIntervalSeconds > 0);

  // 4. Sémaphore : 2 slots, 3e en file avec position/retryAfter.
  const bearer = `host-a:${GOOD_KEY}`;
  const s1 = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: "srv1" }, bearer,
  });
  assert.equal(s1.body.granted, true);
  const s1bis = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: "srv1" }, bearer,
  });
  assert.equal(s1bis.body.leaseId, s1.body.leaseId, "idempotent par serveur");
  const s2 = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: "srv2" }, bearer,
  });
  assert.equal(s2.body.granted, true);
  const s3 = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: "srv3" }, bearer,
  });
  assert.equal(s3.body.granted, false, "sémaphore plein → file");
  assert.equal(s3.body.position, 1);
  assert.ok(s3.body.retryAfterSeconds >= 30);

  // DELETE libère → le 3e passe.
  await call("DELETE", `slots/${s1.body.leaseId}`, { bearer });
  const s3b = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: "srv3" }, bearer,
  });
  assert.equal(s3b.body.granted, true, "slot libéré → accordé");

  // Lease expirée purgée (horloge avancée au-delà du TTL).
  fakeNow += 16 * 60_000;
  const purged = purgeExpiredFleetSlots(db, fakeNow);
  assert.ok(purged >= 2, `leases expirées purgées (${purged})`);
  const s4 = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: "srv4" }, bearer,
  });
  assert.equal(s4.body.granted, true, "après purge, slots à nouveau libres");

  // 5. Report : enregistré, puis UPSERTÉ par (release, serveur).
  const r1 = await call("POST", "report", {
    body: { releaseId: "rel1", serverId: "srv1", status: "failed", detail: "boot KO" },
    bearer,
  });
  assert.equal(r1.status, 200);
  const r2 = await call("POST", "report", {
    body: { releaseId: "rel1", serverId: "srv1", status: "done", detail: "v0.2.0" },
    bearer,
  });
  assert.equal(r2.status, 200);
  const reports = db
    .prepare(`SELECT * FROM admin_fleet_update_reports WHERE release_id='rel1' AND server_id='srv1'`)
    .all();
  assert.equal(reports.length, 1, "une seule row par (release, serveur)");
  assert.equal(reports[0].status, "done");
  assert.equal(reports[0].host_id, "host-a");
  const badReport = await call("POST", "report", {
    body: { releaseId: "rel1", serverId: "srv1", status: "explose" }, bearer,
  });
  assert.equal(badReport.status, 400, "status de report inconnu refusé");

  // CRUD : agrégats de reports sur GET releases.
  const list = await call("GET", "releases", {});
  assert.equal(list.status, 200);
  const rel = list.body.releases.find((r) => r.id === "rel1");
  assert.equal(rel.reports_done, 1);

  // Rollout par serveur : pin/hold/channel.
  const rollout = await call("PUT", "servers/host-a/tf3/main/rollout", {
    body: { hold: true, channel: "beta" },
  });
  assert.equal(rollout.status, 200);
  assert.equal(rollout.body.server.hold, 1);
  assert.equal(rollout.body.server.channel, "beta");
});

test("fleet-releases : boucle agent pull (mock admin + mock updateServer)", async (t) => {
  const db = makeDb();
  let fakeNow = Date.parse("2026-08-06T10:00:00Z");
  const mount = createFleetReleasesMount({
    verifyFleetCredential: verifier,
    maxDownloadSlots: 5,
    nowMs: () => fakeNow,
  });

  const sMain = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "main",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  const sKo = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "casse",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  const digest = `sha256:${"b".repeat(64)}`;
  db.prepare(
    `INSERT INTO admin_fleet_releases
     (id, created_at, updated_at, brand_id, tag, image, digest, variant, channel, status, wave_pct)
     VALUES ('rel1','2026-01-01','2026-01-01','tf3','0.2.0',
             'reg/creezio-server-tf3:0.2.0','${digest}','base','stable','rolling',100)`,
  ).run();

  // Mock admin HTTP : sert le mount réel par-dessus http (comme l'app admin).
  const srv = http.createServer(async (nodeReq, nodeRes) => {
    const url = new URL(nodeReq.url, "http://127.0.0.1");
    const m = url.pathname.match(/^\/api\/v1\/modules\/fleet-releases\/(.*)$/);
    if (!m) {
      nodeRes.writeHead(404).end("{}");
      return;
    }
    let body;
    const chunks = [];
    for await (const c of nodeReq) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) body = JSON.parse(raw);
    const query = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    const out = await mount.handle({
      req: {
        method: nodeReq.method,
        body,
        query,
        headers: { authorization: nodeReq.headers.authorization },
      },
      subPath: m[1],
      db,
    });
    nodeRes.writeHead(out.status, {
      "content-type": "application/json",
      ...(out.headers || {}),
    });
    nodeRes.end(JSON.stringify(out.body));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  // Fermeture GARANTIE (même si une assertion échoue) — sinon le runner
  // ne termine jamais (sockets keep-alive).
  t.after(() => {
    srv.closeAllConnections?.();
    srv.close();
  });
  const adminUrl = `http://127.0.0.1:${srv.address().port}`;

  // Mock registre local : instances vues par l'agent (SoT servers.json).
  const instances = {
    "tf3/main": {
      inst: { name: "main", containerName: "tf3-server-main", port: 1, image: "reg/creezio-server-tf3:0.1.0" },
      brandRoot: "/fake", registry: { brandId: "tf3" },
    },
    "tf3/casse": {
      inst: { name: "casse", containerName: "tf3-server-casse", port: 2, image: "reg/creezio-server-tf3:0.1.0" },
      brandRoot: "/fake", registry: { brandId: "tf3" },
    },
  };
  const updateCalls = [];
  const mockUpdateServer = async ({ inst, image }) => {
    updateCalls.push({ container: inst.containerName, image });
    if (inst.name === "casse") {
      return { ok: false, error: "health KO", rolledBack: true, previousImage: inst.image };
    }
    inst.image = image;
    return { ok: true, image, version: "0.2.0" };
  };
  const updates = new Map();

  // 6a. Cycle nominal : slot → update par DIGEST → report done/rolled_back.
  const cycle = await runAgentUpdateCycle({
    adminUrl,
    fleetKey: GOOD_KEY,
    hostId: "host-a",
    brandRoots: ["/fake"],
    findInstance: (roots, brandId, name) => instances[`${brandId}/${name}`] || null,
    updateServer: mockUpdateServer,
    updates,
    audit: () => {},
  });
  assert.equal(cycle.polled, true);
  assert.equal(cycle.applied, 1, JSON.stringify(cycle));
  assert.equal(updateCalls.length, 2);
  assert.ok(
    updateCalls.every((c) => c.image === `reg/creezio-server-tf3@${digest}`),
    `pull par digest (${updateCalls[0].image})`,
  );
  const reports = db
    .prepare(`SELECT server_id, status FROM admin_fleet_update_reports ORDER BY server_id`)
    .all();
  assert.deepEqual(
    reports,
    [
      { server_id: sKo, status: "rolled_back" },
      { server_id: sMain, status: "done" },
    ].sort((a, b) => (a.server_id < b.server_id ? -1 : 1)),
  );
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_fleet_download_slots`).get().n,
    0,
    "slots libérés après update",
  );

  // 6b. Mutex : update manuel en cours → serveur sauté.
  db.prepare(`DELETE FROM admin_fleet_update_reports`).run();
  db.prepare(`UPDATE admin_fleet_servers SET image = 'reg/creezio-server-tf3:0.1.0' WHERE id = ?`).run(sKo);
  instances["tf3/casse"].inst.image = "reg/creezio-server-tf3:0.1.0";
  updates.set("tf3-server-casse", { status: "running", image: "manuel" });
  updateCalls.length = 0;
  const cycle2 = await runAgentUpdateCycle({
    adminUrl,
    fleetKey: GOOD_KEY,
    hostId: "host-a",
    brandRoots: ["/fake"],
    findInstance: (roots, brandId, name) => instances[`${brandId}/${name}`] || null,
    updateServer: mockUpdateServer,
    updates,
    audit: () => {},
  });
  assert.equal(updateCalls.length, 0, "update manuel en cours → aucun update pull");
  assert.ok(cycle2.skipped >= 1);

  // 6c. Credential invalide → poll refusé, rien ne se passe.
  const cycleBad = await runAgentUpdateCycle({
    adminUrl,
    fleetKey: "mauvais",
    hostId: "host-a",
    brandRoots: ["/fake"],
    findInstance: () => null,
    updateServer: mockUpdateServer,
    updates: new Map(),
    audit: () => {},
  });
  assert.equal(cycleBad.polled, false);
  assert.ok(cycleBad.errors.length >= 1);

  // imageRefWithDigest : port de registre ≠ tag.
  assert.equal(
    imageRefWithDigest("127.0.0.1:5000/x:1.0", "sha256:zz"),
    "127.0.0.1:5000/x@sha256:zz",
  );
  assert.equal(imageRefWithDigest("reg/x:1.0", null), "reg/x:1.0");
});

test("publish --release : declareFleetRelease poste la release draft (idempotent)", async () => {
  const db = makeDb();
  const mount = createFleetReleasesMount({ verifyFleetCredential: verifier });
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, init });
    const out = await mount.handle({
      req: {
        method: init.method,
        body: JSON.parse(init.body),
        query: {},
        headers: {},
      },
      subPath: "releases",
      db,
    });
    return {
      status: out.status,
      json: async () => out.body,
    };
  };
  const r1 = await declareFleetRelease({
    adminAppUrl: "http://admin.local",
    brandId: "tf3",
    tag: "0.2.0",
    image: "registry.zone/creezio-server-tf3:0.2.0",
    digest: `sha256:${"c".repeat(64)}`,
    channel: "stable",
    fetchImpl,
  });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const rows = db.prepare(`SELECT * FROM admin_fleet_releases`).all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft", "déclarée en draft (rollout piloté ensuite)");
  assert.equal(rows[0].image, "registry.zone/creezio-server-tf3:0.2.0");
  assert.equal(rows[0].digest, `sha256:${"c".repeat(64)}`);

  // Re-publish même tag → update de la même row (pas de doublon).
  const r2 = await declareFleetRelease({
    adminAppUrl: "http://admin.local",
    brandId: "tf3",
    tag: "0.2.0",
    image: "registry.zone/creezio-server-tf3:0.2.0",
    digest: `sha256:${"d".repeat(64)}`,
    fetchImpl,
  });
  assert.equal(r2.ok, true);
  const rows2 = db.prepare(`SELECT * FROM admin_fleet_releases`).all();
  assert.equal(rows2.length, 1, "idempotent par (brand, tag, variant)");
  assert.equal(rows2[0].digest, `sha256:${"d".repeat(64)}`);
});

test("T4 : vérificateur par défaut via client typé @creezio/fleet (verify + cache + Basic manquant)", async (t) => {
  // Mock backend flotte : POST /admin/api/hosts/verify (Basic obligatoire).
  const BASIC = "admin:motdepasse";
  let hits = 0;
  const backend = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      hits++;
      const expected = `Basic ${Buffer.from(BASIC).toString("base64")}`;
      if (req.headers.authorization !== expected) {
        res.writeHead(401, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      }
      if (req.method !== "POST" || req.url !== "/admin/api/hosts/verify") {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: false }));
      }
      const body = JSON.parse(raw || "{}");
      const valid = body.hostId === "host-a" && body.token === GOOD_KEY;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, valid }));
    });
  });
  await new Promise((r) => backend.listen(0, "127.0.0.1", r));
  t.after(() => backend.close());
  const backendUrl = `http://127.0.0.1:${backend.address().port}`;

  const verify = createBackendFleetCredentialVerifier(
    { backendUrl, basic: BASIC },
    { cacheTtlMs: 60_000, negativeTtlMs: 60_000 },
  );
  assert.equal(await verify("host-a", GOOD_KEY), true, "credential valide → true");
  assert.equal(await verify("host-a", "mauvais"), false, "credential invalide → false");
  assert.equal(await verify("", GOOD_KEY), false, "hostId vide → refus local");
  const hitsAvant = hits;
  assert.equal(await verify("host-a", GOOD_KEY), true, "hit cache positif");
  assert.equal(await verify("host-a", "mauvais"), false, "hit cache négatif");
  assert.equal(hits, hitsAvant, "cache mémoire : pas de re-hit backend");

  // Basic manquant → 503 local fleet_basic_missing, AUCUN appel réseau.
  const envBasic = process.env.CREEZIO_FLEET_BACKEND_BASIC;
  delete process.env.CREEZIO_FLEET_BACKEND_BASIC;
  try {
    const noBasic = createBackendFleetCredentialVerifier({ backendUrl });
    assert.equal(await noBasic("host-a", GOOD_KEY), false, "Basic manquant → refus");
    assert.equal(hits, hitsAvant, "Basic manquant : zéro appel backend");
  } finally {
    if (envBasic !== undefined) {
      process.env.CREEZIO_FLEET_BACKEND_BASIC = envBasic;
    }
  }
});
