#!/usr/bin/env node
/**
 * Phase P / D-P28a — SoT shell chrome (sidebar / workspace / search / site-slot).
 * Extract kit only ; extinction jumeaux marques = cutover (voir o9p + checklist README).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const KIT_UI = [
  "packages/shell-ui/ui/layout/sidebar.tsx",
  "packages/shell-ui/ui/layout/sidebar-host.ts",
  "packages/shell-ui/ui/workspace/tab-workspace-context.tsx",
  "packages/shell-ui/ui/workspace/workspace-shell.tsx",
  "packages/shell-ui/ui/workspace/workspace-root.tsx",
  "packages/shell-ui/ui/workspace/workspace-config.ts",
  "packages/shell-ui/ui/search/global-search-provider.tsx",
  "packages/shell-ui/ui/search/global-search-config.ts",
  "packages/shell-ui/ui/desktop/external-site-slot.tsx",
  "packages/shell-ui/ui/desktop/external-site-surface.ts",
];

function walkTs(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      out.push(...walkTs(p));
    } else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

test("P-shell.1 modules chrome SoT présents", () => {
  for (const rel of KIT_UI) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const index = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/index.ts"),
    "utf8",
  );
  assert.match(index, /layout\/sidebar/);
  assert.match(index, /tab-workspace-context/);
  assert.match(index, /workspace-shell/);
  assert.match(index, /workspace-root/);
  assert.match(index, /global-search-provider/);
  assert.match(index, /external-site-slot/);
  assert.match(index, /configureSidebar|sidebar-host/);
  assert.match(index, /configureGlobalSearch|global-search-config/);
});

test("P-shell.1b primitives webmail (MD1) : resizable/tooltip/textarea", () => {
  for (const rel of [
    "packages/shell-ui/ui/primitives/resizable.tsx",
    "packages/shell-ui/ui/primitives/tooltip.tsx",
    "packages/shell-ui/ui/primitives/textarea.tsx",
  ]) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const kit = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/kit.ts"),
    "utf8",
  );
  assert.match(kit, /primitives\/resizable/);
  assert.match(kit, /primitives\/tooltip/);
  assert.match(kit, /primitives\/textarea/);

  const resizable = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/primitives/resizable.tsx"),
    "utf8",
  );
  assert.match(resizable, /ResizablePanelGroup/);
  assert.match(resizable, /ResizableHandle/);
  assert.match(resizable, /react-resizable-panels/);

  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/shell-ui/package.json"), "utf8"),
  );
  assert.ok(
    pkg.peerDependencies["react-resizable-panels"],
    "peer react-resizable-panels",
  );
  assert.ok(
    pkg.peerDependencies["@radix-ui/react-tooltip"],
    "peer @radix-ui/react-tooltip",
  );
});

test("P-shell.2 README contrat O9 + hors scope + extinction", () => {
  const readme = fs.readFileSync(
    path.join(root, "packages/shell-ui/README.md"),
    "utf8",
  );
  assert.match(readme, /configureSidebar|Sidebar|CrmSidebar/);
  assert.match(readme, /TabWorkspaceProvider|WorkspaceRoot|ExternalSiteSlot/);
  assert.match(readme, /configureGlobalSearch/);
  assert.match(readme, /@creezio\/auth\/ui/);
  assert.match(readme, /@creezio\/onboarding\/ui/);
  assert.match(readme, /@creezio\/cockpit\/ui/);
  assert.match(readme, /extinction jumeaux|sidebar\.tsx/);
  assert.match(readme, /ADR-no-brand-domain|site externe|siteId/i);
  assert.doesNotMatch(readme, PAPERCLIP_RE);
});

test("P-shell.3 ADR kit : pas de @/ ni TF desktop ni Site fournisseur", () => {
  const dirs = [
    path.join(root, "packages/shell-ui/ui/layout"),
    path.join(root, "packages/shell-ui/ui/workspace"),
    path.join(root, "packages/shell-ui/ui/search"),
    path.join(root, "packages/shell-ui/ui/desktop"),
  ];
  for (const dir of dirs) {
    for (const f of walkTs(dir)) {
      const body = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(body, PAPERCLIP_RE, f);
      assert.doesNotMatch(body, /from ["']@\//, `@/ interdit: ${f}`);
      assert.doesNotMatch(
        body,
        /window\.tempoflowDesktop/,
        `desktop API hardcode: ${f}`,
      );
      assert.doesNotMatch(
        body,
        /Site fournisseur/,
        `label TF interdit: ${f}`,
      );
    }
  }

  const slot = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/desktop/external-site-slot.tsx"),
    "utf8",
  );
  assert.match(slot, /ExternalSiteSlot/);
  assert.match(slot, /reduceExternalSiteLoadState/);
  assert.match(slot, /reduceSupplierLoadState/);
  assert.match(slot, /Site externe/);
  assert.match(slot, /getShellDesktopApi/);
  assert.match(slot, /siteId/);

  const sidebar = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/layout/sidebar.tsx"),
    "utf8",
  );
  assert.match(sidebar, /configureSidebar|getSidebarHost/);
  assert.match(sidebar, /CrmSidebar|export function Sidebar/);
  assert.match(sidebar, /getShellDesktopApi/);

  const ctx = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/tab-workspace-context.tsx"),
    "utf8",
  );
  assert.match(ctx, /TabWorkspaceProvider/);
  assert.match(ctx, /configureTabWorkspaceHost/);
  assert.match(ctx, /openExternalSite/);
  assert.match(ctx, /getShellDesktopApi/);
});

test("P-shell.4 injection configure* SoT", () => {
  const host = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/layout/sidebar-host.ts"),
    "utf8",
  );
  assert.match(host, /export function configureSidebar/);
  assert.match(host, /canShowHref/);

  const searchCfg = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/search/global-search-config.ts"),
    "utf8",
  );
  assert.match(searchCfg, /export function configureGlobalSearch/);
  assert.match(searchCfg, /search:\s*\(/);

  const wsCfg = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/workspace-config.ts"),
    "utf8",
  );
  assert.match(wsCfg, /configureDefaultNewTabHref/);
  assert.match(wsCfg, /configureSidebarCollapsedKey/);
  assert.match(wsCfg, /configureProductDetailCtx/);

  const rootUi = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/workspace-root.tsx"),
    "utf8",
  );
  assert.match(rootUi, /wrapWorkspace/);
  assert.match(rootUi, /banners/);
  assert.doesNotMatch(rootUi, /PanierProvider|from ["']@\//);
  // Bandeau impersonation « Voir comme » = module NATIF kit (fini le wiring
  // marque à la tempoflow) : monté par WorkspaceRoot au-dessus du slot
  // banners, nom produit via getShellUiBrand — aucun libellé marque en dur.
  assert.match(
    rootUi,
    /import { ImpersonationBanner } from "\.\/impersonation-banner";/,
  );
  assert.match(rootUi, /<ImpersonationBanner \/>\s*\{banners\}/);
  const impBanner = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/impersonation-banner.tsx"),
    "utf8",
  );
  assert.match(impBanner, /getShellUiBrand\(\)\.productName/);
  assert.match(impBanner, /stopImpersonate/);
  assert.doesNotMatch(impBanner, /TempoFlow|WinHub/);
  // afterShell = slot ADDITIF : le chrome par défaut (DesktopBridge,
  // AssistantWidget, UiDriver, AiWorkspaceAgentHost) doit TOUJOURS être rendu,
  // le slot s'y ajoute. Sémantique « remplacement » = assistant qui disparaît
  // (régression prod TF3 : la cloche d'alertes montée via afterShell avait
  // fait disparaître FAB + panneau chat).
  assert.doesNotMatch(
    rootUi,
    /afterShell\s*===\s*undefined\s*\?\s*defaultAfterShell\s*:\s*afterShell/,
    "afterShell ne doit JAMAIS remplacer le chrome par défaut (slot additif)",
  );
  assert.match(
    rootUi,
    /AiWorkspaceAgentHost\s*\/>\s*<\/>\s*\)\}\s*\{afterShell\}/,
    "afterShell doit être rendu APRÈS le chrome assistant par défaut",
  );
});

/** Jumeaux chrome P1 — absents après cutover marques (dockerRoot sibling). */
const P_SHELL_TWINS = [
  "src/components/layout/sidebar.tsx",
  "src/components/workspace/tab-workspace-context.tsx",
  "src/components/workspace/workspace-shell.tsx",
  "src/components/global-search-provider.tsx",
  "src/components/desktop/supplier-site-slot.tsx",
];

