/**
 * Harness Node — même façade HTTP + Meili + OS que le desktop, sans Electron.
 *
 * Boot serveur observable (parité splash desktop) :
 *   - early-listen : `GET /api/v1/os/boot-status` répond dès le début du boot
 *   - une ligne JSONL par transition d'étape (docker logs)
 *   - journal ops `{dataDir}/ops/*.jsonl` (@creezio/observability)
 *   - UI Next standalone servie derrière le port unique (CRM navigateur)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureEntityMeiliFromFeed } from "@creezio/api-kernel";
import { isFeatureEnabled } from "@creezio/brand-config";
import { pluginsRootDir } from "@creezio/platform-core";
import {
  ensureKitOsBinaries,
  kitBinaryPaths,
  listenBrandKernelHttp,
} from "@creezio/host-runtime";
import {
  expectedCountsForFeed,
  maybeBootBrandMeili,
  meiliCoherenceScriptPath,
  runFeedIndexation,
} from "@creezio/search";
import {
  createMcpFacade,
  discoverModuleToolsFromKernel,
} from "@creezio/mcp-facade";
import {
  brandKernelBooter,
  type BrandKernelBoot,
} from "./create-brand-kernel.js";
import { composeBrandOs } from "./compose-brand-os.js";
import { createBootProgressReporter } from "./boot-progress.js";
import {
  listenBrandBootHttp,
  type BrandBootHttpHandle,
} from "./listen-brand-boot-http.js";
import { listenBrandOsHttp } from "./listen-brand-os-http.js";
import {
  anyModuleMachineKeyVerifier,
  createBrandApiKeyModuleVerifier,
  createPluginDiskKeyModuleVerifier,
} from "./module-mount-auth.js";
import {
  mcpSurfaceHandlesPath,
  mountBrandMcpSurface,
} from "./mount-brand-mcp-surface.js";
import {
  hasBrandUiPlane,
  startBrandUiPlane,
  type BrandUiPlaneHandle,
} from "./start-brand-ui-plane.js";
import {
  resolveNativeWarmFlags,
  warmBrandNativeHosts,
} from "./warm-brand-native-hosts.js";
import {
  applyStoredEmailEnv,
  applyStoredLlmEnv,
  harnessTunnelProvisionRequested,
  runHarnessCatalogImportPhase,
  runHarnessFleetPhase,
  applyNativeEmbedNextEnv,
  runHarnessHermesBridgePhase,
  runHarnessPluginsPhase,
  runHarnessTunnelPhase,
} from "./harness-server-phases.js";
import {
  createFleetAccessMount,
  startFleetHeartbeat,
  type FleetHeartbeatHandle,
} from "./fleet-heartbeat.js";
import {
  mountBrandPlatformSurface,
  platformSurfaceHandlesPath,
  type BrandPlatformSurface,
} from "./mount-brand-platform-surface.js";
import { createPluginAclMcpWiring } from "./plugin-acl-wiring.js";
import {
  createApiKeyBearerActorResolver,
  registerHermesHostMcpTools,
} from "./hermes-mcp-host-tools.js";
import { wireAssistantMcp } from "./wire-assistant-mcp.js";
import { createPluginProxyMount } from "./plugin-proxy-mount.js";
import {
  createPluginToolsDiscovery,
  type PluginToolsHostLike,
} from "./plugin-tools-discovery.js";
import {
  browserSidecarRequested,
  startBrandBrowserSidecar,
  type BrandBrowserSidecarHandle,
} from "./wire-brand-browser-sidecar.js";
import type {
  BootBrandKernelFn,
  BrandKernelHarnessHandle,
  StartBrandKernelHarnessConfig,
} from "./types.js";

function resolveBootKernel(
  config: StartBrandKernelHarnessConfig,
): BootBrandKernelFn {
  if (config.bootKernel) return config.bootKernel;
  if (
    config.manifest &&
    config.brandMigrations &&
    config.registerModuleApi
  ) {
    return brandKernelBooter({
      manifest: config.manifest,
      brandMigrations: config.brandMigrations,
      registerModuleApi: config.registerModuleApi,
      beforeBoot: config.beforeBoot,
      enablePlatformServices: config.enablePlatformServices,
      ownerPermissions: config.ownerPermissions,
      permissionGroups: config.permissionGroups,
    });
  }
  throw new Error(
    "startBrandKernelHarness: fournir bootKernel OU manifest+brandMigrations+registerModuleApi",
  );
}

function readAppVersion(appRoot: string): string {
  // Image Docker versionnée (publish --tag X) : la version embarquée prime
  // sur le package.json — /api/v1/core/version = SoT update de flotte.
  const fromEnv = (process.env.CREEZIO_APP_VERSION || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(appRoot, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function startBrandKernelHarness(
  config: StartBrandKernelHarnessConfig,
): Promise<BrandKernelHarnessHandle> {
  const envPort = Number(process.env.METIER_PORT || process.env.PORT || 0);
  const port = config.port ?? (envPort > 0 ? envPort : undefined);
  const dataDir =
    config.dataDir ||
    process.env.METIER_DATA_DIR ||
    fs.mkdtempSync(path.join(os.tmpdir(), `${config.brandId}-kernel-`));
  const desktopProfile = config.desktopProfile || "full";
  const warmFlags =
    desktopProfile === "full"
      ? resolveNativeWarmFlags()
      : { n8n: false, hermes: false };
  const warmNative = warmFlags.n8n || warmFlags.hermes;
  // Plugins ON par défaut (parité composeBrandOs) — OFF si
  // features.plugins=false (feature-off) ou kill-switch CREEZIO_PLUGINS=0.
  const pluginsOn =
    desktopProfile === "full" &&
    process.env.CREEZIO_PLUGINS !== "0" &&
    (!config.manifest || isFeatureEnabled(config.manifest, "plugins"));
  const tunnelRequested =
    desktopProfile === "full" &&
    Boolean(config.manifest) &&
    harnessTunnelProvisionRequested(config.manifest!);

  const boot = createBootProgressReporter({
    brandId: config.brandId,
    dataDir,
    appVersion: readAppVersion(config.appRoot),
    warmNative,
    warmHermes: warmFlags.hermes,
    warmN8n: warmFlags.n8n,
    needTunnel: tunnelRequested,
    needIndex:
      Boolean(config.meiliFeed) &&
      config.skipIndex !== true &&
      process.env.MEILI_SKIP_INDEX !== "1",
  });

  // Étapes serveur dynamiques (parité kit) — visibles dans boot-status dès
  // le early-listen quand la phase est activée.
  if (desktopProfile === "full" && config.catalogHost?.ensureCatalogImported) {
    boot.register("catalog-import", "Import catalogue");
  }
  if (pluginsOn) boot.register("plugins", "Plugins");

  // Early-listen : boot-status disponible dès maintenant sur le port final
  // (Docker/headless — port fixe requis). Handoff plus bas sans coupure.
  let early: BrandBootHttpHandle | null = null;
  if (
    desktopProfile === "full" &&
    port &&
    port > 0 &&
    process.env.CREEZIO_BOOT_HTTP !== "0"
  ) {
    try {
      early = await listenBrandBootHttp({
        brandId: config.brandId,
        port,
        getBootStatus: () => boot.model(),
      });
      console.log(
        `brand-kernel-harness boot-status early sur :${port}/api/v1/os/boot-status`,
      );
    } catch (err) {
      console.warn(
        `[creezio-os] early-listen indisponible: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // P&P : binaires kit (Meili/cloudflared) avant Meili/tunnel — jamais dans la marque.
  if (process.env.CREEZIO_SKIP_KIT_BINARIES !== "1") {
    const bins = await ensureKitOsBinaries();
    if (!bins.ok) {
      console.warn(
        `[creezio-os] harness binaires kit incomplets: ${bins.errors.join("; ") || "meili/cloudflared manquants"}`,
      );
    }
  }

  // Catalogue marque (opt-in env côté marque) — parité boot desktop.
  if (config.catalogHost && desktopProfile === "full") {
    boot.go("catalog", { detail: "Vérification du catalogue…" });
    try {
      const state = await config.catalogHost.ensureCatalogPresent((p) => {
        boot.patch("catalog", {
          detail: p.detail || p.phase,
          percent: p.percent,
        });
      });
      boot.done("catalog", `Catalogue ${state}`);
    } catch (err) {
      boot.error(
        "catalog",
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    boot.skip("catalog");
  }

  boot.go("migrations", { detail: "Migrations SQLite…" });
  const bootKernel = resolveBootKernel(config);
  const kernelBoot = bootKernel({
    userDataDir: dataDir,
  }) as BrandKernelBoot;
  const { api, runtime, close: closeKernel, mails } = kernelBoot;
  // Inbox Hono + getKitMailsStore (bindings marque / SMTP) partagent core.db.
  process.env.CREEZIO_CORE_DB_PATH = runtime.paths.core;
  // Plan de données unique (ADR-single-data-plane) : le plane UI Next lit
  // brand.db via cet env — parité startBrandDesktop.
  process.env.CREEZIO_BRAND_DB_PATH = runtime.paths.brand;
  boot.done("migrations", "Base de données prête");

  // OS marque AVANT la surface plateforme : composeBrandOs garantit un
  // AUTH_SECRET unique/persistant (process.env) — les routes auth/tasks/
  // assistant ne doivent jamais signer avec le fallback dev.
  const resourcesRoot = path.join(config.appRoot, "resources");
  let brandOs = null as ReturnType<typeof composeBrandOs> | null;
  const warmHermes = warmFlags.hermes;
  // Host plugins actif (compose) — utilisé par la découverte MCP + mounts.
  const pluginsHostGetter = (): PluginToolsHostLike | null => {
    if (!pluginsOn || !brandOs) return null;
    try {
      if (brandOs.status().hosts.plugins !== "enabled") return null;
      return brandOs.hostStack.hostPlugins() as PluginToolsHostLike;
    } catch {
      return null;
    }
  };
  if (desktopProfile === "full" && config.manifest) {
    brandOs = composeBrandOs({
      manifest: config.manifest,
      userDataDir: dataDir,
      isPackaged: false,
      resourcesRoot,
      electronDirname: path.join(config.appRoot, "build/electron"),
      ...(config.catalogHost ? { catalogHost: config.catalogHost } : {}),
      // P5 : plugins livrés par la marque (`<appRoot>/plugins/<id>/`)
      // installés au boot (idempotent, jamais d'écrasement).
      pluginSeedDirs: [path.join(config.appRoot, "plugins")],
      // P3 : mount proxy /api/v1/plugins/<id> pendant la vie du sidecar.
      pluginHostHooks: {
        onPluginStarted: (p) => {
          // DB plugin/<id> ouverte (isolation H2 — ctx.db scopé du mount).
          try {
            runtime.openPlugin(p.id);
          } catch {
            /* DB plugin optionnelle */
          }
          api.registerPluginApi(
            p.id,
            createPluginProxyMount({
              pluginId: p.id,
              getPort: () =>
                pluginsHostGetter()
                  ?.getRunningPlugins()
                  .find((r) => r.id === p.id)?.port ?? null,
            }),
          );
        },
        onPluginStopped: (id) => {
          api.unregisterPluginApi(id);
          try {
            runtime.closePlugin(id);
          } catch {
            /* déjà fermée */
          }
        },
      },
    });
    // Secret inbound mails / domaine (provisioner tunnel) → env in-process
    // pour POST /api/v1/email/inbound. Jamais d'écrasement d'un env explicite.
    applyStoredEmailEnv(brandOs, {
      log: (line) => console.log(`[creezio-os] ${line}`),
    });
    // BYOK setup HTTP → process.env pour assistant (même process que le chat).
    applyStoredLlmEnv(brandOs, {
      log: (line) => console.log(`[creezio-os] ${line}`),
    });
    if (warmHermes) boot.register("hermes-bridge", "Pont Hermes ↔ CRM");
    if (brandOs.hostRuntime.fleetAgent) {
      boot.register("fleet", "Agent flotte");
    }
  }

  // Surface plateforme auth/tasks/assistant (Hono) sur le port unique.
  // baseUrl résolue paresseusement (le listen arrive plus bas).
  let advertisedBaseUrl = "";
  let platformSurface: BrandPlatformSurface | null = null;
  // État Meili capturé après son boot (le searchBridge de la surface est
  // lazy — la surface est montée avant).
  let meiliRuntime: { host: string; masterKey: string } | null = null;
  let meiliReindexInFlight: Promise<unknown> | null = null;
  // Réindexation complète mutualisée (bridge HTTP /platform/search/reindex ET
  // réindexation post-import catalogue) — jamais deux indexations en vol.
  const triggerMeiliReindex = (): Promise<unknown> | null => {
    const rt = meiliRuntime;
    const feed = config.meiliFeed;
    if (!rt || !feed) return null;
    if (meiliReindexInFlight) return meiliReindexInFlight;
    meiliReindexInFlight = (async () => {
      const result = await runFeedIndexation({
        feed,
        dbPath: runtime.getBrand().path,
        meiliHost: rt.host,
        masterKey: rt.masterKey,
      });
      return { ok: true as const, ready: true, indexed: result.indexed };
    })().finally(() => {
      meiliReindexInFlight = null;
    });
    return meiliReindexInFlight;
  };
  if (desktopProfile === "full") {
    platformSurface = mountBrandPlatformSurface({
      brandId: config.brandId,
      coreDbPath: runtime.paths.core,
      ...(config.ownerPermissions
        ? { ownerPermissions: config.ownerPermissions }
        : {}),
      ...(config.permissionGroups
        ? { permissionGroups: config.permissionGroups }
        : {}),
      // DB métier pour les tools SQL de la config assistant kit par défaut.
      brandDb: () => runtime.getBrand(),
      baseUrl: () => advertisedBaseUrl || `http://127.0.0.1:${port || 0}`,
      // Sync intégrations → n8n : réutilise le bridge Hermes (N8N_API_URL +
      // N8N_API_KEY, clé provisionnée par ensureN8nApiKey). Lazy : la clé
      // n'existe qu'après le warm n8n.
      n8nBridge: () => {
        try {
          const env =
            brandOs?.hostRuntime
              .hostRuntimeContext()
              .getHermesBridgeEnv?.() || {};
          const apiUrl = env.N8N_API_URL || "";
          const apiKey = env.N8N_API_KEY || "";
          return apiUrl && apiKey ? { apiUrl, apiKey } : null;
        } catch {
          return null;
        }
      },
      // Clés IA BYOK en headless : la Configuration web écrit dans le store
      // local-config (comme l'IPC desktop) et hydrate l'env du process
      // kernel — l'assistant (platform surface) les utilise immédiatement.
      llmKeys: {
        get: () => {
          const store = brandOs?.store as unknown as
            | {
                getLlmKeys?: () => {
                  openai?: string | null;
                  anthropic?: string | null;
                };
              }
            | undefined;
          const keys = store?.getLlmKeys?.() ?? {};
          const real = (v: string | null | undefined) =>
            Boolean(String(v || "").trim() && v !== "sk-setup-placeholder");
          return { openai: real(keys.openai), anthropic: real(keys.anthropic) };
        },
        set: (provider, key) => {
          const store = brandOs?.store as unknown as
            | {
                setLlmKey?: (
                  provider: "openai" | "anthropic",
                  key: string | null,
                ) => void;
              }
            | undefined;
          if (!store?.setLlmKey) {
            throw new Error("store BYOK indisponible (OS non composé)");
          }
          store.setLlmKey(provider, key);
          const envKey =
            provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
          if (key) process.env[envKey] = key;
          else delete process.env[envKey];
        },
      },
      // Tunnel headless : actions owner de la Configuration web (start/stop/
      // check-slug/reserve) — mêmes primitives que les IPC tunnel:* desktop.
      tunnelBridge: () => {
        try {
          const tunnel = brandOs?.hostRuntime.tunnelService() as unknown as
            | {
                getTunnelStatus: () => unknown;
                checkTunnelSlug: (slug: string) => Promise<{
                  available: boolean;
                  reason?: string;
                  hostname?: string;
                }>;
                reserveTunnel: (
                  slug: string,
                  localPort: number,
                ) => Promise<
                  | { ok: true; hostname: string; publicUrl: string }
                  | { ok: false; error: string }
                >;
                configureTunnelIngress: (ports: {
                  crmPort: number;
                }) => Promise<void>;
                startCloudflared: () => Promise<void>;
                stopCloudflared: () => void;
              }
            | undefined;
          return tunnel ?? null;
        } catch {
          return null;
        }
      },
      localPort: () => port || 0,
      // Recherche headless : santé Meili + réindexation manuelle (owner).
      // Lazy : Meili boote APRÈS le montage de la surface.
      searchBridge: () => {
        const rt = meiliRuntime;
        const feed = config.meiliFeed;
        if (!rt || !feed) return null;
        const authHeaders = { Authorization: `Bearer ${rt.masterKey}` };
        return {
          health: async () => {
            let meiliOk = false;
            let meiliError: string | null = null;
            try {
              const r = await fetch(`${rt.host}/health`, {
                headers: authHeaders,
              });
              meiliOk = r.ok;
            } catch (err) {
              meiliError = err instanceof Error ? err.message : String(err);
            }
            const sql: Record<string, number> = {};
            try {
              const db = runtime.getBrand();
              for (const [key, table] of Object.entries(feed.countTables)) {
                try {
                  const row = db
                    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
                    .get() as { n?: number } | undefined;
                  sql[key] = Number(row?.n ?? 0);
                } catch {
                  sql[key] = 0;
                }
              }
            } catch {
              /* brand db pas encore prête */
            }
            const meiliCounts: Record<string, number> = {};
            for (const idx of feed.indexes) {
              try {
                const r = await fetch(
                  `${rt.host}/indexes/${idx.uid}/stats`,
                  { headers: authHeaders },
                );
                const j = (await r.json()) as { numberOfDocuments?: number };
                meiliCounts[idx.uid] = Number(j.numberOfDocuments ?? 0);
              } catch {
                meiliCounts[idx.uid] = 0;
              }
            }
            const expected = expectedCountsForFeed(feed, sql);
            const emptyWhileExpected = feed.indexes.find(
              (idx) =>
                (expected[idx.uid] ?? 0) > 0 &&
                (meiliCounts[idx.uid] ?? 0) === 0,
            );
            const stale = !meiliOk || Boolean(emptyWhileExpected);
            return {
              configured: true,
              health: {
                ok: meiliOk,
                ...(meiliError ? { error: meiliError } : {}),
              },
              coherence: {
                stale,
                reason: !meiliOk
                  ? "meili-injoignable"
                  : emptyWhileExpected
                    ? `index vide: ${emptyWhileExpected.uid}`
                    : undefined,
                sql,
                meili: meiliCounts,
              },
            };
          },
          reindex: async () => triggerMeiliReindex(),
        };
      },
    });
  }

  let searchEngine: BrandKernelHarnessHandle["searchEngine"] = "off";
  let meiliStop: (() => void) | null = null;

  if (config.meiliFeed) {
    configureEntityMeiliFromFeed(config.meiliFeed);
    const doIndex =
      config.skipIndex !== true && process.env.MEILI_SKIP_INDEX !== "1";
    boot.go("meili", { detail: "Démarrage Meilisearch…" });
    const kitMeili = kitBinaryPaths().meili;
    const meiliBin =
      config.meiliBinary !== undefined
        ? config.meiliBinary
        : process.env.MEILI_BINARY ||
          kitMeili ||
          path.join(config.appRoot, "resources", "meili");
    if (doIndex) {
      boot.go("index", {
        detail: "Indexation des données…",
        parallel: true,
      });
    }
    const meiliBoot = await maybeBootBrandMeili({
      binaryPath:
        meiliBin && fs.existsSync(meiliBin) ? meiliBin : null,
      dataDir: path.join(dataDir, "meili"),
      userDataDir: dataDir,
      dbPath: runtime.getBrand().path,
      feed: config.meiliFeed,
      index: doIndex,
      // Une réindexation complète (bump schemaVersion, gros catalogue) peut
      // durer plusieurs minutes : elle ne doit jamais retarder le listen ni
      // faire expirer les healthchecks d'update flotte. /search répond
      // `source:"indexing"` tant que l'index n'est pas prêt.
      backgroundIndex: true,
      // Fingerprint persisté à jour (redémarrage sans changement de données
      // ni de schéma) → sauter la réindexation complète : sur un catalogue
      // 85k+ docs elle monopolise CPU/IO plusieurs minutes et dégrade tout
      // le serveur à chaque boot de container.
      skipIfCoherent: true,
      coherencePaths: {
        dbPath: () => runtime.getBrand().path,
        nodeBinary: () => process.execPath,
        nodeScript: (rel) =>
          rel.replace(/\.js$/, ".cjs").endsWith("meili-coherence-query.cjs")
            ? meiliCoherenceScriptPath()
            : rel,
        nodeModulesPathForScripts: () => null,
      },
    });
    searchEngine = meiliBoot.engine;
    if (meiliBoot.meili) {
      meiliRuntime = {
        host: meiliBoot.meili.host,
        masterKey: meiliBoot.meili.masterKey,
      };
      meiliStop = () => meiliBoot.meili?.stop();
    }
    if (meiliBoot.engine === "meili") {
      boot.done("meili", "Meilisearch prêt");
      if (doIndex) {
        if (meiliBoot.indexSkipped) {
          boot.skip("index", "Index à jour (fingerprint) — réindexation sautée");
        } else if (meiliBoot.indexation) {
          // Trackée dans meiliReindexInFlight : une réindexation post-import
          // catalogue doit ATTENDRE la fin de l'indexation de boot avant de
          // relire la DB (sinon deux indexations concurrentes, et le
          // fingerprint périmé pourrait être écrit après le bon).
          meiliReindexInFlight = meiliBoot.indexation.finally(() => {
            meiliReindexInFlight = null;
          });
          void meiliBoot.indexation.then((indexed) => {
            if (indexed) boot.done("index", "Index prêt");
            else
              boot.patch("index", {
                status: "error",
                detail:
                  "Indexation échouée — browse catalogue en erreur (meili_unavailable) jusqu'à réindexation",
              });
          });
        } else {
          boot.done("index", "Index prêt");
        }
      }
    } else {
      // engine "sql-fallback" n'existe plus qu'avec CREEZIO_ALLOW_NO_MEILI=1
      // (dev/tests hors-browse) — sinon maybeBootBrandMeili a throw (fail-closed).
      boot.patch("meili", {
        status: meiliBoot.engine === "sql-fallback" ? "error" : "skip",
        detail:
          meiliBoot.engine === "sql-fallback"
            ? "Meili absent ACCEPTÉ par CREEZIO_ALLOW_NO_MEILI=1 (dev/tests) — browse indexé en SQL visible"
            : "Recherche désactivée",
      });
      if (doIndex) boot.skip("index", "Meili indisponible");
    }
  } else {
    boot.skip("meili", "Pas de feed Meili");
  }

  // P2 : tools plugins découverts par défaut + ACL Product Hub fail-closed
  // (deny cross-layer composé, filtre `see` sur listTools).
  const discoverPluginTools = createPluginToolsDiscovery({
    pluginsHost: pluginsHostGetter,
  });
  const aclWiring = createPluginAclMcpWiring({
    getPolicy: kernelBoot.getPluginAclPolicy,
  });
  // H1 « Hermes cerveau unique » — Bearer opaque (clé CRM service Hermes)
  // vérifié contre `api_keys` et mappé owner (voir hermes-mcp-host-tools.ts).
  const resolveBearerActor = createApiKeyBearerActorResolver({
    getBrandDb: () => {
      try {
        return runtime.getBrand() as unknown as {
          prepare(sql: string): { get(...args: unknown[]): unknown };
        };
      } catch {
        return null;
      }
    },
    getOwnerId: () => {
      try {
        return platformSurface?.runtime.store.getOwner()?.id ?? null;
      } catch {
        return null;
      }
    },
  });
  const mcp = createMcpFacade({
    brandId: config.brandId,
    allowUnauthenticated: true,
    // Secret posé par composeBrandOs (ensureMcpJwtSecret) — permet des
    // acteurs JWT réels (sub/orgId/isOwner) sur listTools/callTool.
    jwtSecret: process.env.MCP_JWT_SECRET || null,
    resolveBearerActor,
    listApiMounts: () => api.listMounts(),
    authorizeToolCall: aclWiring.authorizeToolCall,
    filterPluginToolsForActor: aclWiring.filterPluginToolsForActor,
    discoverToolsBySpace: async () => {
      const brandTools = config.discoverModuleTools
        ? await config.discoverModuleTools(api)
        : [];
      return {
        module: discoverModuleToolsFromKernel(api, brandTools),
        plugin: discoverPluginTools(),
      };
    },
  });
  mcp.registerTool({
    name: "module.platform.list_mounts",
    description: "Liste mounts API",
    space: "module",
    ownerId: "platform",
    handler: async () => ({
      ok: true,
      content: { mounts: api.listMounts() },
    }),
  });
  // Assistant chat (surface plateforme) découvre les tools métier via MCP.
  wireAssistantMcp(mcp);
  // H1/H4 — tools host tasks + workspace pour Hermes (gate acteur interne).
  registerHermesHostMcpTools({
    mcp,
    log: (line) => console.log(`brand-kernel-harness ${line}`),
  });
  if (brandOs) {
    mcp.registerTool({
      name: "module.os.status",
      description: "Statut OS hosts",
      space: "module",
      ownerId: "os",
      handler: async () => ({ ok: true, content: brandOs!.status() }),
    });
  }

  // Surface MCP locale AVANT listen — évite course status=null au premier GET.
  if (
    brandOs &&
    desktopProfile === "full" &&
    process.env.CREEZIO_TUNNEL_LOCAL !== "0" &&
    port &&
    port > 0
  ) {
    const tunnel = brandOs.hostRuntime.tunnelService() as unknown as {
      enableLocalPublicSurface: (o: {
        localPort: number;
        slug?: string;
      }) => { publicMcp: string };
    };
    const local = tunnel.enableLocalPublicSurface({
      localPort: port,
      slug: config.brandId,
    });
    console.log(`brand-kernel-harness tunnel local mcp=${local.publicMcp}`);
  }

  // UI plane Next standalone : proxy activé si le build existe.
  let uiPlane: BrandUiPlaneHandle | null = null;
  const uiAvailable =
    desktopProfile === "full" && hasBrandUiPlane(config.appRoot);

  boot.go("next", { detail: "Serveur HTTP…" });
  let mcpSurface: ReturnType<typeof mountBrandMcpSurface> | null = null;
  if (desktopProfile !== "full" && early) {
    // Profil lite : pas de handoff — libérer le port avant listen kernel.
    await early.close();
    early = null;
  }
  const httpServer =
    desktopProfile === "full"
      ? await listenBrandOsHttp({
          api,
          mcp,
          os: brandOs,
          ...(port && port > 0 ? { port } : {}),
          ...(early ? { existingServer: early.server } : {}),
          getMailsStore: () => mails ?? null,
          getBootStatus: () => boot.model(),
          // Clé machine acceptée sur /api/v1/modules/* : clé API brand
          // (table api_keys) ou clé service plugin sur disque.
          moduleMountMachineKey: anyModuleMachineKeyVerifier(
            createBrandApiKeyModuleVerifier(() => runtime.getBrand()),
            createPluginDiskKeyModuleVerifier(() => pluginsRootDir(dataDir)),
          ),
          ...(uiAvailable
            ? { uiProxyTarget: () => uiPlane?.baseUrl ?? null }
            : {}),
          mcpSurfaceFetch: async (request) => {
            if (!mcpSurface) {
              return new Response(JSON.stringify({ error: "mcp_surface_pending" }), {
                status: 503,
                headers: { "content-type": "application/json" },
              });
            }
            return mcpSurface.app.fetch(request);
          },
          mcpSurfaceHandlesPath,
          ...(platformSurface
            ? {
                platformSurfaceFetch: async (request: Request) =>
                  platformSurface!.app.fetch(request),
                platformSurfaceHandlesPath,
              }
            : {}),
        })
      : await listenBrandKernelHttp({
          api,
          ...(port && port > 0 ? { port } : {}),
        });
  process.env.METIER_BASE_URL = httpServer.baseUrl;
  process.env.MCP_PUBLIC_URL = httpServer.baseUrl;
  process.env.APP_PUBLIC_URL = httpServer.baseUrl;
  advertisedBaseUrl = httpServer.baseUrl;

  if (brandOs && desktopProfile === "full" && config.manifest) {
    // Issuer/resource OAuth MCP : URL tunnel publique quand disponible
    // (parité desktop resolvePublicUrl) — sinon loopback proprement.
    const publicOrigin = () => {
      try {
        const pub = brandOs!.hostRuntime.tunnelService().publicUrlForServer();
        if (pub && /^https:\/\//.test(pub)) return pub;
      } catch {
        /* tunnel non composé */
      }
      return httpServer.baseUrl;
    };
    mcpSurface = mountBrandMcpSurface({
      manifest: config.manifest,
      runtime,
      os: brandOs,
      mcp,
      publicBaseUrl: publicOrigin,
      listKernelMounts: () => api.listMounts(),
      listKernelOperations: () => api.listOperations(),
    });
    console.log(
      `brand-kernel-harness mcp-oauth ready=${mcpSurface.oauthReady()} public=${mcpSurface.publicUrl()}`,
    );
  }

  // Si port auto-assigné : brancher la surface locale après coup.
  if (
    brandOs &&
    desktopProfile === "full" &&
    process.env.CREEZIO_TUNNEL_LOCAL !== "0" &&
    !(port && port > 0)
  ) {
    const tunnel = brandOs.hostRuntime.tunnelService() as unknown as {
      enableLocalPublicSurface: (o: {
        localPort: number;
        slug?: string;
      }) => { publicMcp: string };
    };
    tunnel.enableLocalPublicSurface({
      localPort: httpServer.port,
      slug: config.brandId,
    });
  }

  // CRM navigateur : UI Next standalone derrière le port unique.
  if (uiAvailable) {
    boot.patch("next", { detail: "Démarrage UI Next (CRM)…" });
    uiPlane = await startBrandUiPlane({
      appRoot: config.appRoot,
      metierBaseUrl: httpServer.baseUrl,
    });
    if (uiPlane.kind === "next") {
      boot.done("next", `CRM web prêt (${httpServer.baseUrl}/)`);
    } else {
      boot.patch("next", {
        status: "error",
        detail: "UI Next standalone indisponible — API seule",
      });
    }
  } else {
    boot.done("next", `API prête (${httpServer.baseUrl})`);
  }

  console.log(
    `brand-kernel-harness ${config.brandId} on ${httpServer.baseUrl} data=${dataDir} search=${searchEngine} os=${desktopProfile} ui=${uiPlane?.kind ?? "none"}`,
  );

  boot.go("login", { detail: "Interface disponible" });
  boot.done("login", "Interface disponible");

  const phaseLog = (scope: string) => (line: string) =>
    console.log(`[${scope}] ${line}`);

  // Import catalogue APRÈS le listen : METIER_BASE_URL est posé, l'API
  // kernel répond — l'import projeté ne skippe plus (régression harness).
  if (
    brandOs &&
    desktopProfile === "full" &&
    config.catalogHost?.ensureCatalogImported
  ) {
    const catalogState = await runHarnessCatalogImportPhase({
      boot,
      catalogHost: config.catalogHost,
    });
    // L'indexation Meili du boot est PARALLÈLE (lancée avant le listen pour
    // ne pas retarder les healthchecks) : si l'import vient de modifier
    // brand.db, l'index a été construit sur un état pré-import (potentiellement
    // VIDE — régression prod : recherche vide / fallback SQL lent jusqu'au
    // redémarrage suivant). Réindexer en arrière-plan dès que l'indexation
    // en vol est terminée.
    if (catalogState === "imported" && meiliRuntime && config.meiliFeed) {
      boot.go("index", {
        detail: "Réindexation post-import catalogue…",
        parallel: true,
      });
      void (async () => {
        try {
          await meiliReindexInFlight;
        } catch {
          /* l'indexation de boot a échoué — la réindexation retentera */
        }
        await triggerMeiliReindex();
      })()
        .then(() => boot.done("index", "Index prêt (post-import catalogue)"))
        .catch((err) =>
          boot.patch("index", {
            status: "error",
            detail: `Réindexation post-import échouée : ${
              err instanceof Error ? err.message : String(err)
            }`,
          }),
        );
    }
  }

  // Tunnel Cloudflare auto-provisionné — uniquement sur env CF EXPLICITE
  // (CREEZIO_CF_API_TOKEN / ${PREFIX}_CF_API_TOKEN, via cf.env du stack).
  if (brandOs && tunnelRequested && config.manifest) {
    await runHarnessTunnelPhase({
      boot,
      os: brandOs,
      manifest: config.manifest,
      port: httpServer.port,
      log: phaseLog("tunnel"),
    });
  }

  // Sidecar navigateur IA (variant Docker --browser : CREEZIO_BROWSER_SIDECAR=1).
  let browserSidecar: BrandBrowserSidecarHandle | null = null;
  if (platformSurface && browserSidecarRequested()) {
    boot.register("browser", "Navigateur IA");
    boot.go("browser", { detail: "Démarrage Chromium sidecar…" });
    try {
      browserSidecar = await startBrandBrowserSidecar({
        dataDir,
        sessionCookieName: platformSurface.runtime.sessionCookieName,
        baseUrl: () => httpServer.baseUrl,
        store: platformSurface.runtime.store,
        onLog: (line) => console.log(`[browser-sidecar] ${line}`),
      });
      platformSurface.attachSidecar(browserSidecar);
      boot.done(
        "browser",
        `Chromium prêt (${browserSidecar.display ? `display ${browserSidecar.display}` : "headless"})`,
      );
    } catch (err) {
      boot.error(
        "browser",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Fullstack OS ready : ensure/start natifs depuis le kit (pas la marque).
  // n8n et Hermes sont découplés : CREEZIO_NATIVE_WARM_N8N=0 ne skippe
  // JAMAIS Hermes. VPS create pose WARM=1 + HERMES=1 (pas tunnel-local).
  if (brandOs && warmNative) {
    if (warmFlags.n8n) {
      boot.go("n8n", { detail: "Warm n8n…", parallel: true });
    } else {
      boot.skip(
        "n8n",
        "n8n skip (CREEZIO_NATIVE_WARM_N8N=0 ou CREEZIO_NATIVE_WARM=0) — Hermes indépendant",
      );
      console.log(
        "brand-kernel-harness native : n8n skip — Hermes continue (Work n'exige pas n8n)",
      );
    }
    if (warmHermes) {
      boot.go("hermes", { detail: "Warm Hermes…", parallel: true });
    }
    // Webhooks n8n : URL publique (tunnel réel si provisionné, sinon la
    // surface locale) — parité kit WEBHOOK_URL / N8N_EDITOR_BASE_URL.
    let n8nPublicBaseUrl: string | null = null;
    try {
      n8nPublicBaseUrl = brandOs.hostRuntime
        .tunnelService()
        .publicUrlForEmbedService("n8n");
    } catch {
      /* tunnel non composé */
    }
    const warm = await warmBrandNativeHosts(brandOs, {
      start: process.env.CREEZIO_NATIVE_START !== "0",
      n8n: warmFlags.n8n,
      hermes: warmHermes,
      n8nPublicBaseUrl,
    });
    if (warmFlags.n8n) {
      boot.patch("n8n", {
        status: warm.n8n.started ? "done" : "error",
        detail:
          warm.n8n.detail ||
          (warm.n8n.started ? "n8n démarré" : "n8n indisponible"),
        percent: 100,
      });
    }
    if (warmHermes) {
      boot.patch("hermes", {
        status: warm.hermes.started ? "done" : "error",
        detail:
          warm.hermes.detail ||
          (warm.hermes.started ? "Hermes démarré" : "Hermes indisponible"),
        percent: 100,
      });
    }
    console.log(
      `brand-kernel-harness native warm n8n=${JSON.stringify(warm.n8n)} hermes=${JSON.stringify(warm.hermes)}`,
    );

    // Env embeds → process (Work chat / cockpit) avant le bridge ; le bridge
    // réapplique après restart Hermes (clé/port peuvent changer).
    applyNativeEmbedNextEnv(brandOs, { log: phaseLog("native-env") });

    // Pont Hermes ↔ CRM/n8n (parité kit 5a/5a3) : clé CRM + seed contexte
    // + reapplyHermesBridge — derrière le warm Hermes uniquement.
    if (warmHermes && config.manifest) {
      await runHarnessHermesBridgePhase({
        boot,
        os: brandOs,
        manifest: config.manifest,
        port: httpServer.port,
        log: phaseLog("hermes-bridge"),
      });
    }

    // Le plane Next a été spawné AVANT le warm : son env est un snapshot sans
    // la clé gateway Hermes (headless server-docker — le desktop, lui, passe
    // par buildNextHermesEnv au spawn). Sans relance, hermesKanbanConfigured()
    // reste false côté CRM et les tâches IA attendent Hermes pour toujours.
    // Une relance unique après warm+bridge suffit : l'enfant hérite du
    // process.env fraîchement peuplé par applyNativeEmbedNextEnv.
    if (
      uiPlane?.kind === "next" &&
      (process.env.HERMES_API_SERVER_KEY || "").trim()
    ) {
      boot.patch("next", {
        detail: "Relance UI Next (env Hermes)…",
        status: "running",
      });
      try {
        await uiPlane.close();
        uiPlane = await startBrandUiPlane({
          appRoot: config.appRoot,
          metierBaseUrl: httpServer.baseUrl,
        });
        boot.done(
          "next",
          uiPlane.kind === "next"
            ? `CRM web prêt (${httpServer.baseUrl}/) — env Hermes propagé`
            : "UI Next indisponible après relance env Hermes",
        );
        phaseLog("native-env")(
          `UI plane relancé avec env Hermes (kind=${uiPlane.kind})`,
        );
      } catch (err) {
        boot.patch("next", {
          status: "error",
          detail: `Relance UI env Hermes échouée: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // Plugins user (sidecars + control plane loopback) — actifs par défaut.
  let pluginsPhase: Awaited<ReturnType<typeof runHarnessPluginsPhase>> | null =
    null;
  if (brandOs && pluginsOn) {
    pluginsPhase = await runHarnessPluginsPhase({
      boot,
      os: brandOs,
      port: httpServer.port,
      log: phaseLog("plugins"),
    });
  }

  // Agent flotte : no-op propre sur l'endpoint sentinelle ingest-disabled ;
  // endpoint réel via CREEZIO_FLEET_ENDPOINT / ${PREFIX}_FLEET_ENDPOINT.
  let fleetPhase: ReturnType<typeof runHarnessFleetPhase> = null;
  if (brandOs && brandOs.hostRuntime.fleetAgent) {
    fleetPhase = runHarnessFleetPhase({
      boot,
      os: brandOs,
      searchEngine,
      pluginsEnabled: pluginsOn,
      log: phaseLog("fleet"),
    });
  }

  // Auto-inscription flotte + heartbeat (F3) — no-op sans
  // CREEZIO_FLEET_ADMIN_URL / CREEZIO_FLEET_REGISTER_SECRET ; best-effort
  // absolu (un admin down ne touche jamais le boot). Routes de consultation
  // admin → instance : /api/v1/platform/fleet-access/* (Bearer accessToken).
  let fleetHeartbeat: FleetHeartbeatHandle | null = null;
  if (desktopProfile === "full") {
    try {
      api.registerPlatformApi(
        "fleet-access",
        createFleetAccessMount({
          brandId: config.brandId,
          dataDir,
          getVersion: () => readAppVersion(config.appRoot),
          getBootStatus: () => boot.model(),
        }),
      );
      fleetHeartbeat = startFleetHeartbeat({
        brandId: config.brandId,
        dataDir,
        getVersion: () => readAppVersion(config.appRoot),
        getBootStatus: () => {
          const m = boot.model() as {
            booting?: boolean;
            headline?: string | null;
          };
          return { booting: m.booting, headline: m.headline ?? null };
        },
        getHealth: () => {
          const m = boot.model() as {
            booting?: boolean;
            steps?: Array<{ status?: string }>;
          };
          if (m.booting) return "booting";
          return (m.steps || []).some((s) => s.status === "error")
            ? "degraded"
            : "ok";
        },
        getServerUrl: () => {
          try {
            const pub = brandOs?.hostRuntime
              .tunnelService()
              .publicUrlForServer();
            if (pub && /^https:\/\//.test(pub)) return pub;
          } catch {
            /* tunnel non composé */
          }
          return httpServer.baseUrl;
        },
        log: phaseLog("fleet-heartbeat"),
      });
      if (fleetHeartbeat) {
        console.log(
          `brand-kernel-harness heartbeat flotte actif (état ${fleetHeartbeat.stateFile})`,
        );
      }
    } catch (err) {
      // Jamais bloquant pour le boot.
      console.warn(
        `[fleet-heartbeat] init: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  boot.complete(`Serveur ${config.brandId} prêt`);

  const close = async () => {
    // Ordre critique : le chemin DB d'abord, les sidecars ensuite. Docker
    // stop accorde ~10 s avant SIGKILL — si des sidecars lents (plugins,
    // navigateur, Meili) consomment ce budget AVANT closeKernel(), le
    // process meurt avant la fermeture SQLite et laisse un WAL chaud au
    // boot suivant (corruption « malformed » constatée en prod).
    fleetHeartbeat?.stop();
    fleetPhase?.stop();
    // Tunnel AVANT brandOs.close() : composeBrandOs.close() appelle
    // hostRuntime.resetForTests() qui remet le singleton tunnel à null —
    // stopCloudflared() après coup recréerait un service VIDE et laisserait
    // le process cloudflared vivant (ses pipes stdio retiennent la boucle
    // node → shutdown qui hang jusqu'au SIGKILL). kill() est synchrone et
    // instantané : aucun impact sur le budget de fermeture DB.
    if (brandOs) {
      try {
        brandOs.hostRuntime.tunnelService().stopCloudflared();
      } catch {
        /* tunnel jamais composé */
      }
    }
    try {
      await httpServer.close();
    } catch {
      /* écoute déjà fermée */
    }
    platformSurface?.close();
    await uiPlane?.close();
    brandOs?.close();
    closeKernel();
    // Sidecars sans lien avec la DB — tués après la fermeture SQLite.
    await pluginsPhase?.close();
    meiliStop?.();
    await browserSidecar?.close();
  };

  const shutdown = () => {
    void close().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return {
    baseUrl: httpServer.baseUrl,
    port: httpServer.port,
    dataDir,
    searchEngine,
    desktopProfile,
    api,
    runtime,
    os: brandOs,
    close,
  };
}
