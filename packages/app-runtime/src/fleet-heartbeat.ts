/**
 * Auto-inscription flotte + heartbeat d'un serveur marque (F3).
 *
 * Chaque instance (Docker headless ou desktop serveur) peut s'inscrire
 * TOUTE SEULE dans la DB centrale de l'app admin (module fleet-registry,
 * @creezio/admin) — plus besoin d'un geste opérateur pour qu'un serveur
 * apparaisse dans /flotte avec un statut vivant.
 *
 * Activation : env `CREEZIO_FLEET_ADMIN_URL` + `CREEZIO_FLEET_REGISTER_SECRET`
 * (forwardés par `creezio server-docker create --profile prod` depuis le
 * `.env` marque). Sans ces env : no-op complet (zéro réseau).
 *
 * Contrat BEST-EFFORT ABSOLU : aucun échec (admin down, DNS, 401…) ne doit
 * toucher le boot ni le métier. L'inscription est retentée à chaque tick de
 * heartbeat ; une ré-inscription est idempotente côté admin (rotation des
 * tokens).
 *
 * Double token :
 *   - `accessToken` : généré ICI, envoyé en clair UNE fois au register
 *     (l'admin le chiffre au repos) ; son HASH est gardé localement dans
 *     `{dataDir}/{brandId}-fleet.json` (0600) pour authentifier les routes
 *     de consultation `/api/v1/platform/fleet-access/*` (admin → instance).
 *   - `serverKey` : généré par l'ADMIN, reçu au register, stocké dans le
 *     même fichier ; authentifie les heartbeats (instance → admin).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { ApiMount, ApiRequest } from "@creezio/api-kernel";
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";

type Log = (line: string) => void;

/* ------------------------------------------------------------ version kit */

/**
 * Version lockstep @creezio/platform-core INSTALLÉE (P3.b) — envoyée dans le
 * register + chaque heartbeat (`kitVersion`, avec `architectureVersion`)
 * pour que l'admin flotte réponde « qui tourne avec quelle version du kit ».
 * Champ ADDITIF (protocole flotte v1 dual-accept : non-breaking). Best-effort
 * absolu : introuvable → champ omis, jamais d'échec.
 */
function resolveKitVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    try {
      const pkg = require("@creezio/platform-core/package.json") as {
        version?: string;
      };
      if (typeof pkg.version === "string" && pkg.version) return pkg.version;
    } catch {
      // Pin < 0.17 sans export ./package.json → résolution par l'entrée.
      const entry = require.resolve("@creezio/platform-core");
      let dir = path.dirname(entry);
      for (let i = 0; i < 4; i++) {
        const cand = path.join(dir, "package.json");
        if (fs.existsSync(cand)) {
          const pkg = JSON.parse(fs.readFileSync(cand, "utf8")) as {
            name?: string;
            version?: string;
          };
          if (pkg.name === "@creezio/platform-core" && pkg.version) {
            return pkg.version;
          }
        }
        dir = path.dirname(dir);
      }
    }
  } catch {
    /* platform-core introuvable (harness partiel) → omis */
  }
  return null;
}

const KIT_VERSION = resolveKitVersion();

/* ------------------------------------------------------------- état local */

export type FleetHeartbeatState = {
  serverId: string | null;
  serverKey: string | null;
  /** sha256:<hex> de l'accessToken courant (le clair ne persiste jamais). */
  accessTokenHash: string | null;
  registeredAt: string | null;
};

export function fleetStateFilePath(dataDir: string, brandId: string): string {
  return path.join(dataDir, `${brandId}-fleet.json`);
}

export function readFleetState(file: string): FleetHeartbeatState {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<FleetHeartbeatState>;
    return {
      serverId: raw.serverId ?? null,
      serverKey: raw.serverKey ?? null,
      accessTokenHash: raw.accessTokenHash ?? null,
      registeredAt: raw.registeredAt ?? null,
    };
  } catch {
    return {
      serverId: null,
      serverKey: null,
      accessTokenHash: null,
      registeredAt: null,
    };
  }
}

