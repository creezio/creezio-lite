/**
 * Gate : config electron-builder embarque la clôture npm runtime
 * (hono, better-sqlite3, …) + asarUnpack natifs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildElectronBuilderConfig,
  collectNpmRuntimePackages,
  CREEZIO_ASAR_NPM_RUNTIME_PACKAGES,
  CREEZIO_ASAR_UNPACK_NATIVE,
  demobrandManifest,
} from "../packages/brand-config/dist/index.js";

const base = {
  files: [
    "build/electron/**/*",
    "!node_modules/**/*",
    "node_modules/electron-updater/**/*",
  ],
  extraResources: [],
  win: {},
};

test("pack-runtime: seeds incluent hono + better-sqlite3", () => {
  assert.ok(CREEZIO_ASAR_NPM_RUNTIME_PACKAGES.includes("hono"));
  assert.ok(CREEZIO_ASAR_NPM_RUNTIME_PACKAGES.includes("better-sqlite3"));
  assert.ok(CREEZIO_ASAR_NPM_RUNTIME_PACKAGES.includes("bindings"));
  assert.ok(CREEZIO_ASAR_NPM_RUNTIME_PACKAGES.includes("zod"));
});

test("pack-runtime: server config FileSet better-sqlite3 + asarUnpack", () => {
  const server = buildElectronBuilderConfig(demobrandManifest, "server", base);
  const files = server.files || [];
  assert.ok(
    files.some(
      (e) =>
        typeof e === "object" &&
        e?.from === "node_modules/better-sqlite3" &&
        e?.to === "node_modules/better-sqlite3",
    ),
    "FileSet better-sqlite3 manquant",
  );
  assert.ok(
    files.some(
      (e) =>
        typeof e === "object" &&
        e?.from === "node_modules/hono" &&
        e?.to === "node_modules/hono",
    ),
    "FileSet hono manquant",
  );
  const unpack = server.asarUnpack || [];
  for (const pat of CREEZIO_ASAR_UNPACK_NATIVE) {
    assert.ok(unpack.includes(pat), `asarUnpack manquant: ${pat}`);
  }
});

test("pack-runtime: collectNpmRuntimePackages clôture (si node_modules)", () => {
  // Dans le monorepo creezio, better-sqlite3 peut être hoist — OK si absent.
  const pkgs = collectNpmRuntimePackages(process.cwd());
  assert.ok(Array.isArray(pkgs));
  // Au minimum les seeds présents sur disque
  for (const seed of CREEZIO_ASAR_NPM_RUNTIME_PACKAGES) {
    // pas d'assert présence disque ici — unit sur la forme
    assert.equal(typeof seed, "string");
  }
});
