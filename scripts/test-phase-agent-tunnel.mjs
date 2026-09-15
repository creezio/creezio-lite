#!/usr/bin/env node
/**
 * Gate T7 — tunnel cloudflared DÉDIÉ au host-agent.
 *
 * L'ingress `agent.{slug}.{zone}` ne passe plus par le cloudflared d'un
 * serveur applicatif : container dédié `creezio-agent-tunnel`, provisionné
 * à l'enroll (volet API CF : test-phase-tunnel-self-provision §10).
 * Ici, le volet HÔTE :
 *
 *  1. politique de respawn du watch fleet (miroir cloudflared-respawn,
 *     bornée : ignore/respawn/give-up, backoff, reset après uptime sain,
 *     overrides env bornés) ;
 *  2. boucle de surveillance (docker injecté — aucun daemon requis) :
 *     absent = idle loggé une fois, mort → restart borné, abandon après N,
 *     stop() annule, container redevenu sain → compteur remis à zéro ;
 *  3. contrats source : helpers factory (container/run-args/env-file 600,
 *     token JAMAIS en argv), ordre de migration (provision → connecteur
 *     → bascule DNS → retrait règle résiduelle) porté par
 *     provisionDedicatedAgentTunnel (enroll ET agent up), persist
 *     agentUrl dédiée (host-agent.json + fleet-hosts.json, plus
 *     l'URL nested partagée), host-agent démarre le watch (pas de
 *     kill-switch), jamais de POST cfd_tunnel côté watch, noms de
 *     container alignés fleet ↔ factory, instance rm ne touche jamais
 *     un DNS agent.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const fleetDist = path.join(ROOT, "packages/fleet/dist/agent-tunnel.js");
assert.ok(
  fs.existsSync(fleetDist),
  "packages/fleet/dist/agent-tunnel.js absent — npm run build -w @creezio/fleet",
);
const {
  AGENT_TUNNEL_CONTAINER,
  AGENT_TUNNEL_RESPAWN,
  agentTunnelRespawnDelayMs,
  resolveAgentTunnelRespawnPolicy,
  shouldRespawnAgentTunnel,
  startAgentTunnelWatch,
} = await import(pathToFileURL(fleetDist).href);

const factoryDist = path.join(
  ROOT,
  "packages/factory/dist/server-docker-agent-tunnel.js",
);
assert.ok(
  fs.existsSync(factoryDist),
  "packages/factory/dist/server-docker-agent-tunnel.js absent — npm run build -w @creezio/factory",
);
const factory = await import(pathToFileURL(factoryDist).href);

function poll(fn, { timeoutMs = 4_000, intervalMs = 20 } = {}) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const v = fn();
      if (v) {
        clearInterval(timer);
        resolve(v);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`poll timeout après ${timeoutMs}ms`));
      }
    }, intervalMs);
  });
}

/* ── 1. politique ── */

test("politique : stop volontaire → ignore ; container mort → respawn backoff ; abandon", () => {
  const policy = {
    ...AGENT_TUNNEL_RESPAWN,
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 400,
    healthyResetMs: 1_000,
  };
  assert.deepEqual(
    shouldRespawnAgentTunnel({
      stopping: true,
      consecutiveFailures: 0,
      startedAtMs: Date.now(),
      observedStatus: "exited",
      policy,
    }),
    { action: "ignore" },
  );
  const dead = shouldRespawnAgentTunnel({
    stopping: false,
    consecutiveFailures: 0,
    startedAtMs: Date.now(),
    observedStatus: "exited",
    nowMs: Date.now(),
    policy,
  });
  assert.equal(dead.action, "respawn");
  assert.equal(dead.attempt, 1);
  assert.equal(dead.delayMs, 100);
  assert.match(dead.reason, /exited/);
  const second = shouldRespawnAgentTunnel({
    stopping: false,
    consecutiveFailures: 1,
    startedAtMs: Date.now(),
    observedStatus: "dead",
    nowMs: Date.now(),
    policy,
  });
  assert.equal(second.attempt, 2);
  assert.equal(second.delayMs, 200);
  const giveUp = shouldRespawnAgentTunnel({
    stopping: false,
    consecutiveFailures: 3,
    startedAtMs: 1_000,
    observedStatus: "exited",
    nowMs: 1_500,
    policy,
  });
  assert.equal(giveUp.action, "give-up");
  assert.equal(giveUp.attempt, 4);
  // Uptime sain ≥ healthyResetMs → compteur remis à zéro.
  const reset = shouldRespawnAgentTunnel({
    stopping: false,
    consecutiveFailures: 7,
    startedAtMs: 1_000,
    observedStatus: "exited",
    nowMs: 1_000 + 1_000,
    policy,
  });
  assert.equal(reset.action, "respawn");
  assert.equal(reset.attempt, 1);
});

