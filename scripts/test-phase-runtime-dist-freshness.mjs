/**
 * Gate — dist runtime critiques = câblage source (anti dist stale).
 *
 * Généralise ADR.1b (Admin Database) : contrats src↔dist + fraîcheur par contenu (src-hash)
 * sur app-runtime, database, mcp-facade, api-kernel, etc.
 *
 * Empêche la récidive « mount en source → vendor/image sans routes ».
 * SoT logique : scripts/lib/assert-runtime-dist.mjs (aussi appelé par
 * sync-creezio-vendor.sh et creezio server-docker publish/build).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CONTENT_CONTRACTS,
  FRESHNESS_PACKAGES,
  assertContentContracts,
  assertSrcHashFreshness,
  assertRuntimeDist,
} from "./lib/assert-runtime-dist.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ADR.1b-gen content contracts src↔dist (runtime critique)", () => {
  assert.ok(
    CONTENT_CONTRACTS.length >= 8,
    "au moins les contrats app-runtime/database/api-kernel/mcp-facade",
  );
  assert.ok(
    CONTENT_CONTRACTS.some((c) => c.id.startsWith("ADR.1b")),
    "contrats ADR.1b Admin Database conservés",
  );
  const r = assertContentContracts(root);
  assert.equal(
    r.ok,
    true,
    r.errors.join("\n") || "content contracts KO",
  );
});

test("ADR.1b-gen src-hash freshness packages runtime", () => {
  assert.ok(
    FRESHNESS_PACKAGES.includes("app-runtime"),
    "app-runtime dans FRESHNESS_PACKAGES",
  );
  assert.ok(
    FRESHNESS_PACKAGES.includes("database"),
    "database dans FRESHNESS_PACKAGES",
  );
  const r = assertSrcHashFreshness(root);
  assert.equal(
    r.ok,
    true,
    r.errors.join("\n") || "src-hash freshness KO",
  );
});

test("ADR.1b-gen assertRuntimeDist agrégé + CLI exportée", () => {
  const r = assertRuntimeDist(root);
  assert.equal(r.ok, true, r.errors.join("\n") || "assertRuntimeDist KO");
});
