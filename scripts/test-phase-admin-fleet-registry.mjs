#!/usr/bin/env node
/**
 * Gate — module fleet-registry (@creezio/admin) : DB flotte centrale (F2).
 *
 * Prouve, sur une DB brand réelle (better-sqlite3, migrations admin) :
 *  1. migration admin_004_fleet_registry : tables admin_fleet_servers
 *     (PK "{host_id}/{brand_id}/{name}", UNIQUE) + admin_fleet_events ;
 *  2. POST sync : backfill depuis le backend flotte /admin/api/servers
 *     (mock HTTP Basic) → upsert idempotent, source poller/sync ;
 *  3. dédup self-enroll : un serveur vu `local` PUIS via un hôte enrôlé est
 *     MIGRÉ (une seule row, rattachée à l'hôte enrôlé, événements suivis) ;
 *     un statut `local` ultérieur s'applique à la row enrôlée ;
 *  4. statut online DÉRIVÉ (jamais stocké) : heartbeat frais → online ;
 *     poll frais + docker running → online ; poll frais + exited → offline ;
 *     tout périmé → offline ;
 *  5. poller de fond : startFleetRegistryPoller passe par le kernel
 *     (POST /api/v1/modules/fleet-registry/sync, source=poller) ;
 *  6. l'API ne restitue JAMAIS access_token_enc / server_key_hash.
 */
import http from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";

const {
  adminMigrations,
  createFleetRegistryMount,
  deriveFleetOnline,
  startFleetRegistryPoller,
  upsertFleetServerStatus,
} = await import("../packages/admin/dist/index.js");
const { default: Database } = await import("better-sqlite3");

function makeDb() {
  const db = new Database(":memory:");
  for (const m of adminMigrations()) db.exec(m.sql);
  return db;
}

const BASIC = "admin:gate-pass";

function makeFleetBackendMock(serversRef) {
  const srv = http.createServer((req, res) => {
    const auth = String(req.headers.authorization || "");
    const expected = `Basic ${Buffer.from(BASIC).toString("base64")}`;
    if (auth !== expected) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
      return;
    }
    if (req.url === "/admin/api/servers") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, docker: true, servers: serversRef.list }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });
  return srv;
}

const SRV_DEMO = {
  hostId: "local",
  brandId: "tempoflow3",
  name: "demo",
  containerName: "tempoflow3-server-demo",
  port: 18793,
  env: { CREEZIO_TUNNEL_SLUG: "demo" },
  image: "127.0.0.1:5000/creezio-server-tempoflow3:0.3.8",
  version: "0.3.8",
  orphan: false,
  docker: { state: "running", health: "healthy", startedAt: null, image: null },
  bootStatus: { booting: false, headline: "Prêt", overallPercent: 100 },
};

const SRV_LEGACY = {
  hostId: "local",
  brandId: "creezio",
  name: "server-1",
  containerName: "creezio-server-1",
  port: 18791,
  env: {},
  image: "creezio-brand-server:local",
  version: null,
  orphan: true,
  docker: { state: "exited", health: null, startedAt: null, image: null },
  bootStatus: null,
};