test("politique : backoff borné + mêmes défauts que cloudflared-respawn + overrides env bornés", () => {
  assert.equal(agentTunnelRespawnDelayMs(1), 1_000);
  assert.equal(agentTunnelRespawnDelayMs(2), 2_000);
  assert.equal(agentTunnelRespawnDelayMs(6), 30_000);
  assert.equal(agentTunnelRespawnDelayMs(20), 30_000);
  // Miroir de CLOUDFLARED_RESPAWN (host-runtime) — fleet reste Node pur.
  assert.deepEqual(AGENT_TUNNEL_RESPAWN, {
    maxAttempts: 8,
    initialDelayMs: 1_000,
    maxDelayMs: 30_000,
    factor: 2,
    healthyResetMs: 60_000,
  });
  const p = resolveAgentTunnelRespawnPolicy({
    CREEZIO_AGENT_TUNNEL_RESPAWN_MAX: "2",
    CREEZIO_AGENT_TUNNEL_RESPAWN_DELAY_MS: "40",
    CREEZIO_AGENT_TUNNEL_RESPAWN_MAX_DELAY_MS: "80",
    CREEZIO_AGENT_TUNNEL_RESPAWN_HEALTHY_MS: "10",
  });
  assert.deepEqual(p, {
    maxAttempts: 2,
    initialDelayMs: 40,
    maxDelayMs: 80,
    factor: 2,
    healthyResetMs: 10,
  });
  const bad = resolveAgentTunnelRespawnPolicy({
    CREEZIO_AGENT_TUNNEL_RESPAWN_MAX: "0",
    CREEZIO_AGENT_TUNNEL_RESPAWN_DELAY_MS: "nope",
  });
  assert.equal(bad.maxAttempts, AGENT_TUNNEL_RESPAWN.maxAttempts);
  assert.equal(bad.initialDelayMs, AGENT_TUNNEL_RESPAWN.initialDelayMs);
});

/* ── 2. watch (docker injecté) ── */

function fakeDocker(initial) {
  const state = {
    view: initial, // null = absent, sinon {running, status, startedAtMs}
    starts: 0,
    onStart: null,
  };
  return {
    state,
    deps: {
      inspect: async () =>
        state.view === null
          ? null
          : { exists: true, ...state.view },
      start: async () => {
        state.starts += 1;
        if (state.onStart) state.onStart();
      },
      log: () => {},
    },
  };
}

test("watch : container mort → restart, puis sain → compteur remis à zéro", async () => {
  const logs = [];
  const fake = fakeDocker({ running: false, status: "exited", startedAtMs: null });
  fake.state.onStart = () => {
    fake.state.view = {
      running: true,
      status: "running",
      startedAtMs: Date.now(),
    };
  };
  fake.deps.log = (l) => logs.push(l);
  const watch = startAgentTunnelWatch({
    container: "creezio-agent-tunnel",
    intervalMs: 25,
    policy: {
      maxAttempts: 4,
      initialDelayMs: 10,
      maxDelayMs: 40,
      factor: 2,
      healthyResetMs: 60,
    },
    deps: fake.deps,
  });
  try {
    await poll(() => fake.state.starts >= 1);
    assert.equal(watch.getStatus().consecutiveFailures, 1);
    // Sain ≥ healthyResetMs → reset.
    await poll(() => watch.getStatus().consecutiveFailures === 0, {
      timeoutMs: 3_000,
    });
    assert.equal(watch.getStatus().observed, "running");
    assert.equal(watch.getStatus().gaveUp, false);
    assert.ok(
      logs.some((l) => /respawn/.test(l)),
      `log respawn manquant: ${logs.join(" | ")}`,
    );
    assert.ok(logs.some((l) => /compteur de pannes remis à zéro/.test(l)));
  } finally {
    watch.stop();
  }
});

