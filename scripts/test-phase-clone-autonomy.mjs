/**
 * Gate — clone autonome des repos marque (distribution npm sans kit).
 *
 * Modèle npm (docs/NPM-DISTRIBUTION.md) : un monorepo marque poussé sur
 * GitHub doit être utilisable par un clone qui n'a PAS le kit checké out :
 *   1. deps @creezio/* = versions npm publiées (`^<lockstep>`), zéro vendor,
 *      zéro `file:`, zéro symlink node_modules/vendor tracké ;
 *   2. `.npmrc` commité vers npmjs.org (aucun token) à la
 *      racine + projets npm indépendants (server/ui, client) ;
 *   3. scripts/ensure-server-lock.mjs : locks alignés avant docker build ;
 *   4. docker/server.Dockerfile + .dockerignore matérialisés (docker build
 *      sans CREEZIO_KIT_ROOT, token via secret BuildKit) ;
 *   5. la factory génère des apps qui embarquent ces artefacts d'office.
 *
 * La partie marque historique (tempoflow3 vendor-era) est remplacée par la
 * gate brand-side `server/scripts/test-clone-autonomy.mjs` (npm) — ici on
 * vérifie le kit + le scaffold factory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCKER_SERVER = path.join(ROOT, "docker/server");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");

/** Deps @creezio/* d'un package.json → [{ name, spec }]. */
function creezioDeps(pkgJsonPath) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  const out = [];
  for (const field of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(pkg[field] || {})) {
      if (name.startsWith("@creezio/")) out.push({ name, spec: String(spec) });
    }
  }
  return out;
}

/** Anti-vendor + deps npm semver sur un package.json. */
function assertNpmDeps(pkgJsonPath, label, { min = 1 } = {}) {
  const deps = creezioDeps(pkgJsonPath);
  assert.ok(
    deps.length >= min,
    `${label}: deps @creezio/* attendues (${deps.length} < ${min})`,
  );
  for (const d of deps) {
    assert.match(
      d.spec,
      /^\^\d+\.\d+\.\d+$/,
      `${label}: ${d.name} doit être une version npm ^x.y.z (reçu: ${d.spec})`,
    );
  }
  const raw = fs.readFileSync(pkgJsonPath, "utf8");
  assert.doesNotMatch(
    raw,
    /file:(\.\.\/)?vendor/,
    `${label}: dep file:vendor résiduelle`,
  );
}

/** .npmrc commité : registre @creezio → npmjs.org, aucun token. */
function assertNpmrc(npmrcPath, label) {
  assert.ok(fs.existsSync(npmrcPath), `${label}: .npmrc manquant`);
  const body = fs.readFileSync(npmrcPath, "utf8");
  assert.match(
    body,
    /@creezio:registry=https:\/\/registry\.npmjs\.org/,
    `${label}: .npmrc doit pointer registry.npmjs.org`,
  );
  assert.doesNotMatch(
    body,
    /npm\.pkg\.github\.com/,
    `${label}: .npmrc encore GitHub Packages`,
  );
  assert.doesNotMatch(
    body,
    /CREEZIO_NPM_TOKEN/,
    `${label}: .npmrc ne doit plus exiger CREEZIO_NPM_TOKEN`,
  );
  assert.doesNotMatch(
    body,
    /_authToken=gh[ps]_/,
    `${label}: token en clair dans .npmrc !`,
  );
}

test("kit : artefacts distribution autonome npm (SoT docker/server/)", () => {
  // Scripts vendor retirés (remplacés par npm install + ensure-server-lock).
  for (const gone of [
    "stage-client-vendor.mjs",
    "install-server-deps.mjs",
  ]) {
    assert.ok(
      !fs.existsSync(path.join(DOCKER_SERVER, gone)),
      `docker/server/${gone} aurait dû être supprimé (mode npm)`,
    );
  }
  assert.ok(
    !fs.existsSync(path.join(ROOT, "scripts/sync-creezio-vendor.sh")),
    "scripts/sync-creezio-vendor.sh aurait dû être supprimé (mode npm)",
  );

  // Pré-flight lockfiles npm (workspaces racine + ui/client).
  const ensure = path.join(DOCKER_SERVER, "ensure-server-lock.mjs");
  assert.ok(fs.existsSync(ensure), "docker/server/ensure-server-lock.mjs manquant");
  const check = spawnSync(process.execPath, ["--check", ensure], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, `ensure-server-lock.mjs invalide: ${check.stderr}`);
  const ensureBody = fs.readFileSync(ensure, "utf8");
  assert.match(ensureBody, /lockKey/, "ensure-server-lock sans support workspace");
  assert.doesNotMatch(
    ensureBody,
    /file:vendor|vendor\/creezio|COPY vendor/,
    "ensure-server-lock encore vendor",
  );

  // Dockerfile npm : secret BuildKit, pas de COPY vendor.
  const dockerfile = fs.readFileSync(
    path.join(DOCKER_SERVER, "Dockerfile"),
    "utf8",
  );
  assert.match(
    dockerfile,
    /--mount=type=secret,id=CREEZIO_NPM_TOKEN/,
    "Dockerfile sans secret BuildKit CREEZIO_NPM_TOKEN",
  );
  assert.match(dockerfile, /npm ci/, "Dockerfile sans npm ci");
  assert.doesNotMatch(dockerfile, /COPY vendor/, "Dockerfile COPY vendor résiduel");
  assert.doesNotMatch(dockerfile, /server-deps/, "Dockerfile server-deps résiduel");

  // .dockerignore v5 sans exception vendor.
  const ignore = fs.readFileSync(
    path.join(DOCKER_SERVER, "brand.dockerignore"),
    "utf8",
  );
  assert.match(ignore, /creezio-dockerignore v5/, "dockerignore pas v5");
  assert.doesNotMatch(ignore, /!vendor\//, "dockerignore exception vendor résiduelle");

  // La factory connaît le spec npm lockstep + le .npmrc généré.
  const kitRelease = path.join(ROOT, "packages/factory/src/kit-release.ts");
  assert.ok(fs.existsSync(kitRelease), "factory kit-release.ts manquant");
  const kitReleaseBody = fs.readFileSync(kitRelease, "utf8");
  assert.match(kitReleaseBody, /renderCreezioNpmrc/, "kit-release sans renderCreezioNpmrc");
  assert.match(kitReleaseBody, /creezioNpmDeps/, "kit-release sans creezioNpmDeps");

  // Le push GitHub factory garantit des locks régénérés (repo autonome).
  const gh = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/github-repos.ts"),
    "utf8",
  );
  assert.match(
    gh,
    /prepareBrandDistribution/,
    "push GitHub sans prepareBrandDistribution (locks npm)",
  );
});

