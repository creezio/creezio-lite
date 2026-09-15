#!/usr/bin/env node
/**
 * Gate — manifeste des packages kit publiés à jour.
 *
 * `packages/platform-core/kit-packages.json` doit refléter les packages
 * publiés réels (sinon les gates deps-integrity des apps valident contre
 * une liste stale). Rattrapage : `node scripts/generate-kit-packages.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  KIT_ROOT,
  MANIFEST_REL,
  listPublishedKitPackages,
} from "./generate-kit-packages.mjs";

test("kit-packages.json présent et à jour", () => {
  const manifestPath = path.join(KIT_ROOT, MANIFEST_REL);
  assert.ok(
    fs.existsSync(manifestPath),
    `${MANIFEST_REL} absent → node scripts/generate-kit-packages.mjs`,
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(
    manifest.packages,
    listPublishedKitPackages(),
    `${MANIFEST_REL} stale → node scripts/generate-kit-packages.mjs`,
  );
  assert.ok(
    manifest.packages.includes("@creezio/platform-core"),
    "le manifeste doit inclure platform-core (son hôte)",
  );
});