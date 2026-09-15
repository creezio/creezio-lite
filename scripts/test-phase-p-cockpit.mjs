#!/usr/bin/env node
/**
 * Phase P — @creezio/cockpit (shell + client, hors shell-ui).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  COCKPIT_PACKAGE,
  DEFAULT_COCKPIT_TABS,
  buildJoinLink,
  configureCockpit,
  getCockpitConfig,
  resetCockpitConfigForTests,
  resolveCockpitConfig,
} from "../packages/cockpit/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dockerRoot = path.resolve(root, "..");

const BRANDS = [
  { name: "tempoflow2", dir: "tempoflow2/crm", protocol: "tempoflow" },
  { name: "certivan-app", dir: "certivan-app/crm", protocol: "certivan" },
  { name: "fidu", dir: "fidu/crm", protocol: "fidu" },
];

const UI_TWINS = [
  "src/components/cockpit/server-cockpit-shell.tsx",
  "src/components/cockpit/cockpit-client.tsx",
];

const PACKAGE_UI = [
  "packages/cockpit/ui/index.ts",
  "packages/cockpit/ui/cockpit-client.tsx",
  "packages/cockpit/ui/server-cockpit-shell.tsx",
  "packages/cockpit/ui/hooks/use-cockpit-dashboard.ts",
  "packages/cockpit/ui/parts/status-dot.tsx",
  "packages/cockpit/ui/parts/service-card.tsx",
  "packages/cockpit/README.md",
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === "dist" ||
        ent.name === "dist-cjs"
      ) {
        continue;
      }
      out.push(...walk(p));
    } else out.push(p);
  }
  return out;
}

test("P-CKPT.1 package scaffold + exports", () => {
  assert.equal(COCKPIT_PACKAGE, "@creezio/cockpit");
  for (const rel of PACKAGE_UI) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/cockpit/package.json"), "utf8"),
  );
  assert.equal(pkg.name, "@creezio/cockpit");
  assert.ok(pkg.exports["."]);
  assert.ok(pkg.exports["./ui"]);
  const shellUiVersion = JSON.parse(
    fs.readFileSync(path.join(root, "packages/shell-ui/package.json"), "utf8"),
  ).version;
  assert.equal(pkg.dependencies["@creezio/shell-ui"], `^${shellUiVersion}`);
  assert.ok(fs.existsSync(path.join(root, "packages/cockpit/dist/index.js")));
  assert.deepEqual([...DEFAULT_COCKPIT_TABS], [
    "sante",
    "ia",
    "acces",
    "logs",
    "plugins",
    "invitations",
  ]);
});

test("P-CKPT.2 pas sous shell-ui + dep one-way", () => {
  for (const name of ["shell-ui", "onboarding", "tasks"]) {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(root, `packages/${name}/package.json`), "utf8"),
    );
    assert.equal(
      pkg.dependencies?.["@creezio/cockpit"],
      undefined,
      `${name} ne doit pas dépendre de cockpit`,
    );
    assert.equal(pkg.devDependencies?.["@creezio/cockpit"], undefined);
  }

  const badShell = walk(path.join(root, "packages/shell-ui")).filter((p) =>
    /cockpit/i.test(path.relative(root, p)),
  );
  assert.equal(
    badShell.length,
    0,
    `shell-ui ne doit pas contenir cockpit: ${badShell}`,
  );

  for (const dir of ["shell-ui", "onboarding", "tasks"]) {
    for (const f of walk(path.join(root, "packages", dir))) {
      if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
      const s = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(s, /@creezio\/cockpit/);
    }
  }
});

test("P-CKPT.3 zéro hardcode desktop marque + feeds", () => {
  const dirs = [
    path.join(root, "packages/cockpit/src"),
    path.join(root, "packages/cockpit/ui"),
  ];
  for (const dir of dirs) {
    for (const f of walk(dir)) {
      if (!/\.(ts|tsx|md)$/.test(f)) continue;
      const s = fs.readFileSync(f, "utf8");
      assert.doesNotMatch(
        s,
        /tempoflowDesktop|certivanDesktop|fiduDesktop/,
        path.relative(root, f),
      );
      if (f.endsWith(".md")) continue;
      assert.doesNotMatch(s, /tempoflow:\/\//);
      assert.doesNotMatch(s, /TempoFlow-Setup-latest/);
      assert.doesNotMatch(s, /crm\.tempoflow\.fr\/dl-/);
      assert.doesNotMatch(s, /paperclipApi|startPaperclip|Paperclip/);
      assert.doesNotMatch(
        s,
        /\b(GED|Pennylane|VASP|panier)\b/,
        `métier interdit: ${path.relative(root, f)}`,
      );
    }
  }
  const shell = fs.readFileSync(
    path.join(root, "packages/cockpit/ui/server-cockpit-shell.tsx"),
    "utf8",
  );
  assert.match(shell, /getShellDesktopApi|getShellUiBrand/);
  assert.match(shell, /deepLinkProtocol|buildJoinLink/);
  assert.match(shell, /clientDownloadUrl/);
  assert.match(shell, /extraTabs/);
  const hook = fs.readFileSync(
    path.join(root, "packages/cockpit/ui/hooks/use-cockpit-dashboard.ts"),
    "utf8",
  );
  assert.match(hook, /getShellDesktopApi/);
});

test("P-CKPT.4 config deep-link / download / tabs", () => {
  resetCockpitConfigForTests();
  configureCockpit({
    deepLinkProtocol: "tempoflow",
    clientDownloadUrl: "https://example.test/Client-Setup-latest.exe",
    tabs: ["sante", "ia"],
  });
  const cfg = getCockpitConfig();
  assert.equal(cfg.deepLinkProtocol, "tempoflow");
  assert.equal(
    cfg.clientDownloadUrl,
    "https://example.test/Client-Setup-latest.exe",
  );
  assert.deepEqual(cfg.tabs, ["sante", "ia"]);
  assert.equal(
    buildJoinLink("tempoflow", "demo.tempoflow.fr"),
    "tempoflow://join/demo.tempoflow.fr",
  );
  assert.equal(buildJoinLink("", "x"), null);
  const over = resolveCockpitConfig({ deepLinkProtocol: "fidu" });
  assert.equal(over.deepLinkProtocol, "fidu");
  assert.equal(
    over.clientDownloadUrl,
    "https://example.test/Client-Setup-latest.exe",
  );
  resetCockpitConfigForTests();
});

test("P-CKPT.5 workspace wiring + builds cockpit", () => {
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.match(rootPkg.scripts.build, /@creezio\/cockpit/);
  assert.match(rootPkg.scripts["build:packages"], /@creezio\/cockpit/);
  assert.match(rootPkg.scripts.test, /test-phase-p-cockpit/);

  const cjs = fs.readFileSync(path.join(root, "scripts/build-cjs.mjs"), "utf8");
  assert.match(cjs, /"cockpit"/);
});

test("P-CKPT.6 PHASE doc implemented + UI exports stables", () => {
  const phase = fs.readFileSync(
    path.join(root, "docs/archive/PHASE-P-COCKPIT.md"),
    "utf8",
  );
  assert.match(phase, /implémenté|implemented/i);
  assert.match(phase, /@creezio\/cockpit/);
  assert.doesNotMatch(phase, /Paperclip|paperclipApi/);

  const ui = fs.readFileSync(
    path.join(root, "packages/cockpit/ui/index.ts"),
    "utf8",
  );
  for (const sym of [
    "ServerCockpitShell",
    "CockpitClient",
    "configureCockpit",
    "getCockpitConfig",
    "useCockpitDashboard",
    "DEFAULT_COCKPIT_TABS",
    "buildJoinLink",
  ]) {
    assert.match(ui, new RegExp(sym));
  }
});

test("P-CKPT.7 cutover marques: 0 jumeau UI + parité Fidu", () => {
  for (const b of BRANDS) {
    const crm = path.join(dockerRoot, b.dir);
    if (!fs.existsSync(crm)) {
      assert.fail(`marque absente: ${crm}`);
    }
    for (const rel of UI_TWINS) {
      const p = path.join(crm, rel);
      assert.ok(!fs.existsSync(p), `jumeau encore présent: ${b.name} ${rel}`);
    }
    const pkg = JSON.parse(
      fs.readFileSync(path.join(crm, "package.json"), "utf8"),
    );
    assert.ok(
      pkg.dependencies?.["@creezio/cockpit"] ||
        pkg.devDependencies?.["@creezio/cockpit"],
      `${b.name} doit dépendre de @creezio/cockpit`,
    );

    const serverPage = fs.readFileSync(
      path.join(crm, "src/app/server-cockpit/page.tsx"),
      "utf8",
    );
    assert.match(serverPage, /@creezio\/cockpit/);
    assert.doesNotMatch(serverPage, /@\/components\/cockpit/);

    const clientPage = fs.readFileSync(
      path.join(crm, "src/app/cockpit/page.tsx"),
      "utf8",
    );
    assert.match(clientPage, /@creezio\/cockpit/);
    assert.doesNotMatch(clientPage, /@\/components\/cockpit/);

    const boot = fs.readFileSync(
      path.join(crm, "src/lib/shell-ui/configure-shell-ui-client.ts"),
      "utf8",
    );
    assert.match(boot, /configureCockpit/);
    assert.match(boot, new RegExp(`deepLinkProtocol:\\s*["']${b.protocol}["']`));

    assert.ok(
      fs.existsSync(path.join(crm, "src/server/routes/cockpit.ts")),
      `${b.name} routes/cockpit.ts`,
    );
    assert.ok(
      fs.existsSync(path.join(crm, "src/lib/cockpit-health.ts")),
      `${b.name} cockpit-health.ts`,
    );
    assert.ok(
      fs.existsSync(path.join(crm, "vendor/creezio/cockpit/package.json")),
      `${b.name} vendor cockpit`,
    );
  }
});
