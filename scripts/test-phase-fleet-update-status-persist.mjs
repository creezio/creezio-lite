#!/usr/bin/env node
/**
 * Gate FLOTTE T8 — persistance du suivi update-status (@creezio/fleet).
 *
 * Dette « Suivi update en mémoire » (docs/BACKLOG.md) : la Map
 * containerName → UpdateEntry du host-agent (et du plan local server-admin)
 * ne survivait pas à un restart pendant un update. Vérifie le store
 * update-status-store :
 *   - écriture atomique (tmp+rename, pas de résidu .tmp) ;
 *   - rechargement au boot : entrée "running" interrompue → flag additif
 *     `agentRestarted` + résolution via l'image du registre (done si
 *     l'update est allé au bout, error « issue réelle inconnue » sinon,
 *     dernière étape persistée incluse) ;
 *   - TTL 24 h sur les entrées terminées (purge au reload et à l'écriture) ;
 *   - boucle pull (runAgentUpdateCycle) : statut terminal + lastStep
 *     persistés sur disque ;
 *   - cas restart simulé : relance du binaire host-agent-main.js sur un
 *     state dir peuplé → GET /update-status retrouve un statut terminal
 *     (au lieu d'un trou), protocole v1 inchangé.
 *
 * Node pur (host-agent) — aucun electron. Dist `@creezio/fleet` requis.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLEET_DIST = path.join(ROOT, "packages/fleet/dist");
const FLEET_PROTOCOL_HEADER = "x-creezio-fleet-protocol";
const FLEET_PROTOCOL_VERSION = "1";

const { createUpdateStatusStore, DEFAULT_UPDATE_STATUS_TTL_MS } = await import(
  "../packages/fleet/dist/update-status-store.js"
);
const { runAgentUpdateCycle } = await import(
  "../packages/fleet/dist/agent-updates.js"
);

function tmpStoreFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-updstore-"));
  return { dir, file: path.join(dir, "host-agent-updates.json") };
}

test("store : écriture atomique + format journal versionné", () => {
  const { dir, file } = tmpStoreFile();
  try {
    const store = createUpdateStatusStore({ file });
    assert.equal(store.get("creezio-acme-a"), undefined);
    store.set("creezio-acme-a", {
      status: "running",
      image: "reg:5000/creezio-server-acme:0.2.0",
      startedAt: new Date().toISOString(),
    });
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.updates["creezio-acme-a"].status, "running");
    // Atomique : aucun résidu tmp après écriture.
    const residue = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
    assert.deepEqual(residue, [], "pas de fichier .tmp résiduel");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reload : update interrompu, issue inconnue → error + agentRestarted + dernière étape", () => {
  const { dir, file } = tmpStoreFile();
  try {
    const s1 = createUpdateStatusStore({ file });
    const entry = {
      status: "running",
      image: "reg:5000/creezio-server-acme:0.2.0",
      startedAt: new Date().toISOString(),
    };
    s1.set("creezio-acme-a", entry);
    entry.lastStep = "pull reg:5000/creezio-server-acme:0.2.0";
    s1.save();

    // « Restart » : nouveau store sur le même fichier, registre ≠ image cible.
    const s2 = createUpdateStatusStore({
      file,
      resolveInstanceImage: () => "reg:5000/creezio-server-acme:0.1.0",
    });
    const reloaded = s2.get("creezio-acme-a");
    assert.ok(reloaded, "l'entrée doit survivre au restart");
    assert.equal(reloaded.status, "error");
    assert.equal(reloaded.agentRestarted, true);
    assert.ok(reloaded.finishedAt, "statut terminal daté");
    assert.match(reloaded.result?.error || "", /redémarré pendant l'update/);
    assert.match(
      reloaded.result?.error || "",
      /pull reg:5000\/creezio-server-acme:0\.2\.0/,
      "la dernière étape persistée doit être restituée",
    );
    // La résolution est elle-même persistée (un 2e reload la retrouve telle quelle).
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(raw.updates["creezio-acme-a"].status, "error");
    // Mutex débloqué : plus d'entrée "running" fantôme après restart.
    assert.notEqual(reloaded.status, "running");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reload : image du registre = image de l'update → résolu done + agentRestarted", () => {
  const { dir, file } = tmpStoreFile();
  try {
    const image = "reg:5000/creezio-server-acme:0.2.0";
    createUpdateStatusStore({ file }).set("creezio-acme-a", {
      status: "running",
      image,
      startedAt: new Date().toISOString(),
    });
    // updateServer pose inst.image en fin d'update OK : le registre fait foi.
    const s2 = createUpdateStatusStore({
      file,
      resolveInstanceImage: () => image,
    });
    const reloaded = s2.get("creezio-acme-a");
    assert.equal(reloaded?.status, "done");
    assert.equal(reloaded?.agentRestarted, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TTL : entrées terminées purgées après 24 h, entrées récentes conservées", () => {
  const { dir, file } = tmpStoreFile();
  try {
    assert.equal(DEFAULT_UPDATE_STATUS_TTL_MS, 24 * 60 * 60 * 1000);
    const t0 = Date.parse("2026-08-31T00:00:00.000Z");
    const old = new Date(t0 - DEFAULT_UPDATE_STATUS_TTL_MS - 60_000);
    const recent = new Date(t0 - 60_000);
    const s1 = createUpdateStatusStore({ file, now: () => t0 });
    s1.set("creezio-acme-old", {
      status: "done",
      image: "img:1",
      startedAt: old.toISOString(),
      finishedAt: old.toISOString(),
    });
    s1.set("creezio-acme-recent", {
      status: "done",
      image: "img:2",
      startedAt: recent.toISOString(),
      finishedAt: recent.toISOString(),
    });
    // set() purge déjà : l'entrée expirée ne doit pas survivre à l'écriture.
    assert.equal(s1.get("creezio-acme-old"), undefined, "purge à l'écriture");
    assert.ok(s1.get("creezio-acme-recent"));

    // Purge au reload aussi : l'entrée récente expire quand l'horloge avance.
    const s2 = createUpdateStatusStore({
      file,
      now: () => t0 + DEFAULT_UPDATE_STATUS_TTL_MS + 120_000,
    });
    assert.equal(s2.get("creezio-acme-recent"), undefined, "purge au reload");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(raw.updates, {}, "fichier compacté après purge");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("boucle pull : statut terminal + lastStep persistés via le store", async () => {
  const { dir, file } = tmpStoreFile();
  try {
    const updates = createUpdateStatusStore({ file });
    const inst = {
      name: "a",
      containerName: "creezio-acme-a",
      port: 18791,
      dataDir: "docker-data/a",
      image: "reg:5000/creezio-server-acme:0.1.0",
    };
    const registry = {
      version: 1,
      brandId: "acme",
      image: "reg:5000/creezio-server-acme:0.1.0",
      instances: [inst],
    };
    const fetchImpl = async (url) => ({
      status: 200,
      headers: { get: (n) => (n === FLEET_PROTOCOL_HEADER ? "1" : null) },
      json: async () =>
        url.includes("/next")
          ? {
              ok: true,
              updates: [
                {
                  brandId: "acme",
                  name: "a",
                  image: "reg:5000/creezio-server-acme:0.2.0",
                },
              ],
            }
          : { ok: true },
    });
    const summary = await runAgentUpdateCycle({
      adminUrl: "http://admin.test",
      fleetKey: "k",
      hostId: "h1",
      brandRoots: ["/nope"],
      findInstance: () => ({ inst, brandRoot: "/nope", registry }),
      updateServer: async ({ image, onStep }) => {
        onStep?.(`pull ${image}`);
        onStep?.(`recreate → ${image}`);
        return {
          ok: true,
          image,
          previousImage: inst.image,
          version: "0.2.0",
          backup: null,
          steps: [`pull ${image}`, `recreate → ${image}`],
        };
      },
      updates,
      fetchImpl,
    });
    assert.equal(summary.applied, 1, JSON.stringify(summary));
    // Le fichier (pas la mémoire) doit porter le statut terminal + lastStep.
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const persisted = raw.updates["creezio-acme-a"];
    assert.equal(persisted.status, "done");
    assert.equal(persisted.source, "pull");
    assert.match(persisted.lastStep || "", /recreate → /);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------- restart simulé */

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