function writeFleetState(file: string, state: FleetHeartbeatState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* fs sans chmod */
  }
}

function sha256Hex(s: string): string {
  return (
    "sha256:" + crypto.createHash("sha256").update(String(s)).digest("hex")
  );
}

function tokenMatchesHash(token: string, storedHash: string): boolean {
  const a = Buffer.from(sha256Hex(token));
  const b = Buffer.from(String(storedHash || ""));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------ disque data */

/** Taille récursive bornée (budget d'entrées, pas de symlinks) — async. */
async function dirSizeBytes(
  dir: string,
  budget = { entries: 100_000 },
): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    budget.entries -= 1;
    if (budget.entries <= 0) return total;
    if (budget.entries % 500 === 0) {
      await new Promise((r) => setImmediate(r));
    }
    const full = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += await dirSizeBytes(full, budget);
      else if (e.isFile()) total += (await fs.promises.stat(full)).size;
    } catch {
      /* fichier disparu */
    }
  }
  return total;
}

/* -------------------------------------------------------------- heartbeat */

export type StartFleetHeartbeatConfig = {
  brandId: string;
  dataDir: string;
  /** Version applicative (CREEZIO_APP_VERSION / package.json). */
  getVersion: () => string;
  /** Modèle boot-status (splash) — pour booting/bootHeadline. */
  getBootStatus?: () => {
    booting?: boolean;
    headline?: string | null;
  } | null;
  /** Santé agrégée (hosts) — envoyée telle quelle (redactée en amont). */
  getHealth?: () => string | null;
  /** URL d'accès au serveur (tunnel public si connu, sinon loopback). */
  getServerUrl?: () => string | null;
  /** Nom d'instance (défaut env INSTANCE_ID sans préfixe server-). */
  name?: string;
  containerName?: string | null;
  variant?: string | null;
  /** Défaut env CREEZIO_FLEET_ADMIN_URL. */
  adminUrl?: string;
  /** Défaut env CREEZIO_FLEET_REGISTER_SECRET. */
  registerSecret?: string;
  /** Défaut env CREEZIO_FLEET_HOST_ID (hostId si connu, sinon omis). */
  hostId?: string;
  /** Intervalle heartbeat (s) — la réponse register peut l'ajuster. */
  intervalSeconds?: number;
  /** Scan disque data 1 tick sur N (lourd). Défaut 10. */
  diskEveryNTicks?: number;
  log?: Log;
};

export type FleetHeartbeatHandle = {
  stop: () => void;
  /** Un cycle complet (register si besoin + heartbeat) — pour les tests. */
  tick: () => Promise<void>;
  stateFile: string;
};

function resolveInstanceName(cfg: StartFleetHeartbeatConfig): string {
  if (cfg.name) return cfg.name;
  const inst = (process.env.INSTANCE_ID || "").trim();
  if (inst) return inst.replace(/^server-/, "");
  try {
    return os.hostname();
  } catch {
    return "default";
  }
}

