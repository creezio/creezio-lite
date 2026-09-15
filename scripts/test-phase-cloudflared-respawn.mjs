#!/usr/bin/env node
/**
 * Gate — superviseur cloudflared in-process (respawn borné).
 *
 * Prouve que la mort du process QUIC ne laisse plus le hostname public
 * orphelin (525) : respawn avec backoff, même tunnel id / token persisté,
 * abandon après N essais, stop annule le timer. Aucun POST cfd_tunnel
 * sur le chemin spawn (fail-closed #84/#86/#87 non touché).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLOUDFLARED_RESPAWN,
  cloudflaredRespawnDelayMs,
  createLocalConfigStoreSync,
  createTunnelService,
  describeCloudflaredExit,
  resolveCloudflaredRespawnPolicy,
  shouldRespawnCloudflared,
} from "../packages/host-runtime/dist/index.js";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function persistTunnel(store, token = "tok-persist-1") {
  store.setTunnelConfig({
    slug: "recette",
    hostname: "recette.example.test",
    publicUrl: "https://recette.example.test",
    tunnelId: "tun-persist-1",
    tunnelToken: token,
    localPort: 18791,
    publicUrls: {
      crm: "https://recette.example.test",
      n8n: "https://n8n-recette.example.test",
      hermes: "https://hermes-recette.example.test",
    },
    hostMode: "flat",
    emailDomain: "recette.mail.example.test",
    servicePorts: { n8n: 5678, hermes: 8642 },
  });
}

function writeFakeCloudflared(dir, script) {
  const bin = path.join(dir, "cloudflared");
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return bin;
}

function spawnCount(marker) {
  if (!fs.existsSync(marker)) return 0;
  return fs.readFileSync(marker, "utf8").split("\n").filter(Boolean).length;
}

async function poll(fn, { timeoutMs = 4_000, intervalMs = 40 } = {}) {
  const started = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`poll timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function makeTunnel(tmp, logs = []) {
  const store = createLocalConfigStoreSync({
    configPath: path.join(tmp, "local-config.json"),
    manifest: demobrandManifest,
    encryption: "plain",
  });
  persistTunnel(store);
  const tunnel = createTunnelService({
    ctx: {
      manifest: demobrandManifest,
      userDataDir: path.join(tmp, "user-data"),
      resourcesRoot: path.join(tmp, "resources"),
      isPackaged: false,
      log: (_scope, line) => logs.push(line),
    },
    store,
  });
  return { store, tunnel, logs };
}

test("politique : stop volontaire → ignore ; exit ≠ 0 / signal / exit 0 → respawn", () => {
  const policy = {
    ...CLOUDFLARED_RESPAWN,
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 400,
    healthyResetMs: 1_000,
  };
  assert.deepEqual(
    shouldRespawnCloudflared({
      stopping: true,
      consecutiveFailures: 0,
      startedAtMs: Date.now(),
      exit: { code: 1, signal: null },
      policy,
    }),
    { action: "ignore" },
  );
  const crash = shouldRespawnCloudflared({
    stopping: false,
    consecutiveFailures: 0,
    startedAtMs: Date.now(),
    exit: { code: 1, signal: null },
    nowMs: Date.now(),
    policy,
  });
  assert.equal(crash.action, "respawn");
  assert.equal(crash.attempt, 1);
  assert.equal(crash.delayMs, 100);
  assert.match(crash.reason, /exit 1/);

  const sig = shouldRespawnCloudflared({
    stopping: false,
    consecutiveFailures: 1,
    startedAtMs: Date.now(),
    exit: { code: null, signal: "SIGTERM" },
    nowMs: Date.now(),
    policy,
  });
  assert.equal(sig.action, "respawn");
  assert.equal(sig.attempt, 2);
  assert.equal(sig.delayMs, 200);
  assert.match(sig.reason, /signal SIGTERM/);

  const clean = shouldRespawnCloudflared({
    stopping: false,
    consecutiveFailures: 0,
    startedAtMs: Date.now(),
    exit: { code: 0, signal: null },
    nowMs: Date.now(),
    policy,
  });
  assert.equal(clean.action, "respawn");
  assert.match(clean.reason, /exit 0/);
});

test("politique : backoff borné + abandon + reset après uptime sain", () => {
  assert.equal(cloudflaredRespawnDelayMs(1), 1_000);
  assert.equal(cloudflaredRespawnDelayMs(2), 2_000);
  assert.equal(cloudflaredRespawnDelayMs(6), 30_000);
  assert.equal(cloudflaredRespawnDelayMs(20), 30_000);

  const policy = {
    ...CLOUDFLARED_RESPAWN,
    maxAttempts: 2,
    initialDelayMs: 50,
    maxDelayMs: 200,
    healthyResetMs: 5_000,
  };
  const giveUp = shouldRespawnCloudflared({
    stopping: false,
    consecutiveFailures: 2,
    startedAtMs: 1_000,
    exit: { code: 1, signal: null },
    nowMs: 1_500,
    policy,
  });
  assert.equal(giveUp.action, "give-up");
  assert.equal(giveUp.attempt, 3);

  const reset = shouldRespawnCloudflared({
    stopping: false,
    consecutiveFailures: 7,
    startedAtMs: 1_000,
    exit: { code: 1, signal: null },
    nowMs: 1_000 + 5_000,
    policy,
  });
  assert.equal(reset.action, "respawn");
  assert.equal(reset.attempt, 1);
  assert.equal(describeCloudflaredExit({ code: null, signal: null }), "mort inattendue");
});

test("politique : overrides env bornés (pas de MAX=0 / NaN)", () => {
  const p = resolveCloudflaredRespawnPolicy({
    CREEZIO_CLOUDFLARED_RESPAWN_MAX: "2",
    CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS: "40",
    CREEZIO_CLOUDFLARED_RESPAWN_MAX_DELAY_MS: "80",
    CREEZIO_CLOUDFLARED_RESPAWN_HEALTHY_MS: "10",
  });
  assert.deepEqual(p, {
    maxAttempts: 2,
    initialDelayMs: 40,
    maxDelayMs: 80,
    factor: 2,
    healthyResetMs: 10,
  });
  const bad = resolveCloudflaredRespawnPolicy({
    CREEZIO_CLOUDFLARED_RESPAWN_MAX: "0",
    CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS: "nope",
  });
  assert.equal(bad.maxAttempts, CLOUDFLARED_RESPAWN.maxAttempts);
  assert.equal(bad.initialDelayMs, CLOUDFLARED_RESPAWN.initialDelayMs);
});

test("spawn : exit 1 → respawn même token / même id (pas de nouvel ensureCfTunnel)", async () => {
  const saved = {
    bin: process.env.CREEZIO_CLOUDFLARED_BINARY,
    marker: process.env.CREEZIO_GATE_CF_MARKER,
    max: process.env.CREEZIO_CLOUDFLARED_RESPAWN_MAX,
    delay: process.env.CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS,
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-respawn-"));
  const marker = path.join(tmp, "spawns.txt");
  const logs = [];
  try {
    process.env.CREEZIO_CLOUDFLARED_BINARY = writeFakeCloudflared(
      tmp,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CREEZIO_GATE_CF_MARKER"
echo "Registered tunnel connection (gate stub)"
n=$(wc -l < "$CREEZIO_GATE_CF_MARKER")
if [ "$n" -lt 2 ]; then
  sleep 0.15
  exit 1
fi
exec sleep 300
`,
    );
    process.env.CREEZIO_GATE_CF_MARKER = marker;
    process.env.CREEZIO_CLOUDFLARED_RESPAWN_MAX = "4";
    process.env.CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS = "40";
    const { store, tunnel } = makeTunnel(tmp, logs);
    const idBefore = store.getTunnelConfig().tunnelId;
    await tunnel.startCloudflared();
    await poll(() => spawnCount(marker) >= 2);
    const lines = fs.readFileSync(marker, "utf8").trim().split("\n");
    assert.equal(lines.length, 2, `spawns: ${lines.join(" | ")}`);
    for (const line of lines) {
      assert.equal(
        line,
        "tunnel --no-autoupdate run --token tok-persist-1",
        "respawn réutilise le token persisté",
      );
    }
    assert.equal(store.getTunnelConfig().tunnelId, idBefore);
    assert.equal(store.getTunnelConfig().tunnelToken, "tok-persist-1");
    assert.ok(
      logs.some((l) => /id tun-persist-1 réutilisé/.test(l)),
      `log respawn id manquant: ${logs.join(" | ")}`,
    );
    assert.equal(tunnel.getTunnelStatus().online, true);
    tunnel.stopCloudflared();
  } finally {
    restoreEnv(saved);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("spawn : abandon après N essais — pas de boucle folle", async () => {
  const saved = {
    bin: process.env.CREEZIO_CLOUDFLARED_BINARY,
    marker: process.env.CREEZIO_GATE_CF_MARKER,
    max: process.env.CREEZIO_CLOUDFLARED_RESPAWN_MAX,
    delay: process.env.CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS,
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-giveup-"));
  const marker = path.join(tmp, "spawns.txt");
  const logs = [];
  try {
    process.env.CREEZIO_CLOUDFLARED_BINARY = writeFakeCloudflared(
      tmp,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CREEZIO_GATE_CF_MARKER"
echo "Registered tunnel connection (gate stub)"
sleep 0.05
exit 1
`,
    );
    process.env.CREEZIO_GATE_CF_MARKER = marker;
    process.env.CREEZIO_CLOUDFLARED_RESPAWN_MAX = "2";
    process.env.CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS = "30";
    const { store, tunnel } = makeTunnel(tmp, logs);
    await tunnel.startCloudflared();
    await poll(() => logs.some((l) => /abandon après/.test(l)), {
      timeoutMs: 5_000,
    });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(spawnCount(marker), 3, "initial + 2 respawns puis stop");
    assert.equal(store.getTunnelConfig().tunnelId, "tun-persist-1");
    assert.match(tunnel.getTunnelStatus().error || "", /abandon après 3/);
    tunnel.stopCloudflared();
  } finally {
    restoreEnv(saved);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("spawn : stopCloudflared annule le respawn pending", async () => {
  const saved = {
    bin: process.env.CREEZIO_CLOUDFLARED_BINARY,
    marker: process.env.CREEZIO_GATE_CF_MARKER,
    max: process.env.CREEZIO_CLOUDFLARED_RESPAWN_MAX,
    delay: process.env.CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS,
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cf-stop-"));
  const marker = path.join(tmp, "spawns.txt");
  try {
    process.env.CREEZIO_CLOUDFLARED_BINARY = writeFakeCloudflared(
      tmp,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CREEZIO_GATE_CF_MARKER"
echo "Registered tunnel connection (gate stub)"
sleep 0.05
exit 1
`,
    );
    process.env.CREEZIO_GATE_CF_MARKER = marker;
    process.env.CREEZIO_CLOUDFLARED_RESPAWN_MAX = "8";
    process.env.CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS = "400";
    const { tunnel } = makeTunnel(tmp);
    const started = tunnel.startCloudflared();
    await poll(() => spawnCount(marker) >= 1, { timeoutMs: 2_000 });
    tunnel.stopCloudflared();
    await started;
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(spawnCount(marker), 1, "stop annule le timer de respawn");
  } finally {
    restoreEnv(saved);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("source : spawn/exit ne (re)crée pas un tunnel — fail-closed #84/#86/#87 intacts", () => {
  const tunnelSrc = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/tunnel/tunnel.ts"),
    "utf8",
  );
  const respawnSrc = fs.readFileSync(
    path.join(ROOT, "packages/host-runtime/src/tunnel/cloudflared-respawn.ts"),
    "utf8",
  );
  const factoryTunnel = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-tunnel.ts"),
    "utf8",
  );
  const factoryOwner = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-owner.ts"),
    "utf8",
  );
  const adminAuth = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/listen-brand-os-http.ts"),
    "utf8",
  );
  assert.match(tunnelSrc, /shouldRespawnCloudflared/);
  assert.match(tunnelSrc, /spawnCloudflaredProcess/);
  assert.match(tunnelSrc, /id \$\{tunnelId\} réutilisé/);
  assert.match(respawnSrc, /jamais de POST/);
  const spawnFn = tunnelSrc.slice(tunnelSrc.indexOf("function spawnCloudflaredProcess"));
  assert.doesNotMatch(spawnFn, /ensureCfTunnel\(/);
  assert.doesNotMatch(spawnFn, /createCfTunnel\(/);
  assert.match(factoryTunnel, /fail-closed|Fail-closed|failClosed/i);
  assert.match(factoryOwner, /fail-closed|Fail-closed|failClosed/i);
  assert.match(adminAuth, /Default-deny `\/api\/v1\/admin\/\*`/);
});

function restoreEnv(saved) {
  for (const [key, envKey] of [
    ["bin", "CREEZIO_CLOUDFLARED_BINARY"],
    ["marker", "CREEZIO_GATE_CF_MARKER"],
    ["max", "CREEZIO_CLOUDFLARED_RESPAWN_MAX"],
    ["delay", "CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS"],
  ]) {
    if (saved[key] == null) delete process.env[envKey];
    else process.env[envKey] = saved[key];
  }
}
