#!/usr/bin/env node
/**
 * Tests kit Phase B.2 — embeds purs, local-config, plugins, recovery.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { demobrandManifest, envKey } from "../packages/brand-config/dist/index.js";
import {
  shouldSpawnEmbeddedHermes,
  shouldSpawnEmbeddedN8n,
  sanitizeHermesEmbedConfig,
  sanitizeN8nEmbedConfig,
  buildN8nSpawnEnv,
  buildHermesHomeEnvFile,
  hermesPublicStatus,
  n8nPublicStatus,
  deriveTunnelServiceUrl,
  mergeEmbedUserEnv,
  EMBED_IPC,
  EMBED_TOOL_SITE_IDS,
  generateRecoveryKey,
  createRecoveryVerifier,
  verifyRecoveryKey,
  wrapSecretsWithRecoveryKey,
  unwrapSecretsWithRecoveryKey,
  parsePluginManifest,
  pluginSiteId,
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
  discoverPlugins,
  pluginsRootDir,
  setPluginEnabled,
  isDiskSpaceError,
  n8nHomeLooksWarm,
  resolveHermesBinary,
  resolveN8nEntry,
} from "../packages/platform-core/dist/index.js";
import {
  createLocalConfigStoreSync,
  sealValue,
  openValue,
  canEncrypt,
  buildEmbedHostEnv,
  PLUGIN_VERTICAL_REMAINING,
  overridesAllowed,
  buildConfinedPath,
} from "../packages/host-runtime/dist/index.js";

test("hermes / n8n embed gates", () => {
  assert.equal(
    shouldSpawnEmbeddedHermes({
      connectionMode: "local",
      hermes: sanitizeHermesEmbedConfig(null),
    }),
    true,
  );
  assert.equal(
    shouldSpawnEmbeddedHermes({
      connectionMode: "remote",
      hermes: { mode: "embedded" },
    }),
    false,
  );
  assert.equal(
    shouldSpawnEmbeddedN8n({
      connectionMode: "local",
      n8n: sanitizeN8nEmbedConfig(null),
    }),
    true,
  );
  assert.equal(EMBED_TOOL_SITE_IDS.n8nUi, 900097);
  assert.equal(EMBED_IPC.hermes.status, "hermes:status");
});

test("hermes / n8n status + env builders", () => {
  const h = hermesPublicStatus({
    connectionMode: "remote",
    config: { mode: "embedded" },
    binaryFound: false,
    running: false,
    apiUrl: null,
    lastError: null,
    version: null,
    remoteCrmOrigin: "https://resto.tempoflow.fr",
    tunnelRootDomain: "tempoflow.fr",
  });
  assert.equal(h.webuiUrl, "https://hermes-resto.tempoflow.fr");
  assert.equal(h.status, "remote");

  const n = n8nPublicStatus({
    connectionMode: "local",
    config: { mode: "embedded" },
    entryFound: false,
    running: false,
    uiUrl: null,
    lastError: null,
    version: null,
    tunnelRootDomain: "fidu.creez.io",
    productName: "Fidu",
  });
  assert.equal(n.status, "missing");
  assert.match(n.detail, /Fidu/);

  const env = buildN8nSpawnEnv({
    port: 15678,
    userFolder: "/tmp/n8n-home",
    encryptionKey: "x".repeat(32),
    publicBaseUrl: "https://n8n.x.tempoflow.fr/",
  });
  assert.equal(env.N8N_PORT, "15678");
  assert.equal(env.WEBHOOK_URL, "https://n8n.x.tempoflow.fr/");
  assert.equal(env.N8N_MCP_ACCESS_ENABLED, "true");

  const homeEnv = buildHermesHomeEnvFile({
    apiKey: "k",
    apiPort: 18642,
    productName: "TempoFlow",
  });
  assert.match(homeEnv, /API_SERVER_ENABLED=true/);
  assert.match(homeEnv, /TempoFlow/);
});

test("embed env merge locked keys", () => {
  const merged = mergeEmbedUserEnv({
    service: "n8n",
    systemEnv: { N8N_PORT: "15678", WEBHOOK_URL: "https://x/" },
    userOverlay: { N8N_PORT: "1", GENERIC_TIMEZONE: "Europe/Paris" },
  });
  assert.equal(merged.N8N_PORT, "15678");
  assert.equal(merged.GENERIC_TIMEZONE, "Europe/Paris");
});

test("recovery key wrap/unwrap", () => {
  const key = generateRecoveryKey();
  assert.ok(key.includes("-"));
  const verifier = createRecoveryVerifier(key);
  assert.equal(verifyRecoveryKey(key, verifier), true);
  assert.equal(verifyRecoveryKey("BAD", verifier), false);
  const env = wrapSecretsWithRecoveryKey(key, {
    authUser: "u",
    authPassword: "secret1",
    authSecret: "s".repeat(32),
  });
  const unwrapped = unwrapSecretsWithRecoveryKey(key, env);
  assert.equal(unwrapped.authUser, "u");
});

test("local-config store plain encryption", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-cfg-"));
  const configPath = path.join(dir, "tempoflow-config.json");
  const store = createLocalConfigStoreSync({
    configPath,
    manifest: demobrandManifest,
    encryption: "plain",
  });
  assert.equal(store.encryptionAvailable(), false);
  const secret = store.ensureAuthSecret();
  assert.ok(secret.length >= 32);
  store.setLocalAuthCredentials("alice", "secret12");
  const auth = store.getLocalAuth();
  assert.equal(auth?.authUser, "alice");
  store.setTunnelConfig({
    slug: "demo",
    hostname: "demo.tempoflow.fr",
    publicUrl: "https://demo.tempoflow.fr",
    tunnelId: "tid",
    tunnelToken: "tok",
    localPort: 3000,
  });
  assert.equal(store.getTunnelConfig()?.slug, "demo");
  assert.equal(store.getTunnelPublic().configured, true);
  store.setHermesEmbedConfig({ mode: "embedded" });
  assert.equal(store.getHermesEmbedConfig().mode, "embedded");
  const fleet = store.setFleetTelemetry({ enabled: true, preset: "basic" });
  assert.equal(fleet.enabled, true);
  assert.equal(store.getFleetTelemetry().scopes.heartbeat, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("local-config configPath getter (userData dynamique)", () => {
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-cfg-a-"));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-cfg-b-"));
  let active = dir1;
  const store = createLocalConfigStoreSync({
    configPath: () => path.join(active, "tempoflow-config.json"),
    manifest: demobrandManifest,
    encryption: "plain",
  });
  store.ensureAuthSecret();
  assert.ok(fs.existsSync(path.join(dir1, "tempoflow-config.json")));
  active = dir2;
  store.setLocalAuthCredentials("bob", "secret99");
  assert.ok(fs.existsSync(path.join(dir2, "tempoflow-config.json")));
  assert.equal(store.getLocalAuth()?.authUser, "bob");
  fs.rmSync(dir1, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test("safeStorage seal/open plain fallback", () => {
  assert.equal(canEncrypt(null), false);
  const sealed = sealValue(null, "hello");
  assert.deepEqual(sealed, { plain: "hello" });
  assert.equal(openValue(null, sealed), "hello");
});

test("plugins contracts", () => {
  const m = parsePluginManifest({
    id: "hello-world",
    name: "Hello",
    version: "1.0.0",
    main: "index.js",
    permissions: ["crm:read", "ui:panel"],
  });
  assert.equal(m.id, "hello-world");
  const site = pluginSiteId("hello-world");
  assert.ok(site >= 910000 && site < 920000);

  const { token, payload } = issuePluginExecutionGrant({
    secret: "s".repeat(16),
    productId: "p1",
    prdRevisionId: "r1",
    pluginId: "hello-world",
    tokenPrefix: "tf2_exec_",
  });
  const ok = verifyPluginExecutionGrant({
    token,
    secret: "s".repeat(16),
    pluginId: "hello-world",
    action: "write",
    tokenPrefix: "tf2_exec_",
  });
  assert.equal(ok.ok, true);
  assert.equal(payload.pluginId, "hello-world");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-plug-"));
  const root = pluginsRootDir(dir);
  const pdir = path.join(root, "demo-plug");
  fs.mkdirSync(pdir);
  fs.writeFileSync(
    path.join(pdir, "manifest.json"),
    JSON.stringify({
      id: "demo-plug",
      name: "Demo",
      version: "0.1.0",
      main: "index.js",
      permissions: ["net:loopback"],
    }),
  );
  setPluginEnabled(pdir, true);
  const found = discoverPlugins(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].enabled, true);
  // N1 : git/data/accept-check/crm-key extraits → kit ; reste wiring marque + UI
  assert.ok(!PLUGIN_VERTICAL_REMAINING.includes("plugin-git"));
  assert.ok(PLUGIN_VERTICAL_REMAINING.includes("brand-plugin-host-bindings"));
  assert.ok(!PLUGIN_VERTICAL_REMAINING.includes("plugin-control-api"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("brand env + sandbox helpers", () => {
  const env = buildEmbedHostEnv(demobrandManifest, { DESKTOP: "1" });
  assert.equal(env.DEMOBRAND_DESKTOP, "1");
  assert.equal(env.DEMOBRAND_BRAND_ID, "demobrand");
  assert.equal(envKey(demobrandManifest, "HERMES_BIN"), "DEMOBRAND_HERMES_BIN");
  assert.equal(overridesAllowed(true), false);
  assert.equal(overridesAllowed(false), true);
  const p = buildConfinedPath({
    platform: "linux",
    toolDirs: ["/opt/node"],
  });
  assert.match(p, /\/opt\/node/);
  assert.match(p, /\/usr\/bin/);
});

test("binary resolve sandbox (no PATH)", () => {
  assert.equal(
    resolveHermesBinary({
      platform: "linux",
      searchDirs: [],
      existsSync: () => false,
    }),
    null,
  );
  assert.equal(
    resolveN8nEntry({
      platform: "linux",
      runtimeDir: "/nope",
      existsSync: () => false,
    }),
    null,
  );
  assert.equal(n8nHomeLooksWarm("/nope", () => false), false);
  assert.equal(isDiskSpaceError({ text: "ENOSPC: no space left" }), true);
  assert.equal(
    deriveTunnelServiceUrl(
      "https://x.fidu.creez.io",
      "n8n",
      "fidu.creez.io",
    ),
    "https://n8n-x.fidu.creez.io",
  );
});
