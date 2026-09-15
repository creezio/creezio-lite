#!/usr/bin/env node
/**
 * Scanner vocabulaire marque dans le kit (P1.a) — SoT de la gate
 * `test-phase-no-brand-vocab.mjs`.
 *
 * Le kit `@creezio/*` ne doit contenir AUCUN vocabulaire de marque
 * (frontière absolue n°1, ADR-no-brand-domain-in-native-packages). La dette
 * héritée (TempoFlow…) est matérialisée dans
 * `scripts/no-brand-vocab-allowlist.json` : chaque occurrence legacy y est
 * comptée (fichier + pattern + compteur + ticket d'audit). Le compteur ne
 * peut que DÉCROÎTRE — toute nouvelle occurrence est rouge.
 *
 * CLI (maintenance, ratchet intégré) :
 *   node scripts/lib/brand-vocab.mjs --print            # occurrences actuelles
 *   node scripts/lib/brand-vocab.mjs --write-allowlist  # rétrécit l'allowlist
 *     (retire entrées mortes, décrémente compteurs, garde les tickets ;
 *      REFUSE toute nouvelle entrée / incrément — corriger le code à la place)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const ALLOWLIST_PATH = path.join(
  ROOT,
  "scripts",
  "no-brand-vocab-allowlist.json",
);

/**
 * Patterns interdits, par ordre de spécificité DÉCROISSANTE (un span déjà
 * matché par un pattern plus spécifique n'est pas recompté par un plus
 * générique — ex. `certivanfid` compte pour `certivanfid`, pas `certivan`).
 *
 * Frontières :
 *  - noms de marque pleins (tempoflow, certivan, winhub, foove) : substring
 *    insensible à la casse — couvre tempoflow2/3, foove2, WinhubApp… ;
 *  - `fidu` : borné par des NON-lettres (fidu2, FIDU_, fidu- oui ;
 *    fiduciaire, confidus non) ;
 *  - `tf2` / `tf3` : bornés par des NON-alphanumériques, `_` toléré en
 *    suffixe (tf2_, TF3 oui ; utf2, printf3 non).
 */
export const BRAND_PATTERNS = [
  { id: "tf2fid", re: /tf2fid/gi },
  { id: "certivanfid", re: /certivanfid/gi },
  { id: "fidufid", re: /fidufid/gi },
  { id: "chr-catalog", re: /chr-catalog/gi },
  { id: "tempoflow", re: /tempoflow/gi },
  { id: "certivan", re: /certivan/gi },
  { id: "winhub", re: /winhub/gi },
  { id: "foove", re: /foove/gi },
  { id: "tf2", re: /(?<![a-z0-9])tf2(?![a-z0-9])/gi },
  { id: "tf3", re: /(?<![a-z0-9])tf3(?![a-z0-9])/gi },
  { id: "fidu", re: /(?<![a-z])fidu(?![a-z])/gi },
];

/** Extensions binaires / non pertinentes, jamais scannées. */
const SKIP_EXT_RE = /\.(md|png|jpg|jpeg|gif|ico|icns|svg|woff2?|ttf|eot|zip|gz|db|sqlite)$/i;

function loadAllowlistRaw() {
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, "utf8"));
}

