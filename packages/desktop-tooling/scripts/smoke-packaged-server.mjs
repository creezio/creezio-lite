#!/usr/bin/env node
/**
 * Smoke headless du serveur Electron packagé (linux-unpacked).
 *
 * Usage :
 *   node …/smoke-packaged-server.mjs [appRoot]
 *   CREEZIO_SMOKE_TIMEOUT_MS=45000 …
 *
 * Exit 0 si process alive + (health HTTP OU log boot OK) sans MODULE_NOT_FOUND.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const appRoot = path.resolve(process.argv[2] || process.cwd());
const timeoutMs = Number(process.env.CREEZIO_SMOKE_TIMEOUT_MS || 45_000);
const unpacked = path.join(appRoot, "dist-electron-server", "linux-unpacked");
const logPath = process.env.CREEZIO_SMOKE_LOG || "/tmp/tf3-smoke-packaged-server.log";

function findBinary() {
  if (!fs.existsSync(unpacked)) {
    throw new Error(`missing ${unpacked} — run pack:linux:server first`);
  }
  const entries = fs.readdirSync(unpacked);
  const preferred = entries.find((n) => /Server$/i.test(n) || /-Server$/i.test(n));
  const candidates = (preferred ? [preferred] : entries)
    .map((n) => path.join(unpacked, n))
    .filter((p) => {
      try {
        const st = fs.statSync(p);
        return st.isFile() && (st.mode & 0o111) !== 0 && !p.endsWith(".so");
      } catch {
        return false;
      }
    })
    .filter((p) => !/chrome|crashpad|sandbox/i.test(path.basename(p)));
  if (!candidates.length) throw new Error(`no executable in ${unpacked}`);
  return candidates[0];
}

function httpGet(url, ms = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: ms }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on("error", () => resolve(0));
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function probeHealth(ports) {
  for (const port of ports) {
    for (const p of [
      "/api/v1/core/health",
      "/api/v1/os/ready",
      "/api/v1/os/status",
      "/api/v1/os/connection",
    ]) {
      const code = await httpGet(`http://127.0.0.1:${port}${p}`);
      // Meili/autres renvoient souvent 404 HTML — exiger 2xx seulement.
      if (code >= 200 && code < 300) return { port, path: p, code };
    }
  }
  return null;
}

function collectListenPorts(rootPid) {
  const r = spawnSync("ss", ["-ltnp"], { encoding: "utf8" });
  if (r.status !== 0) return [];
  // Inclure descendants (xvfb-run → electron).
  const pids = new Set([rootPid]);
  try {
    const pst = spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" });
    const rows = (pst.stdout || "")
      .trim()
      .split("\n")
      .map((l) => l.trim().split(/\s+/).map(Number))
      .filter((a) => a.length === 2 && a[0] > 0);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [pid, ppid] of rows) {
        if (pids.has(ppid) && !pids.has(pid)) {
          pids.add(pid);
          grew = true;
        }
      }
    }
  } catch {
    /* ignore */
  }
  const ports = new Set();
  for (const line of (r.stdout || "").split("\n")) {
    let hit = false;
    for (const pid of pids) {
      if (line.includes(`pid=${pid}`)) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    const m = line.match(/:(\d+)\s/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

const bin = findBinary();
fs.writeFileSync(logPath, "");
console.log(`smoke-packaged-server: bin=${bin}`);
console.log(`smoke-packaged-server: log=${logPath} timeout=${timeoutMs}ms`);

const useXvfb = Boolean(spawnSync("bash", ["-lc", "command -v xvfb-run"]).stdout?.toString().trim());
const args = ["--no-sandbox", "--disable-gpu"];
const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-smoke-home-"));
fs.mkdirSync(path.join(smokeHome, "config"), { recursive: true });
fs.mkdirSync(path.join(smokeHome, "data"), { recursive: true });
const env = {
  ...process.env,
  HOME: smokeHome,
  XDG_CONFIG_HOME: path.join(smokeHome, "config"),
  XDG_DATA_HOME: path.join(smokeHome, "data"),
  ELECTRON_ENABLE_LOGGING: "1",
  ELECTRON_ENABLE_STACK_DUMPING: "1",
  // Skip long n8n npm for smoke of UI/API plane; shell still boots.
  CREEZIO_NATIVE_WARM: process.env.CREEZIO_NATIVE_WARM || "0",
  CREEZIO_NATIVE_WARM_HERMES: process.env.CREEZIO_NATIVE_WARM_HERMES || "0",
};

let child;
if (useXvfb) {
  child = spawn("xvfb-run", ["-a", bin, ...args], {
    cwd: unpacked,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
} else {
  child = spawn(bin, args, {
    cwd: unpacked,
    env: { ...env, DISPLAY: process.env.DISPLAY || "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const logFd = fs.openSync(logPath, "a");
const append = (buf) => {
  fs.writeSync(logFd, buf);
  process.stdout.write(buf);
};
child.stdout?.on("data", append);
child.stderr?.on("data", append);

const started = Date.now();
let ok = false;
let reason = "timeout";
let exitCode = null;
child.on("exit", (code) => {
  exitCode = code;
});

while (Date.now() - started < timeoutMs) {
  await sleep(1000);
  const log = fs.readFileSync(logPath, "utf8");
  // MODULE_NOT_FOUND du main Electron (asar) — pas les stderr children meili/etc.
  if (
    /Error: Cannot find module ['"][^'"]*node_modules/.test(log) ||
    /ERR_MODULE_NOT_FOUND/.test(log) ||
    (/\[main\] ERREUR:/.test(log) && /Cannot find module/.test(log))
  ) {
    reason = "MODULE_NOT_FOUND";
    break;
  }
  if (/\[main\] ERREUR:/.test(log) && !/shell=runtime mounts=/.test(log) && !/api=http:\/\//.test(log)) {
    reason = "main_erreur";
    break;
  }
  if (exitCode !== null && exitCode !== 0) {
    reason = `exit_${exitCode}`;
    break;
  }
  const bootOk =
    /\[boot\] kind=/.test(log) &&
    (/\[nav\] /.test(log) ||
      /shell=runtime/.test(log) ||
      /oauth ready=/.test(log) ||
      /warm différé/.test(log) ||
      /api=http:\/\//.test(log));
  const ports = child.pid ? collectListenPorts(child.pid) : [];
  const apiFromLog = [
    ...log.matchAll(/api=http:\/\/127\.0\.0\.1:(\d+)/g),
    ...log.matchAll(/oauth ready=true public=http:\/\/127\.0\.0\.1:(\d+)/g),
  ].map((m) => Number(m[1]));
  // Ne pas sonder tous les ports du log (Meili 404 ≠ health OS).
  const health = await probeHealth(
    [...new Set([...apiFromLog, ...ports])].filter(Boolean),
  );
  if (health) {
    ok = true;
    reason = `health ${health.path} :${health.port} → ${health.code}`;
    break;
  }
  // boot_ok_alive : exiger [nav] (shell + API exposés). warm différé seul = trop tôt.
  if (
    bootOk &&
    child.exitCode === null &&
    exitCode === null &&
    /\[nav\] shell=/.test(log) &&
    !/\[main\] ERREUR:/.test(log)
  ) {
    ok = true;
    reason = "boot_ok_alive";
    break;
  }
}

try {
  if (child.pid) {
    process.kill(-child.pid, "SIGTERM");
  }
} catch {
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}
await sleep(800);
try {
  child.kill("SIGKILL");
} catch {
  /* ignore */
}
fs.closeSync(logFd);

// Preuve layout kit : {installDir}/data/logs/ (pas Roaming / XDG seul).
const installDataLogs = path.join(unpacked, "data", "logs");
let installDataOk = false;
try {
  if (fs.existsSync(installDataLogs)) {
    const logs = fs.readdirSync(installDataLogs).filter((f) => f.endsWith(".log"));
    installDataOk = logs.length > 0;
    console.log(
      `smoke-packaged-server: install-data logs=${installDataLogs} files=${logs.join(",") || "(aucun)"}`,
    );
  } else {
    console.log(`smoke-packaged-server: install-data ABSENT ${installDataLogs}`);
  }
} catch (e) {
  console.log(
    `smoke-packaged-server: install-data check error: ${e instanceof Error ? e.message : e}`,
  );
}
if (ok && !installDataOk) {
  ok = false;
  reason = "missing_install_data_logs";
}

console.log(`smoke-packaged-server: ${ok ? "OK" : "FAIL"} (${reason})`);
console.log(`smoke-packaged-server: log tail:`);
const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
console.log(lines.slice(-40).join("\n"));
process.exit(ok ? 0 : 1);