test("watch : abandon après N essais (pas de boucle folle), repart si redevenu sain", async () => {
  const logs = [];
  const fake = fakeDocker({ running: false, status: "exited", startedAtMs: null });
  fake.deps.log = (l) => logs.push(l);
  const watch = startAgentTunnelWatch({
    container: "creezio-agent-tunnel",
    intervalMs: 20,
    policy: {
      maxAttempts: 2,
      initialDelayMs: 5,
      maxDelayMs: 10,
      factor: 2,
      healthyResetMs: 50,
    },
    deps: fake.deps,
  });
  try {
    await poll(() => watch.getStatus().gaveUp, { timeoutMs: 3_000 });
    const startsAtGiveUp = fake.state.starts;
    assert.equal(startsAtGiveUp, 2, "starts = maxAttempts puis abandon");
    assert.ok(logs.some((l) => /abandon après/.test(l)));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fake.state.starts, startsAtGiveUp, "plus aucun start après abandon");
    // Redevenu sain (ex. docker start manuel) → le watch repart.
    fake.state.view = {
      running: true,
      status: "running",
      startedAtMs: Date.now() - 60_000,
    };
    await poll(() => watch.getStatus().gaveUp === false, { timeoutMs: 3_000 });
    assert.equal(watch.getStatus().consecutiveFailures, 0);
  } finally {
    watch.stop();
  }
});

test("watch : container absent = idle loggé UNE fois ; stop() annule", async () => {
  const logs = [];
  const fake = fakeDocker(null);
  fake.deps.log = (l) => logs.push(l);
  const watch = startAgentTunnelWatch({
    container: "creezio-agent-tunnel",
    intervalMs: 15,
    deps: fake.deps,
  });
  try {
    await poll(() => logs.length >= 1);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      logs.filter((l) => /non provisionné/.test(l)).length,
      1,
      `log absent répété: ${logs.join(" | ")}`,
    );
    assert.equal(fake.state.starts, 0, "jamais de start sur container absent");
    assert.equal(watch.getStatus().observed, "absent");
  } finally {
    watch.stop();
  }
  // stop() : un container mort après stop ne déclenche plus rien.
  const fake2 = fakeDocker({ running: false, status: "exited", startedAtMs: null });
  const watch2 = startAgentTunnelWatch({
    container: "creezio-agent-tunnel",
    intervalMs: 10,
    policy: {
      maxAttempts: 8,
      initialDelayMs: 5,
      maxDelayMs: 10,
      factor: 2,
      healthyResetMs: 50,
    },
    deps: fake2.deps,
  });
  watch2.stop();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fake2.state.starts, 0, "stop() annule la boucle");
});

/* ── 3. contrats factory (helpers purs via dist) ── */

test("factory : run-args du connecteur (network host, restart, token via env-file JAMAIS en argv)", () => {
  assert.equal(factory.AGENT_TUNNEL_CONTAINER, AGENT_TUNNEL_CONTAINER);
  assert.equal(AGENT_TUNNEL_CONTAINER, "creezio-agent-tunnel");
  const args = factory.buildAgentTunnelRunArgs({
    image: "cloudflare/cloudflared:latest",
    envFile: "/opt/docker/brand/docker-data/agent-tunnel.env",
  });
  assert.deepEqual(args, [
    "run",
    "-d",
    "--name",
    "creezio-agent-tunnel",
    "--restart",
    "unless-stopped",
    "--network",
    "host",
    "--label",
    "creezio.agent-tunnel=1",
    "--env-file",
    "/opt/docker/brand/docker-data/agent-tunnel.env",
    "cloudflare/cloudflared:latest",
    "tunnel",
    "--no-autoupdate",
    "--protocol",
    "http2",
    "run",
  ]);
  assert.ok(
    !args.some((a) => /--token/.test(a)),
    "token jamais en argv (docker inspect / ps)",
  );
  assert.equal(
    factory.agentTunnelEnvPath("/opt/docker/brand"),
    path.join("/opt/docker/brand", "docker-data", "agent-tunnel.env"),
  );
  const rendered = factory.renderAgentTunnelEnvFile("tok-gate-1");
  assert.match(rendered, /^TUNNEL_TOKEN=tok-gate-1$/m);
  assert.throws(
    () => factory.renderAgentTunnelEnvFile("  "),
    /tunnelToken vide/,
  );
  assert.equal(
    factory.resolveAgentTunnelImage({}),
    "cloudflare/cloudflared:latest",
  );
  assert.equal(
    factory.resolveAgentTunnelImage({
      CREEZIO_AGENT_TUNNEL_IMAGE: "mirror.local/cloudflared:2024",
    }),
    "mirror.local/cloudflared:2024",
  );
});

