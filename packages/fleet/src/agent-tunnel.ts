/**
 * Tunnel cloudflared DÉDIÉ au host-agent (T7) — surveillance respawn.
 *
 * L'ingress `agent.{slug}.{zone}` ne passe plus par le cloudflared d'un
 * serveur applicatif du VPS : il vit dans son propre container
 * (`creezio-agent-tunnel`, network host, restart unless-stopped),
 * provisionné à l'enroll par `creezio server-docker enroll` (API CF —
 * même modèle que tunnel-self-provision pour les serveurs).
 *
 * Ce module surveille ce container depuis le host-agent : un cloudflared
 * mort (exited/dead) est redémarré avec un backoff BORNÉ — politique
 * MIROIR de `cloudflared-respawn.ts` (@creezio/host-runtime). Miroir et
 * non import : fleet est Node pur, zéro dépendance runtime (frontière
 * package). Jamais de (re)création de tunnel ici — jamais de POST
 * `cfd_tunnel` : l'enroll est le seul chemin de provision.
 */

/** Nom par défaut du container cloudflared dédié agent (SoT flotte). */
export const AGENT_TUNNEL_CONTAINER = "creezio-agent-tunnel";

export const AGENT_TUNNEL_RESPAWN = {
  /** Redémarrages consécutifs max avant abandon (jusqu'à redevenir sain). */
  maxAttempts: 8,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
  /** Uptime sain après lequel le compteur de pannes est remis à zéro. */
  healthyResetMs: 60_000,
} as const;

export type AgentTunnelRespawnPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  healthyResetMs: number;
};

export type AgentTunnelRespawnDecision =
  | { action: "ignore" }
  | { action: "give-up"; attempt: number; reason: string }
  | { action: "respawn"; attempt: number; delayMs: number; reason: string };

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

/** Overrides ops/tests : `CREEZIO_AGENT_TUNNEL_RESPAWN_{MAX,DELAY_MS,MAX_DELAY_MS,HEALTHY_MS}`. */
export function resolveAgentTunnelRespawnPolicy(
  env: NodeJS.ProcessEnv = process.env,
  base: AgentTunnelRespawnPolicy = AGENT_TUNNEL_RESPAWN,
): AgentTunnelRespawnPolicy {
  return {
    maxAttempts: envInt(
      env,
      "CREEZIO_AGENT_TUNNEL_RESPAWN_MAX",
      base.maxAttempts,
      1,
    ),
    initialDelayMs: envInt(
      env,
      "CREEZIO_AGENT_TUNNEL_RESPAWN_DELAY_MS",
      base.initialDelayMs,
      0,
    ),
    maxDelayMs: envInt(
      env,
      "CREEZIO_AGENT_TUNNEL_RESPAWN_MAX_DELAY_MS",
      base.maxDelayMs,
      0,
    ),
    factor: base.factor,
    healthyResetMs: envInt(
      env,
      "CREEZIO_AGENT_TUNNEL_RESPAWN_HEALTHY_MS",
      base.healthyResetMs,
      0,
    ),
  };
}

/** Backoff exponentiel borné — `attempt` est 1-based. */
export function agentTunnelRespawnDelayMs(
  attempt: number,
  policy: AgentTunnelRespawnPolicy = AGENT_TUNNEL_RESPAWN,
): number {
  const exp = Math.max(0, attempt - 1);
  const raw = policy.initialDelayMs * policy.factor ** exp;
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(raw)));
}

/**
 * Décide ignore (stop volontaire du watch) / respawn / abandon quand le
 * container tunnel est observé mort. Un container resté sain au moins
 * `healthyResetMs` remet le compteur de pannes à zéro — mêmes règles que
 * `shouldRespawnCloudflared` (host-runtime).
 */
export function shouldRespawnAgentTunnel(opts: {
  stopping: boolean;
  consecutiveFailures: number;
  /** Dernier démarrage observé du container (State.StartedAt), null si inconnu. */
  startedAtMs: number | null;
  /** Statut docker observé (exited, dead…) — pour le motif loggué. */
  observedStatus: string;
  nowMs?: number;
  policy?: AgentTunnelRespawnPolicy;
}): AgentTunnelRespawnDecision {
  if (opts.stopping) return { action: "ignore" };
  const policy = opts.policy ?? AGENT_TUNNEL_RESPAWN;
  const now = opts.nowMs ?? Date.now();
  const healthy =
    opts.startedAtMs != null &&
    now - opts.startedAtMs >= policy.healthyResetMs;
  const attempt = (healthy ? 0 : opts.consecutiveFailures) + 1;
  const reason = `container ${opts.observedStatus || "mort"}`;
  if (attempt > policy.maxAttempts) {
    return { action: "give-up", attempt, reason };
  }
  return {
    action: "respawn",
    attempt,
    delayMs: agentTunnelRespawnDelayMs(attempt, policy),
    reason,
  };
}

/** Vue docker minimale consommée par le watch (injectable — tests sans daemon). */
export type AgentTunnelInspect = {
  exists: boolean;
  running: boolean;
  status: string;
  startedAtMs: number | null;
};

