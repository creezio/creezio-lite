/**
 * Phases serveur post-boot du harness Docker headless — parité desktop.
 *
 * Tout ce que le desktop rejouait APRÈS le démarrage de Next (import
 * catalogue, clé CRM Hermes + seed contexte + bridge n8n, plugins, tunnel
 * Cloudflare, agent flotte) vit ici, derrière des flags/env explicites,
 * avec une étape boot-status dédiée et un no-op propre si non configuré.
 *
 * Réutilise les hosts déjà câblés par composeBrandOs — zéro logique métier.
 */
import type { AppManifest } from "@creezio/brand-config";
import { startHostPluginControlPlane } from "@creezio/host-runtime";
import type { BrandOsComposition } from "./compose-brand-os.js";
import type { BootProgressReporter } from "./boot-progress.js";
import type { BrandCatalogHost } from "./types.js";

type Log = (line: string) => void;

/**
 * Défauts catalogue harness/tests : pas de download distant (100+ Mo) sauf
 * opt-in explicite. À appeler AVANT l'import des modules marque (qui lisent
 * `${PREFIX}_CATALOG_*` à l'import).
 *
 * Opt-in prod/Docker : `CREEZIO_CATALOG=1` (profil prod) ou
 * `${PREFIX}_CATALOG_ENABLE=1` / `${PREFIX}_CATALOG_LOCAL_PATH=…` /
 * `${PREFIX}_CATALOG_DISABLE=0`.
 */
export function applyBrandCatalogEnvDefaults(envPrefix: string): void {
  if (process.env.CREEZIO_CATALOG === "1") return;
  if ((process.env[`${envPrefix}_CATALOG_ENABLE`] || "").trim()) return;
  if ((process.env[`${envPrefix}_CATALOG_LOCAL_PATH`] || "").trim()) return;
  if (process.env[`${envPrefix}_CATALOG_DISABLE`] === "0") return;
  process.env[`${envPrefix}_CATALOG_DISABLE`] = "1";
}

/**
 * Expose EMAIL_INBOUND_SECRET / EMAIL_DOMAIN depuis la config locale
 * (posés lors du provisioning tunnel CF) — routes mails inbound in-process.
 * Ne jamais écraser un env explicite opérateur sauf `force` (post-provision).
 */
export function applyStoredEmailEnv(
  os: BrandOsComposition,
  opts?: { force?: boolean; log?: Log },
): Record<string, string> {
  const store = os.store as unknown as {
    getEmailNextEnv?: () => Record<string, string>;
  };
  if (typeof store.getEmailNextEnv !== "function") return {};
  const env = store.getEmailNextEnv();
  const applied: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!v) continue;
    if (!opts?.force && (process.env[k] || "").trim()) continue;
    process.env[k] = v;
    applied[k] = v;
  }
  if (Object.keys(applied).length) {
    opts?.log?.(
      `email env appliqué depuis la config locale: ${Object.keys(applied).join(", ")}`,
    );
  }
  return applied;
}

/**
 * Expose OPENAI_API_KEY / ANTHROPIC_API_KEY depuis le store BYOK
 * (`applyFirstRunSetup` / Configuration → Clés IA) pour le process courant.
 *
 * L'assistant (platform surface) ne lit que `process.env` — sans cette
 * hydration, un setup HTTP Docker persiste la clé dans `{brand}-config.json`
 * mais le chat reste muet jusqu'à un restart avec env Docker opérateur.
 * Ne jamais écraser un env explicite opérateur sauf `force` (post-setup).
 */
export function applyStoredLlmEnv(
  os: BrandOsComposition,
  opts?: { force?: boolean; log?: Log },
): Record<string, string> {
  const store = os.store as unknown as {
    getLlmKeys?: () => {
      openai?: string | null;
      anthropic?: string | null;
    };
  };
  if (typeof store.getLlmKeys !== "function") return {};
  const keys = store.getLlmKeys() ?? {};
  const mapping: Record<string, string | null | undefined> = {
    OPENAI_API_KEY: keys.openai,
    ANTHROPIC_API_KEY: keys.anthropic,
  };
  const applied: Record<string, string> = {};
  for (const [envKey, raw] of Object.entries(mapping)) {
    const v = String(raw || "").trim();
    if (!v || v === "sk-setup-placeholder") continue;
    if (!opts?.force && (process.env[envKey] || "").trim()) continue;
    process.env[envKey] = v;
    applied[envKey] = v;
  }
  if (Object.keys(applied).length) {
    opts?.log?.(
      `llm env appliqué depuis la config locale: ${Object.keys(applied).join(", ")}`,
    );
  }
  return applied;
}