const P_SHELL_BRANDS = ["tempoflow2", "certivan-app", "fidu"];

test("P-shell.5 extinction jumeaux chrome ×3 (si repos siblings présents)", () => {
  const dockerRoot = path.resolve(root, "..");
  let checked = 0;
  for (const id of P_SHELL_BRANDS) {
    const crm = path.join(dockerRoot, id, "crm");
    if (!fs.existsSync(crm)) continue;
    checked += 1;
    for (const rel of P_SHELL_TWINS) {
      const p = path.join(crm, rel);
      assert.ok(!fs.existsSync(p), `${id}: jumeau encore présent: ${rel}`);
    }
    const boot = path.join(crm, "src/lib/shell-ui/configure-shell-ui-client.ts");
    assert.ok(fs.existsSync(boot), `${id}: boot configure manquant`);
    const bootBody = fs.readFileSync(boot, "utf8");
    assert.match(bootBody, /configureSidebar|configure-sidebar/);
    assert.match(bootBody, /configureGlobalSearch|configure-global-search/);
    const rootTsx = path.join(
      crm,
      "src/components/workspace/workspace-root.tsx",
    );
    assert.ok(fs.existsSync(rootTsx), `${id}: workspace-root mince`);
    const rootBody = fs.readFileSync(rootTsx, "utf8");
    assert.match(rootBody, /@creezio\/shell-ui\/ui/);
    assert.match(rootBody, /WorkspaceRoot/);
  }
  // En CI kit-only sans siblings : skip soft (0 checked).
  if (checked === 0) {
    assert.ok(true, "pas de repos marques siblings — skip extinction");
  }
});