async function postJson(
  url: string,
  bearer: string,
  body: unknown,
  timeoutMs = 8000,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non JSON */
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Démarre l'auto-inscription + heartbeat. Retourne `null` (no-op) si
 * CREEZIO_FLEET_ADMIN_URL / CREEZIO_FLEET_REGISTER_SECRET absents.
 * Ne lève JAMAIS — tout échec est loggé et retenté au tick suivant.
 */
export function startFleetHeartbeat(
  cfg: StartFleetHeartbeatConfig,
): FleetHeartbeatHandle | null {
  const adminUrl = (
    cfg.adminUrl ||
    process.env.CREEZIO_FLEET_ADMIN_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  const secret = (
    cfg.registerSecret ||
    process.env.CREEZIO_FLEET_REGISTER_SECRET ||
    ""
  ).trim();
  if (!adminUrl || !secret) return null;

  const log: Log = cfg.log || (() => {});
  const stateFile = fleetStateFilePath(cfg.dataDir, cfg.brandId);
  const name = resolveInstanceName(cfg);
  const hostId = (cfg.hostId || process.env.CREEZIO_FLEET_HOST_ID || "").trim();
  const base = `${adminUrl}/api/v1/modules/fleet-registry`;
  const diskEveryN = Math.max(1, cfg.diskEveryNTicks ?? 10);
  const startedAt = Date.now();

  let state = readFleetState(stateFile);
  let intervalSeconds = cfg.intervalSeconds ?? 90;
  let tickCount = 0;
  let lastDiskBytes: number | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const doRegister = async (): Promise<boolean> => {
    // Nouveau accessToken à CHAQUE inscription (rotation) — le clair part
    // une seule fois vers l'admin, seul son hash persiste localement.
    const accessToken = crypto.randomBytes(24).toString("hex");
    const r = await postJson(`${base}/register`, secret, {
      ...(hostId ? { hostId } : {}),
      brandId: cfg.brandId,
      name,
      containerName:
        cfg.containerName ?? process.env.HOSTNAME ?? undefined,
      serverUrl: cfg.getServerUrl?.() ?? undefined,
      version: cfg.getVersion(),
      kitVersion: KIT_VERSION ?? undefined,
      architectureVersion: ARCHITECTURE_VERSION,
      variant: cfg.variant ?? undefined,
      accessToken,
    });
    if (r.status !== 200 || !r.json?.ok) {
      log(
        `inscription flotte KO (${r.status}${r.json?.error ? ` ${r.json.error}` : ""}) — retentera`,
      );
      return false;
    }
    state = {
      serverId: String(r.json.serverId || ""),
      serverKey: String(r.json.serverKey || ""),
      accessTokenHash: sha256Hex(accessToken),
      registeredAt: new Date().toISOString(),
    };
    writeFleetState(stateFile, state);
    const hb = Number(r.json.heartbeatIntervalSeconds);
    if (Number.isFinite(hb) && hb >= 10) intervalSeconds = hb;
    log(
      `inscrit dans la flotte (serverId=${state.serverId}, rotation=${r.json.rotation === true})`,
    );
    return true;
  };

  const doHeartbeat = async (): Promise<void> => {
    if (!state.serverId || !state.serverKey) return;
    tickCount += 1;
    if (lastDiskBytes === null || tickCount % diskEveryN === 1) {
      try {
        lastDiskBytes = await dirSizeBytes(cfg.dataDir);
      } catch {
        /* disque best-effort */
      }
    }
    const boot = cfg.getBootStatus?.() ?? null;
    const r = await postJson(`${base}/heartbeat`, state.serverKey, {
      serverId: state.serverId,
      version: cfg.getVersion(),
      kitVersion: KIT_VERSION ?? undefined,
      architectureVersion: ARCHITECTURE_VERSION,
      health: cfg.getHealth?.() ?? undefined,
      booting: boot?.booting ?? undefined,
      bootHeadline: boot?.headline ?? undefined,
      diskBytes: lastDiskBytes ?? undefined,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
    if (r.status === 401) {
      // serverKey périmé (rotation côté admin, DB restaurée…) → ré-inscription.
      log("heartbeat 401 — ré-inscription (rotation tokens)");
      state = {
        serverId: null,
        serverKey: null,
        accessTokenHash: state.accessTokenHash,
        registeredAt: null,
      };
      await doRegister();
    } else if (r.status !== 200) {
      log(`heartbeat KO (${r.status}) — retentera`);
    }
  };

  const tick = async (): Promise<void> => {
    try {
      if (!state.serverId || !state.serverKey) {
        const ok = await doRegister();
        if (!ok) return;
      }
      await doHeartbeat();
    } catch (err) {
      // BEST-EFFORT ABSOLU : jamais d'exception hors du tick.
      log(
        `heartbeat flotte: ${err instanceof Error ? err.message : String(err)} — retentera`,
      );
    }
  };

  const schedule = () => {
    if (stopped) return;
    // Jitter ±20 % — étale les heartbeats d'une flotte redémarrée en masse.
    const jitter = 1 + (Math.random() * 0.4 - 0.2);
    timer = setTimeout(
      () => {
        void tick().finally(schedule);
      },
      Math.round(intervalSeconds * 1000 * jitter),
    );
    (timer as { unref?: () => void }).unref?.();
  };

  // Premier cycle rapide (inscription au boot) puis rythme de croisière.
  const first = setTimeout(() => {
    void tick().finally(schedule);
  }, 3_000);
  (first as { unref?: () => void }).unref?.();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(first);
      if (timer) clearTimeout(timer);
    },
    tick,
    stateFile,
  };
}

/* ------------------------------------------------- mount fleet-access */

export type FleetAccessMountOptions = {
  brandId: string;
  dataDir: string;
  getVersion: () => string;
  getBootStatus?: () => unknown;
};

function bearerOf(req: ApiRequest): string {
  const raw = Array.isArray(req.headers?.authorization)
    ? req.headers?.authorization?.[0]
    : req.headers?.authorization;
  const m = String(raw || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1]!.trim() : "";
}

function tailFile(file: string, tail: number): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .slice(-tail);
  } catch {
    return [];
  }
}