/* ── 4. contrats source (enroll / agent up / host-agent / fail-closed) ── */

test("source : provisionDedicatedAgentTunnel = ensure → connecteur → DNS → retrait résiduel", () => {
  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  const iFn = cli.indexOf("async function provisionDedicatedAgentTunnel");
  const iEnsure = cli.indexOf("cf.ensureCfAgentTunnel(", iFn);
  const iContainer = cli.indexOf(
    "ensureAgentTunnelContainer({ env: process.env, envFile, recreate: true })",
    iFn,
  );
  const iDns = cli.indexOf("cf.ensureCfAgentTunnelDns(", iFn);
  const iLegacy = cli.indexOf("cf.removeCfTunnelAgentRule(", iFn);
  assert.ok(iFn > 0, "provisionDedicatedAgentTunnel extraite (enroll + agent up)");
  assert.ok(iEnsure > iFn, "ensureCfAgentTunnel dans le geste partagé");
  assert.ok(
    iEnsure < iContainer && iContainer < iDns && iDns < iLegacy,
    `ordre migration cassé (ensure=${iEnsure}, container=${iContainer}, dns=${iDns}, legacy=${iLegacy})`,
  );
  const slice = cli.slice(iEnsure, iDns);
  assert.match(slice, /dns: false/);
  assert.ok(
    !/agent:\s*\{\s*host:\s*"host\.docker\.internal"/.test(cli),
    "aucun chemin ne pose la règle agent sur le tunnel d'une instance",
  );
  assert.match(cli, /needsDedicatedAgentTunnelMigration/);
  assert.match(cli, /deprovisionCfAgentTunnel/);
  assert.match(cli, /action === "rm"/);
  assert.match(cli, /recreate: false/);
  assert.match(cli, /writeAgentTunnelEnv/);

  const helper = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-agent-tunnel.ts"),
    "utf8",
  );
  assert.match(helper, /mode: 0o600|chmod|600/);
  assert.match(helper, /export function needsDedicatedAgentTunnelMigration/);
  assert.match(helper, /export function parseAgentPublicUrl/);
  assert.match(helper, /export function canonicalDedicatedAgentUrl/);
  assert.match(helper, /export function applyDedicatedAgentUrlToHostState/);
  assert.match(helper, /export function persistDedicatedAgentUrlInFleetHostsFile/);
  assert.match(helper, /export function isFsPermissionError/);
  assert.match(helper, /export function readTextFileDirectOrSudo/);
  assert.match(helper, /export function writeTextFileDirectOrSudo/);
  assert.match(helper, /export function formatStackFileEaccesError/);
  assert.match(helper, /CREEZIO_SERVER_DOCKER_WRAPPER/);
  assert.match(helper, /priv-io/);
  assert.match(helper, /sudo -n/);
  assert.match(helper, /permissionDenied/);
  assert.match(helper, /Ne PAS chmod\/chown/);
});

