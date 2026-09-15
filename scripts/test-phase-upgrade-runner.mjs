#!/usr/bin/env node
/**
 * Gate P3.a — runner de montée de version `creezio upgrade`.
 *
 * Contrat (packages/factory/src/upgrade-cli.ts + scripts/codemods/README.md) :
 *   U1. `creezio upgrade --dry-run` sur un scaffold factory FRAIS = no-op
 *       explicite (architecture courante = cible, manifests alignés) ;
 *   U2. sur une fixture simulant un retard multi-versions (marqueur H7,
 *       fichier legacy pré-H9), le dry-run liste LA CHAÎNE des codemods
 *       intermédiaires DANS L'ORDRE (H8 puis H9) ;
 *   U3. l'application réelle migre la fixture (types.ts → ré-export kit,
 *       marqueur re-stampé) en PROUVANT l'idempotence de chaque pas, et un
 *       second `upgrade` complet est un no-op ;
 *   U4. SYNC DES DEPS (trou systémique, incident prod 0.20.0) : une fixture
 *       sans les deps requises par la SoT kit (SERVER/UI_CREEZIO_DEPS) se
 *       les fait AJOUTER en ^<lockstep> (listées au --dry-run), le doctor
 *       brand-spec passe ensuite, et le re-run est un no-op ;
 *   U5. une dep @creezio/* HORS SoT n'est jamais supprimée : warning listé,
 *       manifest intact ;
 *   U6. la logique de sync est PARTAGÉE : planCreezioManifestSync /
 *       applyCreezioManifestSync (factory dist) — unit-testés ici — et
 *       scripts/propagate-brands.mjs les consomme (plus de boucle de bump
 *       parallèle).
 *
 * Offline : scaffold avec CREEZIO_SKIP_BRAND_DIST=1 + --no-push ; les
 * fixtures ont des manifests alignés sur le lockstep courant OU des
 * lockfiles artisanales déjà en sync avec l'état POST-sync (contrat
 * ensureBrandPackageLocks : lock en sync ⇒ npm jamais invoqué ⇒ zéro
 * réseau).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");

const LOCKSTEP = JSON.parse(
  fs.readFileSync(path.join(ROOT, "packages/platform-core/package.json"), "utf8"),
).version;
const SPEC = `^${LOCKSTEP}`;

const factoryDist = (rel) =>
  pathToFileURL(path.join(ROOT, "packages/factory/dist", rel)).href;

const { SERVER_CREEZIO_DEPS, UI_CREEZIO_DEPS, CLIENT_CREEZIO_DEPS } =
  await import(factoryDist("kit-release.js"));
const {
  planCreezioManifestSync,
  applyCreezioManifestSync,
  creezioSyncPlanHasChanges,
} = await import(factoryDist("sync-creezio-deps.js"));
const { ARCHITECTURE_VERSION } = await import(
  pathToFileURL(
    path.join(ROOT, "packages/platform-core/dist/architecture-version.js"),
  ).href
);

function runUpgrade(brandRoot, extra = []) {
  return spawnSync(
    process.execPath,
    [CLI, "upgrade", "--brand-root", brandRoot, ...extra],
    {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 120_000,
      // CREEZIO_LINK_KIT (posé par la CI kit pour les gates scaffold) est
      // neutralisé : un upgrade réel de marque produit un lock REGISTRE
      // (committable), jamais file:<worktree>. Sans ça, le pin link-kit
      // désynchronise manifest/lock des fixtures offline (U4/U5) et
      // ensureBrandPackageLocks part sur le réseau (contrat gate : zéro npm).
      env: { ...process.env, CREEZIO_LINK_KIT: "0" },
    },
  );
}

/** deps `@creezio/<name>` → SPEC pour une liste SoT (moins `omit`). */
function sotDeps(names, omit = []) {
  return Object.fromEntries(
    names
      .filter((n) => !omit.includes(n))
      .map((n) => [`@creezio/${n}`, SPEC]),
  );
}

function readPkg(work, rel) {
  return JSON.parse(fs.readFileSync(path.join(work, rel), "utf8"));
}

/**
 * Lockfiles artisanales EN SYNC avec l'état POST-sync des manifests
 * (isPackageLockInSync compare exactement les maps de deps) — garantit
 * qu'ensureBrandPackageLocks n'invoque jamais npm (gate offline).
 */
