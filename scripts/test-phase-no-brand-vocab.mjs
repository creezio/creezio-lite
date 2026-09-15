#!/usr/bin/env node
/**
 * Gate P1.a — pas de vocabulaire marque dans le kit (allowlist décroissante).
 *
 * Frontière absolue n°1 (AGENTS.md, ADR-no-brand-domain-in-native-packages) :
 * aucun vocabulaire de marque (tempoflow, certivan, fidu, winhub, foove,
 * TF2/TF3, chr-catalog, *fid) dans `packages/<pkg>/src` et
 * `packages/<pkg>/ui`. La dette héritée est matérialisée dans
 * `scripts/no-brand-vocab-allowlist.json` (fichier + pattern + compteur +
 * ticket d'audit F1.x/P1.x) — le compteur ne peut que DÉCROÎTRE :
 *
 *   - occurrence hors allowlist            → ROUGE (nouvelle dette interdite)
 *   - compteur réel > compteur allowlisté  → ROUGE (idem)
 *   - compteur réel < compteur allowlisté  → ROUGE (décrémenter l'entrée :
 *     node scripts/lib/brand-vocab.mjs --write-allowlist)
 *   - entrée sans occurrence               → ROUGE (entrée morte, la retirer)
 *
 * Exclusions : docs/ et *.md (hors périmètre du scan), fixtures marquées
 * legacy via entrées d'allowlist, et les répertoires `globalExclusions`
 * (ex. brand-config/src/manifests, ticket P1.d) dont l'existence est
 * vérifiée (exclusion morte = rouge aussi).
 *
 * SoT scanner + patterns : scripts/lib/brand-vocab.mjs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ALLOWLIST_PATH,
  BRAND_PATTERNS,
  ROOT,
  loadAllowlist,
  scanBrandVocab,
} from "./lib/brand-vocab.mjs";

const allow = loadAllowlist();
const scan = scanBrandVocab(allow.globalExclusions);

test("NV0 allowlist — structure saine (patterns connus, exclusions vivantes, pas de doublon)", () => {
  const knownPatterns = new Set(BRAND_PATTERNS.map((p) => p.id));
  const seen = new Set();
  for (const e of allow.entries) {
    assert.ok(
      knownPatterns.has(e.pattern),
      `allowlist : pattern inconnu « ${e.pattern} » (${e.file}) — patterns valides : ${[...knownPatterns].join(", ")}`,
    );
    assert.ok(
      Number.isInteger(e.count) && e.count > 0,
      `allowlist : compteur invalide pour ${e.file}::${e.pattern} (${e.count})`,
    );
    assert.ok(
      typeof e.ticket === "string" && e.ticket.length > 4,
      `allowlist : ticket d'audit manquant pour ${e.file}::${e.pattern}`,
    );
    const key = `${e.file}::${e.pattern}`;
    assert.ok(!seen.has(key), `allowlist : entrée dupliquée ${key}`);
    seen.add(key);
  }
  for (const ex of allow.globalExclusions) {
    assert.ok(
      typeof ex.ticket === "string" && ex.ticket.length > 4,
      `allowlist : globalExclusion sans ticket (${ex.dir})`,
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, ex.dir)),
      `allowlist : globalExclusion morte — ${ex.dir} n'existe plus, retirer l'exclusion de ${path.relative(ROOT, ALLOWLIST_PATH)}`,
    );
  }
});

test("NV1 aucune NOUVELLE occurrence de vocabulaire marque (hors allowlist)", () => {
  const allowed = new Map(allow.entries.map((e) => [`${e.file}::${e.pattern}`, e]));
  const fresh = [];
  for (const [key, r] of scan) {
    const entry = allowed.get(key);
    const excess = r.hits.length - (entry?.count ?? 0);
    if (excess <= 0) continue;
    const label = entry
      ? `${key} : ${r.hits.length} occurrence(s) pour ${entry.count} allowlistée(s)`
      : `${key} : ${r.hits.length} occurrence(s), AUCUNE allowlistée`;
    fresh.push(
      `${label}\n    ` +
        r.hits
          .slice(0, 4)
          .map((h) => `${r.file}:${h.line} — ${h.text}`)
          .join("\n    ") +
        (r.hits.length > 4 ? `\n    … (${r.hits.length} au total)` : ""),
    );
  }
  assert.equal(
    fresh.length,
    0,
    `vocabulaire marque NOUVEAU dans le kit (frontière n°1) :\n  ${fresh.join("\n  ")}\n` +
      `→ retirer le vocabulaire marque (envPrefix / AppManifest / bindings / BrandSpec). ` +
      `L'allowlist ${path.relative(ROOT, ALLOWLIST_PATH)} est un ratchet décroissant : on n'y AJOUTE rien.`,
  );
});

test("NV2 ratchet — l'allowlist décroît avec la dette (entrées mortes / compteurs gonflés)", () => {
  const stale = [];
  for (const e of allow.entries) {
    const key = `${e.file}::${e.pattern}`;
    const actual = scan.get(key)?.hits.length ?? 0;
    if (actual === 0) {
      stale.push(`${key} : plus aucune occurrence — retirer l'entrée (bravo)`);
    } else if (actual < e.count) {
      stale.push(`${key} : ${actual} occurrence(s) restante(s) pour ${e.count} allowlistée(s) — décrémenter`);
    }
  }
  assert.equal(
    stale.length,
    0,
    `dette réduite mais allowlist pas rétrécie :\n  ${stale.join("\n  ")}\n` +
      `→ node scripts/lib/brand-vocab.mjs --write-allowlist (rétrécit, ne peut rien ajouter), puis committer le JSON.`,
  );
});

test("NV4 P1.d — le kit ne publie plus de manifest de marque (manifests/ figé)", () => {
  // « Le kit ne connaît pas ses consommateurs » (docs/PROPAGATION.md).
  // H11 : seul demobrand (sandbox kit) reste. Tout autre
  // manifests/<marque>.ts est un retour en arrière : le manifest d'une
  // marque vit dans SON repo (src/electron/app-manifest.ts, factory).
  const manifestsDir = path.join(ROOT, "packages/brand-config/src/manifests");
  const allowed = new Set(["demobrand.ts"]);
  const actual = fs.readdirSync(manifestsDir).sort();
  const intruders = actual.filter((f) => !allowed.has(f));
  assert.deepEqual(
    intruders,
    [],
    `packages/brand-config/src/manifests/ : fichier(s) de manifest marque NOUVEAU(x) dans le kit — ` +
      `interdit depuis P1.d (matérialiser dans le repo marque via la factory) : ${intruders.join(", ")}`,
  );
});

test("NV3 sanity — le scanner voit bien la dette connue (anti-scanner-cassé)", () => {
  // Si le scanner se met à tout rater (regex/exclusions cassées), NV1/NV2
  // passeraient silencieusement au vert-menteur : on ancre un plancher.
  const total = [...scan.values()].reduce((n, r) => n + r.hits.length, 0);
  const allowedTotal = allow.entries.reduce((n, e) => n + e.count, 0);
  assert.ok(
    allow.entries.length === 0 || total >= Math.min(allowedTotal, 10),
    `scanner suspect : ${total} occurrences trouvées pour ${allowedTotal} allowlistées`,
  );
});
