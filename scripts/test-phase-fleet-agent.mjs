#!/usr/bin/env node
/**
 * Gate FLOTTE — agent hôte + server-admin multi-VPS (@creezio/fleet).
 *
 * Sans docker : CREEZIO_DOCKER_SOCK inexistant → états "unknown" acceptés.
 * Vérifie le contrat sécurité de l'agent : ping public, API refusée sans
 * Bearer, acceptée avec un token dont seul le hash est stocké + header
 * `x-creezio-fleet-protocol` (409 fail-closed si le header est absent —
 * contrat strict 0.19.0). Dist `@creezio/fleet` requis.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLEET_BIN = path.join(ROOT, "packages/fleet/dist/bin");
const FLEET_PROTOCOL_HEADER = "x-creezio-fleet-protocol";
const FLEET_PROTOCOL_VERSION = "1";

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
      const res = await fetch(url);
      return res;
    } catch {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout ${url}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

test("server-admin : suite locale @creezio/fleet verte", () => {
  const r = spawnSync(
    process.execPath,
    [
      "--test",
      path.join(
        ROOT,
        "packages/observability/fleet-collector/test-server-admin.mjs",
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
});

test("agent hôte : ping public, API Bearer only, token hashé", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-agent-"));
  const brandRoot = path.join(tmp, "brand");
  fs.mkdirSync(path.join(brandRoot, "docker-data"), { recursive: true });
  const token = crypto.randomBytes(24).toString("hex");
  const stateFile = path.join(brandRoot, "docker-data", "host-agent.json");
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      version: 1,
      hostId: "host-test",
      label: "gate",
      port: 0,
      bindHosts: "127.0.0.1",
      brandRoots: [brandRoot],
      tokens: [
        {
          id: "tok1",
          hash:
            "sha256:" +
            crypto.createHash("sha256").update(token).digest("hex"),
          label: "gate",
          createdAt: new Date().toISOString(),
        },
        {
          id: "tok2",
          hash:
            "sha256:" +
            crypto.createHash("sha256").update("revoked-token").digest("hex"),
          label: "revoked",
          createdAt: new Date().toISOString(),
          revokedAt: new Date().toISOString(),
        },
      ],
    }),
  );
  const port = await ephemeralPort();
  const child = spawn(
    process.execPath,
    [path.join(FLEET_BIN, "host-agent-main.js")],
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

    const noAuth = await fetch(`http://127.0.0.1:${port}/agent/api/servers`);
    assert.equal(noAuth.status, 401, "API sans Bearer doit être refusée");

    const badAuth = await fetch(`http://127.0.0.1:${port}/agent/api/servers`, {
      headers: { authorization: "Bearer nope" },
    });
    assert.equal(badAuth.status, 401);

    const revoked = await fetch(`http://127.0.0.1:${port}/agent/api/servers`, {
      headers: { authorization: "Bearer revoked-token" },
    });
    assert.equal(revoked.status, 401, "token révoqué doit être refusé");

    const noProto = await fetch(`http://127.0.0.1:${port}/agent/api/servers`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(
      noProto.status,
      409,
      "API autorisée sans header protocole doit être refusée (strict 0.19)",
    );
    const noProtoBody = await noProto.json();
    assert.equal(noProtoBody.error, "protocol_mismatch");

    const badProto = await fetch(`http://127.0.0.1:${port}/agent/api/servers`, {
      headers: {
        authorization: `Bearer ${token}`,
        [FLEET_PROTOCOL_HEADER]: "99",
      },
    });
    assert.equal(badProto.status, 409, "version de protocole ≠ v1 → 409");

    const ok = await fetch(`http://127.0.0.1:${port}/agent/api/servers`, {
      headers: {
        authorization: `Bearer ${token}`,
        [FLEET_PROTOCOL_HEADER]: FLEET_PROTOCOL_VERSION,
      },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get(FLEET_PROTOCOL_HEADER), FLEET_PROTOCOL_VERSION);
    const body = await ok.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.servers));

    // Jamais de token en clair dans l'état persisté.
    const persisted = fs.readFileSync(stateFile, "utf8");
    assert.ok(!persisted.includes(token));
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
