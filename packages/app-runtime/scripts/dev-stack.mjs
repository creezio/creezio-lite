#!/usr/bin/env node
/**
 * Dev-stack marque — `npm run dev|stop|status|setup` standard (Q1/Q6).
 *
 * Convention 2026 : clone → npm run setup → npm run dev.
 *   dev    : kernel métier (brand-kernel-harness) + Next dev (server/ui),
 *            ports détectés (METIER_PORT/UI_PORT, 0 = auto), .env chargé,
 *            URL affichée, PID files sous .creezio/ (cycle de vie explicite).
 *   stop   : tue les deux arbres de processus (process group POSIX / taskkill
 *            /T Windows) depuis le PID file — jamais de pkill large.
 *   status : état des processus + ports + URLs + santé HTTP.
 *   setup  : npm ci racine + server/ui + client (si présents) + build kernel.
 *
 * Aucune copie dans les marques : les apps exposent un proxy
 * (scripts/creezio-dev.mjs) vers ce script (node_modules/@creezio/app-runtime).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUBCOMMANDS = ["dev", "stop", "status", "setup"];

function parseArgs(argv) {
  const out = { sub: argv[2] || "", appRoot: process.env.CREEZIO_APP_ROOT || "" };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === "--app-root" && argv[i + 1]) out.appRoot = argv[++i];
  }
  out.appRoot = path.resolve(out.appRoot || process.cwd());
  return out;
}

function fail(msg) {
  console.error(`✗ dev-stack: ${msg}`);
  process.exit(1);
}

function log(tag, msg) {
  console.log(`[dev-stack:${tag}] ${msg}`);
}

/* ---------- .env (racine puis server/ — le plus spécifique gagne) ---------- */
function loadDotEnv(appRoot) {
  for (const rel of [".env", path.join("server", ".env")]) {
    const file = path.join(appRoot, rel);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

/* ---------- état (PID files explicites) ---------- */
function stateDir(appRoot) {
  return path.join(appRoot, ".creezio");
}
function stateFile(appRoot) {
  return path.join(stateDir(appRoot), "dev-stack.json");
}
function readState(appRoot) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(appRoot), "utf8"));
  } catch {
    return null;
  }
}
function writeState(appRoot, state) {
  fs.mkdirSync(stateDir(appRoot), { recursive: true });
  fs.writeFileSync(stateFile(appRoot), JSON.stringify(state, null, 2) + "\n");
}
function removeState(appRoot) {
  fs.rmSync(stateFile(appRoot), { force: true });
}

/* ---------- processus ---------- */
function pidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Tue un arbre de processus : groupe POSIX (detached) / taskkill /T Windows. */
function killTree(pid, label) {
  if (!pidAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  for (const sig of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-pid, sig); // groupe (enfant détaché = leader)
    } catch {
      try {
        process.kill(pid, sig);
      } catch {
        /* déjà parti */
      }
    }
    if (!pidAlive(pid)) break;
    // Laisse au signal le temps de faire effet avant l'escalade.
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},400)"]);
  }
  log("stop", `${label} (PID ${pid}) arrêté`);
}

/* ---------- ports ---------- */
async function resolvePort(value, defaut, envName, appRoot) {
  const raw = (value ?? "").toString().trim();
  if (raw === "0") {
    const { findFreePort } = await importPortGuard(appRoot);
    return findFreePort();
  }
  const port = raw ? Number(raw) : defaut;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`${envName} invalide: ${raw || port} (entier 1-65535 ou 0=auto)`);
  }
  const { portFree, portHolderLabel } = await importPortGuard(appRoot);
  if (!(await portFree(port))) {
    const st = readState(appRoot);
    const ours =
      st && (st.metierPort === port || st.uiPort === port) &&
      (pidAlive(st.pidKernel) || pidAlive(st.pidUi));
    if (ours) {
      fail(
        `le dev-stack tourne déjà (port ${port}) — npm run status pour l'état, npm run stop pour arrêter`,
      );
    }
    fail(
      `port ${port} occupé${portHolderLabel(port)} — npm run stop ou ${envName}=0 (port auto)`,
    );
  }
  return port;
}

