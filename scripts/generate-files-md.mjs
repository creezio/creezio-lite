#!/usr/bin/env node
/**
 * Générateur des inventaires `docs/FILES.md` — format standard du kit.
 *
 * Standard documentaire : docs/DOC-STANDARD.md. Chaque package (`packages/*`),
 * zone Docker (`docker/*`), app (`apps/*`) et la zone `scripts/` maintient un
 * `docs/FILES.md` listant TOUS ses fichiers source, une ligne par fichier,
 * groupés par dossier dans un tableau `| Fichier | Rôle |`.
 *
 * Usage (depuis la racine du kit, /opt/docker/creezio) :
 *
 *   node scripts/generate-files-md.mjs api-kernel        # packages/api-kernel
 *   node scripts/generate-files-md.mjs docker/server     # une zone docker
 *   node scripts/generate-files-md.mjs apps/console      # une app
 *   node scripts/generate-files-md.mjs scripts           # la zone scripts/
 *   node scripts/generate-files-md.mjs --all             # toutes les cibles
 *   node scripts/generate-files-md.mjs --all --check     # vérification seule
 *
 * Comportement :
 *   - liste les fichiers source réels (extensions .ts .tsx .mts .cts .js .jsx
 *     .mjs .cjs .sql .sh hors .d.ts, plus Dockerfile*, docker-compose*.yml,
 *     *.dockerignore, *.service.example ; exclut dist/, dist-cjs/,
 *     node_modules/, .next/, coverage/, __snapshots__/, docs/, docker-data/,
 *     build/) ;
 *   - FUSIONNE avec le FILES.md courant : la colonne « Rôle » d'un fichier
 *     déjà listé est préservée (format standard OU ancien format « détail par
 *     fichier » dont la prose est récupérée) ; un fichier nouveau reçoit
 *     `(à documenter)` ;
 *   - écrit le format standard (en-tête + tableau par dossier).
 *
 * `--check` n'écrit rien : code de sortie 1 si un fichier source manque dans
 * son FILES.md ou si le trio README.md / AGENTS.md / docs/FILES.md est
 * incomplet. C'est le mode consommé par la gate
 * `scripts/test-phase-docs-freshness.mjs`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const KIT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const EXCLUDED_DIRS = new Set([
  "dist",
  "dist-cjs",
  "node_modules",
  ".next",
  ".turbo",
  "coverage",
  "__snapshots__",
  "docs",
  "docker-data",
  "build",
  ".git",
]);

const SOURCE_EXT_RE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|sh)$/;

/** Un fichier « source » au sens du standard documentaire. */
export function isSourceFile(name) {
  if (name.endsWith(".d.ts")) return false;
  if (SOURCE_EXT_RE.test(name)) return true;
  if (name.startsWith("Dockerfile")) return true;
  if (/^docker-compose.*\.ya?ml$/.test(name)) return true;
  if (name.endsWith(".dockerignore")) return true;
  if (name.endsWith(".service.example")) return true;
  return false;
}

/** Toutes les cibles du périmètre de la gate. */
export function listTargets(root = KIT_ROOT) {
  const targets = [];
  for (const zone of ["packages", "docker", "apps"]) {
    const zoneDir = path.join(root, zone);
    if (!fs.existsSync(zoneDir)) continue;
    for (const entry of fs.readdirSync(zoneDir, { withFileTypes: true })) {
      if (entry.isDirectory()) targets.push(`${zone}/${entry.name}`);
    }
  }
  targets.push("scripts");
  return targets;
}

/** Résout un argument CLI (`api-kernel`, `docker/server`, `scripts`…). */
export function resolveTarget(arg, root = KIT_ROOT) {
  const candidates = arg.includes("/")
    ? [arg]
    : [arg === "scripts" ? "scripts" : null, `packages/${arg}`, `docker/${arg}`, `apps/${arg}`].filter(Boolean);
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return rel;
  }
  throw new Error(
    `cible introuvable : ${arg} (essayé : ${candidates.join(", ")})`,
  );
}

/** Fichiers source d'une cible, chemins relatifs à sa racine, triés. */
export function listSourceFiles(targetRel, root = KIT_ROOT) {
  const base = path.join(root, targetRel);
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(abs);
      } else if (isSourceFile(entry.name)) {
        out.push(path.relative(base, abs));
      }
    }
  };
  walk(base);
  return out.sort();
}

/* ── Extraction des rôles existants ─────────────────────────────────────── */

/** Cellules d'une ligne de tableau markdown (sans les bords). */
function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** Chemin de fichier depuis une cellule `` `path` `` ou `` [`path`](lien) ``. */
function cellFilePath(cell) {
  const m = cell.match(/^\[?`([^`]+)`/);
  return m ? m[1] : null;
}

/**
 * Récupère les descriptions du FILES.md courant, tous formats confondus :
 *   - format standard : tableau 2 colonnes `| Fichier | Rôle |` ;
 *   - ancien format : sections `### \`path\`` dont la prose (hors bullets
 *     Lignes/Exports et blocs de code) devient le Rôle.
 * @returns {Map<string, string>} chemin relatif → rôle.
 */
