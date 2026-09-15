#!/usr/bin/env node
/**
 * Tests kit Phase B — modules purs (sans Electron GUI).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  demobrandManifest,
  buildElectronBuilderConfig,
  collectCreezioRuntimePackages,
  CREEZIO_ASAR_RUNTIME_PACKAGES,
  envKey,
  exeForKind,
  getManifest,
  listBrandIds,
} from "../packages/brand-config/dist/index.js";
import {
  parseAppKind,
  resolveAppKind,
  bootBehaviorFor,
  isAllowedServerCockpitPath,
  userDataDirForAppKind,
  normalizeRemoteUrl,
  sanitizeConnectionProfile,
  parseProfileArgv,
  parseJoinDeepLink,
  buildTunnelPublicUrls,
  deriveTunnelServiceUrl,
  reduceUpdateEvent,
  initialUpdateStatus,
  factoryResetTargets,
  buildNextHostEnv,
  feedUrlForKind,
  createAppRequire,
} from "../packages/platform-core/dist/index.js";
import { IpcChannels, createDesktopApi } from "../packages/shell/dist/index.js";
import {
  createLocalSplashSteps,
  computeOverallPercent,
  activateSplashStep,
  completeSplashStep,
} from "../packages/electron-shell/dist/index.js";

test("manifests : client + serveur obligatoires", () => {
  for (const id of listBrandIds()) {
    const m = getManifest(id);
    assert.ok(m.client.appId, id);
    assert.ok(m.server.appId, id);
    assert.notEqual(m.client.appId, m.server.appId);
    assert.ok(m.deepLinkProtocol);
    assert.ok(m.sessionPartition);
    assert.ok(m.tunnelRootDomain);
    assert.ok(m.client.feedUrl.endsWith("/"));
    assert.ok(m.server.feedUrl.includes("/server"));
  }
});

test("app-kind : résolution + boot behavior", () => {
  assert.equal(parseAppKind(" SERVER "), "server");
  assert.equal(resolveAppKind({}), "legacy");
  assert.equal(resolveAppKind({ env: "client" }), "client");

  const serverBoot = bootBehaviorFor("server", { mode: "server" });
  assert.equal(serverBoot.allowLocalStack, true);
  assert.equal(serverBoot.forceLocalProfile, true);
  assert.equal(serverBoot.registerDeepLink, false);
  assert.equal(serverBoot.cockpitPath, "/server-cockpit");

  const clientBoot = bootBehaviorFor("client", { mode: "server" });
  assert.equal(clientBoot.allowLocalStack, false);
  assert.equal(clientBoot.requireRemoteProfile, true);
  assert.equal(clientBoot.pickerVariant, "join-only");

  assert.ok(isAllowedServerCockpitPath("/server-cockpit"));
  assert.equal(isAllowedServerCockpitPath("/dashboard"), false);

  const ud = userDataDirForAppKind(
    demobrandManifest,
    "server",
    "/home/u/.config/demobrand",
  );
  assert.ok(ud?.endsWith("DemoBrand Server"));
});

test("connection + profile + tunnel", () => {
  assert.equal(
    normalizeRemoteUrl("cabinet.tempoflow.fr"),
    "http://cabinet.tempoflow.fr",
  );
  const p = sanitizeConnectionProfile({ mode: "remote", remoteUrl: "https://x.test/" });
  assert.equal(p.mode, "remote");
  assert.equal(p.remoteUrl, "https://x.test");

  const join = parseJoinDeepLink(
    "demobrand://join/cabinet.example.test",
    "demobrand",
  );
  assert.equal(join, "https://cabinet.example.test");

  const launch = parseProfileArgv(
    ["node", "main", "--demobrand-profile=join:http://127.0.0.1:3456"],
    demobrandManifest,
  );
  assert.equal(launch.mode, "join");
  assert.equal(launch.serverUrl, "http://127.0.0.1:3456");

  // D2 (0.10.0) : le défaut est FLAT (Universal SSL) — nested uniquement
  // si CREEZIO_CF_UNIVERSAL_SSL truthy ou mode explicite.
  const urls = buildTunnelPublicUrls("resto1.tempoflow.fr");
  assert.equal(urls.n8n, "https://n8n-resto1.tempoflow.fr");
  assert.equal(
    deriveTunnelServiceUrl("https://resto1.tempoflow.fr", "hermes", "tempoflow.fr"),
    "https://hermes-resto1.tempoflow.fr",
  );
  assert.equal(
    deriveTunnelServiceUrl("https://other.example", "n8n", "tempoflow.fr"),
    null,
  );

  // Mode flat (Universal SSL) — CRM inchangé, embeds aplatis.
  const flat = buildTunnelPublicUrls("server-1.winhub.fr", "flat");
  assert.equal(flat.crm, "https://server-1.winhub.fr");
  assert.equal(flat.n8n, "https://n8n-server-1.winhub.fr");
  assert.equal(flat.hermes, "https://hermes-server-1.winhub.fr");
  assert.equal(
    deriveTunnelServiceUrl(
      "https://server-1.winhub.fr",
      "n8n",
      "winhub.fr",
      "flat",
    ),
    "https://n8n-server-1.winhub.fr",
  );
  // Nested explicite (zones à certificat multi-niveaux, ex. tempoflow).
  const nestedDefault = buildTunnelPublicUrls("resto1.tempoflow.fr", "nested");
  assert.equal(nestedDefault.n8n, "https://n8n.resto1.tempoflow.fr");
});

test("updater reduce + builder config", () => {
  let st = initialUpdateStatus("1.0.0");
  st = reduceUpdateEvent(st, { type: "idle" });
  assert.equal(st.state, "idle");
  st = reduceUpdateEvent(st, { type: "available", version: "1.1.0" });
  assert.equal(st.updateAvailable, true);

  const base = {
    files: ["build/electron/**/*", "!node_modules/**/*", "node_modules/electron-updater/**/*"],
    extraResources: [{ from: "vendor/meili", to: "vendor/meili" }, { from: "build/electron" }],
    win: {},
  };
  const serverCfg = buildElectronBuilderConfig(demobrandManifest, "server", base);
  assert.equal(serverCfg.appId, demobrandManifest.server.appId);
  assert.equal(serverCfg.executableName, demobrandManifest.server.executableName);
  assert.equal(serverCfg.publish.url, demobrandManifest.server.feedUrl);
  const serverFiles = serverCfg.files || [];
  assert.ok(
    serverFiles.some(
      (e) =>
        typeof e === "object" &&
        e?.from?.endsWith("node_modules/@creezio/brand-config") &&
        e?.to === "node_modules/@creezio/brand-config",
    ),
    "server : asar embarque @creezio/brand-config (package npm installé)",
  );
  for (const pkg of [
    "brand-config",
    "platform-core",
    "product-hub",
    "shell",
    "electron-shell",
    "app-runtime",
    "api-kernel",
    "auth",
    "mcp-facade",
    "assistant",
    "tasks",
    "mails",
  ]) {
    assert.ok(
      serverFiles.some(
        (e) =>
          typeof e === "object" &&
          e?.from?.endsWith(`node_modules/@creezio/${pkg}`) &&
          e?.to === `node_modules/@creezio/${pkg}`,
      ),
      `server : asar embarque @creezio/${pkg} (npm)`,
    );
  }
  const collected = collectCreezioRuntimePackages();
  for (const pkg of CREEZIO_ASAR_RUNTIME_PACKAGES) {
    assert.ok(
      collected.includes(pkg),
      `collectCreezioRuntimePackages inclut le plancher ${pkg}`,
    );
  }
  assert.ok(
    collected.includes("auth"),
    "collectCreezioRuntimePackages : auth obligatoire",
  );
  const appReq = createAppRequire();
  assert.ok(
    typeof appReq.resolve("@creezio/brand-config") === "string",
    "createAppRequire résout @creezio/brand-config",
  );

  assert.ok(
    serverFiles.some(
      (e) =>
        typeof e === "object" &&
        e?.from === "node_modules/hono" &&
        e?.to === "node_modules/hono",
    ),
    "server : asar FileSet hono (deps npm runtime, hors symlink vendor)",
  );
  assert.ok(
    serverFiles.some(
      (e) =>
        typeof e === "object" &&
        e?.from === "node_modules/better-sqlite3" &&
        e?.to === "node_modules/better-sqlite3",
    ),
    "server : asar FileSet better-sqlite3",
  );
  assert.ok(
    serverFiles.some(
      (e) =>
        typeof e === "object" &&
        e?.from === "node_modules/zod" &&
        e?.to === "node_modules/zod",
    ),
    "server : asar FileSet zod",
  );
  const unpack = serverCfg.asarUnpack || [];
  assert.ok(
    unpack.some((p) => String(p).includes(".node")),
    "server : asarUnpack *.node (natifs)",
  );

  const clientCfg = buildElectronBuilderConfig(demobrandManifest, "client", base);
  assert.equal(clientCfg.appId, demobrandManifest.client.appId);
  const extras = clientCfg.extraResources;
  assert.ok(Array.isArray(extras));
  assert.ok(!extras.some((e) => String(e.from || e).startsWith("vendor/")));
  assert.ok(
    (clientCfg.files || []).some(
      (e) =>
        typeof e === "object" &&
        e?.from?.endsWith("node_modules/@creezio/brand-config") &&
        e?.to === "node_modules/@creezio/brand-config",
    ),
    "client slim : asar embarque aussi @creezio/* (npm)",
  );
  assert.ok(
    (clientCfg.files || []).some(
      (e) =>
        typeof e === "string" && e.includes("host-runtime/resources/bin"),
    ),
    "asar exclut host-runtime/resources/bin",
  );
  assert.ok(
    !extras.some(
      (e) =>
        String(e.from || e).includes("resources/bin") ||
        String(e.from || e).includes("win-bin-stage"),
    ),
    "client slim : pas de bin en extraResources",
  );
  assert.deepEqual(clientCfg.win?.extraResources || [], []);
  const serverWin = serverCfg.win?.extraResources || [];
  assert.ok(
    serverWin.some(
      (e) =>
        e &&
        typeof e === "object" &&
        e.to === "bin" &&
        Array.isArray(e.filter) &&
        e.filter.includes("meilisearch-win.exe") &&
        e.filter.includes("cloudflared.exe") &&
        !e.filter.includes("meili.exe"),
    ),
    "server : win.extraResources bin Win-only (meilisearch-win + cloudflared, pas meili.exe)",
  );
  assert.ok(
    (serverCfg.files || []).some(
      (e) =>
        typeof e === "object" &&
        e?.from === "build/electron" &&
        Array.isArray(e?.filter),
    ),
    "server : build/electron en fileset objet (évite asar sans main.js)",
  );
});