test("helpers : needsDedicatedAgentTunnelMigration + parseAgentPublicUrl", () => {
  assert.equal(
    factory.needsDedicatedAgentTunnelMigration({
      adminUrl: "https://admin.example",
      agentUrl: "https://agent-resto.example.test",
      envFileExists: false,
    }),
    true,
    "enrôlé sans tunnel dédié → migration",
  );
  assert.equal(
    factory.needsDedicatedAgentTunnelMigration({
      adminUrl: "https://admin.example",
      agentUrl: "https://agent-resto.example.test",
      agentTunnel: { tunnelId: "t-1" },
      envFileExists: false,
    }),
    false,
    "déjà dédié (state) → pas de migration",
  );
  assert.equal(
    factory.needsDedicatedAgentTunnelMigration({
      adminUrl: "https://admin.example",
      envFileExists: true,
    }),
    false,
    "env file dédié présent → pas de migration",
  );
  assert.equal(
    factory.needsDedicatedAgentTunnelMigration({
      envFileExists: false,
    }),
    false,
    "pas enrôlé → pas de migration",
  );
  assert.deepEqual(
    factory.parseAgentPublicUrl("https://agent.resto-lyon.tempoflow.fr"),
    {
      hostname: "agent.resto-lyon.tempoflow.fr",
      serverHostname: "resto-lyon.tempoflow.fr",
      slugGuess: "resto-lyon",
      hostMode: "nested",
    },
  );
  assert.deepEqual(
    factory.parseAgentPublicUrl("https://agent-resto-lyon.tempoflow.fr/"),
    {
      hostname: "agent-resto-lyon.tempoflow.fr",
      serverHostname: "resto-lyon.tempoflow.fr",
      slugGuess: "resto-lyon",
      hostMode: "flat",
    },
  );
  assert.equal(factory.parseAgentPublicUrl("http://127.0.0.1:18810"), null);
});