export function extractRoles(markdown) {
  const roles = new Map();
  const lines = markdown.split("\n");

  for (const line of lines) {
    const cells = tableCells(line);
    if (!cells || cells.length !== 2) continue;
    const file = cellFilePath(cells[0]);
    if (!file || /^-+$/.test(cells[1]) || cells[1] === "Rôle") continue;
    if (cells[1]) roles.set(file, cells[1]);
  }

  // Ancien format « Détail par fichier ».
  let current = null;
  let prose = [];
  let inFence = false;
  const flush = () => {
    if (current && prose.length && !roles.has(current)) {
      const role = prose
        .join(" ")
        .replace(/\s+/g, " ")
        .replace(/\|/g, "\\|")
        .replace(/\s*:\s*$/, "")
        .trim();
      if (role) roles.set(current, role);
    }
    current = null;
    prose = [];
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    // Un titre referme implicitement une fence mal fermée (anciens FILES.md
    // tronqués) — sinon toutes les sections suivantes seraient avalées.
    if (inFence && /^#{1,3}\s/.test(line)) inFence = false;
    if (inFence) continue;
    const heading = line.match(/^###\s+`([^`]+)`\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      flush();
      continue;
    }
    if (!current) continue;
    const t = line.trim();
    if (!t || t.startsWith("- **") || t.startsWith("|")) continue;
    prose.push(t);
  }
  flush();
  return roles;
}

/* ── Rendu ──────────────────────────────────────────────────────────────── */

export function renderFilesMd(targetRel, files, roles, root = KIT_ROOT) {
  const docsDir = path.join(root, targetRel, "docs");
  const standardRel = path
    .relative(docsDir, path.join(root, "docs", "DOC-STANDARD.md"))
    .split(path.sep)
    .join("/");
  const cliArg = targetRel.startsWith("packages/")
    ? targetRel.slice("packages/".length)
    : targetRel;

  const byDir = new Map();
  for (const file of files) {
    const dir = path.dirname(file);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(file);
  }
  const dirs = [...byDir.keys()].sort((a, b) =>
    a === "." ? -1 : b === "." ? 1 : a.localeCompare(b),
  );

  const out = [];
  out.push(`# ${targetRel} — inventaire des fichiers`);
  out.push("");
  out.push(`> Standard : [DOC-STANDARD.md](${standardRel}) — maintenu via`);
  out.push(
    `> \`node scripts/generate-files-md.mjs ${cliArg}\` (gate \`test-phase-docs-freshness\`).`,
  );
  out.push("> Colonne « Rôle » éditable à la main : la régénération la préserve.");
  out.push("");
  for (const dir of dirs) {
    out.push(dir === "." ? "## Racine" : `## \`${dir}/\``);
    out.push("");
    out.push("| Fichier | Rôle |");
    out.push("|---|---|");
    for (const file of byDir.get(dir)) {
      const role = roles.get(file) || "(à documenter)";
      out.push(`| [\`${file}\`](../${file}) | ${role} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

/* ── Check / génération ─────────────────────────────────────────────────── */

/**
 * Vérifie une cible sans rien écrire.
 * @returns {{ target: string, missingDocs: string[], missingFiles: string[] }}
 */
export function checkTarget(targetRel, root = KIT_ROOT) {
  const base = path.join(root, targetRel);
  const missingDocs = [];
  for (const doc of ["README.md", "AGENTS.md", "docs/FILES.md"]) {
    if (!fs.existsSync(path.join(base, doc))) missingDocs.push(doc);
  }
  const filesMd = path.join(base, "docs", "FILES.md");
  const text = fs.existsSync(filesMd) ? fs.readFileSync(filesMd, "utf8") : "";
  const missingFiles = listSourceFiles(targetRel, root).filter(
    (f) => !text.includes(f),
  );
  return { target: targetRel, missingDocs, missingFiles };
}

export function generateTarget(targetRel, root = KIT_ROOT) {
  const filesMd = path.join(root, targetRel, "docs", "FILES.md");
  const existing = fs.existsSync(filesMd)
    ? fs.readFileSync(filesMd, "utf8")
    : "";
  const files = listSourceFiles(targetRel, root);
  const roles = extractRoles(existing);
  fs.mkdirSync(path.dirname(filesMd), { recursive: true });
  fs.writeFileSync(filesMd, renderFilesMd(targetRel, files, roles, root));
  return { target: targetRel, count: files.length };
}

/* ── CLI ────────────────────────────────────────────────────────────────── */

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const all = args.includes("--all");
  const names = args.filter((a) => !a.startsWith("--"));
  const targets = all
    ? listTargets()
    : names.map((n) => resolveTarget(n));
  if (!targets.length) {
    console.error("usage : generate-files-md.mjs <cible>… | --all [--check]");
    process.exit(2);
  }
  let failed = false;
  for (const target of targets) {
    if (check) {
      const r = checkTarget(target);
      if (r.missingDocs.length || r.missingFiles.length) {
        failed = true;
        console.error(`✗ ${target}`);
        for (const d of r.missingDocs) console.error(`    doc manquante : ${d}`);
        for (const f of r.missingFiles)
          console.error(`    absent de docs/FILES.md : ${f}`);
      } else {
        console.log(`✓ ${target}`);
      }
    } else {
      const r = generateTarget(target);
      console.log(`écrit ${target}/docs/FILES.md (${r.count} fichiers)`);
    }
  }
  if (check && failed) {
    console.error(
      "\nRattrapage : node scripts/generate-files-md.mjs <cible> (voir docs/DOC-STANDARD.md)",
    );
    process.exit(1);
  }
}
