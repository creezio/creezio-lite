#!/usr/bin/env node
/**
 * Gate P1.a — manifests marque alignés (`@creezio/*`).
 *
 * Une marque générée porte des deps `@creezio/*` dans PLUSIEURS manifests
 * (`server/package.json`, `server/ui/package.json`, `client/package.json`).
 * Un bump partiel entre eux = CI verte, deploy vert, mais ancienne page
 * os-ui servie (incident réel login 0.6.0 — docs/PROPAGATION.md « Règle
 * d'or du bump côté apps »).
 *
 * Contrats gravés ici :
 *   1. le scaffold factory (`brand create`) génère des manifests dont TOUTES
 *      les specs `@creezio/*` sont identiques (lockstep `creezioDepSpec`) ;
 *   2. le doctor brand-spec (`doctorAppBrandSpec`) échoue fail-closed
 *      (`CREEZIO_MANIFEST_MISALIGNED`, level error) sur une app désalignée,
 *      et reste vert sur une app alignée.
 *
 * Prérequis : `packages/brand-spec/dist` buildé (npm run build:packages).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");

const SMOKE_ENV = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_SKIP_BRAND_DIST: "1",
  NODE_PATH: path.join(ROOT, "node_modules"),
};

/** Manifests d'une app marque susceptibles de porter des deps @creezio/*. */
const MANIFEST_RELS = [
  "package.json",
  "server/package.json",
  "server/ui/package.json",
  "client/package.json",
];

function collectCreezioSpecs(appDir) {
  const found = [];
  for (const rel of MANIFEST_RELS) {
    const p = path.join(appDir, rel);
    if (!fs.existsSync(p)) continue;
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    const merged = { ...pkg.dependencies, ...pkg.devDependencies };
    const specs = Object.fromEntries(
      Object.entries(merged).filter(([name]) => name.startsWith("@creezio/")),
    );
    if (Object.keys(specs).length) found.push({ rel, specs });
  }
  return found;
}

