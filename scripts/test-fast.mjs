#!/usr/bin/env node
/**
 * Runner de gates fail-fast et lisible — 3 suites (`test:kit` / `test:brands`
 * / `test:env`).
 *
 * Contrairement à `npm test` (toutes les gates en un seul `node --test`,
 * sortie TAP illisible, aucun feedback avant la fin), ce runner :
 *   - enchaîne les gates SÉQUENTIELLEMENT avec sortie live
 *     (`▶ test-phase-xxx` puis `✓ OK (12s)` / `✗ FAIL`) ;
 *   - S'ARRÊTE à la première gate rouge et n'affiche QUE sa sortie ;
 *   - journalise chaque gate en JSONL dans /tmp/creezio-test-fast.log.
 *
 * La liste des gates est lue depuis le script npm `test` (source of truth,
 * pas de seconde liste à maintenir). Chaque gate est classée AUTOMATIQUEMENT
 * dans une suite (aucune liste figée de noms) :
 *
 *   kit    — gates pures kit : lisent uniquement ce repo. Doivent être 100 %
 *            vertes partout, sans repos externes ni réseau.
 *   brands — gates qui lisent les repos marque (import `lib/brand-roots.mjs`
 *            ou résolution `dockerRoot`).
 *            Skip AUTO-DÉTECTÉ par marque référencée : repo absent, ou
 *            `crm/vendor/creezio` absent (oracle pré-cutover / lecture seule).
 *   env    — gates coûteuses/environnementales (liste ENV_GATES, documentée
 *            dans scripts/README.md) : cold-warm (réseau embeds + ~4 Go /tmp),
 *            factory-prd (scaffold --from-prd + smoke, lien node_modules kit,
 *            pas de npm install). Opt-in par variable d'env, sinon skip explicite.
 *
 * AUCUN assert n'est affaibli : une gate skippée l'est pour un prérequis
 * d'environnement affiché en clair, jamais silencieusement.
 *
 * Options :
 *   --suite <kit|brands|env|all>  suite à lancer (défaut kit)
 *   --from <gate>     reprendre à partir de cette gate (substring)
 *   --only <regex>    ne lancer que les gates qui matchent
 *   --skip <regex>    exclure des gates
 *   --keep-going      ne pas s'arrêter à la première rouge (inventaire)
 *   --timeout <s>     timeout par gate (défaut 300 s → FAIL timeout)
 *
 * Workflow : `npm run test:kit` → première rouge → corriger la cause →
 * `npm run test:kit -- --from <gate>` → itérer jusqu'au vert.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRAND_IDS, resolveBrandCrmRoot } from "./lib/brand-roots.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = process.env.CREEZIO_TEST_FAST_LOG || "/tmp/creezio-test-fast.log";

/* ── Suites ─────────────────────────────────────────────────────────────── */

// Gates environnementales (voir matrice dans scripts/README.md) :
// prérequis lourds qui ne se détectent pas de façon fiable → opt-in explicite.
const ENV_GATES = new Map([
  [
    "test-os-cold-warm.mjs",
    {
      optIn: "CREEZIO_COLD_WARM",
      why: "bootstrap embeds réseau + ~4 Go dans /tmp par run",
    },
  ],
  [
    "test-phase-factory-prd.mjs",
    {
      optIn: "CREEZIO_FACTORY_PRD",
      why: "scaffold --from-prd + smoke harness (lien node_modules kit, pas de npm install)",
    },
  ],
  [
    "test-phase-factory-prd-experience.mjs",
    {
      optIn: "CREEZIO_FACTORY_PRD",
      why: "scaffold --from-prd + smoke harness (lien node_modules kit, pas de npm install)",
    },
  ],
  [
    "test-phase-factory-docker-parity.mjs",
    {
      optIn: "CREEZIO_FACTORY_DOCKER",
      why: "app neuve factory + npm install + build UI + image Docker (~10 min)",
    },
  ],
  // Ces deux gates exigent les binaires natifs réels (meili, cloudflared,
  // hermes, n8n) : impossibles quand CREEZIO_SKIP_KIT_BINARIES=1 (CI GH-hosted
  // les saute volontairement). Elles tournent en nightly self-hosted où les
  // binaires sont téléchargeables et cachés entre runs.
  [
    "test-os-native-pnp.mjs",
    {
      optIn: "CREEZIO_KIT_BINARIES",
      why: "télécharge les binaires natifs meili/cloudflared/hermes/n8n",
    },
  ],
  [
    "test-os-shell-contracts.mjs",
    {
      optIn: "CREEZIO_KIT_BINARIES",
      why: "assert ensureKitOsBinaries → binaires natifs réels requis",
    },
  ],
]);