function newestFile(dir: string, ext: string): string | null {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .map((f) => {
        const full = path.join(dir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.full ?? null;
  } catch {
    return null;
  }
}

/**
 * Mount platform `fleet-access` — consultation MINIMALE de l'instance par
 * l'admin (Bearer = accessToken remis à l'inscription, vérifié contre le
 * hash local du fichier d'état — relu à chaque requête : suit la rotation).
 *
 *   GET /api/v1/platform/fleet-access/status → version, uptime, boot-status
 *   GET /api/v1/platform/fleet-access/logs   → tail du journal fichier
 *                                              ({dataDir}/logs/*.log)
 *   GET /api/v1/platform/fleet-access/ops    → tail ops JSONL ({dataDir}/ops)
 *
 * Aucune donnée métier. Sans inscription (pas de hash local) : 503.
 */
export function createFleetAccessMount(
  opts: FleetAccessMountOptions,
): ApiMount {
  const startedAt = Date.now();
  const stateFile = fleetStateFilePath(opts.dataDir, opts.brandId);
  return {
    dbLayer: "core",
    handle: async ({ req, subPath }) => {
      if (req.method.toUpperCase() !== "GET") {
        return { status: 405, body: { ok: false, error: "method_not_allowed" } };
      }
      const state = readFleetState(stateFile);
      if (!state.accessTokenHash) {
        return {
          status: 503,
          body: { ok: false, error: "fleet_access_not_provisioned" },
        };
      }
      const bearer = bearerOf(req);
      if (!bearer || !tokenMatchesHash(bearer, state.accessTokenHash)) {
        return { status: 401, body: { ok: false, error: "unauthorized" } };
      }

      if (subPath === "status") {
        return {
          status: 200,
          body: {
            ok: true,
            brandId: opts.brandId,
            version: opts.getVersion(),
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
            serverId: state.serverId,
            boot: opts.getBootStatus?.() ?? null,
          },
        };
      }

      if (subPath === "logs") {
        const tail = Math.min(
          Math.max(Number((req.query?.tail as string) || 200), 1),
          2000,
        );
        const logFile = newestFile(path.join(opts.dataDir, "logs"), ".log");
        if (!logFile) {
          return {
            status: 200,
            body: {
              ok: true,
              lines: [],
              detail: "pas de journal fichier (logs sur stdout — docker logs)",
            },
          };
        }
        return {
          status: 200,
          body: { ok: true, file: path.basename(logFile), lines: tailFile(logFile, tail) },
        };
      }

      if (subPath === "ops") {
        const limit = Math.min(
          Math.max(Number((req.query?.limit as string) || 100), 1),
          1000,
        );
        const opsFile = newestFile(path.join(opts.dataDir, "ops"), ".jsonl");
        const events: unknown[] = [];
        if (opsFile) {
          for (const line of tailFile(opsFile, limit)) {
            try {
              events.push(JSON.parse(line));
            } catch {
              /* ligne partielle */
            }
          }
        }
        return { status: 200, body: { ok: true, events } };
      }

      return { status: 404, body: { ok: false } };
    },
  };
}