/** Étape catalog-import : projection snapshot → brand.db via l'API kernel. */
export async function runHarnessCatalogImportPhase(opts: {
  boot: BootProgressReporter;
  catalogHost: BrandCatalogHost;
}): Promise<string> {
  const { boot, catalogHost } = opts;
  if (typeof catalogHost.ensureCatalogImported !== "function") {
    boot.skip("catalog-import", "Pas d'import projeté (marque sans snapshot)");
    return "skipped";
  }
  boot.go("catalog-import", { detail: "Import du catalogue dans la base…" });
  try {
    const state = await catalogHost.ensureCatalogImported((p) => {
      boot.patch("catalog-import", {
        detail: p.detail || p.phase,
        percent: p.percent,
      });
    });
    if (state === "skipped") {
      boot.skip("catalog-import", "Aucun snapshot catalogue présent");
    } else {
      boot.done("catalog-import", `Catalogue ${state}`);
    }
    return typeof state === "string" ? state : "unknown";
  } catch (err) {
    boot.error(
      "catalog-import",
      err instanceof Error ? err.message : String(err),
    );
    return "error";
  }
}

/**
 * Provision tunnel demandée ? Uniquement sur env EXPLICITE (jamais le défaut
 * sandbox de composeBrandOs) — aucun DNS prod créé sans intention opérateur.
 * Contrat 0.10.0 : `CREEZIO_CF_API_TOKEN` (ou `${PREFIX}_CF_API_TOKEN`),
 * livré au conteneur via `cf.env` (600) généré par le CLI — l'instance
 * auto-provisionne son tunnel via l'API Cloudflare (fin du provisioner VPS).
 */
export function harnessTunnelProvisionRequested(
  manifest: AppManifest,
): boolean {
  return Boolean(
    (process.env.CREEZIO_CF_API_TOKEN || "").trim() ||
      (process.env[`${manifest.envPrefix}_CF_API_TOKEN`] || "").trim(),
  );
}

export type TunnelPublicProbeResult = {
  ok: boolean;
  attempts: number;
  lastError?: string;
};

/**
 * Sonde l'état RÉEL du tunnel via l'URL publique (hairpin Cloudflare →
 * cloudflared in-process → app) avec retry + backoff. Seule la réponse
 * publique prouve que le tunnel sert. Budget ~45 s par défaut — un tunnel
 * sain répond en quelques secondes après un restart à froid (502 le temps
 * que cloudflared reconnecte). Lancée en arrière-plan au boot (non fatale).
 */
export async function probeTunnelPublicUrl(
  publicUrl: string,
  opts?: {
    budgetMs?: number;
    requestTimeoutMs?: number;
    log?: Log;
    /**
     * true = timers unref'd (sonde d'arrière-plan au boot : ne retient pas
     * l'event loop d'un process éphémère). Défaut false : un appelant qui
     * AWAIT la sonde (gates, CLI) a besoin de timers ref'd.
     */
    unrefTimers?: boolean;
  },
): Promise<TunnelPublicProbeResult> {
  const budgetMs = opts?.budgetMs ?? 45_000;
  const requestTimeoutMs = opts?.requestTimeoutMs ?? 5_000;
  const url = `${publicUrl.replace(/\/+$/, "")}/api/v1/core/health`;
  const started = Date.now();
  let attempts = 0;
  let lastError = "inconnu";
  let delayMs = 2_000;
  for (;;) {
    attempts += 1;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), requestTimeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: "manual",
      });
      if (res.ok) return { ok: true, attempts };
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
    if (Date.now() - started + delayMs > budgetMs) break;
    opts?.log?.(
      `sonde publique tunnel: ${lastError} — nouvelle tentative dans ${Math.round(delayMs / 1000)}s`,
    );
    await new Promise((r) => {
      const t = setTimeout(r, delayMs);
      if (opts?.unrefTimers) t.unref?.();
    });
    delayMs = Math.min(Math.round(delayMs * 1.6), 10_000);
  }
  return { ok: false, attempts, lastError };
}