async function importPortGuard(appRoot) {
  const candidates = [
    path.join(appRoot, "server", "node_modules", "@creezio", "desktop-tooling", "scripts", "port-guard.mjs"),
    path.join(appRoot, "node_modules", "@creezio", "desktop-tooling", "scripts", "port-guard.mjs"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    fail(
      "@creezio/desktop-tooling introuvable (port-guard) — lancez npm run setup",
    );
  }
  return import(pathToFileUrl(found));
}

function pathToFileUrl(p) {
  const abs = path.resolve(p).replace(/\\/g, "/");
  return `file://${abs.startsWith("/") ? "" : "/"}${abs}`;
}

/* ---------- santé HTTP ---------- */
function httpOk(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.once("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await httpOk(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`${label} ne répond pas sur ${url} après ${Math.round(timeoutMs / 1000)}s — voir logs ci-dessus`);
}

/* ---------- sous-commandes ---------- */
function serverDir(appRoot) {
  const dir = path.join(appRoot, "server");
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    fail(`layout monorepo attendu: ${dir}/package.json absent`);
  }
  return dir;
}

function uiDir(appRoot) {
  const dir = path.join(serverDir(appRoot), "ui");
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    fail(`UI Next introuvable: ${dir}/package.json absent`);
  }
  return dir;
}

function nextBin(ui) {
  const bin = path.join(ui, "node_modules", "next", "dist", "bin", "next");
  return fs.existsSync(bin) ? bin : null;
}