/** @returns {{ globalExclusions: {dir:string,ticket:string}[], entries: {file:string,pattern:string,count:number,ticket:string}[] }} */
export function loadAllowlist() {
  const raw = loadAllowlistRaw();
  return {
    globalExclusions: raw.globalExclusions ?? [],
    entries: raw.entries ?? [],
  };
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "dist-cjs") continue;
      walk(p, acc);
    } else if (!SKIP_EXT_RE.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

/** Racines scannées : packages/<pkg>/src et packages/<pkg>/ui. */
export function scanRoots() {
  const roots = [];
  const pkgsDir = path.join(ROOT, "packages");
  for (const entry of fs.readdirSync(pkgsDir).sort()) {
    for (const sub of ["src", "ui"]) {
      const dir = path.join(pkgsDir, entry, sub);
      if (fs.existsSync(dir)) roots.push(dir);
    }
  }
  return roots;
}

/**
 * Scanne le kit.
 * @param {{dir:string}[]} globalExclusions répertoires exclus (dette dédiée)
 * @returns {Map<string, {file:string, pattern:string, hits:{line:number,text:string}[]}>}
 *   clé `${file}::${pattern}` (file relatif au repo)
 */
export function scanBrandVocab(globalExclusions = []) {
  const excludedDirs = globalExclusions.map((e) =>
    path.join(ROOT, e.dir).replace(/\/$/, "") + path.sep,
  );
  const results = new Map();
  for (const root of scanRoots()) {
    for (const file of walk(root)) {
      if (excludedDirs.some((d) => file.startsWith(d))) continue;
      const rel = path.relative(ROOT, file);
      const src = fs.readFileSync(file, "utf8");
      const masked = new Set(); // index de départ des spans déjà matchés
      for (const { id, re } of BRAND_PATTERNS) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) {
          let overlaps = false;
          for (let i = m.index; i < m.index + m[0].length; i++) {
            if (masked.has(i)) { overlaps = true; break; }
          }
          if (overlaps) continue;
          for (let i = m.index; i < m.index + m[0].length; i++) masked.add(i);
          const line = src.slice(0, m.index).split("\n").length;
          const text = src.split("\n")[line - 1]?.trim().slice(0, 160) ?? "";
          const key = `${rel}::${id}`;
          const bucket = results.get(key) ?? { file: rel, pattern: id, hits: [] };
          bucket.hits.push({ line, text });
          results.set(key, bucket);
        }
      }
    }
  }
  return results;
}

/* ── CLI maintenance ────────────────────────────────────────────────────── */

function cliPrint() {
  const allow = fs.existsSync(ALLOWLIST_PATH)
    ? loadAllowlist()
    : { globalExclusions: [], entries: [] };
  const scan = scanBrandVocab(allow.globalExclusions);
  const rows = [...scan.values()].sort((a, b) =>
    (a.file + a.pattern).localeCompare(b.file + b.pattern),
  );
  for (const r of rows) {
    console.log(`${r.file} :: ${r.pattern} × ${r.hits.length}`);
    for (const h of r.hits.slice(0, 3)) console.log(`    L${h.line} ${h.text}`);
  }
  console.log(
    `\n${rows.length} couples fichier×pattern, ${rows.reduce((n, r) => n + r.hits.length, 0)} occurrences.`,
  );
}

function cliWriteAllowlist() {
  const raw = loadAllowlistRaw();
  const allow = loadAllowlist();
  const scan = scanBrandVocab(allow.globalExclusions);
  const existing = new Map(allow.entries.map((e) => [`${e.file}::${e.pattern}`, e]));
  const next = [];
  const refused = [];
  for (const [key, r] of scan) {
    const prev = existing.get(key);
    if (!prev) {
      refused.push(`${key} × ${r.hits.length} (L${r.hits[0].line})`);
      continue;
    }
    if (r.hits.length > prev.count) {
      refused.push(`${key} : ${prev.count} → ${r.hits.length} (incrément interdit)`);
      continue;
    }
    next.push({ ...prev, count: r.hits.length });
  }
  if (refused.length) {
    console.error(
      "REFUS — le ratchet ne peut que décroître ; corriger le code, pas l'allowlist :\n  " +
        refused.join("\n  "),
    );
    process.exit(1);
  }
  next.sort((a, b) => (a.file + a.pattern).localeCompare(b.file + b.pattern));
  const dropped = allow.entries.length - next.length;
  fs.writeFileSync(
    ALLOWLIST_PATH,
    JSON.stringify({ ...raw, entries: next }, null, 2) + "\n",
  );
  console.log(
    `allowlist réécrite : ${next.length} entrées (${dropped} morte(s) retirée(s)).`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (process.argv.includes("--print")) cliPrint();
  else if (process.argv.includes("--write-allowlist")) cliWriteAllowlist();
  else {
    console.log("usage: node scripts/lib/brand-vocab.mjs --print | --write-allowlist");
    process.exit(2);
  }
}