test("MA1 scaffold brand create — specs @creezio/* identiques dans tous les manifests", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-manifest-align-"));
  const appDir = path.join(work, "acme");
  const r = spawnSync(
    process.execPath,
    [
      CLI, "brand", "create",
      "--id", "acme",
      "--name", "Acme",
      "--domain", "acme.local",
      "--out", appDir,
      "--force", "--no-push",
    ],
    { encoding: "utf8", cwd: ROOT, env: SMOKE_ENV },
  );
  assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);

  const manifests = collectCreezioSpecs(appDir);
  assert.ok(
    manifests.length >= 3,
    `au moins server + server/ui + client attendus avec deps @creezio/* — trouvé : ${manifests.map((m) => m.rel).join(", ") || "(aucun)"}`,
  );
  assert.ok(
    manifests.some((m) => m.rel === "server/ui/package.json"),
    "server/ui/package.json sans deps @creezio/* — scaffold os-ui cassé",
  );

  const distinct = new Map(); // spec -> [ "rel:pkg", … ]
  for (const { rel, specs } of manifests) {
    for (const [name, spec] of Object.entries(specs)) {
      distinct.set(spec, [...(distinct.get(spec) ?? []), `${rel} → ${name}`]);
    }
  }
  assert.equal(
    distinct.size,
    1,
    `specs @creezio/* divergentes au scaffold (bump partiel garanti dès la naissance) :\n` +
      [...distinct.entries()]
        .map(([spec, uses]) => `  ${spec}\n    ${uses.slice(0, 5).join("\n    ")}${uses.length > 5 ? `\n    … (${uses.length} au total)` : ""}`)
        .join("\n") +
      `\n→ corriger la factory (creezioDepSpec est la SoT lockstep, packages/factory/src/kit-release.ts).`,
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MA2 doctor — CREEZIO_MANIFEST_MISALIGNED fail-closed sur bump partiel", async () => {
  const { doctorAppBrandSpec } = await import(
    "../packages/brand-spec/dist/index.js"
  );

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-manifest-doctor-"));
  const appDir = path.join(work, "acme");
  // App minimale : brand-spec + deux manifests portant @creezio/os-ui.
  fs.mkdirSync(path.join(appDir, "brand-spec/modules"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "brand-spec/brand.yaml"),
    'brandId: acme\nbrandName: Acme\ndomain: acme.local\n',
  );
  fs.writeFileSync(path.join(appDir, "brand-spec/product.md"), "# Acme\nProduit.\n");
  fs.mkdirSync(path.join(appDir, "server/ui"), { recursive: true });
  const writeManifest = (rel, spec) =>
    fs.writeFileSync(
      path.join(appDir, rel),
      JSON.stringify(
        {
          name: rel === "server/package.json" ? "acme-server" : "@creezio/brand-ui",
          dependencies: { "@creezio/os-ui": spec, "@creezio/platform-core": "^0.10.14" },
        },
        null,
        2,
      ),
    );

  // Désaligné : os-ui bumpé côté serveur seulement (scénario incident 0.6.0).
  writeManifest("server/package.json", "^0.10.14");
  writeManifest("server/ui/package.json", "^0.6.0");
  const bad = doctorAppBrandSpec(appDir);
  const misaligned = bad.issues.filter((i) => i.code === "CREEZIO_MANIFEST_MISALIGNED");
  assert.equal(
    misaligned.length,
    1,
    `doctor devait rapporter 1 CREEZIO_MANIFEST_MISALIGNED (os-ui), issues : ${JSON.stringify(bad.issues)}`,
  );
  assert.equal(misaligned[0].level, "error", "désalignement = error (fail-closed), pas warn");
  assert.match(misaligned[0].message, /@creezio\/os-ui/);
  assert.match(misaligned[0].message, /PROPAGATION/);
  assert.equal(bad.ok, false, "doctor.ok doit être false sur app désalignée");

  // Aligné : plus d'issue de désalignement (les autres codes, ex. NO_MODULES,
  // ne concernent pas cette gate).
  writeManifest("server/ui/package.json", "^0.10.14");
  const good = doctorAppBrandSpec(appDir);
  assert.equal(
    good.issues.filter((i) => i.code === "CREEZIO_MANIFEST_MISALIGNED").length,
    0,
    `faux positif : app alignée signalée désalignée — ${JSON.stringify(good.issues)}`,
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MA3 source — le check est câblé dans doctorBrandSpec (anti-régression)", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "packages/brand-spec/src/doctor.ts"),
    "utf8",
  );
  assert.match(src, /CREEZIO_MANIFEST_MISALIGNED/, "code finding retiré de doctor.ts");
  assert.match(
    src,
    /doctorCreezioManifestAlignment\(spec\.rootDir, issues\)/,
    "doctorCreezioManifestAlignment n'est plus appelé par doctorBrandSpec",
  );
  assert.match(
    src,
    /doctorOsUiPageDeps\(spec\.rootDir, issues\)/,
    "doctorOsUiPageDeps n'est plus appelé par doctorBrandSpec",
  );
});

/**
 * Fixture app minimale pour les checks deps des pages os-ui : brand-spec +
 * server/ui/package.json. `uiDeps` = deps @creezio/* déclarées côté UI.
 */
function makeOsUiDepsFixture(work, uiDeps, appName = "acme") {
  const appDir = path.join(work, appName);
  fs.mkdirSync(path.join(appDir, "brand-spec/modules"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "brand-spec/brand.yaml"),
    "brandId: acme\nbrandName: Acme\ndomain: acme.local\n",
  );
  fs.writeFileSync(path.join(appDir, "brand-spec/product.md"), "# Acme\nProduit.\n");
  fs.mkdirSync(path.join(appDir, "server/ui"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "server/ui/package.json"),
    JSON.stringify({ name: "@creezio/brand-ui", dependencies: uiDeps }, null, 2),
  );
  return appDir;
}