async function waitHttp(url, timeoutMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    try {
      return await fetch(url);
    } catch {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout ${url}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

test("restart simulé : host-agent relancé sur un state dir peuplé → update-status retrouvé", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-updrestart-"));
  const brandRoot = path.join(tmp, "brand");
  const dataDir = path.join(brandRoot, "docker-data");
  fs.mkdirSync(dataDir, { recursive: true });
  const token = crypto.randomBytes(24).toString("hex");
  const stateFile = path.join(dataDir, "host-agent.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      version: 1,
      hostId: "host-test",
      label: "gate",
      tokens: [
        {
          id: "tok1",
          hash:
            "sha256:" +
            crypto.createHash("sha256").update(token).digest("hex"),
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  );
  // Deux instances : « fini » (image registre = image update, posée par
  // updateServer avant le crash) et « interrompu » (image registre restée
  // sur l'ancienne — issue réelle inconnue).
  fs.writeFileSync(
    path.join(dataDir, "servers.json"),
    JSON.stringify({
      version: 1,
      brandId: "acme",
      image: "reg:5000/creezio-server-acme:0.1.0",
      instances: [
        {
          name: "fini",
          containerName: "creezio-acme-fini",
          port: 18791,
          dataDir: "docker-data/fini",
          image: "reg:5000/creezio-server-acme:0.2.0",
        },
        {
          name: "interrompu",
          containerName: "creezio-acme-interrompu",
          port: 18792,
          dataDir: "docker-data/interrompu",
          image: "reg:5000/creezio-server-acme:0.1.0",
        },
      ],
    }),
  );
  // Journal laissé par « l'agent d'avant » tué en plein update.
  fs.writeFileSync(
    path.join(dataDir, "host-agent-updates.json"),
    JSON.stringify({
      version: 1,
      updates: {
        "creezio-acme-fini": {
          status: "running",
          image: "reg:5000/creezio-server-acme:0.2.0",
          startedAt: new Date().toISOString(),
          lastStep: "health OK (version 0.2.0)",
        },
        "creezio-acme-interrompu": {
          status: "running",
          image: "reg:5000/creezio-server-acme:0.2.0",
          startedAt: new Date().toISOString(),
          lastStep: "recreate → reg:5000/creezio-server-acme:0.2.0",
        },
      },
    }),
  );

  const port = await ephemeralPort();
  const child = spawn(
    process.execPath,
    [path.join(FLEET_DIST, "bin", "host-agent-main.js")],
    {
      env: {
        ...process.env,
        CREEZIO_AGENT_PORT: String(port),
        CREEZIO_AGENT_HOSTS: "127.0.0.1",
        CREEZIO_AGENT_BRAND_ROOTS: brandRoot,
        CREEZIO_AGENT_STATE_FILE: stateFile,
        CREEZIO_DOCKER_SOCK: path.join(tmp, "nope.sock"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const ping = await waitHttp(`http://127.0.0.1:${port}/agent/ping`);
    assert.equal(ping.status, 200);
    const headers = {
      authorization: `Bearer ${token}`,
      [FLEET_PROTOCOL_HEADER]: FLEET_PROTOCOL_VERSION,
    };
    const getStatus = async (name) => {
      const r = await fetch(
        `http://127.0.0.1:${port}/agent/api/servers/acme/${name}/update-status`,
        { headers },
      );
      assert.equal(r.status, 200);
      const body = await r.json();
      assert.equal(body.ok, true);
      return body.update;
    };

    // Le poll admin retrouve un STATUT TERMINAL au lieu d'un trou (null).
    const fini = await getStatus("fini");
    assert.ok(fini, "suivi retrouvé après restart (pas de trou)");
    assert.equal(fini.status, "done", "image registre = cible → update fini");
    assert.equal(fini.agentRestarted, true);

    const interrompu = await getStatus("interrompu");
    assert.ok(interrompu, "suivi retrouvé après restart (pas de trou)");
    assert.equal(interrompu.status, "error", "issue réelle inconnue → error");
    assert.equal(interrompu.agentRestarted, true);
    assert.match(interrompu.result?.error || "", /redémarré pendant l'update/);
    assert.match(
      interrompu.result?.error || "",
      /recreate → reg:5000\/creezio-server-acme:0\.2\.0/,
      "dernière étape persistée restituée à l'admin",
    );

    // Mutex débloqué : le POST /update n'est plus refusé pour « déjà en
    // cours » (sans docker il échoue plus loin, mais jamais en 409).
    const retry = await fetch(
      `http://127.0.0.1:${port}/agent/api/servers/acme/interrompu/update`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ image: "reg:5000/creezio-server-acme:0.2.0" }),
      },
    );
    assert.notEqual(
      retry.status,
      409,
      "l'entrée interrompue ne doit pas coincer le mutex après restart",
    );
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
