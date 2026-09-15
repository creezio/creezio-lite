#!/usr/bin/env node
/**
 * Codemod H9 — contrat de module importé du kit (P2.c, audit F3.4).
 *
 * Usage (contrat scripts/codemods/README.md) :
 *   ROOT=<racine du clone marque> node h9-import-module-contract.mjs
 *
 * `BrandModuleDef` n'est plus une copie owned-by-brand : la SoT vit dans
 * `@creezio/app-runtime` (doctor `MODULE_TYPES_DIVERGENT` fail-closed).
 * Ce codemod :
 *
 *   1. remplace `src/electron/modules/types.ts` (layouts `server/` et plat)
 *      par le ré-export canonique kit — REFUSÉ (exit 1, marque intacte) si
 *      le fichier local déclare des champs ou exports inconnus du contrat
 *      kit (divergence à arbitrer à la main, jamais écrasée en silence) ;
 *   2. pose `accessJustification: "à qualifier"` sur chaque apiMount
 *      manuscrit sans `permission` ni `accessJustification` (règle d'or
 *      n°7 — le doctor warn `MODULE_PERMISSION_UNQUALIFIED` dessus, on
 *      n'invente JAMAIS une permission).
 *
 * Idempotent : relancer sur une marque déjà migrée = no-op (exit 0, zéro
 * diff). Ne touche jamais node_modules/, dist/, .next/, docker-data/.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.env.ROOT || ".");
if (!fs.existsSync(ROOT)) {
  console.error(`ROOT introuvable : ${ROOT}`);
  process.exit(1);
}

const CANONICAL_TYPES_TS = `/**
 * creezio:owned-by-brand (ré-export — ne rien redéclarer ici)
 * Contrat du registre de modules — un module métier = un fichier
 * \`modules/<id>.ts\` exportant un \`BrandModuleDef\` (standard kit
 * DOC-STANDARD-MODULE.md). SoT du contrat : \`@creezio/app-runtime\`
 * (P2.c / H9) — une redéclaration locale = doctor MODULE_TYPES_DIVERGENT.
 */
