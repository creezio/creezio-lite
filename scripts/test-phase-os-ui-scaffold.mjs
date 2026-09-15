/**
 * Gate : factory --from-prd ne versionne PLUS de pages OS dans ui/app/.
 * Les surfaces OS vivent dans @creezio/os-ui et sont matérialisées hors git.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const PRD = path.join(ROOT, "docs/experiences/tempoflow3/PRD-PRODUIT.md");

const FORBIDDEN_OS_DIRS = [
  "mails",
  "taches",
  "setup",
  "login",
  "developers",
  "settings",
  "admin",
  "cockpit",
  "mcp",
];

test("os-ui generator : RequireSession kit enveloppe WorkspaceRoot (source, sans spawn)", () => {
  const gen = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/os-ui.ts"),
    "utf8",
  );
  assert.match(gen, /from "@creezio\/auth\/ui"/);
  assert.match(
    gen,
    /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
    "générateur BrandChrome : RequireSession autour de WorkspaceRoot",
  );
  assert.doesNotMatch(
    gen,
    /function RequireSession/,
    "interdit un RequireSession local dans le générateur",
  );
  assert.match(
    gen,
    /logsSlot=\{<RequestLogsClient \/>\}/,
    "générateur MCP : logsSlot RequestLogsClient",
  );
  assert.match(gen, /jwtVerify/, "middleware généré : garde JWT");
  assert.match(gen, /host\.startsWith\("lp\."\)/, "middleware généré : rewrite lp.");
  assert.doesNotMatch(
    gen,
    /const OS_NAV/,
    "générateur : plus de constante OS_NAV recopiée",
  );
  assert.match(
    gen,
    /NavCatalogLoader/,
    "générateur monte <NavCatalogLoader /> (catalogue GET /)",
  );
  assert.match(
    gen,
    /defaultOsPrimaryNavItems/,
    "générateur fallback defaultOsPrimaryNavItems()",
  );
  assert.match(
    gen,
    /defaultOsAdminNavItems/,
    "générateur appelle defaultOsAdminNavItems()",
  );
  assert.doesNotMatch(
    gen,
    /href:\s*["']\/granola["']/,
    "générateur : pas de href /granola inline",
  );
});

test("os-ui generator : factory installe granola, grokbot et nav", () => {
  const sot = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/kit-release.ts"),
    "utf8",
  );
  const scaffold = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/scaffold.ts"),
    "utf8",
  );
  const fromPrd = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/scaffold-from-prd.ts"),
    "utf8",
  );
  const gen = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/os-ui.ts"),
    "utf8",
  );
  assert.match(
    scaffold,
    /creezioNpmDeps\(SERVER_CREEZIO_DEPS\)/,
    "scaffold.ts consomme SERVER_CREEZIO_DEPS (pas de liste parallèle)",
  );
  assert.match(
    fromPrd,
    /creezioNpmDeps\(SERVER_CREEZIO_DEPS\)/,
    "scaffold-from-prd.ts consomme SERVER_CREEZIO_DEPS (pas de liste parallèle)",
  );
  assert.doesNotMatch(
    fromPrd,
    /creezioNpmDeps\(\[/,
    "from-prd : interdit une liste inline (dérive de la SoT → granola manquant)",
  );
  // Le package.json UI généré consomme la SoT UI_CREEZIO_DEPS — plus de
  // liste inline parallèle (c'est elle qui a laissé passer l'incident
  // prod 0.20.0 côté upgrade : la liste UI n'existait que dans le
  // générateur, jamais dans le runner).
  assert.match(
    gen,
    /creezioNpmDeps\(UI_CREEZIO_DEPS\)/,
    "renderUiPackageJson consomme UI_CREEZIO_DEPS (pas de liste parallèle)",
  );
  assert.doesNotMatch(
    gen,
    /"@creezio\/[a-z-]+":\s*spec/,
    "renderUiPackageJson : interdit un spec @creezio/* inline (dérive de la SoT)",
  );
  for (const name of ["granola", "grokbot", "nav"]) {
    assert.match(
      sot,
      new RegExp(`SERVER_CREEZIO_DEPS[\\s\\S]*"${name}"`),
      `SERVER_CREEZIO_DEPS (kit-release.ts) contient ${name}`,
    );
    assert.match(
      sot,
      new RegExp(`CLIENT_CREEZIO_DEPS[\\s\\S]*"${name}"`),
      `CLIENT_CREEZIO_DEPS (kit-release.ts) contient ${name}`,
    );
    assert.match(
      sot,
      new RegExp(`UI_CREEZIO_DEPS[\\s\\S]*"${name}"`),
      `UI_CREEZIO_DEPS (kit-release.ts) contient ${name}`,
    );
    assert.match(
      gen,
      new RegExp(`"@creezio/${name}"`),
      `transpilePackages déclare @creezio/${name}`,
    );
  }
  // Les peers kit déclarés en dependencies de l'UI (résolution déterministe
  // hors workspace) font partie de la SoT UI — sinon `creezio upgrade` les
  // signalerait à tort « hors SoT » sur chaque marque.
  for (const name of ["platform-core", "brand-config", "shell", "api-kernel", "integrations"]) {
    assert.match(
      sot,
      new RegExp(`UI_CREEZIO_DEPS[\\s\\S]*"${name}"`),
      `UI_CREEZIO_DEPS (kit-release.ts) contient le peer ${name}`,
    );
  }
});

test("os-ui scaffold : zéro page OS versionnée, materialize + boot kit", () => {
  assert.ok(fs.existsSync(CLI), "factory CLI");
  assert.ok(fs.existsSync(PRD), "PRD produit");
  assert.ok(
    fs.existsSync(path.join(ROOT, "packages/os-ui/routes/mails/page.tsx")),
    "@creezio/os-ui routes",
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, "packages/os-ui/routes/granola/page.tsx")),
    "wrapper OS /granola",
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, "packages/os-ui/routes/grokbot/page.tsx")),
    "wrapper OS /grokbot",
  );

  const out = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-os-ui-"));
  // Structure seule : pas de npm install / lock (registre). Même contrat
  // hors-ligne que factory-prd (CREEZIO_SKIP_BRAND_DIST + lien kit si smoke).
  const r = spawnSync(
    process.execPath,
    [CLI, "new-app", "--from-prd", PRD, "--out", out, "--force", "--no-push"],
    {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 60_000,
      env: { ...process.env, CREEZIO_SKIP_BRAND_DIST: "1" },
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(
    r.stdout,
    /repos GitHub non créés \(--push pour les créer\)/,
    "os-ui-scaffold sans --push : aucun repo GitHub",
  );

  // Layout 2 repos (monorepo client+server) : le serveur (et son UI) vit sous server/.
  const srv = path.join(out, "server");

  for (const seg of FORBIDDEN_OS_DIRS) {
    assert.ok(
      !fs.existsSync(path.join(srv, "ui/app", seg)),
      `ne doit pas versionner ui/app/${seg}`,
    );
  }
  assert.ok(
    !fs.existsSync(path.join(srv, "ui/app/lib/creezio-ui-boot.tsx")),
    "pas de boot OS versionné",
  );

  assert.ok(
    fs.existsSync(path.join(srv, "scripts/materialize-os-ui.mjs")),
    "script materialize",
  );
  const gitignore = fs.readFileSync(path.join(out, ".gitignore"), "utf8");
  assert.match(gitignore, /\(creezio-os\)/);

  const uiPkg = JSON.parse(
    fs.readFileSync(path.join(srv, "ui/package.json"), "utf8"),
  );
  assert.ok(uiPkg.dependencies["@creezio/os-ui"]);
  assert.ok(
    uiPkg.dependencies["@creezio/granola"],
    "dep UI @creezio/granola (jamais retirer — attend publish si E404 npm)",
  );
  assert.ok(
    uiPkg.dependencies["@creezio/grokbot"],
    "dep UI @creezio/grokbot (jamais retirer — attend publish si E404 npm)",
  );
  assert.ok(
    uiPkg.dependencies["@creezio/nav"],
    "dep UI @creezio/nav (même vague publish que granola/grokbot)",
  );
  assert.ok(uiPkg.scripts.prebuild);

  const srvPkg = JSON.parse(
    fs.readFileSync(path.join(srv, "package.json"), "utf8"),
  );
  assert.ok(
    srvPkg.dependencies["@creezio/granola"],
    "dep serveur @creezio/granola (SERVER_CREEZIO_DEPS)",
  );
  assert.ok(
    srvPkg.dependencies["@creezio/grokbot"],
    "dep serveur @creezio/grokbot (SERVER_CREEZIO_DEPS)",
  );
  assert.ok(
    srvPkg.dependencies["@creezio/nav"],
    "dep serveur @creezio/nav (SERVER_CREEZIO_DEPS)",
  );

  const layout = fs.readFileSync(path.join(srv, "ui/app/layout.tsx"), "utf8");
  assert.match(layout, /@creezio\/os-ui\/boot/);
  assert.match(layout, /CreezioUiBoot/);
  assert.match(
    layout,
    /@creezio\/interactive-demo\/ui\/interactive-demo\.css/,
    "layout importe le CSS démo interactive",
  );
  assert.ok(
    uiPkg.dependencies["@creezio/interactive-demo"],
    "dep UI @creezio/interactive-demo",
  );
  const bootSrc = fs.readFileSync(
    path.join(ROOT, "packages/os-ui/src/boot.tsx"),
    "utf8",
  );
  assert.doesNotMatch(
    bootSrc,
    /<InteractiveDemoRoot/,
    "boot ne monte plus InteractiveDemoRoot (lecteur unique dans BrandChrome)",
  );
  const chromeSrc = fs.readFileSync(
    path.join(srv, "ui/components/brand-chrome.tsx"),
    "utf8",
  );
  assert.match(
    chromeSrc,
    /InteractiveDemoRoot/,
    "BrandChrome monte InteractiveDemoRoot dans SessionProvider",
  );
  const brandApi = fs.readFileSync(
    path.join(srv, "src/electron/brand-module-api.ts"),
    "utf8",
  );
  assert.match(brandApi, /createInteractiveDemoMount/);
  const brandMig = fs.readFileSync(
    path.join(srv, "src/electron/brand-migrations.ts"),
    "utf8",
  );
  assert.match(brandMig, /interactiveDemoMigrations/);
  assert.doesNotMatch(layout, /OS_NAV/);
  assert.doesNotMatch(layout, /\/mails/);

  // Chrome CRM kit + Tailwind : sans ça, l'app générée rend du HTML brut
  // (nav en liens texte, zéro sidebar) — régression vue sur tempoflow3.
  assert.match(layout, /BrandChrome/, "layout branche le chrome kit");
  assert.match(layout, /globals\.css/, "layout importe globals.css");
  assert.match(
    layout,
    /@creezio\/shell-ui\/theme\.css/,
    "layout importe le thème Creezio canonique (design system kit)",
  );
  assert.doesNotMatch(
    layout,
    /style=\{\{/,
    "plus de styles inline scaffold dans le layout",
  );

  const chrome = fs.readFileSync(
    path.join(srv, "ui/components/brand-chrome.tsx"),
    "utf8",
  );
  assert.match(chrome, /@creezio\/shell-ui\/ui/, "chrome vient du kit");
  assert.match(chrome, /WorkspaceRoot/);
  assert.match(chrome, /configureSidebar/);
  assert.match(chrome, /SessionProvider/);
  assert.match(
    chrome,
    /from "@creezio\/auth\/ui"/,
    "RequireSession vient du contrat kit, pas d'un wrapper local",
  );
  assert.match(chrome, /<RequireSession>/);
  assert.match(
    chrome,
    /<RequireSession>[\s\S]*<WorkspaceRoot>\{children\}<\/WorkspaceRoot>[\s\S]*<\/RequireSession>/,
    "RequireSession doit envelopper WorkspaceRoot (sinon CRM/flotte creux, APIs 401)",
  );
  assert.doesNotMatch(
    chrome,
    /function RequireSession/,
    "interdit un RequireSession local — contrat @creezio/auth/ui",
  );
  assert.match(chrome, /AssistantRoot/);
  assert.match(
    chrome,
    /SessionUsageAnalyticsProvider/,
    "chrome monte le tracker analytics (sinon Admin → Analytics reste à 0)",
  );
  assert.match(chrome, /@creezio\/observability\/ui/);
  assert.doesNotMatch(
    chrome,
    /const OS_NAV/,
    "chrome ne recopie plus une constante OS_NAV",
  );
  assert.doesNotMatch(
    chrome,
    /["']\/granola["']/,
    "chrome n'embed plus /granola en dur — catalogue kit",
  );
  assert.doesNotMatch(
    chrome,
    /["']\/grokbot["']/,
    "chrome n'embed plus /grokbot en dur — catalogue kit",
  );
  assert.match(
    chrome,
    /NavCatalogLoader/,
    "chrome monte <NavCatalogLoader /> (GET /api/v1/modules/nav)",
  );
  assert.match(
    chrome,
    /defaultOsPrimaryNavItems/,
    "chrome fallback defaultOsPrimaryNavItems() (premier paint)",
  );
  assert.match(
    chrome,
    /defaultOsAdminNavItems/,
    "chrome appelle defaultOsAdminNavItems (pas de liste admin recopiée)",
  );
  assert.match(
    chrome,
    /includePlugins:\s*true/,
    "chrome passe includePlugins: true (défaut ON)",
  );

  const tailwind = fs.readFileSync(
    path.join(srv, "ui/tailwind.config.ts"),
    "utf8",
  );
  assert.match(
    tailwind,
    /node_modules\/@creezio\/\*\/ui/,
    "tailwind scanne les sources UI des packages npm @creezio/* (sinon classes purgées)",
  );
  assert.match(
    tailwind,
    /@creezio\/shell-ui\/tailwind-preset/,
    "tailwind consomme le preset thème kit (design system par défaut)",
  );
  const postcss = fs.readFileSync(
    path.join(srv, "ui/postcss.config.js"),
    "utf8",
  );
  assert.match(postcss, /tailwindcss/);
  const globals = fs.readFileSync(
    path.join(srv, "ui/app/globals.css"),
    "utf8",
  );
  assert.match(globals, /@tailwind base/);
  // Les tokens vivent dans le kit (theme.css, SoT — consommée via le
  // package npm @creezio/shell-ui, ui/ inclus dans le tarball publié).
  const kitTheme = fs.readFileSync(
    path.join(ROOT, "packages/shell-ui/ui/theme/theme.css"),
    "utf8",
  );
  assert.match(kitTheme, /--background: #faf7f1/, "tokens thème gold TF");
  assert.match(kitTheme, /\.tf-tab-bg/, "chrome onglets kit présent");
  assert.match(kitTheme, /\.sidebar-scroll/, "scrollbar sidebar sombre");
  const kitPreset = fs.readFileSync(
    path.join(ROOT, "packages/shell-ui/ui/theme/tailwind-preset.cjs"),
    "utf8",
  );
  assert.match(kitPreset, /#f0701d/, "accent orange gold TF dans le preset");
  const shellUiPkg = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "packages/shell-ui/package.json"),
      "utf8",
    ),
  );
  assert.equal(
    shellUiPkg.exports?.["./theme.css"],
    "./ui/theme/theme.css",
    "export ./theme.css",
  );
  assert.equal(
    shellUiPkg.exports?.["./tailwind-preset"],
    "./ui/theme/tailwind-preset.cjs",
    "export ./tailwind-preset",
  );
  assert.ok(
    uiPkg.devDependencies?.tailwindcss,
    "tailwindcss en devDependency UI",
  );

  const home = fs.readFileSync(path.join(srv, "ui/app/page.tsx"), "utf8");
  assert.match(
    home,
    /redirect\("\/dashboard"\)/,
    "home '/' = pure redirection vers /dashboard (le kit canonise '/' → /dashboard), jamais vers une autre page",
  );
  assert.match(
    home,
    /CONVENTION OS/,
    "home '/' porte le commentaire CONVENTION OS (home réelle = app/dashboard/page.tsx)",
  );

  // Pages métier générées = composants kit, JAMAIS de HTML brut.
  assert.equal(
    shellUiPkg.exports?.["./ui/primitives/*"]?.import,
    "./ui/primitives/*.tsx",
    "export ./ui/primitives/* (re-exports marque)",
  );
  const btnReexport = fs.readFileSync(
    path.join(srv, "ui/components/ui/button.tsx"),
    "utf8",
  );
  assert.match(
    btnReexport,
    /@creezio\/shell-ui\/ui\/primitives\/button/,
    "convention @/components/ui/* = re-export design system kit",
  );
  const entityTable = fs.readFileSync(
    path.join(srv, "ui/components/entity-table.tsx"),
    "utf8",
  );
  assert.match(
    entityTable,
    /DataTable.*@creezio\/shell-ui\/ui|@creezio\/shell-ui\/ui[\s\S]*DataTable/,
    "table métier = DataTable kit (tri/filtre/pagination)",
  );
  const dashboard = fs.readFileSync(
    path.join(srv, "ui/app/dashboard/page.tsx"),
    "utf8",
  );
  assert.match(dashboard, /@\/components\/ui\/card/, "dashboard = cartes kit");
  assert.doesNotMatch(dashboard, /<ul>/, "pas de liste HTML brute");
  const entityPages = fs
    .readdirSync(path.join(srv, "ui/app"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "dashboard")
    .map((e) => path.join(srv, "ui/app", e.name, "page.tsx"))
    .filter((p) => fs.existsSync(p));
  assert.ok(entityPages.length >= 1, "au moins une page entité générée");
  for (const p of entityPages) {
    const src = fs.readFileSync(p, "utf8");
    assert.ok(
      /@\/components\/(entity-table|ui\/card)/.test(src),
      `page générée sans composant kit : ${p}`,
    );
    assert.ok(!/<ul>/.test(src), `HTML brut (<ul>) dans ${p}`);
  }
  // Le générateur de layout HTML brut legacy ne doit plus exister.
  const factoryUiSrc = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/generators/ui.ts"),
    "utf8",
  );
  assert.ok(
    !/export function renderNextLayoutTsx/.test(factoryUiSrc),
    "renderNextLayoutTsx (layout HTML brut) supprimé de la factory",
  );

  const allow = fs.readFileSync(
    path.join(srv, "scripts/test-allowlist.mjs"),
    "utf8",
  );
  assert.match(allow, /page OS versionnée interdite/);

  fs.rmSync(out, { recursive: true, force: true });
});

test("os-ui materialize : une page métier marque prime sur le wrapper OS", () => {
  const materialize = path.join(ROOT, "packages/os-ui/scripts/materialize.mjs");
  assert.ok(fs.existsSync(materialize), "script materialize kit");
  const onbPage = path.join(ROOT, "packages/os-ui/routes/onboarding/page.tsx");
  assert.ok(fs.existsSync(onbPage), "route OS onboarding (témoin du test)");
  const onbSrc = fs.readFileSync(onbPage, "utf8");
  assert.match(onbSrc, /redirect\(["']\/["']\)/, "onboarding OS = redirect home");
  assert.doesNotMatch(
    onbSrc,
    /Les étapes produit se déclarent/,
    "plus de placeholder mort /onboarding",
  );

  const brandRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-os-own-"));
  const appDir = path.join(brandRoot, "ui", "app");
  // Page métier verbatim (ex. onboarding TF) : le wrapper kit DOIT être
  // skippé, sinon Next refuse le build (parallel pages, même chemin).
  fs.mkdirSync(path.join(appDir, "onboarding"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "onboarding", "page.tsx"),
    "export default function OnboardingMetier() { return null; }\n",
  );
  // Parent métier avec enfant kit (/parametres TF + /parametres/email kit) :
  // chemins finaux différents → l'enfant DOIT survivre.
  fs.mkdirSync(path.join(appDir, "parametres"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "parametres", "page.tsx"),
    "export default function ParametresMetier() { return null; }\n",
  );

  const r = spawnSync(process.execPath, [materialize, "--app-root", brandRoot], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);

  const group = path.join(appDir, "(creezio-os)");
  assert.ok(
    !fs.existsSync(path.join(group, "onboarding")),
    "wrapper onboarding skippé (page métier marque présente)",
  );
  assert.ok(
    fs.existsSync(path.join(group, "mails", "page.tsx")),
    "les autres routes OS restent matérialisées",
  );
  assert.match(r.stdout, /skip \/onboarding/, "skip loggé explicitement");

  assert.ok(
    !fs.existsSync(path.join(group, "parametres", "page.tsx")),
    "wrapper /parametres skippé (page métier marque présente)",
  );
  assert.ok(
    fs.existsSync(path.join(group, "parametres", "email", "page.tsx")),
    "l'enfant kit /parametres/email survit à un parent métier",
  );

  fs.rmSync(brandRoot, { recursive: true, force: true });
});
