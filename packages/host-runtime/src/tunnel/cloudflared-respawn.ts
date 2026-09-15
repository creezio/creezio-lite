/**
 * Politique de respawn borné pour cloudflared in-process.
 *
 * Sans superviseur, un process QUIC mort laisse le hostname public en 525
 * alors que localhost reste 200 (recette / demo / admin, 15-16/08).
 * Le respawn réutilise le token / tunnel id persisté — jamais de POST
 * `cfd_tunnel` ici (`ensureCfTunnel` reste le seul chemin de (re)création).
 */

export const CLOUDFLARED_RESPAWN = {
  /** Respawn consécutifs max avant abandon (jusqu'au prochain `start`). */
  maxAttempts: 8,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
  /** Uptime sain après lequel le compteur de pannes est remis à zéro. */
  healthyResetMs: 60_000,
} as const;

export type CloudflaredRespawnPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  healthyResetMs: number;
};

export type CloudflaredExitInfo = {
  code: number | null;
  signal: NodeJS.Signals | string | null;
};

export type CloudflaredRespawnDecision =
  | { action: "ignore" }
  | { action: "give-up"; attempt: number; reason: string }
  | {
      action: "respawn";
      attempt: number;
      delayMs: number;
      reason: string;
    };

function envInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
): number {
  const raw = String(env[key] || "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

/** Overrides ops/tests : `CREEZIO_CLOUDFLARED_RESPAWN_{MAX,DELAY_MS,MAX_DELAY_MS,HEALTHY_MS}`. */
export function resolveCloudflaredRespawnPolicy(
  env: NodeJS.ProcessEnv = process.env,
  base: CloudflaredRespawnPolicy = CLOUDFLARED_RESPAWN,
): CloudflaredRespawnPolicy {
  return {
    maxAttempts: envInt(
      env,
      "CREEZIO_CLOUDFLARED_RESPAWN_MAX",
      base.maxAttempts,
      1,
    ),
    initialDelayMs: envInt(
      env,
      "CREEZIO_CLOUDFLARED_RESPAWN_DELAY_MS",
      base.initialDelayMs,
      0,
    ),
    maxDelayMs: envInt(
      env,
      "CREEZIO_CLOUDFLARED_RESPAWN_MAX_DELAY_MS",
      base.maxDelayMs,
      0,
    ),
    factor: base.factor,
    healthyResetMs: envInt(
      env,
      "CREEZIO_CLOUDFLARED_RESPAWN_HEALTHY_MS",
      base.healthyResetMs,
      0,
    ),
  };
}

/** Backoff exponentiel borné — `attempt` est 1-based. */
export function cloudflaredRespawnDelayMs(
  attempt: number,
  policy: CloudflaredRespawnPolicy = CLOUDFLARED_RESPAWN,
): number {
  const exp = Math.max(0, attempt - 1);
  const raw = policy.initialDelayMs * policy.factor ** exp;
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(raw)));
}

export function describeCloudflaredExit(exit: CloudflaredExitInfo): string {
  if (exit.signal) return `signal ${exit.signal}`;
  if (exit.code === 0) return "exit 0 (inattendu)";
  if (exit.code == null) return "mort inattendue";
  return `exit ${exit.code}`;
}

/**
 * Décide ignore (stop volontaire) / respawn / abandon.
 * Une mort après `healthyResetMs` d'uptime remet le compteur à zéro.
 */
export function shouldRespawnCloudflared(opts: {
  stopping: boolean;
  consecutiveFailures: number;
  startedAtMs: number | null;
  exit: CloudflaredExitInfo;
  nowMs?: number;
  policy?: CloudflaredRespawnPolicy;
}): CloudflaredRespawnDecision {
  if (opts.stopping) return { action: "ignore" };
  const policy = opts.policy ?? CLOUDFLARED_RESPAWN;
  const now = opts.nowMs ?? Date.now();
  const healthy =
    opts.startedAtMs != null &&
    now - opts.startedAtMs >= policy.healthyResetMs;
  const attempt = (healthy ? 0 : opts.consecutiveFailures) + 1;
  const reason = describeCloudflaredExit(opts.exit);
  if (attempt > policy.maxAttempts) {
    return { action: "give-up", attempt, reason };
  }
  return {
    action: "respawn",
    attempt,
    delayMs: cloudflaredRespawnDelayMs(attempt, policy),
    reason,
  };
}
