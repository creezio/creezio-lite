#!/usr/bin/env node
/**
 * Gate — auto-inscription flotte + heartbeat (F3).
 *
 * Prouve, avec un VRAI serveur HTTP admin (mount fleet-registry @creezio/admin
 * sur DB better-sqlite3) et le client kit (@creezio/app-runtime) :
 *  1. register : mauvais secret → 401 ; bon secret → serverId + serverKey ;
 *     accessToken stocké CHIFFRÉ (enc:v1:, déchiffrable), serverKey stocké
 *     HASHÉ (sha256:, jamais en clair) ; event `registered` ;
 *  2. rotation : ré-inscription idempotente → nouveaux tokens, l'ancien
 *     serverKey est refusé (401), event `rotated` ;
 *  3. heartbeat : Bearer serverKey → version/health/disk/last_heartbeat_at
 *     mis à jour ; mauvaise clé → 401 ;
 *  4. rate-limit register par IP (429 au-delà du quota) ;
 *  5. startFleetHeartbeat (kit) : no-op sans env ; avec env → register réel,
 *     fichier d'état {dataDir}/{brand}-fleet.json en 0600 SANS accessToken en
 *     clair (hash seulement) ; heartbeat suivant OK ; 401 → ré-inscription
 *     auto (rotation) ;
 *  6. BEST-EFFORT ABSOLU : admin down (port fermé) → tick ne lève JAMAIS ;
 *  7. mount fleet-access : Bearer = accessToken vérifié contre le hash local
 *     (status 200 / mauvais token 401 / non provisionné 503) ;
 *  8. factory : `--profile prod` forwarde CREEZIO_FLEET_ADMIN_URL /
 *     _REGISTER_SECRET / _HOST_ID / _BACKEND_URL / _BACKEND_BASIC
 *     (anti-régression sur la liste).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { adminMigrations, createFleetRegistryMount } = await import(
  "../packages/admin/dist/index.js"
);
const { openIntegrationSecret } = await import(
  "../packages/integrations/dist/index.js"
);
const { createFleetAccessMount, readFleetState, startFleetHeartbeat } =
  await import("../packages/app-runtime/dist/fleet-heartbeat.js");
const { default: Database } = await import("better-sqlite3");

const SECRET = "gate-fleet-register-secret";

function makeDb() {
  const db = new Database(":memory:");
  for (const m of adminMigrations()) db.exec(m.sql);
  return db;
}

/** Mini serveur HTTP admin : route les requêtes vers le mount fleet-registry. */
function makeAdminHttp(mount, db) {
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const url = new URL(req.url, "http://x");
      const prefix = "/api/v1/modules/fleet-registry/";
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        /* corps vide */
      }
      const out = await mount.handle({
        req: {
          method: req.method,
          body,
          query: Object.fromEntries(url.searchParams),
          headers: req.headers,
        },
        subPath: url.pathname.slice(prefix.length),
        db,
      });
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  return srv;
}