function writePostSyncLocks(work, { serverDeps, uiDeps }) {
  fs.writeFileSync(
    path.join(work, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        server: { dependencies: serverDeps },
      },
    }) + "\n",
  );
  if (uiDeps) {
    fs.writeFileSync(
      path.join(work, "server/ui/package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": { dependencies: uiDeps } },
      }) + "\n",
    );
  }
}

/** BrandSpec minimal VALIDE (doctor réellement exécuté, et vert). */
function writeMinimalBrandSpec(work, brandId) {
  const specDir = path.join(work, "brand-spec");
  fs.mkdirSync(path.join(specDir, "modules", "articles"), { recursive: true });
  fs.writeFileSync(
    path.join(specDir, "brand.yaml"),
    `brandId: ${brandId}\nbrandName: Updoc\ndomain: updoc.local\n`,
  );
  fs.writeFileSync(
    path.join(specDir, "product.md"),
    "# Updoc\n\nGestion d'articles.\n",
  );
  fs.writeFileSync(
    path.join(specDir, "modules", "articles", "prd.md"),
    "# Module articles\n\nVision remplie pour la fixture de test.\n",
  );
}

/** Fixture minimale « repo marque en retard » (sans brand.yaml → doctor skip explicite). */
function makeLaggingFixture(work) {
  const modulesDir = path.join(work, "server/src/electron/modules");
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify(
      {
        name: "updoc",
        private: true,
        creezio: { brandId: "updoc", layout: "monorepo", architectureVersion: "H7" },
        workspaces: ["server"],
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify(
      {
        name: "updoc-server",
        // Clôture SoT COMPLÈTE au lockstep courant : la fixture isole la
        // chaîne de codemods — aucun bump/ajout ⇒ aucune régénération de
        // lock ⇒ zéro réseau (contrat offline historique de cette gate).
        dependencies: sotDeps(SERVER_CREEZIO_DEPS),
      },
      null,
      2,
    ) + "\n",
  );
  // Copie locale legacy du contrat de module (état pré-H9) — cible du codemod H9.
  fs.writeFileSync(
    path.join(modulesDir, "types.ts"),
    `export type BrandModuleDef = {
  id: string;
  apiMounts?: Record<string, unknown>;
  navItems?: unknown[];
};
`,
  );
  return { modulesDir };
}

test("U0 dist factory/platform-core buildés (SoT deps importable)", () => {
  for (const rel of [
    "packages/factory/dist/kit-release.js",
    "packages/factory/dist/sync-creezio-deps.js",
    "packages/platform-core/dist/architecture-version.js",
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} manquant — npm run build:packages`);
  }
  assert.ok(SERVER_CREEZIO_DEPS.includes("granola"), "SoT server sans granola");
  assert.ok(UI_CREEZIO_DEPS.includes("grokbot"), "SoT ui sans grokbot");
  assert.ok(CLIENT_CREEZIO_DEPS.includes("electron-shell"), "SoT client sans electron-shell");
});

test("U1 dry-run sur scaffold factory frais = no-op explicite", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upgrade-fresh-"));
  const scaffold = spawnSync(
    process.execPath,
    [
      CLI,
      "new-app",
      "--name",
      "UpDoc",
      "--id",
      "updoc",
      "--domain",
      "updoc.local",
      "--out",
      path.join(out, "updoc"),
      "--no-push",
      "--force",
    ],
    {
      encoding: "utf8",
      cwd: ROOT,
      timeout: 120_000,
      env: { ...process.env, CREEZIO_SKIP_BRAND_DIST: "1" },
    },
  );
  assert.equal(scaffold.status, 0, scaffold.stderr || scaffold.stdout);

  // Le scaffold stampe le marqueur de version d'architecture (SoT détection).
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(out, "updoc/package.json"), "utf8"),
  );
  assert.match(
    String(rootPkg.creezio?.architectureVersion || ""),
    /^H\d+$/,
    "scaffold : creezio.architectureVersion stampé",
  );

  const r = runUpgrade(path.join(out, "updoc"), ["--dry-run"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /no-op/, r.stdout);
  assert.match(r.stdout, new RegExp(`\\^${LOCKSTEP.replaceAll(".", "\\.")}`));
  // Un scaffold frais est DANS la SoT : aucun ajout, aucun warning extra.
  assert.doesNotMatch(r.stdout, /ajouts :/, r.stdout);
  assert.doesNotMatch(r.stdout, /hors SoT kit/, r.stdout);
  fs.rmSync(out, { recursive: true, force: true });
});

test("U2 fixture multi-versions : dry-run liste la chaîne H8 puis H9 dans l'ordre", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upgrade-lag-"));
  makeLaggingFixture(work);

  const r = runUpgrade(work, ["--dry-run"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /architecture : H7 → H\d+/);
  const h8 = r.stdout.indexOf("→ H8/");
  const h9 = r.stdout.indexOf("→ H9/");
  assert.ok(h8 !== -1, `chaîne sans H8 :\n${r.stdout}`);
  assert.ok(h9 !== -1, `chaîne sans H9 :\n${r.stdout}`);
  assert.ok(h8 < h9, `H8 doit précéder H9 :\n${r.stdout}`);
  assert.doesNotMatch(r.stdout, /→ H7\//, "H7 (déjà appliqué) hors chaîne");

  // Dry-run = rien n'est écrit.
  const pkg = JSON.parse(fs.readFileSync(path.join(work, "package.json"), "utf8"));
  assert.equal(pkg.creezio.architectureVersion, "H7");
  fs.rmSync(work, { recursive: true, force: true });
});

test("U3 application réelle : chaîne migrée, idempotence prouvée, re-run = no-op", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upgrade-apply-"));
  const { modulesDir } = makeLaggingFixture(work);

  const r = runUpgrade(work, ["--no-install"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /codemod H8\//);
  assert.match(r.stdout, /codemod H9\//);
  assert.match(r.stdout, /doctor : pas de brand\.yaml/, r.stdout);
  assert.match(r.stdout, /✓ upgrade terminé/);

  // Le codemod H9 a bien remplacé la copie locale par le ré-export kit.
  const types = fs.readFileSync(path.join(modulesDir, "types.ts"), "utf8");
  assert.match(types, /from "@creezio\/app-runtime"/);
  assert.doesNotMatch(types, /type BrandModuleDef\s*=\s*\{/);

  // Marqueur re-stampé à la cible.
  const pkg = JSON.parse(fs.readFileSync(path.join(work, "package.json"), "utf8"));
  assert.match(String(pkg.creezio.architectureVersion), /^H\d+$/);
  assert.notEqual(pkg.creezio.architectureVersion, "H7");

  // Un second upgrade complet est un no-op vert.
  const again = runUpgrade(work, ["--no-install"]);
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.match(again.stdout, /no-op/, again.stdout);
  fs.rmSync(work, { recursive: true, force: true });
});

test("U4 fixture sans les deps SoT : upgrade les AJOUTE, doctor passe, re-run no-op", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upgrade-sync-"));
  // Marque à l'architecture COURANTE (chaîne vide) mais manifests en retard
  // sur la LISTE des deps — le trou prod 0.20.0 (granola/grokbot/nav).
  fs.mkdirSync(path.join(work, "server/ui"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify(
      {
        name: "updoc",
        private: true,
        creezio: {
          brandId: "updoc",
          layout: "monorepo",
          architectureVersion: ARCHITECTURE_VERSION,
        },
        workspaces: ["server"],
      },
      null,
      2,
    ) + "\n",
  );
  const serverDepsPre = sotDeps(SERVER_CREEZIO_DEPS, ["granola", "grokbot", "nav"]);
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify(
      { name: "updoc-server", dependencies: serverDepsPre },
      null,
      2,
    ) + "\n",
  );
  const uiDepsPre = sotDeps(UI_CREEZIO_DEPS, ["granola", "grokbot"]);
  fs.writeFileSync(
    path.join(work, "server/ui/package.json"),
    JSON.stringify({ name: "updoc-ui", dependencies: uiDepsPre }, null, 2) + "\n",
  );
  // Locks déjà en sync avec l'état POST-sync (offline : npm jamais invoqué).
  writePostSyncLocks(work, {
    serverDeps: sotDeps(SERVER_CREEZIO_DEPS),
    uiDeps: sotDeps(UI_CREEZIO_DEPS),
  });
  writeMinimalBrandSpec(work, "updoc");

  // --dry-run : liste les ajouts, n'écrit rien.
  const dry = runUpgrade(work, ["--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr || dry.stdout);
  assert.match(dry.stdout, /server\/package\.json \(3 ajouts : @creezio\/granola, @creezio\/grokbot, @creezio\/nav\)/, dry.stdout);
  assert.match(dry.stdout, /server\/ui\/package\.json \(2 ajouts : @creezio\/granola, @creezio\/grokbot\)/, dry.stdout);
  assert.equal(
    readPkg(work, "server/package.json").dependencies["@creezio/granola"],
    undefined,
    "dry-run a écrit le manifest",
  );

  // Application réelle : ajouts en ^<lockstep>, doctor brand-spec vert.
  const r = runUpgrade(work, ["--no-install"]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /ajout @creezio\/granola → .* \(server\/package\.json\)/, r.stdout);
  assert.match(r.stdout, /ajout @creezio\/grokbot → .* \(server\/ui\/package\.json\)/, r.stdout);
  const serverDeps = readPkg(work, "server/package.json").dependencies;
  for (const name of ["@creezio/granola", "@creezio/grokbot", "@creezio/nav"]) {
    assert.equal(serverDeps[name], SPEC, `${name} non ajouté au serveur`);
  }
  const uiDeps = readPkg(work, "server/ui/package.json").dependencies;
  for (const name of ["@creezio/granola", "@creezio/grokbot"]) {
    assert.equal(uiDeps[name], SPEC, `${name} non ajouté à l'UI`);
  }
  assert.match(r.stdout, /✓ BrandSpec OK/, r.stdout);
  assert.match(r.stdout, /✓ upgrade terminé/, r.stdout);

  // Idempotence : re-run = no-op (contrat historique du runner).
  const again = runUpgrade(work, ["--no-install"]);
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.match(again.stdout, /no-op/, again.stdout);
  fs.rmSync(work, { recursive: true, force: true });
});

test("U5 dep @creezio/* hors SoT : warning listé, JAMAIS supprimée", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upgrade-extra-"));
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify(
      {
        name: "updoc",
        private: true,
        creezio: {
          brandId: "updoc",
          layout: "monorepo",
          architectureVersion: ARCHITECTURE_VERSION,
        },
        workspaces: ["server"],
      },
      null,
      2,
    ) + "\n",
  );
  const serverDepsFull = {
    ...sotDeps(SERVER_CREEZIO_DEPS),
    // Dep hors SoT (ex. consommée par du wiring marque) : conservée + warning.
    "@creezio/landing": SPEC,
  };
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({ name: "updoc-server", dependencies: serverDepsFull }, null, 2) + "\n",
  );
  writePostSyncLocks(work, { serverDeps: serverDepsFull });

  // Rien à changer → no-op, mais le warning est visible (aussi en dry-run).
  for (const extra of [["--no-install"], ["--dry-run"]]) {
    const r = runUpgrade(work, extra);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /no-op/, r.stdout);
    assert.match(r.stdout, /⚠ server\/package\.json : deps @creezio\/\* hors SoT kit/, r.stdout);
    assert.match(r.stdout, /@creezio\/landing/, r.stdout);
  }
  assert.equal(
    readPkg(work, "server/package.json").dependencies["@creezio/landing"],
    SPEC,
    "dep hors SoT supprimée — interdit (jamais de suppression silencieuse)",
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("U6 logique de sync PARTAGÉE (factory dist) + propagate la consomme", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-sync-unit-"));
  fs.mkdirSync(path.join(work, "server/ui"), { recursive: true });
  fs.mkdirSync(path.join(work, "client"), { recursive: true });
  // Racine : dep @creezio en vieux spec — rôle sans SoT : bump seul, jamais d'extra.
  fs.writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify({ name: "u", private: true, dependencies: { "@creezio/os-ui": "^0.1.0" } }) + "\n",
  );
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      name: "u-server",
      dependencies: {
        ...sotDeps(SERVER_CREEZIO_DEPS, ["granola"]),
        "@creezio/landing": SPEC, // extra
        "@creezio/platform-core": "link:../kit", // spec local : intact, pas bumpé
      },
    }) + "\n",
  );
  fs.writeFileSync(
    path.join(work, "server/ui/package.json"),
    JSON.stringify({ name: "u-ui", dependencies: sotDeps(UI_CREEZIO_DEPS, ["grokbot"]) }) + "\n",
  );
  fs.writeFileSync(
    path.join(work, "client/package.json"),
    JSON.stringify({
      name: "u-client",
      dependencies: { ...sotDeps(CLIENT_CREEZIO_DEPS), "@creezio/shell": "^0.1.0" },
    }) + "\n",
  );

  const plans = planCreezioManifestSync(work, SPEC);
  const byRel = Object.fromEntries(plans.map((p) => [p.rel, p]));

  // Racine : bump seul (pas d'ajout, pas d'extra — rôle sans clôture SoT).
  assert.deepEqual(Object.keys(byRel["package.json"].adds), []);
  assert.deepEqual(byRel["package.json"].extras, []);
  assert.equal(byRel["package.json"].bumps["@creezio/os-ui"].from, "^0.1.0");

  // Server : ajout granola, extra landing, link: intact.
  assert.equal(byRel["server/package.json"].adds["@creezio/granola"], SPEC);
  assert.deepEqual(byRel["server/package.json"].extras, ["@creezio/landing"]);
  assert.equal(byRel["server/package.json"].bumps["@creezio/platform-core"], undefined);

  // UI : ajout grokbot. Client : bump shell.
  assert.equal(byRel["server/ui/package.json"].adds["@creezio/grokbot"], SPEC);
  assert.equal(byRel["client/package.json"].bumps["@creezio/shell"].to, SPEC);

  for (const plan of plans.filter(creezioSyncPlanHasChanges)) {
    applyCreezioManifestSync(plan);
  }
  const serverPkg = readPkg(work, "server/package.json");
  assert.equal(serverPkg.dependencies["@creezio/granola"], SPEC);
  assert.equal(serverPkg.dependencies["@creezio/landing"], SPEC, "extra supprimé");
  assert.equal(serverPkg.dependencies["@creezio/platform-core"], "link:../kit");
  assert.equal(readPkg(work, "client/package.json").dependencies["@creezio/shell"], SPEC);

  // Idempotence : re-plan = zéro changement, extras toujours listés.
  const replans = planCreezioManifestSync(work, SPEC);
  assert.deepEqual(replans.filter(creezioSyncPlanHasChanges), []);
  assert.deepEqual(
    replans.find((p) => p.rel === "server/package.json").extras,
    ["@creezio/landing"],
  );

  // propagate-brands.mjs : consomme le helper partagé, plus de boucle parallèle.
  const propagate = fs.readFileSync(
    path.join(ROOT, "scripts/propagate-brands.mjs"),
    "utf8",
  );
  assert.match(propagate, /factory\/dist\/sync-creezio-deps\.js/);
  assert.match(propagate, /planCreezioManifestSync/);
  assert.doesNotMatch(propagate, /function bumpManifests/);

  // upgrade-cli : plus de planificateur de bump local parallèle.
  const upgradeCli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/upgrade-cli.ts"),
    "utf8",
  );
  assert.match(upgradeCli, /from "\.\/sync-creezio-deps\.js"/);
  assert.doesNotMatch(upgradeCli, /planManifestBumps/);
  fs.rmSync(work, { recursive: true, force: true });
});

