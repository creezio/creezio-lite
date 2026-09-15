/**
 * Gate — architecture hybride : client Electron thin + IA côté serveur.
 *
 * Contrats vérifiés :
 * - `@creezio/browser-host` : Chromium sidecar CDP sans dépendance Electron,
 *   driver external_* partagé (pas de fork des HELPERS), screencast in-process.
 * - Surface plateforme app-runtime (auth/tasks/assistant) + sidecar navigateur.
 * - Client thin : `requireRemoteProfile` → aucune stack locale, bridge remote
 *   auth session, `defaultServerUrl` pré-provisionné (manifest / brand-spec / CLI).
 * - Hermes browser tools opt-in (`CREEZIO_HERMES_BROWSER=1`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("browser-host : package sidecar sans dépendance Electron", () => {
  for (const f of [
    "packages/browser-host/src/index.ts",
    "packages/browser-host/src/chromium-process.ts",
    "packages/browser-host/src/cdp-connection.ts",
    "packages/browser-host/src/browser-host.ts",
    "packages/browser-host/src/shared-driver.ts",
    "packages/browser-host/src/driver-scripts.ts",
    "packages/browser-host/src/ai-session-host.ts",
    "packages/browser-host/src/browser-screencaster.ts",
    "packages/browser-host/src/screencast-hub.ts",
    "packages/browser-host/src/chrome-ua.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(root, f)), `manquant: ${f}`);
  }
  const pkg = JSON.parse(read("packages/browser-host/package.json"));
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
  };
  assert.ok(
    !Object.keys(deps).some((d) => /electron/i.test(d)),
    "browser-host ne doit dépendre d'aucun package Electron",
  );
  const proc = read("packages/browser-host/src/chromium-process.ts");
  assert.match(proc, /--remote-debugging-port/);
  assert.match(proc, /--user-data-dir/);
  assert.match(proc, /--no-first-run/);
  assert.match(proc, /CREEZIO_CHROMIUM_BIN/);
  const host = read("packages/browser-host/src/browser-host.ts");
  assert.match(host, /startScreencast/);
});

test("driver external_* partagé : Electron importe les scripts browser-host", () => {
  const scripts = read("packages/browser-host/src/driver-scripts.ts");
  assert.match(scripts, /DRIVER_HELPERS/);
  assert.match(scripts, /FAKE_CURSOR_INJECT/);
  const shared = read("packages/browser-host/src/shared-driver.ts");
  assert.match(shared, /CdpTransport/);
  assert.match(shared, /runDriverVerb/);
  const electronDriver = read(
    "packages/electron-shell/src/host/browser-tabs/browser-tab-driver.ts",
  );
  assert.match(electronDriver, /@creezio\/browser-host/);
  assert.match(electronDriver, /DRIVER_HELPERS/);
  // Pas de fork : le bloc HELPERS ne doit plus être défini côté Electron.
  assert.doesNotMatch(electronDriver, /const DRIVER_HELPERS\s*=/);
  const cursor = read(
    "packages/electron-shell/src/host/browser-tabs/fake-cursor-inject.ts",
  );
  assert.match(cursor, /@creezio\/browser-host/);
});

test("app-runtime : surface plateforme + sidecar navigateur IA", () => {
  const surface = read(
    "packages/app-runtime/src/mount-brand-platform-surface.ts",
  );
  assert.match(surface, /mountBrandPlatformSurface/);
  assert.match(surface, /createPlatformTasksBrandAdapters/);
  assert.match(surface, /registerDesktopBridge|DesktopPresenceRegistry/);
  const sidecar = read("packages/app-runtime/src/wire-brand-browser-sidecar.ts");
  assert.match(sidecar, /startBrandBrowserSidecar/);
  assert.match(sidecar, /CREEZIO_BROWSER_SIDECAR/);
  assert.match(sidecar, /AiSessionHost/);
  // Exécuteurs in-process : IA serveur prioritaire dans dispatchSupplierAction.
  assert.match(sidecar, /syncAiExecutors/);
  assert.match(sidecar, /dispatchSupplierAction/);
  const harness = read("packages/app-runtime/src/start-brand-kernel-harness.ts");
  assert.match(harness, /mountBrandPlatformSurface/);
  assert.match(harness, /browserSidecarRequested|startBrandBrowserSidecar/);
  const idx = read("packages/app-runtime/src/index.ts");
  assert.match(idx, /mountBrandPlatformSurface/);
  assert.match(idx, /createPlatformTasksBrandAdapters/);
  assert.match(idx, /startBrandBrowserSidecar/);
});

test("client thin : requireRemoteProfile skip stack locale", () => {
  const sbd = read("packages/app-runtime/src/start-brand-desktop.ts");
  assert.match(sbd, /requireRemoteProfile/);
  assert.match(
    sbd,
    /kernel\/OS-HTTP\/MCP\/Meili\/tunnel locaux SKIPPÉS|stack locale interdite/,
  );
  const kind = read("packages/platform-core/src/app-kind.ts");
  assert.match(kind, /requireRemoteProfile/);
  assert.match(kind, /allowLocalStack/);
});

test("bridge remote : auth session + device headers", () => {
  const bridge = read("packages/host-runtime/src/bridge-client.ts");
  assert.match(bridge, /getSessionCookie/);
  assert.match(bridge, /deviceId/);
  const runtime = read(
    "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
  );
  assert.match(runtime, /startRemoteBridge/);
  assert.match(runtime, /setupAndStartRemote/);
});

test("defaultServerUrl : manifest → picker + brand-spec + factory CLI", () => {
  const types = read("packages/brand-config/src/types.ts");
  assert.match(types, /defaultServerUrl\?: string/);
  const create = read("packages/brand-config/src/create-manifest.ts");
  assert.match(create, /defaultServerUrl/);
  const runtime = read(
    "packages/electron-shell/src/desktop/brand-desktop-runtime.ts",
  );
  assert.match(runtime, /_DEFAULT_SERVER_URL/);
  assert.match(runtime, /presetServerUrl/);
  const specTypes = read("packages/brand-spec/src/types.ts");
  assert.match(specTypes, /defaultServerUrl/);
  const specLoad = read("packages/brand-spec/src/load.ts");
  assert.match(specLoad, /defaultServerUrl/);
  const cli = read("packages/factory/src/cli.ts");
  assert.match(cli, /--default-server-url/);
  const brandCli = read("packages/factory/src/brand-cli.ts");
  assert.match(brandCli, /defaultServerUrl/);
});

test("install-brand-os-desktop : onglets sites externes réels (pas de stub)", () => {
  const src = read("packages/app-runtime/src/install-brand-os-desktop.ts");
  // Le client thin doit exécuter les external_* dispatchés par le serveur :
  // manager + driver kit réels, plus de stub `async () => ({ ok: false })`.
  assert.match(src, /from "@creezio\/electron-shell\/browser-tabs"/);
  // Chargé lazy (jamais top-level : tirerait `electron` dans les gates Node).
  assert.match(src, /loadBrowserTabs\(\)\.SupplierTabManager/);
  assert.match(src, /loadBrowserTabs\(\)\.executeSupplierAction/);
  assert.doesNotMatch(src, /executeSupplierAction: async \(\) => \(\{ ok: false \}\)/);
  assert.doesNotMatch(
    src,
    /^import \{[^}]*SupplierTabManager[^}]*\} from "@creezio\/electron-shell\/browser-tabs"/m,
  );
});

test("Hermes browser tools : --skip-browser conditionnel", () => {
  const boot = read(
    "packages/host-runtime/src/hermes/runtime-bootstrap.ts",
  );
  assert.match(boot, /hermesBrowserToolsEnabled/);
  assert.match(boot, /CREEZIO_HERMES_BROWSER/);
});