async function cmdDev(appRoot) {
  loadDotEnv(appRoot);
  const server = serverDir(appRoot);
  const ui = uiDir(appRoot);

  const existing = readState(appRoot);
  if (existing && (pidAlive(existing.pidKernel) || pidAlive(existing.pidUi))) {
    console.log(
      `✓ dev-stack déjà en cours — UI: http://localhost:${existing.uiPort} (npm run status / npm run stop)`,
    );
    return;
  }

  // Préflight deps : message d'aide plutôt qu'erreur opaque de module.
  if (
    !fs.existsSync(path.join(server, "node_modules")) &&
    !fs.existsSync(path.join(appRoot, "node_modules"))
  ) {
    fail("dépendances absentes — lancez npm run setup d'abord");
  }

  const metierPort = await resolvePort(process.env.METIER_PORT, 18791, "METIER_PORT", appRoot);
  const uiPort = await resolvePort(process.env.UI_PORT, 18790, "UI_PORT", appRoot);

  // Kernel buildé ? Sinon build explicite (premier run après clone/setup léger).
  const manifest = path.join(server, "build", "electron", "app-manifest.js");
  if (!fs.existsSync(manifest)) {
    log("dev", "build/electron absent — npm run build:electron --prefix server…");
    const b = spawnSync("npm", ["run", "build:electron", "--prefix", "server"], {
      cwd: appRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    if (b.status !== 0) fail("build kernel en échec (voir erreurs ci-dessus)");
  }

  // Pages OS fraîches (Q5) : le dev-stack lance `next dev` directement —
  // le hook predev de server/ui est contourné, donc materialize tourne ici
  // (idempotent, <1s) : jamais de pages stale ou absentes au premier dev.
  const materialize = path.join(server, "scripts", "materialize-os-ui.mjs");
  if (fs.existsSync(materialize)) {
    const m = spawnSync(process.execPath, [materialize], {
      cwd: server,
      stdio: "inherit",
      env: process.env,
    });
    if (m.status !== 0) {
      fail("os-ui:materialize en échec — pages OS non matérialisées");
    }
  }

  const dataDir = process.env.METIER_DATA_DIR || path.join(stateDir(appRoot), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  log("dev", `kernel métier sur 127.0.0.1:${metierPort} (data: ${path.relative(appRoot, dataDir)})…`);
  const kernel = spawn(
    process.execPath,
    [path.join("scripts", "brand-kernel-harness.mjs")],
    {
      cwd: server,
      env: {
        ...process.env,
        METIER_PORT: String(metierPort),
        METIER_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "inherit", "inherit"],
      detached: process.platform !== "win32",
    },
  );
  kernel.on("error", (e) => fail(`spawn kernel: ${e.message}`));

  await waitHttp(`http://127.0.0.1:${metierPort}/api/v1/core/health`, 120000, "kernel");

  const next = nextBin(ui);
  log("dev", `Next dev sur 127.0.0.1:${uiPort}…`);
  const uiChild = next
    ? spawn(process.execPath, [next, "dev", "-p", String(uiPort)], {
        cwd: ui,
        env: {
          ...process.env,
          METIER_BASE_URL: `http://127.0.0.1:${metierPort}`,
          NEXT_PUBLIC_METIER_BASE_URL: `http://127.0.0.1:${metierPort}`,
        },
        stdio: ["ignore", "inherit", "inherit"],
        detached: process.platform !== "win32",
      })
    : spawn("npm", ["run", "dev", "--", "-p", String(uiPort)], {
        cwd: ui,
        env: {
          ...process.env,
          METIER_BASE_URL: `http://127.0.0.1:${metierPort}`,
          NEXT_PUBLIC_METIER_BASE_URL: `http://127.0.0.1:${metierPort}`,
        },
        stdio: ["ignore", "inherit", "inherit"],
        shell: process.platform === "win32",
        detached: process.platform !== "win32",
      });
  uiChild.on("error", (e) => fail(`spawn UI: ${e.message}`));

  writeState(appRoot, {
    pidKernel: kernel.pid,
    pidUi: uiChild.pid,
    metierPort,
    uiPort,
    startedAt: new Date().toISOString(),
  });

  console.log("");
  console.log(`✓ dev prêt — UI: http://localhost:${uiPort}`);
  console.log(`  API kernel: http://127.0.0.1:${metierPort}/api/v1/core/health`);
  console.log(`  Ctrl+C ou npm run stop pour arrêter (npm run status pour l'état)`);

  const shutdown = () => {
    killTree(uiChild.pid, "ui");
    killTree(kernel.pid, "kernel");
    removeState(appRoot);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  kernel.on("exit", (code) => {
    if (code && code !== 0) fail(`kernel terminé (code ${code}) — npm run stop pour nettoyer`);
  });
}

function cmdStop(appRoot) {
  const st = readState(appRoot);
  if (!st) {
    console.log("✓ aucun dev-stack en cours (pas de PID file .creezio/dev-stack.json)");
    return;
  }
  killTree(st.pidUi, "ui");
  killTree(st.pidKernel, "kernel");
  removeState(appRoot);
  console.log("✓ dev-stack arrêté");
}

async function cmdStatus(appRoot) {
  const st = readState(appRoot);
  if (!st) {
    console.log("dev-stack: arrêté (pas de PID file)");
    return;
  }
  const kAlive = pidAlive(st.pidKernel);
  const uAlive = pidAlive(st.pidUi);
  console.log(`dev-stack démarré le ${st.startedAt}`);
  console.log(`  kernel : PID ${st.pidKernel} ${kAlive ? "vivant" : "MORT"} — http://127.0.0.1:${st.metierPort}/api/v1/core/health`);
  console.log(`  ui     : PID ${st.pidUi} ${uAlive ? "vivant" : "MORT"} — http://localhost:${st.uiPort}`);
  if (kAlive) {
    const ok = await httpOk(`http://127.0.0.1:${st.metierPort}/api/v1/core/health`);
    console.log(`  santé kernel: ${ok ? "OK" : "KO"}`);
  }
  if (!kAlive && !uAlive) {
    console.log("  (processus morts — npm run stop pour nettoyer le PID file)");
  }
}

function runNpmCi(appRoot, dir, label) {
  log("setup", `npm ci ${label}…`);
  const r = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    fail(
      `npm ci ${label} en échec — registre @creezio privé : CREEZIO_NPM_TOKEN (PAT read:packages) requis, voir README`,
    );
  }
}

function cmdSetup(appRoot) {
  loadDotEnv(appRoot);
  const server = serverDir(appRoot);
  runNpmCi(appRoot, appRoot, "racine (workspaces)");
  const ui = path.join(server, "ui");
  if (fs.existsSync(path.join(ui, "package.json"))) {
    runNpmCi(appRoot, ui, "server/ui");
  }
  const client = path.join(appRoot, "client");
  if (fs.existsSync(path.join(client, "package.json"))) {
    runNpmCi(appRoot, client, "client");
  }
  log("setup", "build kernel (build:electron)…");
  const b = spawnSync("npm", ["run", "build:electron", "--prefix", "server"], {
    cwd: appRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (b.status !== 0) fail("build kernel en échec");
  console.log("✓ setup terminé — npm run dev pour démarrer");
}

async function main() {
  const { sub, appRoot } = parseArgs(process.argv);
  if (!SUBCOMMANDS.includes(sub)) {
    console.log(
      "Usage: dev-stack.mjs dev|stop|status|setup [--app-root <dir>]\n" +
        "Env: METIER_PORT (défaut 18791, 0=auto), UI_PORT (défaut 18790, 0=auto), METIER_DATA_DIR",
    );
    process.exit(sub ? 1 : 0);
  }
  if (sub === "dev") return cmdDev(appRoot);
  if (sub === "stop") return cmdStop(appRoot);
  if (sub === "status") return cmdStatus(appRoot);
  if (sub === "setup") return cmdSetup(appRoot);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));