export type {
  BrandMeiliIndex,
  BrandModuleDef,
  BrandNavItem,
} from "@creezio/app-runtime";
`;

/** Champs du contrat kit — un champ local hors liste = divergence réelle. */
const KNOWN_MODULE_DEF_FIELDS = new Set([
  "id",
  "entitySpecs",
  "apiMounts",
  "navItems",
  "meiliIndexes",
  "horsIndexJustification",
  "demo",
  "migrations",
]);

/** Types satellites historiquement co-déclarés dans le fichier généré. */
const KNOWN_LOCAL_TYPES = new Set([
  "BrandModuleDef",
  "BrandNavItem",
  "BrandMeiliIndex",
]);

const MODULE_HELPER_FILES = new Set([
  "index.ts",
  "types.ts",
  "shared.ts",
  "mcp-shared.ts",
  "meili-shared.ts",
]);

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

function findModulesDirs() {
  const dirs = [];
  for (const dir of ["server", "."]) {
    const abs = path.join(ROOT, dir, "src/electron/modules");
    if (fs.existsSync(abs)) dirs.push(abs);
  }
  return dirs;
}

/**
 * Vérifie que le types.ts local est un sous-ensemble du contrat kit :
 * uniquement des imports type, les 3 types connus, et des champs
 * `BrandModuleDef` tous connus. Retourne null si OK, sinon la raison.
 */
function localTypesDivergence(src) {
  const stripped = stripComments(src);

  const declaredTypes = [
    ...stripped.matchAll(/export\s+type\s+([A-Za-z0-9_]+)\s*=/g),
  ].map((m) => m[1]);
  for (const name of declaredTypes) {
    if (!KNOWN_LOCAL_TYPES.has(name)) {
      return `type local inconnu du contrat kit : ${name}`;
    }
  }

  const defMatch = stripped.match(/type\s+BrandModuleDef\s*=\s*\{([\s\S]*?)\n\};/);
  if (!defMatch) {
    return "déclaration BrandModuleDef introuvable (forme inattendue)";
  }
  const body = defMatch[1];
  const fields = [...body.matchAll(/^\s{2}([a-zA-Z0-9_]+)\??\s*:/gm)].map(
    (m) => m[1],
  );
  for (const field of fields) {
    if (!KNOWN_MODULE_DEF_FIELDS.has(field)) {
      return `champ BrandModuleDef local inconnu du contrat kit : ${field}`;
    }
  }

  const valueExports = stripped.match(
    /export\s+(?:const|function|class|let|var)\s+/,
  );
  if (valueExports) {
    return "export de valeur (const/function/…) dans types.ts — à déplacer avant migration";
  }
  return null;
}

function isAlreadyReExport(src) {
  const stripped = stripComments(src);
  return (
    /export\s+type\s*\{[^}]*BrandModuleDef[^}]*\}\s*from\s*["']@creezio\/app-runtime["']/.test(
      stripped,
    ) && !/type\s+BrandModuleDef\s*=/.test(stripped)
  );
}

// ---------------------------------------------------------------------------
// Passe 1 (dry) : calculer toutes les écritures, échouer AVANT tout write.
// ---------------------------------------------------------------------------
const writes = []; // { abs, rel, body }

for (const modulesDir of findModulesDirs()) {
  const typesPath = path.join(modulesDir, "types.ts");
  if (fs.existsSync(typesPath)) {
    const src = fs.readFileSync(typesPath, "utf8");
    if (!isAlreadyReExport(src)) {
      const divergence = localTypesDivergence(src);
      if (divergence) {
        console.error(
          `✗ codemod H9 : ${path.relative(ROOT, typesPath)} divergent du ` +
            `contrat kit (${divergence}) — migration refusée, marque intacte. ` +
            `Arbitrer la divergence (la remonter au kit ou la retirer) puis relancer.`,
        );
        process.exit(1);
      }
      writes.push({
        abs: typesPath,
        rel: path.relative(ROOT, typesPath),
        body: CANONICAL_TYPES_TS,
      });
    }
  }

  // apiMounts manuscrits sans contrôle d'accès déclaré → dette explicite.
  const moduleFiles = fs
    .readdirSync(modulesDir)
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !MODULE_HELPER_FILES.has(f) &&
        !f.startsWith("_"),
    )
    .sort();
  for (const file of moduleFiles) {
    const abs = path.join(modulesDir, file);
    const src = fs.readFileSync(abs, "utf8");
    const stripped = stripComments(src);
    if (!/\bapiMounts\s*:/.test(stripped)) continue;
    if (/\bpermission\s*:/.test(stripped)) continue;
    if (/\baccessJustification\s*:/.test(stripped)) continue;

    // Ancres d'insertion conservatrices, dans l'ordre :
    //   1. `dbLayer: "brand",` (mount objet littéral) ;
    //   2. `...createXxxMount(),` (mount composé par spread d'une factory).
    const DB_LAYER_ANCHOR = /^(\s*)(dbLayer:\s*["']brand["'],?)\s*$/gm;
    const SPREAD_ANCHOR = /^(\s*)(\.\.\.[A-Za-z0-9_.]*[Mm]ount\(\),?)\s*$/gm;
    let migrated = src;
    if (DB_LAYER_ANCHOR.test(src)) {
      migrated = src.replace(
        DB_LAYER_ANCHOR,
        (_m, indent, decl) =>
          `${indent}${decl}\n${indent}accessJustification: "à qualifier",`,
      );
    } else if (SPREAD_ANCHOR.test(src)) {
      migrated = src.replace(
        SPREAD_ANCHOR,
        (_m, indent, decl) =>
          `${indent}${decl}\n${indent}accessJustification: "à qualifier",`,
      );
    } else {
      console.error(
        `✗ codemod H9 : ${path.relative(ROOT, abs)} a un apiMount sans ` +
          `permission/accessJustification mais sans ancre reconnue ` +
          `(\`dbLayer: "brand"\` ou spread \`...createXxxMount()\`) — ` +
          `poser accessJustification à la main puis relancer (marque intacte).`,
      );
      process.exit(1);
    }
    writes.push({ abs, rel: path.relative(ROOT, abs), body: migrated });
  }
}

// ---------------------------------------------------------------------------
// Passe 2 : écrire.
// ---------------------------------------------------------------------------
if (writes.length === 0) {
  console.log("✓ codemod H9 : rien à migrer (déjà en H9) — no-op");
} else {
  for (const { abs, body } of writes) fs.writeFileSync(abs, body, "utf8");
  console.log(`✓ codemod H9 : ${writes.length} fichier(s) migré(s)`);
  for (const { rel } of writes) console.log(`  ~ ${rel}`);
}
