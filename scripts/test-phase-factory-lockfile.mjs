/**
 * Gate — cohérence package-lock marque (Docker npm ci).
 *
 * Empêche la régression « marque neuve → docker build lock incohérent →
 * agents cassent server/node_modules symlink ».
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadLockHelpers() {
  const dist = path.join(ROOT, "packages/factory/dist/package-lock.js");
  const src = path.join(ROOT, "packages/factory/src/package-lock.ts");
  if (fs.existsSync(dist)) {
    return import(pathToFileURL(dist).href);
  }
  // Dev sans dist : transpile via tsx si dispo, sinon skip soft impossible —
  // la gate kit exige le build factory (comme les autres gates factory).
  assert.ok(
    fs.existsSync(dist) || fs.existsSync(src),
    "packages/factory/src/package-lock.ts manquant",
  );
  assert.ok(
    fs.existsSync(dist),
    "packages/factory/dist/package-lock.js absent — npm run build -w @creezio/factory",
  );
}

test("isPackageLockInSync : match / mismatch / absent", async () => {
  const { isPackageLockInSync } = await loadLockHelpers();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-lock-"));
  try {
    const pkgPath = path.join(dir, "package.json");
    const lockPath = path.join(dir, "package-lock.json");
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({
        name: "probe",
        dependencies: { hono: "^4.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    assert.equal(isPackageLockInSync(pkgPath), false, "sans lock → false");

    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: { hono: "^4.0.0" },
            // manque typescript
          },
        },
      }),
    );
    assert.equal(
      isPackageLockInSync(pkgPath),
      false,
      "devDep manquante dans lock → false",
    );

    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: { hono: "^4.0.0" },
            devDependencies: { typescript: "^5.0.0" },
          },
        },
      }),
    );
    assert.equal(isPackageLockInSync(pkgPath), true, "lock aligné → true");

    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: { hono: "^3.0.0" },
            devDependencies: { typescript: "^5.0.0" },
          },
        },
      }),
    );
    assert.equal(
      isPackageLockInSync(pkgPath),
      false,
      "version déclarée différente → false",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Dockerfile : npm ci strict + secret BuildKit (mode npm)", () => {
  const df = fs.readFileSync(
    path.join(ROOT, "docker/server/Dockerfile"),
    "utf8",
  );
  assert.match(df, /npm ci --omit=dev/);
  assert.match(df, /--mount=type=secret,id=CREEZIO_NPM_TOKEN/);
  assert.doesNotMatch(df, /fallback npm install/);
  assert.doesNotMatch(df, /COPY vendor/);
});

test("push GitHub + ensureBrandStandalone régénèrent le lock", () => {
  const gh = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/github-repos.ts"),
    "utf8",
  );
  assert.match(gh, /prepareBrandDistribution/);

  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(cli, /ensureBrandPackageLocks/);
  assert.match(cli, /isPackageLockInSync/);
  assert.match(cli, /mode: "install"/);
});

test("new-app / brand apply appellent prepareBrandDistribution", () => {
  const mainCli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/cli.ts"),
    "utf8",
  );
  assert.match(mainCli, /prepareBrandDistribution/);
  const brandCli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/brand-cli.ts"),
    "utf8",
  );
  assert.match(brandCli, /prepareBrandDistribution/);
});

test("ensure-server-lock.mjs autonome (syntaxe + contrat)", () => {
  const script = path.join(ROOT, "docker/server/ensure-server-lock.mjs");
  assert.ok(fs.existsSync(script));
  const check = spawnSync(process.execPath, ["--check", script], {
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
  const src = fs.readFileSync(script, "utf8");
  assert.match(src, /package-lock-only/);
  assert.doesNotMatch(src, /ln -sfn.*node_modules|renameSync.*node_modules/);
});

test("prepareBrandDistribution produit le lock racine workspace (mode npm)", async (t) => {
  const { isPackageLockInSync } = await loadLockHelpers();
  const prepMod = await import(
    pathToFileURL(
      path.join(ROOT, "packages/factory/dist/prepare-brand-distribution.js"),
    ).href,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-prep-"));
  try {
    // Marque minimale npm : orchestrateur racine (workspaces [server]) +
    // livrable server/ avec une dep npm publique (registre requis).
    const server = path.join(dir, "server");
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "prep-probe",
        private: true,
        type: "module",
        workspaces: ["server"],
      }),
    );
    fs.writeFileSync(
      path.join(server, "package.json"),
      JSON.stringify({
        name: "@creezio/app-prep",
        private: true,
        type: "module",
        dependencies: { ms: "^2.1.3" },
      }),
    );
    const hasNetwork = (() => {
      const ping = spawnSync("npm", ["view", "ms", "version"], {
        encoding: "utf8",
      });
      return ping.status === 0;
    })();
    if (!hasNetwork) {
      t.skip("registre npm injoignable — lock-only non testé ici");
      return;
    }
    const r = prepMod.prepareBrandDistribution(dir, {
      log: () => {},
    });
    const rootLock = path.join(dir, "package-lock.json");
    assert.ok(
      isPackageLockInSync(path.join(dir, "package.json"), rootLock),
      "lock racine absent/incohérent après prepare",
    );
    assert.ok(
      isPackageLockInSync(path.join(server, "package.json"), rootLock, "server"),
      "entrée packages[server] du lock racine incohérente après prepare",
    );
    assert.ok(
      !fs.existsSync(path.join(server, "package-lock.json")),
      "pas de lock server/ propre en mode workspace (SoT = racine)",
    );
    assert.ok(r.locksRefreshed.length >= 1, "prepare n'a rien régénéré");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push GitHub : locks préparés sur les DEUX repos (marque + admin)", () => {
  const gh = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/github-repos.ts"),
    "utf8",
  );
  // Régression vécue (foove2-admin, 2026-08-13) : maybePushBrandRepos ne
  // préparait les locks que du monorepo marque → repo admin poussé sans
  // package-lock.json.
  assert.match(gh, /prepareBrandDistribution\(o\.outDir/);
  assert.match(gh, /prepareBrandDistribution\(o\.adminDir/);
});

test("maybePushBrandRepos --no-push produit les locks marque ET admin", async (t) => {
  const hasNetwork = (() => {
    const ping = spawnSync("npm", ["view", "ms", "version"], {
      encoding: "utf8",
    });
    return ping.status === 0;
  })();
  if (!hasNetwork) {
    t.skip("registre npm injoignable — lock-only non testé ici");
    return;
  }
  const { maybePushBrandRepos } = await import(
    pathToFileURL(path.join(ROOT, "packages/factory/dist/github-repos.js")).href,
  );
  const { isPackageLockInSync } = await loadLockHelpers();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-push-locks-"));
  try {
    // Arbres minimaux npm : racine workspace + server/ (dep publique).
    for (const dir of [path.join(tmp, "brandx"), path.join(tmp, "brandx-admin")]) {
      fs.mkdirSync(path.join(dir, "server"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: `${path.basename(dir)}-probe`,
          private: true,
          type: "module",
          workspaces: ["server"],
        }),
      );
      fs.writeFileSync(
        path.join(dir, "server", "package.json"),
        JSON.stringify({
          name: `@creezio/app-${path.basename(dir)}`,
          private: true,
          type: "module",
          dependencies: { ms: "^2.1.3" },
        }),
      );
    }
    const outDir = path.join(tmp, "brandx");
    const adminDir = path.join(tmp, "brandx-admin");
    const res = await maybePushBrandRepos({
      outDir,
      adminDir,
      brandId: "brandx",
      productName: "BrandX",
      noPush: true,
      log: () => {},
    });
    assert.equal(res, null, "--no-push ne crée aucun repo");
    for (const dir of [outDir, adminDir]) {
      const lock = path.join(dir, "package-lock.json");
      assert.ok(fs.existsSync(lock), `lock racine manquant: ${dir}`);
      assert.ok(
        isPackageLockInSync(path.join(dir, "package.json"), lock),
        `lock racine incohérent: ${dir}`,
      );
      assert.ok(
        isPackageLockInSync(
          path.join(dir, "server", "package.json"),
          lock,
          "server",
        ),
        `entrée packages[server] incohérente: ${dir}`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("link-kit : helpers kit-release + CLI + gates scaffold", async () => {
  const kitRelease = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/kit-release.ts"),
    "utf8",
  );
  assert.match(kitRelease, /export function isLinkKitEnabled/);
  assert.match(kitRelease, /export function creezioLinkKitFileSpecs/);
  const lockSrc = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/package-lock.ts"),
    "utf8",
  );
  assert.match(lockSrc, /pinCreezioDepsToKitWorktree/);
  assert.match(lockSrc, /isLinkKitEnabled/);
  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/cli.ts"),
    "utf8",
  );
  assert.match(cli, /--link-kit/);
  const brandCli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/brand-cli.ts"),
    "utf8",
  );
  assert.match(brandCli, /--link-kit/);
  // Les gates scaffold ne doivent jamais dépendre du registre npm : soit
  // --link-kit (install depuis le worktree), soit CREEZIO_SKIP_BRAND_DIST=1
  // (structure seule, node_modules hoisté du kit — contrat hors-ligne T12).
  for (const file of [
    "scripts/test-phase-os-ui-scaffold.mjs",
    "scripts/test-phase-factory-two-repos.mjs",
    "scripts/test-phase-factory-prd-experience.mjs",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(
      /--link-kit/.test(src) || /CREEZIO_SKIP_BRAND_DIST/.test(src),
      `${file} doit passer --link-kit ou CREEZIO_SKIP_BRAND_DIST=1 (pas de registre npm)`,
    );
  }
  const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /CREEZIO_LINK_KIT/);
  const { creezioLinkKitFileSpecs, isLinkKitEnabled } = await import(
    pathToFileURL(path.join(ROOT, "packages/factory/dist/kit-release.js")).href,
  );
  assert.equal(isLinkKitEnabled(true), true);
  assert.equal(isLinkKitEnabled(false), false);
  const specs = creezioLinkKitFileSpecs(ROOT);
  assert.ok(specs["@creezio/platform-core"]?.startsWith("file:"));
  assert.ok(specs["@creezio/os-ui"]?.startsWith("file:"));
  assert.ok(specs["@creezio/factory"]?.startsWith("file:"));
});

test("link-kit : npm install d'une version ABSENTE du registre", async () => {
  const dist = path.join(ROOT, "packages/factory/dist/package-lock.js");
  assert.ok(fs.existsSync(dist), "build factory requis");
  const { ensureBrandPackageLocks, isPackageLockInSync } = await import(
    pathToFileURL(dist).href,
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-linkkit-unpub-"));
  try {
    const server = path.join(dir, "server");
    fs.mkdirSync(server, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: "unpub-probe",
        private: true,
        type: "module",
        workspaces: ["server"],
      }),
    );
    const unpublished = "^99.0.0";
    fs.writeFileSync(
      path.join(server, "package.json"),
      JSON.stringify({
        name: "@creezio/app-unpub",
        private: true,
        type: "module",
        dependencies: {
          "@creezio/platform-core": unpublished,
          ms: "^2.1.3",
        },
      }),
    );
    const r = ensureBrandPackageLocks(dir, {
      mode: "lock-only",
      kitRoot: ROOT,
      linkKit: true,
      log: () => {},
    });
    assert.ok(r.refreshed.length >= 1, "link-kit n'a rien régénéré");
    const srvPkg = JSON.parse(
      fs.readFileSync(path.join(server, "package.json"), "utf8"),
    );
    assert.equal(
      srvPkg.dependencies["@creezio/platform-core"],
      unpublished,
      "manifest restauré en ^lockstep (pas file: commité)",
    );
    assert.ok(
      !srvPkg.overrides,
      "overrides file: temporaires retirés après install",
    );
    const rootLock = path.join(dir, "package-lock.json");
    assert.ok(fs.existsSync(rootLock), "lock racine absent après link-kit");
    // Après restore, package.json = ^99.0.0 et le lock a file: — le
    // contrat name-level : le lock existe et npm a réussi.
    assert.ok(
      JSON.parse(fs.readFileSync(rootLock, "utf8")).packages,
      "lock vide",
    );
    // Pendant le pin, le sync file:↔file: a déjà été validé. Ici on
    // vérifie juste que le restore n'a pas cassé le JSON.
    assert.equal(typeof srvPkg.dependencies.ms, "string");
    assert.equal(
      isPackageLockInSync(path.join(dir, "package.json"), rootLock),
      true,
      "lock racine (workspaces, zéro dep directe) aligné",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