test("factory : new-app génère une app npm autonome (zéro vendor)", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-clone-probe-"));
  const appDir = path.join(out, "cloneprobe");
  try {
    const r = spawnSync(
      process.execPath,
      [
        CLI,
        "new-app",
        "--name",
        "CloneProbe",
        "--id",
        "cloneprobe",
        "--domain",
        "cloneprobe.creez.io",
        "--out",
        appDir,
        "--force",
        "--no-push",
      ],
      {
        encoding: "utf8",
        // Skip la régénération de locks (réseau registre) : on vérifie les
        // artefacts scaffold. La prep réelle est gateée dans
        // test-phase-factory-lockfile.
        env: {
          ...process.env,
          CREEZIO_KIT_ROOT: ROOT,
          CREEZIO_SKIP_BRAND_DIST: "1",
        },
      },
    );
    assert.equal(r.status, 0, `new-app a échoué:\n${r.stdout}\n${r.stderr}`);

    // Artefacts npm matérialisés.
    for (const f of [
      "scripts/ensure-server-lock.mjs",
      "docker/server.Dockerfile",
      ".dockerignore",
      ".npmrc",
      "client/.npmrc",
    ]) {
      assert.ok(fs.existsSync(path.join(appDir, f)), `app générée: ${f} manquant`);
    }
    // Plus aucun artefact vendor.
    for (const gone of [
      "scripts/stage-client-vendor.mjs",
      "scripts/install-server-deps.mjs",
      "vendor",
      "server/vendor",
      "client/vendor",
      "server/node_modules",
    ]) {
      assert.ok(
        !fs.existsSync(path.join(appDir, gone)),
        `app générée: ${gone} ne devrait pas exister (mode npm)`,
      );
    }
    assertNpmrc(path.join(appDir, ".npmrc"), "app générée (racine)");
    assertNpmrc(path.join(appDir, "client/.npmrc"), "app générée (client)");

    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(appDir, "package.json"), "utf8"),
    );
    assert.deepEqual(
      rootPkg.workspaces,
      ["server"],
      "app générée: workspaces racine [server]",
    );
    assert.ok(
      !rootPkg.scripts?.bootstrap,
      "app générée: script bootstrap vendor résiduel",
    );
    assert.ok(
      !rootPkg.scripts?.["install:server-deps"],
      "app générée: script install:server-deps résiduel",
    );
    assert.match(
      rootPkg.scripts?.["docker:build"] || "",
      /ensure-server-lock\.mjs/,
      "app générée: docker:build sans ensure-server-lock",
    );
    assert.match(
      rootPkg.scripts?.["docker:build"] || "",
      /--secret id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN/,
      "app générée: docker:build sans secret BuildKit",
    );
    assert.ok(
      !rootPkg.creezio?.kitVendor,
      "app générée: creezio.kitVendor résiduel",
    );

    // Deps npm semver dans les livrables.
    assertNpmDeps(path.join(appDir, "server/package.json"), "server", {
      min: 10,
    });
    assertNpmDeps(path.join(appDir, "client/package.json"), "client", {
      min: 5,
    });

    const readme = fs.readFileSync(path.join(appDir, "README.md"), "utf8");
    assert.match(readme, /Clone autonome/, "README sans section clone autonome");
    assert.match(readme, /registry\.npmjs\.org/, "README clone sans npmjs.org");
    assert.doesNotMatch(readme, /CREEZIO_NPM_TOKEN/, "README clone encore CREEZIO_NPM_TOKEN requis");
    assert.doesNotMatch(readme, /vendor\/creezio/, "README encore vendor");

    // Workflows CI/CD npm (plus de kit-compat / vendor-update).
    const ci = fs.readFileSync(
      path.join(appDir, ".github/workflows/ci.yml"),
      "utf8",
    );
    assert.doesNotMatch(ci, /CREEZIO_NPM_TOKEN/, "ci.yml encore CREEZIO_NPM_TOKEN requis");
    assert.match(ci, /npm ci/, "ci.yml sans npm ci");
    assert.doesNotMatch(
    ci,
    /vendor\/creezio|file:vendor|kit-compat|vendor-update|install:server-deps/,
    "ci.yml encore vendor",
  );
    assert.ok(
      fs.existsSync(path.join(appDir, ".github/workflows/deploy.yml")),
      "deploy.yml manquant",
    );
    for (const gone of ["kit-compat.yml", "vendor-update.yml"]) {
      assert.ok(
        !fs.existsSync(path.join(appDir, ".github/workflows", gone)),
        `app générée: ${gone} ne devrait plus être généré`,
      );
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