// Une gate « marques » lit les repos marque : import de la lib de résolution
// ou identifiant dockerRoot (twins /opt/docker | siblings).
const BRAND_GATE_RE = /lib\/brand-roots\.mjs|dockerRoot/;

/** État d'un repo marque pour les gates : utilisable, ou raison du skip. */
function brandAvailability(id) {
  const crm = resolveBrandCrmRoot(id);
  if (!fs.existsSync(crm)) return { ok: false, why: `repo absent (${crm})` };
  if (!fs.existsSync(path.join(crm, "vendor", "creezio"))) {
    return {
      ok: false,
      why: "crm/vendor/creezio absent (oracle pré-cutover / lecture seule)",
    };
  }
  return { ok: true };
}

const brandStates = new Map(BRAND_IDS.map((id) => [id, brandAvailability(id)]));

/**
 * Classe une gate et calcule son éventuel skip (avec raison explicite).
 * @returns {{ suite: "kit"|"brands"|"env", skipReason: string|null }}
 */
function classifyGate(gatePath, base) {
  const env = ENV_GATES.get(base);
  if (env) {
    const on = process.env[env.optIn] === "1";
    return {
      suite: "env",
      skipReason: on ? null : `${env.optIn}=1 requis — ${env.why}`,
    };
  }
  const src = fs.readFileSync(path.join(ROOT, gatePath), "utf8");
  if (!BRAND_GATE_RE.test(src)) return { suite: "kit", skipReason: null };
  const referenced = BRAND_IDS.filter((id) => src.includes(id));
  const needed = referenced.length ? referenced : BRAND_IDS;
  const missing = needed
    .map((id) => ({ id, state: brandStates.get(id) }))
    .filter((b) => !b.state.ok);
  return {
    suite: "brands",
    skipReason: missing.length
      ? missing.map((b) => `${b.id} : ${b.state.why}`).join(" ; ")
      : null,
  };
}

/* ── CLI ── */
const args = process.argv.slice(2);
const opt = {
  suite: "kit",
  from: "",
  only: "",
  skip: "",
  keepGoing: false,
  timeoutS: 300,
};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--suite") opt.suite = args[++i] || "";
  else if (a.startsWith("--suite=")) opt.suite = a.slice(8);
  else if (a === "--from") opt.from = args[++i] || "";
  else if (a.startsWith("--from=")) opt.from = a.slice(7);
  else if (a === "--only") opt.only = args[++i] || "";
  else if (a.startsWith("--only=")) opt.only = a.slice(7);
  else if (a === "--skip") opt.skip = args[++i] || "";
  else if (a.startsWith("--skip=")) opt.skip = a.slice(7);
  else if (a === "--keep-going") opt.keepGoing = true;
  else if (a === "--timeout") opt.timeoutS = Number(args[++i]) || 300;
  else if (a.startsWith("--timeout=")) opt.timeoutS = Number(a.slice(10)) || 300;
  else if (a === "--help" || a === "-h") {
    console.log(
      "Usage: npm run test:kit|test:brands|test:env [-- --from <gate>] [--only <regex>] [--skip <regex>] [--keep-going] [--timeout <s>]\n" +
        "       node scripts/test-fast.mjs --suite <kit|brands|env|all>",
    );
    process.exit(0);
  } else {
    console.error(`option inconnue: ${a}`);
    process.exit(2);
  }
}
if (!["kit", "brands", "env", "all"].includes(opt.suite)) {
  console.error(`--suite inconnu: ${opt.suite} (kit|brands|env|all)`);
  process.exit(2);
}