test("MA4 doctor — page os-ui matérialisée sans la dep dans server/ui = ERROR", async () => {
  const { doctorAppBrandSpec } = await import(
    "../packages/brand-spec/dist/index.js"
  );
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-os-ui-deps-"));
  // Incident prod 0.20.0 rejoué : la page /granola est matérialisée (importe
  // @creezio/granola/ui) mais server/ui/package.json ne déclare pas la dep.
  const appDir = makeOsUiDepsFixture(work, { "@creezio/os-ui": "^0.20.0" });
  const pageDir = path.join(appDir, "server/ui/app/(creezio-os)/granola");
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(
    path.join(pageDir, "page.tsx"),
    '"use client";\nimport { GranolaClient } from "@creezio/granola/ui";\nexport default function Page() { return <GranolaClient />; }\n',
  );

  const bad = doctorAppBrandSpec(appDir);
  const missing = bad.issues.filter((i) => i.code === "OS_UI_PAGE_DEP_MISSING");
  assert.equal(
    missing.length,
    1,
    `doctor devait rapporter OS_UI_PAGE_DEP_MISSING : ${JSON.stringify(bad.issues)}`,
  );
  assert.equal(missing[0].level, "error", "dep de page os-ui absente = error, pas warn");
  assert.match(missing[0].message, /@creezio\/granola/);
  assert.match(missing[0].message, /creezio upgrade/);
  assert.equal(bad.ok, false, "doctor.ok doit être false (build UI cassé)");

  // Dep déclarée → l'erreur disparaît.
  const good = makeOsUiDepsFixture(work, {
    "@creezio/os-ui": "^0.20.0",
    "@creezio/granola": "^0.20.0",
  });
  fs.mkdirSync(path.join(good, "server/ui/app/(creezio-os)/granola"), { recursive: true });
  fs.writeFileSync(
    path.join(good, "server/ui/app/(creezio-os)/granola/page.tsx"),
    '"use client";\nimport { GranolaClient } from "@creezio/granola/ui";\nexport default function Page() { return <GranolaClient />; }\n',
  );
  const goodRes = doctorAppBrandSpec(good);
  assert.equal(
    goodRes.issues.filter((i) => i.code === "OS_UI_PAGE_DEP_MISSING").length,
    0,
    `faux positif après ajout de la dep : ${JSON.stringify(goodRes.issues)}`,
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MA5 doctor — source = @creezio/os-ui INSTALLÉ (avant matérialisation) + skip explicite", async () => {
  const { doctorAppBrandSpec } = await import(
    "../packages/brand-spec/dist/index.js"
  );
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-os-ui-inst-"));
  // Pas de pages matérialisées, mais le package os-ui installé embarque une
  // route /grokbot : c'est ce que la PROCHAINE matérialisation produira —
  // le check mord avant le build (c'est ce qui aurait attrapé l'incident).
  const appDir = makeOsUiDepsFixture(work, { "@creezio/os-ui": "^0.20.0" });
  const routesDir = path.join(appDir, "server/ui/node_modules/@creezio/os-ui/routes/grokbot");
  fs.mkdirSync(routesDir, { recursive: true });
  fs.writeFileSync(
    path.join(routesDir, "page.tsx"),
    '"use client";\nimport { GrokbotClient } from "@creezio/grokbot/ui";\nexport default function Page() { return <GrokbotClient />; }\n',
  );
  const bad = doctorAppBrandSpec(appDir);
  const missing = bad.issues.filter((i) => i.code === "OS_UI_PAGE_DEP_MISSING");
  assert.equal(missing.length, 1, JSON.stringify(bad.issues));
  assert.match(missing[0].message, /@creezio\/grokbot/);

  // Ni pages matérialisées ni os-ui installé → skip EXPLICITE (info), jamais silencieux.
  const bare = makeOsUiDepsFixture(work, { "@creezio/os-ui": "^0.20.0" }, "acmebare");
  const bareRes = doctorAppBrandSpec(bare);
  const skip = bareRes.issues.filter((i) => i.code === "OS_UI_DEPS_UNCHECKED");
  assert.equal(skip.length, 1, JSON.stringify(bareRes.issues));
  assert.equal(skip[0].level, "info", "skip = info explicite, pas error");
  fs.rmSync(work, { recursive: true, force: true });
});