test("U7 npm isolé : upgrade d'une marque à côté d'un faux kit ne touche pas son node_modules", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-upgrade-iso-"));
  const fakeKit = path.join(parent, "fake-kit");
  const brand = path.join(parent, "brand");
  try {
    fs.mkdirSync(path.join(fakeKit, "packages", "platform-core"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(fakeKit, "node_modules", "@creezio", "platform-core"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fakeKit, "package.json"),
      JSON.stringify({
        name: "creezio",
        private: true,
        workspaces: ["packages/*"],
      }) + "\n",
    );
    fs.writeFileSync(
      path.join(fakeKit, "packages", "platform-core", "package.json"),
      JSON.stringify({ name: "@creezio/platform-core", version: "0.0.0-sentinel" }) +
        "\n",
    );
    const sentinel = path.join(
      fakeKit,
      "node_modules",
      "@creezio",
      "platform-core",
      "SENTINEL",
    );
    fs.writeFileSync(sentinel, "DO_NOT_TOUCH\n");
    fs.writeFileSync(
      path.join(fakeKit, "node_modules", "@creezio", "platform-core", "package.json"),
      JSON.stringify({ name: "@creezio/platform-core", version: "0.0.0-sentinel" }) +
        "\n",
    );

    fs.mkdirSync(path.join(brand, "server"), { recursive: true });
    fs.mkdirSync(path.join(brand, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(brand, "package.json"),
      JSON.stringify({
        name: "probe-brand",
        private: true,
        workspaces: ["server"],
        creezio: { brandId: "probe", architectureVersion: "H7" },
        scripts: { "os-ui:materialize": "node -e \"\"" },
      }) + "\n",
    );
    fs.writeFileSync(
      path.join(brand, "server", "package.json"),
      JSON.stringify({ name: "probe-server", private: true }) + "\n",
    );

    const upgradeCli = fs.readFileSync(
      path.join(ROOT, "packages/factory/src/upgrade-cli.ts"),
      "utf8",
    );
    const lockSrc = fs.readFileSync(
      path.join(ROOT, "packages/factory/src/package-lock.ts"),
      "utf8",
    );
    assert.match(upgradeCli, /from "\.\/npm-isolated\.js"/);
    assert.match(upgradeCli, /spawnNpmAt/);
    assert.match(lockSrc, /from "\.\/npm-isolated\.js"/);
    assert.match(lockSrc, /spawnNpmAt/);

    const { ensureBrandPackageLocks } = await import(factoryDist("package-lock.js"));
    const poisoned = {
      ...process.env,
      CREEZIO_LINK_KIT: "0",
      npm_config_local_prefix: fakeKit,
      npm_config_prefix: fakeKit,
      INIT_CWD: fakeKit,
      npm_lifecycle_event: "upgrade",
    };
    const { refreshed } = ensureBrandPackageLocks(brand, {
      mode: "lock-only",
      log: () => {},
      env: poisoned,
    });
    assert.ok(refreshed.length >= 1, "lock marque régénéré (npm a tourné)");
    assert.ok(
      fs.existsSync(path.join(brand, "package-lock.json")),
      "lock créé dans la marque, pas dans le faux kit",
    );
    assert.ok(
      !fs.existsSync(path.join(fakeKit, "package-lock.json")),
      "faux kit : aucun package-lock créé",
    );
    assert.equal(
      fs.readFileSync(sentinel, "utf8"),
      "DO_NOT_TOUCH\n",
      "node_modules/@creezio du faux kit intact après lock-only",
    );

    const kitVer = JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "packages/platform-core/package.json"),
        "utf8",
      ),
    ).version;
    const published = spawnSync(
      "npm",
      ["view", `@creezio/platform-core@${kitVer}`, "version"],
      { encoding: "utf8", timeout: 30_000 },
    );
    // PR changeset-release : lockstep pas encore sur npmjs (ETARGET).
    // L'isolation lock-only + sentinel est déjà prouvée ci-dessus.
    if (published.status !== 0) {
      console.log(
        `# skip U7 upgrade spawn : @creezio/platform-core@${kitVer} absent de npmjs (PR version)`,
      );
    } else {
      const up = spawnSync(
        process.execPath,
        [CLI, "upgrade", "--brand-root", brand],
        {
          encoding: "utf8",
          cwd: fakeKit,
          timeout: 120_000,
          env: {
            ...poisoned,
            CREEZIO_KIT_ROOT: ROOT,
          },
        },
      );
      assert.equal(
        up.status,
        0,
        `upgrade isolé a échoué:\n${up.stdout}\n${up.stderr}`,
      );
    }
    assert.equal(
      fs.readFileSync(sentinel, "utf8"),
      "DO_NOT_TOUCH\n",
      "fail-closed : upgrade d'une marque à côté d'un faux kit workspace ne touche pas son node_modules/@creezio",
    );
    assert.ok(
      fs.existsSync(
        path.join(fakeKit, "node_modules", "@creezio", "platform-core", "package.json"),
      ),
      "lien/package @creezio du faux kit toujours présent",
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
