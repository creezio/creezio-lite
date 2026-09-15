#!/usr/bin/env node
/**
 * Gate — rollout piloté de la flotte (F6).
 *
 * Prouve, sur DB brand réelle (better-sqlite3, migrations admin) :
 *  1. kill-switch : release rolling → directives ; PUT status aborted via le
 *     mount → plus AUCUNE directive au poll suivant + leases de
 *     téléchargement révoquées ; pause/reprise idem (paused → rien,
 *     re-rolling → directives de nouveau) ;
 *  2. vagues MONOTONES : un serveur inclus à N % reste inclus à tout
 *     M % ≥ N (une promotion n'exclut jamais un serveur déjà servi) ;
 *  3. auto-pause (garde-fou) : release rolling avec ≥ seuil d'échecs
 *     (failed + rolled_back) → paused automatiquement + événement
 *     release_auto_paused + slots purgés — idempotent ;
 *  4. POST maintenance : purge des leases expirées + auto-pause en un
 *     geste (janitor du poller) ;
 *  5. poller de fond : startFleetRegistryPoller appelle sync PUIS
 *     fleet-releases/maintenance (best-effort) ; désactivable
 *     (releasesMaintenance:false) ;
 *  6. UI /flotte : section releases (Démarrer/Promouvoir/Pause/STOP
 *     kill-switch) + pilotage par serveur (hold/pin/canal) présents dans
 *     fleet-admin-client.tsx.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  adminMigrations,
  autoPauseFleetReleases,
  computeFleetUpdateDirectives,
  createFleetReleasesMount,
  fleetWaveIncludes,
  startFleetRegistryPoller,
  upsertFleetServerStatus,
} = await import("../packages/admin/dist/index.js");
const { default: Database } = await import("better-sqlite3");

function makeDb() {
  const db = new Database(":memory:");
  for (const m of adminMigrations()) db.exec(m.sql);
  return db;
}

const GOOD_KEY = "agent-token-vert";
const verifier = async (hostId, token) =>
  hostId === "host-a" && token === GOOD_KEY;

function seedServer(db, { hostId, brandId, name, image }) {
  return upsertFleetServerStatus(db, {
    hostId,
    brandId,
    name,
    containerName: `${brandId}-server-${name}`,
    image,
    dockerState: "running",
    source: "poller",
  });
}

function insertRelease(db, id, { status = "rolling", wavePct = 100 } = {}) {
  // Tag distinct par release (UNIQUE brand+tag+variant).
  db.prepare(
    `INSERT INTO admin_fleet_releases
     (id, created_at, updated_at, brand_id, tag, image, variant, channel, status, wave_pct)
     VALUES (?, '2026-01-01','2026-01-01','tf3', ?,
             'reg/creezio-server-tf3:' || ?, 'base','stable',?,?)`,
  ).run(id, `0.2.0-${id}`, `0.2.0-${id}`, status, wavePct);
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

test("fleet-rollout : kill-switch + pause/reprise révoquent directives et leases", async () => {
  const db = makeDb();
  let fakeNow = Date.parse("2026-08-06T10:00:00Z");
  const mount = createFleetReleasesMount({
    verifyFleetCredential: verifier,
    maxDownloadSlots: 5,
    nowMs: () => fakeNow,
  });
  const call = (method, subPath, opts) =>
    mount.handle({ req: req(method, opts), subPath, db });
  const bearer = `host-a:${GOOD_KEY}`;

  const sMain = seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "main",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  insertRelease(db, "rel1");

  // rolling → directive + lease active.
  let dirs = computeFleetUpdateDirectives(db, "host-a");
  assert.ok(dirs.some((d) => d.releaseId === "rel1"), "rolling → directive");
  const slot = await call("POST", "slots", {
    body: { releaseId: "rel1", serverId: sMain }, bearer,
  });
  assert.equal(slot.body.granted, true);

  // KILL-SWITCH : PUT status=aborted via le mount.
  const abort = await call("PUT", "releases/rel1", { body: { status: "aborted" } });
  assert.equal(abort.status, 200);
  assert.equal(abort.body.release.status, "aborted");
  dirs = computeFleetUpdateDirectives(db, "host-a");
  assert.equal(dirs.length, 0, "aborted → plus aucune directive");
  const leases = db
    .prepare(`SELECT COUNT(*) AS n FROM admin_fleet_download_slots WHERE release_id='rel1'`)
    .get().n;
  assert.equal(leases, 0, "kill-switch → leases révoquées");
  const events = db
    .prepare(`SELECT kind FROM admin_fleet_events WHERE kind='release_status'`)
    .all();
  assert.ok(events.length >= 1, "événement release_status journalisé");

  // Pause / reprise : paused → rien ; re-rolling → directives de nouveau.
  insertRelease(db, "rel2");
  await call("POST", "slots", { body: { releaseId: "rel2", serverId: sMain }, bearer });
  const pause = await call("PUT", "releases/rel2", { body: { status: "paused" } });
  assert.equal(pause.status, 200);
  assert.equal(
    computeFleetUpdateDirectives(db, "host-a").length, 0,
    "paused → plus de directive",
  );
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_fleet_download_slots WHERE release_id='rel2'`).get().n,
    0,
    "pause → leases révoquées aussi",
  );
  const resume = await call("PUT", "releases/rel2", { body: { status: "rolling" } });
  assert.equal(resume.status, 200);
  assert.ok(
    computeFleetUpdateDirectives(db, "host-a").some((d) => d.releaseId === "rel2"),
    "reprise → directive de nouveau",
  );
});

test("fleet-rollout : vagues monotones (une promotion n'exclut jamais)", () => {
  // Propriété : inclus à N % ⇒ inclus à tout M ≥ N. Vérifiée sur un
  // échantillon d'ids + toutes les paires (N, M) par pas de 10.
  const ids = Array.from({ length: 50 }, (_, i) => `srv-${i}-${i * 7919}`);
  for (const id of ids) {
    let included = false;
    for (let pct = 0; pct <= 100; pct += 5) {
      const now = fleetWaveIncludes(id, pct);
      assert.ok(
        !included || now,
        `monotonie violée pour ${id} à ${pct}% (déjà inclus avant)`,
      );
      included = included || now;
    }
    assert.equal(fleetWaveIncludes(id, 100), true, "100 % inclut tout le monde");
    assert.equal(fleetWaveIncludes(id, 0), false, "0 % n'inclut personne");
  }
});

test("fleet-rollout : auto-pause après seuil d'échecs + maintenance janitor", async () => {
  const db = makeDb();
  let fakeNow = Date.parse("2026-08-06T10:00:00Z");
  const mount = createFleetReleasesMount({
    verifyFleetCredential: verifier,
    autoPauseFailures: 2,
    slotTtlSeconds: 900,
    nowMs: () => fakeNow,
  });
  const call = (method, subPath, opts) =>
    mount.handle({ req: req(method, opts), subPath, db });
  const bearer = `host-a:${GOOD_KEY}`;

  seedServer(db, {
    hostId: "host-a", brandId: "tf3", name: "main",
    image: "reg/creezio-server-tf3:0.1.0",
  });
  insertRelease(db, "rel1");

  // 1 échec < seuil → rien ne bouge.
  await call("POST", "report", {
    body: { releaseId: "rel1", serverId: "srv1", status: "failed", detail: "boot KO" },
    bearer,
  });
  assert.deepEqual(autoPauseFleetReleases(db, { maxFailures: 2 }), []);
  assert.equal(
    db.prepare(`SELECT status FROM admin_fleet_releases WHERE id='rel1'`).get().status,
    "rolling",
  );

  // 2e échec (rolled_back compte aussi) + lease active → auto-pause.
  await call("POST", "report", {
    body: { releaseId: "rel1", serverId: "srv2", status: "rolled_back", detail: "santé KO" },
    bearer,
  });
  await call("POST", "slots", { body: { releaseId: "rel1", serverId: "srv3" }, bearer });
  const paused = autoPauseFleetReleases(db, { maxFailures: 2 });
  assert.deepEqual(paused, ["rel1"], "seuil atteint → auto-pause");
  assert.equal(
    db.prepare(`SELECT status FROM admin_fleet_releases WHERE id='rel1'`).get().status,
    "paused",
  );
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_fleet_download_slots WHERE release_id='rel1'`).get().n,
    0,
    "auto-pause → leases révoquées",
  );
  assert.ok(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_fleet_events WHERE kind='release_auto_paused'`).get().n >= 1,
    "événement release_auto_paused journalisé",
  );
  // Idempotent : un second passage ne retouche rien.
  assert.deepEqual(autoPauseFleetReleases(db, { maxFailures: 2 }), []);

  // Maintenance : lease expirée purgée + auto-pause d'une autre release.
  insertRelease(db, "rel2");
  await call("POST", "slots", { body: { releaseId: "rel2", serverId: "srv9" }, bearer });
  for (const srv of ["s1", "s2"]) {
    await call("POST", "report", {
      body: { releaseId: "rel2", serverId: srv, status: "failed" }, bearer,
    });
  }
  fakeNow += 16 * 60_000; // la lease de rel2 expire (TTL 15 min)
  const maint = await call("POST", "maintenance", {});
  assert.equal(maint.status, 200);
  assert.ok(maint.body.purgedSlots >= 1, "maintenance purge les leases expirées");
  assert.deepEqual(maint.body.autoPaused, ["rel2"], "maintenance auto-pause rel2");
});

test("fleet-rollout : le poller de fond appelle sync puis maintenance", async () => {
  const calls = [];
  const api = {
    handle: async ({ path: p }) => {
      calls.push(p);
      return { status: 200, body: { ok: true } };
    },
  };
  const poller = startFleetRegistryPoller({ api, intervalMs: 3_600_000 });
  await poller.tick();
  poller.stop();
  assert.deepEqual(calls, [
    "/api/v1/modules/fleet-registry/sync",
    "/api/v1/modules/fleet-releases/maintenance",
  ]);

  // Désactivable — et un module fleet-releases absent (404) reste silencieux.
  calls.length = 0;
  const p2 = startFleetRegistryPoller({
    api,
    intervalMs: 3_600_000,
    releasesMaintenance: false,
  });
  await p2.tick();
  p2.stop();
  assert.deepEqual(calls, ["/api/v1/modules/fleet-registry/sync"]);

  const errors = [];
  const api404 = {
    handle: async ({ path: p }) => ({
      status: p.includes("maintenance") ? 404 : 200,
      body: { ok: p.includes("sync") },
    }),
  };
  const p3 = startFleetRegistryPoller({
    api: api404,
    intervalMs: 3_600_000,
    onError: (e) => errors.push(e),
  });
  await p3.tick();
  p3.stop();
  assert.equal(errors.length, 0, "maintenance 404 (module absent) silencieuse");
});

test("fleet-rollout : UI /flotte — releases + kill-switch + pilotage par serveur", () => {
  const src = readFileSync(
    path.join(ROOT, "packages/admin/ui/fleet-admin-client.tsx"),
    "utf8",
  );
  // Section releases branchée sur le module fleet-releases.
  assert.ok(src.includes("/api/v1/modules/fleet-releases"), "RELEASES_API présent");
  assert.ok(src.includes("Releases (updates en pull)"), "section releases");
  // Cycle de vie complet du rollout.
  for (const marker of ["Démarrer", "Promouvoir", "Pause", "Reprendre", "Terminer"]) {
    assert.ok(src.includes(marker), `action « ${marker} » présente`);
  }
  assert.ok(src.includes("KILL-SWITCH"), "kill-switch avec confirmation explicite");
  assert.ok(src.includes('status: "aborted"'), "kill-switch → status aborted");
  // Pilotage par serveur : hold / pin / canal.
  assert.ok(src.includes("/rollout"), "PUT servers/<id>/rollout branché");
  for (const marker of ["Hold", "Pin…", "canary"]) {
    assert.ok(src.includes(marker), `pilotage serveur « ${marker} » présent`);
  }
  // Les vagues sont expliquées à l'admin (promotion jamais régressive).
  assert.ok(src.includes("wave_pct"), "wave_pct affiché");
});