async function post(base, sub, bearer, body) {
  const res = await fetch(`${base}/api/v1/modules/fleet-registry/${sub}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test("fleet-heartbeat : register/rotation/heartbeat côté admin (tokens chiffrés/hashés)", async () => {
  const db = makeDb();
  const mount = createFleetRegistryMount({ registerSecret: SECRET });
  const srv = makeAdminHttp(mount, db);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${srv.address().port}`;

  // 1. Mauvais secret → 401 (jamais d'inscription).
  const bad = await post(base, "register", "mauvais-secret", {
    brandId: "tempoflow3",
    name: "hbtest",
    accessToken: "at-pirate",
  });
  assert.equal(bad.status, 401);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM admin_fleet_servers`).get().n,
    0,
  );

  // Bon secret → serverId + serverKey ; tokens protégés au repos.
  const at1 = "access-token-clair-0001";
  const reg1 = await post(base, "register", SECRET, {
    brandId: "tempoflow3",
    name: "hbtest",
    containerName: "tempoflow3-server-hbtest",
    serverUrl: "http://127.0.0.1:18999/",
    version: "0.4.0",
    accessToken: at1,
  });
  assert.equal(reg1.status, 200, JSON.stringify(reg1.json));
  assert.ok(reg1.json.serverId, "serverId retourné");
  assert.ok(reg1.json.serverKey, "serverKey retourné (une seule fois)");
  assert.equal(reg1.json.rotation, false);
  const row1 = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
    .get(reg1.json.serverId);
  assert.ok(
    String(row1.access_token_enc).startsWith("enc:v1:"),
    "accessToken chiffré AES-GCM au repos",
  );
  assert.equal(
    openIntegrationSecret(row1.access_token_enc),
    at1,
    "accessToken déchiffrable (clé dérivée AUTH_SECRET)",
  );
  assert.ok(
    String(row1.server_key_hash).startsWith("sha256:"),
    "serverKey stocké hashé",
  );
  assert.ok(
    !String(row1.server_key_hash).includes(reg1.json.serverKey),
    "serverKey JAMAIS en clair en DB",
  );
  assert.equal(row1.version, "0.4.0");
  assert.ok(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM admin_fleet_events WHERE server_id = ? AND kind = 'registered'`,
      )
      .get(reg1.json.serverId).n >= 1,
    "event registered journalisé",
  );

  // 2. Rotation : ré-inscription idempotente (même serveur).
  const at2 = "access-token-clair-0002";
  const reg2 = await post(base, "register", SECRET, {
    brandId: "tempoflow3",
    name: "hbtest",
    version: "0.4.1",
    accessToken: at2,
  });
  assert.equal(reg2.status, 200);
  assert.equal(reg2.json.serverId, reg1.json.serverId, "même row (idempotent)");
  assert.equal(reg2.json.rotation, true);
  assert.notEqual(reg2.json.serverKey, reg1.json.serverKey, "serverKey tourné");
  const row2 = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
    .get(reg1.json.serverId);
  assert.equal(openIntegrationSecret(row2.access_token_enc), at2);
  assert.ok(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM admin_fleet_events WHERE server_id = ? AND kind = 'rotated'`,
      )
      .get(reg1.json.serverId).n >= 1,
    "event rotated journalisé",
  );

  // Ancien serverKey refusé après rotation.
  const hbOld = await post(base, "heartbeat", reg1.json.serverKey, {
    serverId: reg1.json.serverId,
  });
  assert.equal(hbOld.status, 401, "ancienne clé refusée après rotation");

  // 3. Heartbeat avec la clé courante → statut mis à jour.
  const hb = await post(base, "heartbeat", reg2.json.serverKey, {
    serverId: reg1.json.serverId,
    version: "0.4.1",
    health: "ok",
    bootHeadline: "Prêt",
    diskBytes: 123456,
  });
  assert.equal(hb.status, 200, JSON.stringify(hb.json));
  assert.ok(hb.json.heartbeatIntervalSeconds >= 10);
  const row3 = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
    .get(reg1.json.serverId);
  assert.equal(row3.health, "ok");
  assert.equal(row3.disk_bytes, 123456);
  assert.ok(row3.last_heartbeat_at, "last_heartbeat_at posé");

  const hbBad = await post(base, "heartbeat", "cle-bidon", {
    serverId: reg1.json.serverId,
  });
  assert.equal(hbBad.status, 401);

  srv.close();
});

test("fleet-heartbeat : rate-limit register par IP", async () => {
  const db = makeDb();
  const mount = createFleetRegistryMount({
    registerSecret: SECRET,
    registerRatePerMinute: 3,
  });
  const call = (ip) =>
    mount.handle({
      req: {
        method: "POST",
        body: { brandId: "b", name: "n", accessToken: "t" },
        query: {},
        headers: {
          authorization: `Bearer mauvais`,
          "x-forwarded-for": ip,
        },
      },
      subPath: "register",
      db,
    });
  for (let i = 0; i < 3; i++) {
    assert.equal((await call("10.0.0.1")).status, 401, "sous le quota → 401 (secret)");
  }
  assert.equal((await call("10.0.0.1")).status, 429, "quota IP dépassé → 429");
  assert.equal(
    (await call("10.0.0.2")).status,
    401,
    "autre IP non affectée (limite PAR ip)",
  );
});

test("fleet-heartbeat : client kit (état 0600, rotation auto, best-effort) + fleet-access", async () => {
  const db = makeDb();
  const mount = createFleetRegistryMount({ registerSecret: SECRET });
  const srv = makeAdminHttp(mount, db);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const adminUrl = `http://127.0.0.1:${srv.address().port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hb-gate-"));

  // No-op absolu sans env (desktop / instances non flotte).
  assert.equal(
    startFleetHeartbeat({
      brandId: "tempoflow3",
      dataDir,
      getVersion: () => "0.4.2",
      adminUrl: "",
      registerSecret: "",
    }),
    null,
    "sans env → no-op (null)",
  );

  const hb = startFleetHeartbeat({
    brandId: "tempoflow3",
    dataDir,
    name: "hbgate",
    containerName: "tempoflow3-server-hbgate",
    getVersion: () => "0.4.2",
    getBootStatus: () => ({ booting: false, headline: "Prêt" }),
    getHealth: () => "ok",
    getServerUrl: () => "http://127.0.0.1:18998/",
    adminUrl,
    registerSecret: SECRET,
  });
  assert.ok(hb, "démarré avec env");
  hb.stop(); // pas de timer pendant la gate — ticks manuels.

  // Premier tick = register (le fichier d'état apparaît, mode 0600).
  await hb.tick();
  const state = readFleetState(hb.stateFile);
  assert.ok(state.serverId, "serverId persisté");
  assert.ok(state.serverKey, "serverKey persisté");
  assert.match(
    state.accessTokenHash,
    /^sha256:/,
    "seul le HASH de l'accessToken persiste localement",
  );
  const mode = fs.statSync(hb.stateFile).mode & 0o777;
  assert.equal(mode, 0o600, `fichier d'état en 0600 (trouvé ${mode.toString(8)})`);

  const row = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
    .get(state.serverId);
  assert.ok(row, "row créée côté admin");
  assert.equal(row.brand_id, "tempoflow3");
  assert.equal(row.name, "hbgate");
  assert.equal(row.version, "0.4.2");
  // P3.b — version kit dans le heartbeat : le register annonce la version
  // lockstep @creezio/platform-core installée + la version d'architecture
  // (champs ADDITIFS, protocole flotte v1 dual-accept).
  const kitPkg = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "packages/platform-core/package.json"),
      "utf8",
    ),
  );
  assert.equal(row.kit_version, kitPkg.version, "kit_version annoncée au register");
  assert.match(
    String(row.architecture_version),
    /^H\d+$/,
    "architecture_version annoncée au register",
  );
  const accessTokenClair = openIntegrationSecret(row.access_token_enc);
  assert.ok(accessTokenClair, "admin détient l'accessToken (chiffré)");
  assert.ok(
    !fs.readFileSync(hb.stateFile, "utf8").includes(accessTokenClair),
    "accessToken en clair ABSENT du fichier d'état local",
  );

  // Deuxième tick = heartbeat (statut rafraîchi).
  db.prepare(
    `UPDATE admin_fleet_servers SET last_heartbeat_at = NULL WHERE id = ?`,
  ).run(state.serverId);
  await hb.tick();
  const rowHb = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
    .get(state.serverId);
  assert.ok(rowHb.last_heartbeat_at, "heartbeat rafraîchit last_heartbeat_at");
  assert.equal(rowHb.health, "ok");
  assert.ok(rowHb.disk_bytes >= 0, "diskBytes envoyé");
  assert.equal(
    rowHb.kit_version,
    kitPkg.version,
    "kit_version portée par chaque heartbeat",
  );

  // fleet-access : Bearer = accessToken (vérifié contre le hash local).
  const access = createFleetAccessMount({
    brandId: "tempoflow3",
    dataDir,
    getVersion: () => "0.4.2",
    getBootStatus: () => ({ booting: false }),
  });
  const status = await access.handle({
    req: {
      method: "GET",
      query: {},
      headers: { authorization: `Bearer ${accessTokenClair}` },
    },
    subPath: "status",
  });
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.version, "0.4.2");
  assert.equal(status.body.serverId, state.serverId);
  const accessBad = await access.handle({
    req: { method: "GET", query: {}, headers: { authorization: "Bearer nope" } },
    subPath: "status",
  });
  assert.equal(accessBad.status, 401);
  const logs = await access.handle({
    req: {
      method: "GET",
      query: { tail: "50" },
      headers: { authorization: `Bearer ${accessTokenClair}` },
    },
    subPath: "logs",
  });
  assert.equal(logs.status, 200, "logs répond même sans journal fichier");

  // Non provisionné (autre dataDir vierge) → 503, pas de fuite.
  const accessVierge = createFleetAccessMount({
    brandId: "tempoflow3",
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hb-vierge-")),
    getVersion: () => "0.4.2",
  });
  const viergeRes = await accessVierge.handle({
    req: { method: "GET", query: {}, headers: {} },
    subPath: "status",
  });
  assert.equal(viergeRes.status, 503, "non provisionné → 503");

  // Rotation auto : l'admin perd/rotate la clé → heartbeat 401 → ré-inscription.
  db.prepare(
    `UPDATE admin_fleet_servers SET server_key_hash = 'sha256:autre' WHERE id = ?`,
  ).run(state.serverId);
  await hb.tick();
  const state2 = readFleetState(hb.stateFile);
  assert.ok(state2.serverKey, "nouveau serverKey après rotation auto");
  assert.notEqual(state2.serverKey, state.serverKey);
  const rowRot = db
    .prepare(`SELECT * FROM admin_fleet_servers WHERE id = ?`)
    .get(state.serverId);
  assert.ok(
    String(rowRot.server_key_hash).startsWith("sha256:") &&
      rowRot.server_key_hash !== "sha256:autre",
    "hash re-posé côté admin (ré-inscription)",
  );

  srv.close();

  // 6. Best-effort absolu : admin injoignable → tick ne lève jamais.
  const dead = startFleetHeartbeat({
    brandId: "tempoflow3",
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "fleet-hb-dead-")),
    name: "deadgate",
    getVersion: () => "0.4.2",
    adminUrl: "http://127.0.0.1:9", // port discard — connexion refusée
    registerSecret: SECRET,
  });
  dead.stop();
  await assert.doesNotReject(dead.tick(), "admin down → jamais d'exception");
  const deadState = readFleetState(dead.stateFile);
  assert.equal(deadState.serverId, null, "pas d'état fantôme si register KO");
});

test("fleet-heartbeat : factory forwarde les env flotte en --profile prod", () => {
  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  for (const key of [
    "CREEZIO_FLEET_ADMIN_URL",
    "CREEZIO_FLEET_REGISTER_SECRET",
    "CREEZIO_FLEET_HOST_ID",
    "CREEZIO_FLEET_BACKEND_URL",
    "CREEZIO_FLEET_BACKEND_BASIC",
  ]) {
    assert.ok(
      cli.includes(`"${key}"`),
      `${key} dans la liste de forward --profile prod`,
    );
  }
});