/* ── Liste des gates depuis package.json (SoT) ── */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const gates = (pkg.scripts.test.match(/scripts\/[\w./-]+\.mjs/g) || []).map((g) =>
  g.trim(),
);
if (!gates.length) {
  console.error("aucune gate trouvée dans le script npm test");
  process.exit(2);
}

const onlyRe = opt.only ? new RegExp(opt.only) : null;
const skipRe = opt.skip ? new RegExp(opt.skip) : null;
let started = !opt.from;
const plan = [];
for (const gate of gates) {
  const base = path.basename(gate);
  const cls = classifyGate(gate, base);
  if (opt.suite !== "all" && cls.suite !== opt.suite) continue;
  if (!started) {
    if (base.includes(opt.from) || gate.includes(opt.from)) started = true;
    else continue;
  }
  if (onlyRe && !onlyRe.test(base)) continue;
  const skippedArg = Boolean(skipRe && skipRe.test(base));
  plan.push({
    gate,
    base,
    suite: cls.suite,
    skipReason: skippedArg ? "exclue par --skip" : cls.skipReason,
  });
}

/* ── Couleurs (désactivées si pas un TTY) ── */
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);
const yellow = (s) => c("33", s);

const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
const jsonl = (o) =>
  logStream.write(JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n");

function runGate(gate) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", gate], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const t0 = Date.now();
    const killer = setTimeout(() => {
      child.kill("SIGKILL");
    }, opt.timeoutS * 1000);
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      resolve({
        code,
        timedOut: signal === "SIGKILL",
        ms: Date.now() - t0,
        out,
      });
    });
  });
}

const fmt = (ms) => (ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

jsonl({ event: "run-start", suite: opt.suite, gates: plan.length, opts: opt });
console.log(
  dim(
    `test:fast suite=${opt.suite} — ${plan.filter((p) => !p.skipReason).length} gates (skip: ${plan.filter((p) => p.skipReason).length}) → ${LOG_FILE}`,
  ),
);

let pass = 0;
let fail = 0;
for (const item of plan) {
  if (item.skipReason) {
    console.log(`${yellow("∅")} ${item.base} ${dim(`(skip : ${item.skipReason})`)}`);
    jsonl({ event: "gate", gate: item.base, status: "skip", reason: item.skipReason });
    continue;
  }
  process.stdout.write(`▶ ${item.base} `);
  const r = await runGate(item.gate);
  if (r.code === 0) {
    pass++;
    console.log(green(`✓ OK (${fmt(r.ms)})`));
    jsonl({ event: "gate", gate: item.base, status: "ok", ms: r.ms });
  } else {
    fail++;
    console.log(red(r.timedOut ? `✗ FAIL (timeout ${opt.timeoutS}s)` : `✗ FAIL (${fmt(r.ms)})`));
    jsonl({
      event: "gate",
      gate: item.base,
      status: r.timedOut ? "timeout" : "fail",
      ms: r.ms,
    });
    if (!opt.keepGoing) {
      console.log(red(`\n━━━ sortie de ${item.base} ━━━`));
      console.log(r.out);
      console.log(
        red(
          `━━━ FIN — corriger puis relancer : npm run test:${opt.suite === "all" ? "fast" : opt.suite} -- --from ${item.base} ━━━`,
        ),
      );
      break;
    }
    // --keep-going : ne pas avaler la cause — sans extrait, les logs CI ne
    // montrent que « ✗ FAIL » et obligent à reproduire localement à l'aveugle.
    console.log(dim(`── extrait ${item.base} ──`));
    console.log(r.out.trim().split("\n").slice(-30).join("\n"));
    console.log(dim(`── fin extrait ──`));
  }
}

jsonl({ event: "run-end", suite: opt.suite, pass, fail });
console.log(
  `\n${pass} OK, ${fail} FAIL, ${plan.filter((p) => p.skipReason).length} skip.`,
);
logStream.end();
process.exit(fail ? 1 : 0);