export type AgentTunnelWatchDeps = {
  /** Inspect du container — null si absent ; throw = daemon injoignable. */
  inspect: (container: string) => Promise<AgentTunnelInspect | null>;
  /** POST start du container (304 déjà démarré toléré côté impl). */
  start: (container: string) => Promise<void>;
  log: (line: string) => void;
  nowMs?: () => number;
};

export type AgentTunnelWatchStatus = {
  container: string;
  /** Dernier état observé (`running`, `exited`, `absent`, `unknown`…). */
  observed: string;
  consecutiveFailures: number;
  gaveUp: boolean;
  lastRespawnAt: string | null;
};

/**
 * Boucle de surveillance du container tunnel dédié agent — best-effort
 * absolu : aucune erreur ici ne doit toucher le service HTTP de l'agent.
 *
 * - container ABSENT → idle (tunnel dédié pas encore provisionné / hôte
 *   legacy) : loggué une fois, jamais d'erreur ;
 * - container running → compteur remis à zéro après `healthyResetMs` ;
 * - container mort → respawn borné (backoff), abandon après N essais
 *   (repart si le container redevient sain — ex. start manuel).
 */
export function startAgentTunnelWatch(opts: {
  container?: string;
  intervalMs?: number;
  policy?: AgentTunnelRespawnPolicy;
  deps: AgentTunnelWatchDeps;
}): { stop: () => void; getStatus: () => AgentTunnelWatchStatus } {
  const container = opts.container || AGENT_TUNNEL_CONTAINER;
  const intervalMs = Math.max(200, opts.intervalMs ?? 15_000);
  const policy = opts.policy ?? AGENT_TUNNEL_RESPAWN;
  const deps = opts.deps;
  const now = deps.nowMs ?? (() => Date.now());

  let stopping = false;
  let ticking = false;
  let observed = "unknown";
  let consecutiveFailures = 0;
  let gaveUp = false;
  let loggedAbsent = false;
  let loggedDaemonDown = false;
  let pendingRespawnAtMs: number | null = null;
  let lastRespawnAt: string | null = null;

  async function tick(): Promise<void> {
    if (stopping || ticking) return;
    ticking = true;
    try {
      let st: AgentTunnelInspect | null;
      try {
        st = await deps.inspect(container);
      } catch (e) {
        if (!loggedDaemonDown) {
          deps.log(
            `tunnel agent ${container}: docker injoignable (${(e as Error)?.message || e}) — watch en attente`,
          );
          loggedDaemonDown = true;
        }
        observed = "unknown";
        return;
      }
      loggedDaemonDown = false;

      if (!st || !st.exists) {
        observed = "absent";
        pendingRespawnAtMs = null;
        if (!loggedAbsent) {
          deps.log(
            `tunnel agent ${container}: container absent — tunnel dédié non provisionné (creezio server-docker enroll)`,
          );
          loggedAbsent = true;
        }
        return;
      }
      loggedAbsent = false;

      if (st.running) {
        observed = "running";
        pendingRespawnAtMs = null;
        if (
          (consecutiveFailures > 0 || gaveUp) &&
          st.startedAtMs != null &&
          now() - st.startedAtMs >= policy.healthyResetMs
        ) {
          deps.log(
            `tunnel agent ${container}: sain depuis ${Math.round(policy.healthyResetMs / 1000)}s — compteur de pannes remis à zéro`,
          );
          consecutiveFailures = 0;
          gaveUp = false;
        }
        return;
      }

      observed = st.status || "exited";
      if (gaveUp) return;
      if (pendingRespawnAtMs != null) {
        if (now() < pendingRespawnAtMs) return;
        pendingRespawnAtMs = null;
        try {
          await deps.start(container);
          lastRespawnAt = new Date(now()).toISOString();
          deps.log(`tunnel agent ${container}: redémarré (respawn surveillé)`);
        } catch (e) {
          deps.log(
            `tunnel agent ${container}: start KO (${(e as Error)?.message || e})`,
          );
        }
        return;
      }
      const decision = shouldRespawnAgentTunnel({
        stopping,
        consecutiveFailures,
        startedAtMs: st.startedAtMs,
        observedStatus: st.status,
        nowMs: now(),
        policy,
      });
      if (decision.action === "ignore") return;
      if (decision.action === "give-up") {
        gaveUp = true;
        deps.log(
          `tunnel agent ${container}: abandon après ${decision.attempt - 1} respawns (${decision.reason}) — ` +
            `redémarrer manuellement (docker start ${container}) ou relancer l'enroll`,
        );
        return;
      }
      consecutiveFailures = decision.attempt;
      pendingRespawnAtMs = now() + decision.delayMs;
      deps.log(
        `tunnel agent ${container}: ${decision.reason} — respawn ${decision.attempt}/${policy.maxAttempts} dans ${decision.delayMs}ms`,
      );
    } finally {
      ticking = false;
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  void tick();

  return {
    stop: () => {
      stopping = true;
      clearInterval(timer);
    },
    getStatus: () => ({
      container,
      observed,
      consecutiveFailures,
      gaveUp,
      lastRespawnAt,
    }),
  };
}
