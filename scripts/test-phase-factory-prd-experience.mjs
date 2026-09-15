#!/usr/bin/env node
/**
 * Gate expérience F5 — simulation agent « un prompt produit ».
 * Input = PROMPT-PRODUIT + PRD uniquement ; assert fichiers métier + smoke.
 *
 * Hors-ligne : `CREEZIO_SKIP_BRAND_DIST=1` (pas de `npm install --package-lock-only`)
 * + lien `node_modules` du kit (`scripts/lib/link-kit-node-modules.mjs`).
 * `--link-kit` ne suffit pas : il pinne `@creezio/*` en `file:` mais l'install
 * télécharge encore electron/typescript.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { linkKitNodeModulesForBrand } from "./lib/link-kit-node-modules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROMPT = path.join(
  ROOT,
  "docs/experiences/tempoflow3/PROMPT-PRODUIT.md",
);
const PRD = path.join(ROOT, "docs/experiences/tempoflow3/PRD-PRODUIT.md");
const CLI = path.join(ROOT, "packages/factory/bin/creezio.js");
const SMOKE_ENV = {
  ...process.env,
  CREEZIO_KIT_ROOT: ROOT,
  CREEZIO_ROOT: ROOT, // legacy compat (Q8)
  CREEZIO_SKIP_BRAND_DIST: "1",
  npm_config_offline: "true",
  npm_config_prefer_offline: "true",
  NODE_PATH: path.join(ROOT, "node_modules"),
  PATH: [
    path.join(ROOT, "node_modules", ".bin"),
    process.env.PATH || "",
  ].join(path.delimiter),
};

test("expérience: PROMPT-PRODUIT reste non technique", () => {
  const body = fs.readFileSync(PROMPT, "utf8");
  // Seul le bloc collable à l'agent doit rester non technique.
  const block = body.match(/```text\n([\s\S]*?)```/)?.[1] || "";
  assert.ok(block.length > 80, "bloc ```text``` du prompt manquant");
  assert.doesNotMatch(block, /host-stack|sync-vendor|P0–P12|allowlist|brand-runtime/i);
  assert.match(block, /fournisseurs/);
  assert.match(block, /PRD-PRODUIT/);
});

test("expérience: dry-run agent = new-app --from-prd seulement", () => {
  // L'agent produit n'a qu'une commande à connaître.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tf3-experience-"));
  const r = spawnSync(
    process.execPath,
    [CLI, "new-app", "--from-prd", PRD, "--out", outDir, "--force", "--no-push"],
    { encoding: "utf8", cwd: ROOT, env: SMOKE_ENV },
  );
  assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
  assert.match(
    r.stdout,
    /repos GitHub non créés \(--push pour les créer\)/,
  );

  const server = fs.existsSync(path.join(outDir, "server/package.json"))
    ? path.join(outDir, "server")
    : outDir;
  const modelPath = path.join(server, "product-model.json");
  assert.ok(fs.existsSync(modelPath), `product-model.json manquant (${modelPath})`);
  const model = JSON.parse(fs.readFileSync(modelPath, "utf8"));
  assert.equal(model.brandId, "tempoflow3");
  assert.ok(model.entities.some((e) => e.id === "fournisseurs"));
  assert.ok(model.entities.some((e) => e.id === "commandes"));

  const mainTs = fs.readFileSync(
    path.join(server, "src/electron/main.ts"),
    "utf8",
  );
  assert.match(mainTs, /startBrandDesktop/);
  assert.match(mainTs, /@creezio\/app-runtime/);
  assert.ok(
    fs.existsSync(path.join(server, "src/electron/brand-migrations.ts")),
    "brand-migrations manquant",
  );
  assert.ok(!fs.existsSync(path.join(server, "scripts/metier-api.mjs")));
  assert.ok(!fs.existsSync(path.join(server, "src/lib/host-stack.ts")));

  if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
    throw new Error(
      "node_modules kit absent — impossible de lier l'app générée pour tsc",
    );
  }
  const link = linkKitNodeModulesForBrand(outDir, ROOT);
  assert.ok(
    fs.existsSync(path.join(link.path, "@types/node")),
    "lien kit : @types/node introuvable (tsc hors-ligne impossible)",
  );

  const smoke = spawnSync(
    process.execPath,
    [path.join(server, "scripts/test-metier-parcours.mjs")],
    {
      encoding: "utf8",
      cwd: server,
      timeout: 120000,
      env: SMOKE_ENV,
    },
  );
  assert.equal(smoke.status, 0, smoke.stderr + "\n" + smoke.stdout);
  console.log("expérience 5/5: brief → app → parcours kernel OK");
});
