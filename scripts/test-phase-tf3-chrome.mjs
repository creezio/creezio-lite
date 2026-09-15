#!/usr/bin/env node
/**
 * Extension O9p — cutover chrome TF3 (server/ui) quand le repo marque est présent.
 * Skip auto si tempoflow3 absent (agents cloud sans clone).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { KIT_ROOT } from "./lib/brand-roots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveTempoflow3Root() {
  const fromEnv = process.env.CREEZIO_BRAND_ROOT_TEMPOFLOW3;
  const candidates = [
    fromEnv,
    "/opt/docker/tempoflow3",
    path.resolve(KIT_ROOT, "../tempoflow3"),
    path.resolve(KIT_ROOT, "../../tempoflow3"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "server/ui"))) return c;
  }
  return null;
}

const ABSENT = [
  "components/layout/sidebar.tsx",
  "components/global-search-provider.tsx",
  "components/assistant/assistant-widget.tsx",
  "components/settings/desktop-n8n-settings.tsx",
  "components/desktop/desktop-bridge.tsx",
  "components/layout/page-chrome.tsx",
];

test("TF3-chrome.1 jumeaux absents + configureSidebar", () => {
  const brandRoot = resolveTempoflow3Root();
  if (!brandRoot) {
    console.log("skip: tempoflow3 absent");
    return;
  }
  const ui = path.join(brandRoot, "server/ui");
  for (const rel of ABSENT) {
    assert.ok(!fs.existsSync(path.join(ui, rel)), `TF3 encore présent: ${rel}`);
  }
  const bootTsx = path.join(ui, "lib/shell-ui/configure-shell-ui-client.tsx");
  const bootTs = path.join(ui, "lib/shell-ui/configure-shell-ui-client.ts");
  const boot = fs.existsSync(bootTsx) ? bootTsx : bootTs;
  assert.ok(fs.existsSync(boot), "TF3 configure-shell-ui-client");
  const body = fs.readFileSync(boot, "utf8");
  assert.match(body, /configureSidebar/);
  assert.match(body, /configureShellUiBrand/);

  const wr = fs.readFileSync(
    path.join(ui, "components/workspace/workspace-root.tsx"),
    "utf8",
  );
  assert.match(wr, /@creezio\/shell-ui\/ui/);
  assert.doesNotMatch(wr, /@\/components\/layout\/sidebar/);

  const conf = fs.readFileSync(path.join(ui, "app/configuration/page.tsx"), "utf8");
  assert.match(conf, /DesktopSettingsPage/);
});

test("TF3-chrome.2 kit DesktopSettingsPage parité compte/clés", () => {
  const page = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/os-pages/desktop-settings-page.tsx"),
    "utf8",
  );
  assert.match(page, /AccountSettings/);
  assert.match(page, /ApiKeysSettings/);
  assert.match(page, /DesktopFleetTelemetrySettings/);
  assert.match(page, /HostOnlySettings/);
});