test("helpers : après migration, agentUrl == URL dédiée (plus l'URL nested partagée)", () => {
  assert.equal(
    factory.canonicalDedicatedAgentUrl({
      provisionedUrl: "https://agent-resto.example.test/",
    }),
    "https://agent-resto.example.test",
  );
  assert.equal(
    factory.canonicalDedicatedAgentUrl({
      hostname: "agent-resto.example.test",
    }),
    "https://agent-resto.example.test",
  );
  assert.throws(
    () => factory.canonicalDedicatedAgentUrl({}),
    /introuvable/,
  );
  assert.throws(
    () => factory.canonicalDedicatedAgentUrl({ provisionedUrl: "http://agent-resto.example.test" }),
    /https requis/,
  );

  const nestedShared = "https://agent.resto.example.test";
  const dedicated = "https://agent-resto.example.test";
  assert.equal(
    factory.agentUrlNeedsDedicatedPersist(nestedShared, dedicated),
    true,
    "URL nested partagée ≠ URL dédiée",
  );
  assert.equal(
    factory.agentUrlNeedsDedicatedPersist(dedicated, dedicated),
    false,
    "déjà dédiée → idempotent",
  );
  assert.equal(
    factory.agentUrlNeedsDedicatedPersist(null, dedicated),
    true,
    "agentUrl absent → persist",
  );

  const state = { agentUrl: nestedShared };
  assert.equal(factory.applyDedicatedAgentUrlToHostState(state, dedicated), true);
  assert.equal(state.agentUrl, dedicated, "host-agent.json : plus l'URL nested");
  assert.equal(
    factory.applyDedicatedAgentUrlToHostState(state, dedicated),
    false,
    "re-apply idempotent",
  );

  const hosts = {
    hosts: [
      { hostId: "host-1", agentUrl: nestedShared },
      { hostId: "host-other", agentUrl: "https://agent.other.example.test" },
    ],
  };
  assert.deepEqual(
    factory.applyDedicatedAgentUrlToFleetHosts(hosts, "host-1", dedicated),
    { found: true, changed: true },
  );
  assert.equal(
    hosts.hosts[0].agentUrl,
    dedicated,
    "fleet-hosts.json : agentUrl == URL dédiée",
  );
  assert.equal(
    hosts.hosts[1].agentUrl,
    "https://agent.other.example.test",
    "autres hôtes intacts",
  );
  assert.deepEqual(
    factory.applyDedicatedAgentUrlToFleetHosts(hosts, "host-1", dedicated),
    { found: true, changed: false },
    "fleet-hosts idempotent",
  );
  assert.deepEqual(
    factory.applyDedicatedAgentUrlToFleetHosts(hosts, "inconnu", dedicated),
    { found: false, changed: false },
  );

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-agenturl-"));
  try {
    const brandRoot = path.join(tmp, "brand");
    const adminRoot = path.join(tmp, "brand-admin");
    fs.mkdirSync(path.join(brandRoot, "docker-data"), { recursive: true });
    fs.mkdirSync(path.join(adminRoot, "docker-data"), { recursive: true });
    const runtime = path.join(adminRoot, "docker-data", "fleet-hosts.json");
    fs.writeFileSync(
      runtime,
      JSON.stringify({
        version: 1,
        hosts: [{ hostId: "host-1", agentUrl: nestedShared, agentToken: "tok" }],
      }),
    );
    const found = factory.discoverFleetHostsJsonPaths({
      brandRoot,
      adminRoot,
    });
    assert.ok(found.includes(runtime), `runtime manquant: ${found.join(",")}`);
    const wrote = factory.persistDedicatedAgentUrlInFleetHostsFile(
      runtime,
      "host-1",
      dedicated,
    );
    assert.deepEqual(wrote, { found: true, changed: true });
    const after = JSON.parse(fs.readFileSync(runtime, "utf8"));
    assert.equal(after.hosts[0].agentUrl, dedicated);
    assert.equal(after.hosts[0].agentToken, "tok", "token intact");
    assert.deepEqual(
      factory.persistDedicatedAgentUrlInFleetHostsFile(runtime, "host-1", dedicated),
      { found: true, changed: false },
    );

    const eacces = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    assert.equal(factory.isFsPermissionError(eacces), true);
    assert.equal(factory.isFsPermissionError(new Error("ENOENT")), false);
    const denied = factory.persistDedicatedAgentUrlInFleetHostsFile(
      runtime,
      "host-1",
      "https://agent-other.example.test",
      {
        readFile: () => {
          throw eacces;
        },
        writeFile: () => {
          throw eacces;
        },
      },
    );
    assert.deepEqual(
      denied,
      { found: true, changed: false, permissionDenied: true },
      "EACCES → permissionDenied, pas d'exception",
    );
    const sudoWrote = { path: "", body: "" };
    const viaSudo = factory.persistDedicatedAgentUrlInFleetHostsFile(
      runtime,
      "host-1",
      "https://agent-via-sudo.example.test",
      {
        readFile: () => fs.readFileSync(runtime, "utf8"),
        writeFile: (filePath, body) => {
          sudoWrote.path = filePath;
          sudoWrote.body = body;
          fs.writeFileSync(filePath, body);
        },
      },
    );
    assert.deepEqual(viaSudo, { found: true, changed: true });
    assert.match(sudoWrote.body, /agent-via-sudo\.example\.test/);
    const msg = factory.formatFleetHostsEaccesError({
      dedicatedUrl: dedicated,
      deniedFiles: [runtime],
      adminDetail: "admin down",
    });
    assert.match(msg, /root:root 600/);
    assert.match(msg, /admin up/);
    assert.match(msg, /POST \/admin\/api\/hosts\/agent-url/);
    assert.match(msg, /Ne PAS chmod\/chown/);
    const stackMsg = factory.formatStackFileEaccesError("/opt/docker/x/docker-data/stacks/n/cf.env");
    assert.match(stackMsg, /root:root 600/);
    assert.match(stackMsg, /priv-io/);
    assert.match(stackMsg, /Ne PAS chmod\/chown/);
    assert.equal(
      factory.CREEZIO_SERVER_DOCKER_WRAPPER,
      "/usr/local/sbin/creezio-server-docker",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("source : agent up migre ; instance rm n'appelle jamais deprovisionCfAgentTunnel", () => {
  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  const iUp = cli.indexOf("if (action !== \"up\")");
  const iDeprovInst = cli.indexOf("async function deprovisionInstanceTunnelCf");
  const iDeprovInstEnd = cli.indexOf("Marqueur de version du template", iDeprovInst);
  const instFn = cli.slice(iDeprovInst, iDeprovInstEnd);
  assert.match(
    instFn,
    /deprovisionCfSlug/,
    "rm instance = deprovisionCfSlug uniquement",
  );
  assert.doesNotMatch(
    instFn,
    /deprovisionCfAgentTunnel|agentTunnelDeprovisionDnsHosts|agent-\$\{/,
    "rm instance ne mentionne aucun DNS/tunnel agent",
  );
  const upSlice = cli.slice(iUp);
  assert.match(upSlice, /needsDedicatedAgentTunnelMigration/);
  assert.match(upSlice, /provisionDedicatedAgentTunnel/);
  assert.match(
    upSlice,
    /contrat Cloudflare incomplet/,
    "migration fail-closed si CF manque",
  );
  assert.match(
    upSlice,
    /persistDedicatedAgentUrlAfterUp/,
    "agent up persiste agentUrl après provision/reprise",
  );
  const iFn = cli.indexOf("async function provisionDedicatedAgentTunnel");
  const iSave = cli.indexOf("saveAgentState(opts.brandRoot, opts.state)", iFn);
  const provisionFn = cli.slice(iFn, iSave + 80);
  assert.match(
    provisionFn,
    /applyDedicatedAgentUrlToHostState/,
    "provision écrit agentUrl dans host-agent.json",
  );
  assert.match(provisionFn, /canonicalDedicatedAgentUrl/);
  assert.match(
    cli,
    /async function persistDedicatedAgentUrlAfterUp/,
    "persist partagée (host-agent + fleet-hosts + admin API)",
  );
  assert.match(cli, /\/admin\/api\/hosts\/agent-url/);
  assert.match(
    cli,
    /permissionDenied/,
    "EACCES local n'aborte pas avant le POST admin",
  );
  assert.match(cli, /formatFleetHostsEaccesError/);
  assert.doesNotMatch(
    cli,
    /penser à patcher|patcher agentUrl|patch manuel/,
    "plus de consigne de patch manuel agentUrl",
  );
});

test("source : host-agent démarre le watch ; pas de kill-switch ; watch sans API CF", () => {
  const hostAgent = fs.readFileSync(
    path.join(ROOT, "packages/fleet/src/host-agent.ts"),
    "utf8",
  );
  assert.match(hostAgent, /startAgentTunnelWatch/);
  assert.doesNotMatch(
    hostAgent,
    /CREEZIO_AGENT_TUNNEL_WATCH/,
    "kill-switch CREEZIO_AGENT_TUNNEL_WATCH retiré",
  );
  const agentTunnel = fs.readFileSync(
    path.join(ROOT, "packages/fleet/src/agent-tunnel.ts"),
    "utf8",
  );
  assert.match(agentTunnel, /jamais de POST/);
  assert.doesNotMatch(agentTunnel, /ensureCfTunnel\(|createCfTunnel\(|cfApi\(/);
  assert.doesNotMatch(
    agentTunnel,
    /^import /m,
    "agent-tunnel.ts reste autonome (Node pur, zéro import — docker injecté)",
  );
  const serverAdmin = fs.readFileSync(
    path.join(ROOT, "packages/fleet/src/server-admin.ts"),
    "utf8",
  );
  assert.match(
    serverAdmin,
    /\/admin\/api\/hosts\/agent-url/,
    "backend flotte accepte le push agentUrl (agent up)",
  );
  assert.match(serverAdmin, /handleHostAgentUrlUpdate/);
  const skill = fs.readFileSync(
    path.join(ROOT, ".cursor/skills/creezio-fleet-ops/SKILL.md"),
    "utf8",
  );
  assert.match(skill, /persiste l'URL publique canonique/);
  assert.match(skill, /root:root 600/);
  assert.match(skill, /sudo -n tee/);
  assert.doesNotMatch(skill, /penser à patcher agentUrl/);
  const runbook = fs.readFileSync(
    path.join(ROOT, "docs/RUNBOOK-FLOTTE.md"),
    "utf8",
  );
  assert.match(runbook, /persiste `agentUrl`/);
  assert.match(runbook, /root:root 600/);
  assert.doesNotMatch(runbook, /penser à patcher agentUrl/);
});