test("fleet-registry : migration + sync + dédup + online dérivé + poller", async () => {
  const db = makeDb();

  // 1. Migration : tables + contrainte UNIQUE.
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'admin_fleet_%' ORDER BY name`,
    )
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, [
    // admin_005 (F5 — gate dédiée test-phase-fleet-releases.mjs)
    "admin_fleet_download_slots",
    // admin_004 (F2)
    "admin_fleet_events",
    "admin_fleet_releases",
    "admin_fleet_servers",
    "admin_fleet_update_reports",
  ]);
  upsertFleetServerStatus(db, {
    hostId: "local",
    brandId: "b",
    name: "n",
    source: "sync",
  });
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO admin_fleet_servers
           (id, created_at, updated_at, host_id, brand_id, name, source)
           VALUES ('doublon','x','x','local','b','n','sync')`,
        )
        .run(),
    /UNIQUE/,
    "UNIQUE(host_id, brand_id, name)",
  );
  db.prepare(`DELETE FROM admin_fleet_servers`).run();

  // 2. Sync/backfill depuis le backend flotte (mock Basic).
  const serversRef = { list: [SRV_DEMO, SRV_LEGACY] };
  const mock = makeFleetBackendMock(serversRef);
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const backendUrl = `http://127.0.0.1:${mock.address().port}`;
  const mount = createFleetRegistryMount({
    fleet: { backendUrl, basic: BASIC },
  });

  const sync1 = await mount.handle({
    req: { method: "POST", body: {}, query: {}, headers: {} },
    subPath: "sync",
    db,
  });
  assert.equal(sync1.status, 200, JSON.stringify(sync1.body));
  assert.equal(sync1.body.upserted, 2);

  const demo = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = 'local/tempoflow3/demo'`)
    .get();
  assert.ok(demo, "row demo créée avec PK {host_id}/{brand_id}/{name}");
  assert.equal(demo.docker_state, "running");
  assert.equal(demo.health, "healthy");
  assert.equal(demo.version, "0.3.8");
  assert.equal(demo.tunnel_slug, "demo");
  assert.equal(demo.port, 18793);
  assert.equal(demo.source, "sync");
  assert.ok(demo.last_polled_at, "last_polled_at posé");
  const legacy = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE brand_id = 'creezio'`)
    .get();
  assert.equal(legacy.orphan, 1, "instance legacy (orpheline) couverte");
  assert.equal(legacy.docker_state, "exited", "serveur arrêté couvert");

  // Idempotence : re-sync = mêmes rows (pas de doublon).
  const sync2 = await mount.handle({
    req: { method: "POST", body: { source: "poller" }, query: {}, headers: {} },
    subPath: "sync",
    db,
  });
  assert.equal(sync2.status, 200);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_fleet_servers`).get().n,
    2,
  );
  assert.equal(
    db.prepare(`SELECT source FROM admin_fleet_servers WHERE brand_id='tempoflow3'`).get()
      .source,
    "poller",
    "source=poller quand le poller alimente",
  );

  // 3. Dédup self-enroll : le même serveur arrive maintenant via l'hôte
  //    enrôlé (le backend le rattache à l'hôte) → row MIGRÉE, pas dupliquée.
  db.prepare(
    `INSERT INTO admin_fleet_events (id, created_at, server_id, kind)
     VALUES ('ev1', 'x', 'local/tempoflow3/demo', 'registered')`,
  ).run();
  serversRef.list = [{ ...SRV_DEMO, hostId: "vps-resto" }, SRV_LEGACY];
  const sync3 = await mount.handle({
    req: { method: "POST", body: {}, query: {}, headers: {} },
    subPath: "sync",
    db,
  });
  assert.equal(sync3.status, 200);
  const demoRows = db
    .prepare(
      `SELECT * FROM admin_fleet_servers WHERE brand_id='tempoflow3' AND name='demo'`,
    )
    .all();
  assert.equal(demoRows.length, 1, "une seule row après self-enroll");
  assert.equal(demoRows[0].host_id, "vps-resto", "rattachée à l'hôte ENRÔLÉ");
  assert.equal(demoRows[0].id, "vps-resto/tempoflow3/demo", "PK migrée");
  assert.equal(
    db.prepare(`SELECT server_id FROM admin_fleet_events WHERE id='ev1'`).get()
      .server_id,
    "vps-resto/tempoflow3/demo",
    "événements suivis lors de la migration",
  );

  // Statut `local` ultérieur → appliqué à la row enrôlée, pas de doublon.
  serversRef.list = [
    { ...SRV_DEMO, version: "0.3.9" },
    { ...SRV_DEMO, hostId: "vps-resto", version: "0.3.9" },
    SRV_LEGACY,
  ];
  await mount.handle({
    req: { method: "POST", body: {}, query: {}, headers: {} },
    subPath: "sync",
    db,
  });
  const demoRows2 = db
    .prepare(
      `SELECT * FROM admin_fleet_servers WHERE brand_id='tempoflow3' AND name='demo'`,
    )
    .all();
  assert.equal(demoRows2.length, 1, "toujours une seule row (statut local absorbé)");
  assert.equal(demoRows2[0].host_id, "vps-resto");
  assert.equal(demoRows2[0].version, "0.3.9");
  mock.close();

  // 4. Statut online dérivé.
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();
  const optsOnline = { nowMs: now, heartbeatIntervalSeconds: 90, pollIntervalSeconds: 90 };
  assert.equal(
    deriveFleetOnline({ last_heartbeat_at: iso(60_000) }, optsOnline),
    true,
    "heartbeat frais → online (même sans docker_state)",
  );
  assert.equal(
    deriveFleetOnline(
      { last_heartbeat_at: iso(10 * 60_000), last_polled_at: iso(30_000), docker_state: "running" },
      optsOnline,
    ),
    true,
    "heartbeat périmé mais poll frais + running → online",
  );
  assert.equal(
    deriveFleetOnline(
      { last_polled_at: iso(30_000), docker_state: "exited" },
      optsOnline,
    ),
    false,
    "poll frais mais serveur arrêté → offline",
  );
  assert.equal(
    deriveFleetOnline(
      { last_heartbeat_at: iso(10 * 60_000), last_polled_at: iso(10 * 60_000), docker_state: "running" },
      optsOnline,
    ),
    false,
    "tout périmé (> 3× intervalle) → offline",
  );

  // GET servers : online exposé + jamais de colonnes sensibles.
  db.prepare(
    `UPDATE admin_fleet_servers
     SET access_token_enc = 'enc:v1:xxx', server_key_hash = 'sha256:yyy',
         last_heartbeat_at = ?
     WHERE brand_id = 'tempoflow3'`,
  ).run(new Date().toISOString());
  const list = await mount.handle({
    req: { method: "GET", query: {}, headers: {} },
    subPath: "servers",
    db,
  });
  assert.equal(list.status, 200);
  const pubDemo = list.body.servers.find((s) => s.brand_id === "tempoflow3");
  assert.equal(pubDemo.online, true);
  assert.equal(pubDemo.registered, true);
  assert.equal(pubDemo.access_token_enc, undefined, "token chiffré jamais restitué");
  assert.equal(pubDemo.server_key_hash, undefined, "hash serverKey jamais restitué");
  const pubLegacy = list.body.servers.find((s) => s.brand_id === "creezio");
  assert.equal(pubLegacy.online, false, "serveur exited → offline");

  // 5. Poller de fond : passe par le kernel (POST sync, source=poller).
  const calls = [];
  const fakeApi = {
    handle: async (req) => {
      calls.push(req);
      return { status: 200, body: { ok: true, upserted: 0 } };
    },
  };
  const poller = startFleetRegistryPoller({ api: fakeApi, intervalMs: 3600_000 });
  await poller.tick();
  poller.stop();
  const syncCall = calls.find(
    (c) => c.path === "/api/v1/modules/fleet-registry/sync" && c.method === "POST",
  );
  assert.ok(syncCall, "le poller poste sur fleet-registry/sync");
  assert.equal(syncCall.body.source, "poller");
});