export type HarnessTunnelPhaseResult = {
  publicUrl: string | null;
  hostname: string | null;
};

/**
 * Étape tunnel : ensure CF (GET → 404 → recréation, PUT ingress, DNS
 * idempotent) → cloudflared in-process → resync webhooks n8n + env publics
 * (APP_PUBLIC_URL / MCP_PUBLIC_URL / EMAIL_*). Mode unique in-process
 * (fin du sidecar). Piloté par CREEZIO_CF_API_TOKEN / _ACCOUNT_ID /
 * _ZONE_ID (+ _SLUG, _DOMAIN, _UNIVERSAL_SSL) — cf.env du stack.
 */
export async function runHarnessTunnelPhase(opts: {
  boot: BootProgressReporter;
  os: BrandOsComposition;
  manifest: AppManifest;
  port: number;
  log: Log;
}): Promise<HarnessTunnelPhaseResult> {
  const { boot, os, manifest, port, log } = opts;
  const prefix = manifest.envPrefix;
  const tunnel = os.hostRuntime.tunnelService();
  const out: HarnessTunnelPhaseResult = { publicUrl: null, hostname: null };

  boot.go("tunnel", { detail: "Provision du tunnel d'accès distant…" });
  try {
    const store = os.store as unknown as {
      getTunnelConfig: () => {
        slug?: string;
        hostname?: string;
        publicUrl?: string;
        tunnelToken?: string;
      } | null;
    };
    const existing = store.getTunnelConfig();
    const hasRealTunnel = Boolean(
      existing?.tunnelToken && existing.tunnelToken !== "local",
    );
    const slug = (
      process.env.CREEZIO_TUNNEL_SLUG ||
      process.env[`${prefix}_TUNNEL_SLUG`] ||
      (hasRealTunnel ? existing?.slug : "") ||
      manifest.brandId
    )
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");

    if (!hasRealTunnel) {
      const reserved = await tunnel.reserveTunnel(slug, port);
      if (!reserved.ok) {
        throw new Error(`reserve ${slug}: ${reserved.error}`);
      }
      log(`tunnel provisionné ${slug} → ${reserved.publicUrl}`);
    } else {
      log(`tunnel déjà provisionné (${existing?.hostname}) — ensure + run`);
    }
    // Ensure idempotent (GET tunnel → 404/token absent → recréation + CNAME
    // mis à jour, PUT ingress, upsert DNS) puis cloudflared in-process
    // supervisé (respawn borné, même tunnel id — pas de POST cfd_tunnel).
    await tunnel.configureTunnelIngress({ crmPort: port });
    await tunnel.startCloudflared();

    const cfg = store.getTunnelConfig();
    out.publicUrl = cfg?.publicUrl || null;
    out.hostname = cfg?.hostname || null;

    // URLs publiques process (issuer OAuth MCP, slug mails).
    if (out.publicUrl && /^https:\/\//.test(out.publicUrl)) {
      process.env.APP_PUBLIC_URL = out.publicUrl;
      process.env.MCP_PUBLIC_URL = out.publicUrl;
    }
    // Secret inbound mails persisté au provisioning → env in-process.
    applyStoredEmailEnv(os, { force: true, log });

    // n8n a pu démarrer avant le tunnel → réaligner WEBHOOK_URL publique.
    try {
      const pub = tunnel.publicUrlForEmbedService("n8n");
      if (pub) {
        const n8n = os.hostRuntime.n8nHost() as unknown as {
          getRunningN8n: () => unknown;
          applyN8nPublicBaseUrl: (o: {
            publicBaseUrl: string | null;
            connectionMode?: "local" | "remote";
            onLog?: Log;
          }) => Promise<unknown>;
        };
        if (n8n.getRunningN8n()) {
          await n8n.applyN8nPublicBaseUrl({
            publicBaseUrl: pub,
            connectionMode: "local",
            onLog: log,
          });
          log(`n8n webhooks réalignés sur ${pub}`);
        }
      }
    } catch (err) {
      log(
        `resync webhooks n8n reporté: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (out.publicUrl && /^https:\/\//.test(out.publicUrl)) {
      if (process.env.CREEZIO_TUNNEL_PUBLIC_PROBE === "0") {
        boot.done("tunnel", `${out.publicUrl} (sonde publique désactivée)`);
      } else {
        const st = tunnel.getTunnelStatus();
        boot.done(
          "tunnel",
          `${out.publicUrl} (cloudflared ${st.online ? "online" : "démarré"} — sonde publique en arrière-plan)`,
        );
        // Sonde publique en arrière-plan — retry borné, non fatale : le
        // boot ne dépend pas de la propagation DNS/TLS Cloudflare.
        void (async () => {
          const probe = await probeTunnelPublicUrl(out.publicUrl!, {
            log,
            unrefTimers: true,
          });
          log(
            probe.ok
              ? `sonde publique tunnel OK (${probe.attempts} essai(s))`
              : `sonde publique tunnel sans réponse après ${probe.attempts} essais (${probe.lastError}) — non fatal`,
          );
        })().catch(() => {});
      }
    } else {
      const st = tunnel.getTunnelStatus();
      boot.done(
        "tunnel",
        `${out.publicUrl || "configuré"} (cloudflared ${st.online ? "online" : "démarré"})`,
      );
    }
  } catch (err) {
    boot.error(
      "tunnel",
      `${err instanceof Error ? err.message : String(err)} (CRM local reste utilisable)`,
    );
  }
  return out;
}

/**
 * Fusionne getHermesNextEnv / getN8nNextEnv dans process.env (harness
 * same-process). Sur Electron desktop, ces envs vont dans le child Next ;
 * en Docker le chat Work / cockpit health lisent process.env du kernel —
 * sans ça : « Hermes non configuré » / HERMES_API_SERVER_KEY manquante
 * alors que les services sont up.
 */
export function applyNativeEmbedNextEnv(
  os: BrandOsComposition,
  opts?: { log?: Log },
): { hermesKeys: string[]; n8nKeys: string[] } {
  const log = opts?.log || (() => {});
  const hermesKeys: string[] = [];
  const n8nKeys: string[] = [];
  const apply = (
    label: string,
    env: Record<string, string>,
    bucket: string[],
  ) => {
    for (const [k, v] of Object.entries(env)) {
      if (v == null || v === "") continue;
      process.env[k] = v;
      bucket.push(k);
    }
    if (bucket.length) {
      log(
        `${label} env in-process: ${bucket
          .map((k) =>
            /KEY|PASSWORD|TOKEN|SECRET/i.test(k) ? `${k}=set` : `${k}=${env[k]}`,
          )
          .join(" ")}`,
      );
    }
  };
  try {
    const hermes = os.hostRuntime.hermesHost() as unknown as {
      getHermesNextEnv?: (mode: "local" | "remote") => Record<string, string>;
    };
    apply("hermes", hermes.getHermesNextEnv?.("local") || {}, hermesKeys);
  } catch (err) {
    log(
      `hermes next-env: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    const n8n = os.hostRuntime.n8nHost() as unknown as {
      getN8nNextEnv?: (mode: "local" | "remote") => Record<string, string>;
    };
    apply("n8n", n8n.getN8nNextEnv?.("local") || {}, n8nKeys);
  } catch (err) {
    log(`n8n next-env: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { hermesKeys, n8nKeys };
}

/**
 * Étape hermes-bridge : clé CRM Hermes → seed contexte (si la marque en
 * fournit un) → reapplyHermesBridge. Parité desktop phase 5a/5a3.
 */
export async function runHarnessHermesBridgePhase(opts: {
  boot: BootProgressReporter;
  os: BrandOsComposition;
  manifest: AppManifest;
  port: number;
  log: Log;
}): Promise<void> {
  const { boot, os, manifest, port, log } = opts;
  boot.go("hermes-bridge", { detail: "Clé CRM Hermes + bridge n8n…" });
  try {
    let apiKey: string | null = null;
    try {
      const crmKey = await os.hostRuntime
        .hermesCrmKeySurface()
        .ensureHermesCrmApiKey({ log });
      apiKey = crmKey.apiKey;
      log(`crm-key Hermes: ${crmKey.detail}`);
    } catch (err) {
      log(
        `crm-key Hermes indisponible: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (apiKey) {
      // Bridge env in-process (assistant / tools kernel) — clés
      // `${envPrefix}_API_KEY` / `${envPrefix}_API_URL` injectées dans Next.
      const prefix = manifest.envPrefix;
      process.env[`${prefix}_API_KEY`] = apiKey;
      process.env[`${prefix}_API_URL`] = `http://127.0.0.1:${port}`;
    }

    // Seed contexte (prefs, OpenAPI, glossaire) — fourni par la marque via
    // hostHermesSeed ; le stub kit n'expose que seedHermesSkills → skip doux.
    const seed = os.hostStack.hostHermesSeed() as {
      seedHermesContext?: (o: {
        crmPort: number;
        apiKey: string;
        log: Log;
      }) => Promise<{ files: string[]; dir: string; mcpUrl: string }>;
    };
    if (apiKey && typeof seed.seedHermesContext === "function") {
      try {
        const ctx = await seed.seedHermesContext({
          crmPort: port,
          apiKey,
          log,
        });
        log(
          `hermes-context: ${ctx.files.length} fichiers → ${ctx.dir} (mcp ${ctx.mcpUrl})`,
        );
      } catch (err) {
        log(
          `hermes-context reporté: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      log("hermes-context: pas de seed marque (skip)");
    }

    const hermes = os.hostRuntime.hermesHost() as unknown as {
      reapplyHermesBridge: (o: {
        connectionMode: "local" | "remote";
        crmPort: number;
        forceRestart?: boolean;
        forceReason?: string;
        onLog?: Log;
      }) => Promise<{ restarted: boolean; detail: string }>;
    };
    const bridge = await hermes.reapplyHermesBridge({
      connectionMode: "local",
      crmPort: port,
      forceRestart: Boolean(apiKey),
      forceReason: "context+mcp (harness)",
      onLog: log,
    });
    log(`bridge CRM→Hermes: ${bridge.detail}`);
    // Après restart bridge, apiKey/ports Hermes peuvent changer — réinjecter
    // HERMES_API_* pour le chat Work + cockpit (même process que l'API).
    const nextEnv = applyNativeEmbedNextEnv(os, { log });
    boot.done(
      "hermes-bridge",
      `clé=${apiKey ? "ok" : "absente"} bridge ${bridge.restarted ? "réappliqué (restart)" : "à jour"} hermesEnv=${nextEnv.hermesKeys.includes("HERMES_API_SERVER_KEY") ? "ok" : "absent"}`,
    );
  } catch (err) {
    boot.error(
      "hermes-bridge",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Étape plugins : sidecars user + control plane loopback.
 * Actifs par défaut — OFF si features.plugins=false ou CREEZIO_PLUGINS=0
 * (cohérent avec composeBrandOs pluginsFeatureOff).
 */
export async function runHarnessPluginsPhase(opts: {
  boot: BootProgressReporter;
  os: BrandOsComposition;
  port: number;
  log: Log;
}): Promise<{
  startedIds: string[];
  controlUrl: string | null;
  close: () => Promise<void>;
}> {
  const out: {
    startedIds: string[];
    controlUrl: string | null;
    close: () => Promise<void>;
  } = {
    startedIds: [],
    controlUrl: null,
    close: async () => {},
  };
  const { boot, os, port, log } = opts;
  boot.go("plugins", { detail: "Démarrage des plugins…" });
  try {
    const pluginsHost = os.hostStack.hostPlugins() as {
      listPlugins: () => Array<{ manifest: { id: string }; enabled?: boolean }>;
      startEnabledPlugins: (o?: {
        crmPort?: number | null;
      }) => Promise<Array<{ id: string }>>;
      pluginsStatusPayload: () => unknown;
      enablePlugin: (id: string, enabled: boolean) => unknown;
      getRunningPlugins: () => Array<{ id: string }>;
      getPluginLogs: () => string[];
    };
    const started = await pluginsHost.startEnabledPlugins({ crmPort: port });
    out.startedIds = started.map((p) => p.id);
    const plane = await startHostPluginControlPlane({
      ctx: os.hostRuntime.hostRuntimeContext(),
      pluginsHost: pluginsHost as never,
    });
    out.controlUrl = plane.url;
    out.close = async () => {
      try {
        (pluginsHost as unknown as { stopAllPlugins?: () => void })
          .stopAllPlugins?.();
      } catch {
        /* déjà stoppés */
      }
      await plane.close().catch(() => {});
    };
    log(
      `plugins démarrés: ${out.startedIds.join(", ") || "(aucun activé)"} — control API ${plane.url}`,
    );
    boot.done(
      "plugins",
      `${out.startedIds.length} plugin(s) — API ${plane.url}`,
    );
  } catch (err) {
    boot.error("plugins", err instanceof Error ? err.message : String(err));
  }
  return out;
}

/**
 * Étape fleet : startFleetAgent avec hooks headless. L'endpoint sentinelle
 * `…/ingest-disabled` (défaut composeBrandOs) = no-op propre, zéro réseau.
 * Endpoint réel : CREEZIO_FLEET_ENDPOINT / ${PREFIX}_FLEET_ENDPOINT.
 */
export function runHarnessFleetPhase(opts: {
  boot: BootProgressReporter;
  os: BrandOsComposition;
  searchEngine: string;
  pluginsEnabled: boolean;
  log: Log;
}): { stop: () => void } | null {
  const { boot, os, searchEngine, pluginsEnabled, log } = opts;
  boot.go("fleet", { detail: "Agent flotte…" });
  try {
    const getAgent = os.hostRuntime.fleetAgent;
    if (!getAgent) {
      boot.skip("fleet", "features.fleet=false (manifest)");
      return null;
    }
    const agent = getAgent();
    const samples = os.hostRuntime.fleetSamples?.() ?? null;
    agent.startFleetAgent({
      appKind: "server",
      getHealth: () => {
        const hermes = (
          os.hostRuntime.hermesHost() as unknown as {
            getHermesStatusPayload: (m: "local") => { status: string };
          }
        ).getHermesStatusPayload("local");
        const n8n = (
          os.hostRuntime.n8nHost() as unknown as {
            getN8nStatusPayload: (m: "local") => { status: string };
          }
        ).getN8nStatusPayload("local");
        const tun = os.hostRuntime.tunnelService().getTunnelStatus();
        return {
          next: "running",
          meili: searchEngine === "meili" ? "running" : "stopped",
          hermes: hermes.status,
          n8n: n8n.status,
          tunnel: tun.online
            ? "running"
            : tun.configured
              ? "configured"
              : "off",
        };
      },
      ...(pluginsEnabled
        ? {
            getPluginsSummary: () => {
              try {
                const st = (
                  os.hostStack.hostPlugins() as {
                    pluginsStatusPayload: () => {
                      plugins: Array<{
                        manifest: {
                          id: string;
                          name: string;
                          version: string;
                        };
                        enabled: boolean;
                      }>;
                    };
                  }
                ).pluginsStatusPayload();
                return (st.plugins || []).map((p) => ({
                  id: p.manifest.id,
                  name: p.manifest.name,
                  version: p.manifest.version,
                  enabled: p.enabled,
                }));
              } catch {
                return [];
              }
            },
          }
        : {}),
      ...(samples
        ? {
            getAssistantChatsSample: () => samples.sampleAssistantChats(40),
            getHermesChatsSample: () => samples.sampleHermesChats(20),
            getRequestLogsSample: () => samples.sampleRequestLogs(40),
            getUsersSummary: () => samples.sampleUsers(),
            getSessionsSummary: () => samples.sampleSessions(),
          }
        : {}),
    });
    const endpoint = agent.fleetEndpointBase();
    const sentinel = /ingest-disabled/i.test(endpoint);
    log(
      `fleet agent démarré endpoint=${endpoint}${sentinel ? " (sentinelle — aucun envoi)" : ""}`,
    );
    boot.done(
      "fleet",
      sentinel
        ? "Agent prêt (télémétrie désactivée — endpoint sentinelle)"
        : `Agent actif → ${endpoint}`,
    );
    return { stop: () => agent.stopFleetAgent() };
  } catch (err) {
    boot.error("fleet", err instanceof Error ? err.message : String(err));
  }
  return null;
}