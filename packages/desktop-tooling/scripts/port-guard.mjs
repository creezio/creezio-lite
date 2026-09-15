#!/usr/bin/env node
/**
 * Garde de ports dev/test — détection de port occupé + messages actionnables.
 *
 * SoT unique pour le harness e2e (e2e-browser-parcours.mjs), le dev-stack
 * (@creezio/app-runtime/scripts/dev-stack.mjs) et tout script marque.
 *
 * Convention d'erreur (Q2) : un port explicitement demandé (METIER_PORT,
 * UI_PORT…) et occupé = erreur claire avec le PID fautif et la sortie
 * (« npm run stop » ou variable=0 pour un port auto) — jamais d'échec muet
 * ni de 401 trompeurs contre un serveur étranger.
 */
import net from "node:net";
import { execFileSync, execSync } from "node:child_process";

/** Port libre sur l'hôte donné ? */
export function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (free) => {
      sock.destroy();
      resolve(free);
    };
    sock.once("connect", () => done(false));
    sock.once("error", () => done(true));
    sock.setTimeout(400, () => done(true));
  });
}

/** Port libre attribué par l'OS (éphémère). */
export function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => (p ? resolve(p) : reject(new Error("no port"))));
    });
  });
}

/**
 * PIDs écoutant sur le port (best-effort, jamais bloquant).
 * Linux : ss -tlnp / lsof / fuser — Windows : netstat -ano.
 */
export function portHolderPids(port) {
  const pids = new Set();
  const collect = (fn) => {
    try {
      fn();
    } catch {
      /* best-effort */
    }
  };
  if (process.platform === "win32") {
    collect(() => {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(
          new RegExp(`:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i"),
        );
        if (m) pids.add(Number(m[1]));
      }
    });
  } else {
    collect(() => {
      const out = execFileSync("ss", ["-tlnp", `sport = :${port}`], {
        encoding: "utf8",
      });
      for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    });
    if (!pids.size) {
      collect(() => {
        const out = execFileSync(
          "lsof",
          ["-ti", `tcp:${port}`, "-sTCP:LISTEN"],
          { encoding: "utf8" },
        );
        for (const line of out.split(/\r?\n/)) {
          const n = Number(line.trim());
          if (n > 0) pids.add(n);
        }
      });
    }
  }
  return [...pids];
}

/** Ligne « occupé par … » lisible (PID + commande quand disponible). */
export function portHolderLabel(port) {
  const pids = portHolderPids(port);
  if (!pids.length) return "";
  const parts = pids.map((pid) => {
    let cmd = "";
    if (process.platform !== "win32") {
      try {
        cmd = execFileSync("ps", ["-o", "args=", "-p", String(pid)], {
          encoding: "utf8",
        })
          .trim()
          .slice(0, 80);
      } catch {
        /* processus parti entre-temps */
      }
    }
    return cmd ? `PID ${pid} (${cmd})` : `PID ${pid}`;
  });
  return ` par ${parts.join(", ")}`;
}

/**
 * Échoue vite si le port demandé est occupé, avec la sortie de secours.
 * @param {number} port port demandé
 * @param {object} opts envName: nom de la variable (METIER_PORT…),
 *                      stopHint: commande d'arrêt (défaut « npm run stop »)
 */
export function assertPortFree(port, opts = {}) {
  const envName = opts.envName || "METIER_PORT";
  const stopHint = opts.stopHint || "npm run stop";
  const holder = portHolderLabel(port);
  throw new Error(
    `port ${port} occupé${holder} — ${stopHint} ou ${envName}=0 (port auto)`,
  );
}