test("paths / env brand / factory targets", () => {
  assert.equal(envKey(demobrandManifest, "APP_KIND"), "DEMOBRAND_APP_KIND");
  assert.equal(
    feedUrlForKind(demobrandManifest, "client"),
    demobrandManifest.client.feedUrl,
  );
  const env = buildNextHostEnv({
    manifest: demobrandManifest,
    port: 3000,
    hostname: "127.0.0.1",
    dbPath: "/tmp/x.db",
    assistantDbPath: "/tmp/a.db",
    uploadsDir: "/tmp/u",
  });
  assert.equal(env.PORT, "3000");
  assert.equal(env.DEMOBRAND_BRAND_ID, "demobrand");

  const targets = factoryResetTargets({
    manifest: demobrandManifest,
    userDataRoot: "/tmp/ud",
    isPackaged: true,
  });
  assert.ok(targets.some((t) => t.endsWith("demobrand-config.json")));
});

test("shell createDesktopApi + IPC", () => {
  assert.equal(IpcChannels.desktop.info, "desktop:info");
  const calls = [];
  const api = createDesktopApi({
    invoke: async (ch, ...args) => {
      calls.push([ch, ...args]);
      return { ok: true };
    },
    send: (ch) => calls.push([ch]),
    on: () => {},
    removeListener: () => {},
  });
  assert.equal(api.isDesktop, true);
  void api.getInfo();
  assert.equal(calls[0][0], "desktop:info");
});

test("splash model", () => {
  let model = {
    headline: "Boot",
    bootStartedAt: Date.now(),
    overallPercent: 0,
    steps: createLocalSplashSteps({
      needIndex: false,
      needNode: true,
      needHermes: false,
      needN8n: false,
      needTunnel: false,
    }),
    footer: "",
  };
  model = activateSplashStep(model, "migrations", { detail: "…" });
  assert.equal(model.steps.find((s) => s.id === "migrations")?.status, "running");
  model = completeSplashStep(model, "migrations");
  assert.ok(computeOverallPercent(model.steps) > 0);
});

test("exeForKind", () => {
  assert.equal(exeForKind(demobrandManifest, "client").productName, "DemoBrand");
  assert.equal(exeForKind(demobrandManifest, "server").productName, "DemoBrand Server");
});
