#!/usr/bin/env node
/**
 * Gate D0 — fraîcheur documentaire (docs/DOC-STANDARD.md).
 *
 * Vérifie, pour chaque cible du périmètre (packages/*, docker/*, apps/*,
 * scripts/) :
 *   1. le trio README.md / AGENTS.md / docs/FILES.md est présent ;
 *   2. chaque fichier source apparaît dans le docs/FILES.md de sa cible
 *      (vérification format-agnostique : présence du chemin relatif).
 *
 * Mode vérification du générateur `scripts/generate-files-md.mjs` — la
 * définition « fichier source » et la liste des cibles y vivent (SoT unique).
 * Rattrapage en cas de rouge :
 *   node scripts/generate-files-md.mjs <cible>
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTarget, listTargets } from "./generate-files-md.mjs";

const targets = listTargets();

test("D0.0 périmètre non vide (packages + docker + apps + scripts)", () => {
  assert.ok(targets.length >= 30, `cibles trouvées : ${targets.length}`);
  assert.ok(targets.includes("scripts"));
  assert.ok(targets.some((t) => t.startsWith("packages/")));
  assert.ok(targets.some((t) => t.startsWith("docker/")));
});

for (const target of targets) {
  test(`D0 trio + FILES.md à jour — ${target}`, () => {
    const { missingDocs, missingFiles } = checkTarget(target);
    assert.deepEqual(
      missingDocs,
      [],
      `${target} : docs manquantes ${missingDocs.join(", ")} (trio README/AGENTS/docs/FILES.md — voir docs/DOC-STANDARD.md)`,
    );
    assert.deepEqual(
      missingFiles,
      [],
      `${target} : fichiers absents de docs/FILES.md → node scripts/generate-files-md.mjs ${
        target.startsWith("packages/") ? target.slice("packages/".length) : target
      }\n  ${missingFiles.join("\n  ")}`,
    );
  });
}
