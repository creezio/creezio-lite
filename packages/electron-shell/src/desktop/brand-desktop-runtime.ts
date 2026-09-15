/**
 * Runtime desktop plateforme — extrait mécanique du main Electron historique (M12).
 * Comportement préservé ; la marque injecte deps (store, hosts, paths, vertical).
 *
 * P2.a — ce fichier est le MOTEUR DESKTOP PARTAGÉ, pas un runtime mort :
 * le chemin moderne (`startBrandDesktop` → `installBrandOsDesktop`,
 * app-runtime) l'appelle avec des adaptateurs kit ; les clients desktop
 * legacy l'appellent directement avec leurs verticaux. H10 : la compat
 * marque héritée (`legacy-brand-compat.ts`) a été RETIRÉE — les défauts
 * sont génériques (`<PREFIX>_PLUGINS_DIR`, `<brandId>fid`,
 * `<PREFIX>_API_KEY`, preload `preload.js`, `ensureDesktopNode`) et les
 * clients legacy migrent via le codemod `scripts/codemods/H10/`. Ne pas
 * rajouter de branche marque ici.
 */
// @ts-nocheck — types Electron/marque injectés via deps ; shim kit incomplet volontairement.
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { closeAdminWindow, openAdminWindow } from "../admin-window.js";
import { initLogger, log, logError, logFilePath, scoped, setOpsLineHandler } from "@creezio/host-runtime";
import { crashLogHint, crashReportsDir } from "@creezio/host-runtime";
import {
  activateSplashStep,
  completeSplashStep,
  createRemoteSplashSteps,
  createSplashModel,
  estimateEmbedPercent,
  sanitizeSplashDetail,
  splashDataUrl,
  updateSplashStep,
} from "../splash-ui.js";
import { TrayController, applyLaunchAtStartup, installCloseToTray } from "../tray.js";
import {
  checkForUpdatesNow,
  sendUpdateToWebContents,
  setUpdaterRenderer,
  setupAutoUpdater,
} from "../updater.js";
import {
  consumeOpsLine,
  evaluateBootRules,
  getFleetSessionContext,
  initOpsJournal,
  persistBootSummary,
  recordFleetAction,
  sampleFleetActions,
  setFleetSessionContext,
  setOpsJournalHooks,
  track,
  trackDecision,
  trackExternal,
} from "@creezio/observability";
import {
  defaultProfileForAppKind,
  unwrapBootProfileResult,
} from "@creezio/platform-core";
import { isFeatureEnabled } from "@creezio/brand-config";
import { envForNodeScriptSpawn } from "@creezio/host-runtime";
import { remoteOfflineHtml } from "./remote-offline-html.js";

export type BrandDesktopHosts = {
  catalog: () => any;
  factoryReset: () => any;
  fleetAgent: () => any;
  fleetSamples: () => any;
  hermes: () => any;
  hermesCrmKey: () => any;
  hermesSeed: () => any;
  meili: () => any;
  meiliCoherence: () => any;
  n8n: () => any;
  nodeRuntime: () => any;
  pluginAccept: () => any;
  pluginControl: () => any;
  pluginRuntime: () => any;
  pluginTests: () => any;
  plugins: () => any;
  server: () => any;
  tunnel: () => any;
};

export type BrandDesktopPaths = {
  userDataDir: () => string;
  isPackaged: () => boolean;
  resourcesRoot: () => string;
  dbPath: () => string;
  meiliDataDir: () => string;
  nodeBinary: () => string;
  nodeScript: (rel: string) => string;
  nodeModulesPathForScripts: () => string | null | undefined;
  preloadPath: (name: string) => string;
};

export type BrandDesktopVertical = Record<string, any>;

export type BrandDesktopDeps = {
  manifest: any;
  bridgeName: string;
  accentColor: string;
  cssPrefix: string;
  envPrefix: string;
  sessionCookieName: string;
  profileArgPrefix: string;
  defaultDesktopPort: number;
  /** Env Next pour le dossier plugins (défaut : `<envPrefix>_PLUGINS_DIR`). */
  pluginsDirEnvKey?: string;
  /** Query param SiteLink (défaut : `<brandId>fid`). */
  supplierFidQueryParam?: string;
  /** Clé API CRM dans process.env (défaut : `<envPrefix>_API_KEY`). */
  apiKeyEnvName?: string;
  /** Libellé splash Node (ex. « Runtime Node <Produit> »). */
  nodeRuntimeLabel?: string;
  appKind: string;
  bootBehavior: any;
  bootProfileLaunch: any;
  sessionPartition: string;
  deepLinkProtocol: string;
  store: () => any;
  hosts: BrandDesktopHosts;
  paths: BrandDesktopPaths;
  vertical: BrandDesktopVertical;
  createLocalSplashSteps: (opts: {
    needNode: boolean;
    needHermes: boolean;
    needN8n: boolean;
    needTunnel: boolean;
  }) => any;
  electron: any;
};

/**
 * Installe le runtime desktop (handlers app + boot). À appeler APRÈS
 * requestSingleInstanceLock / isolation userData marque.
 */
export function installBrandDesktopRuntime(deps: BrandDesktopDeps): void {
  const {
    app,
    BaseWindow,
    WebContentsView,
    ipcMain,
    session,
    dialog,
    Menu,
    shell,
  } = deps.electron;

  const productName = String(deps.manifest?.client?.productName || "App");
  const productNameServer = String(
    deps.manifest?.server?.productName || `${productName} Server`,
  );
  const nodeLabel = deps.nodeRuntimeLabel || `Runtime Node ${productName}`;
  const pluginsDirEnvKey =
    deps.pluginsDirEnvKey || `${deps.envPrefix}_PLUGINS_DIR`;
  const supplierFidQueryParam =
    deps.supplierFidQueryParam ||
    `${String(deps.manifest?.brandId || "app")}fid`;
  const apiKeyEnvName = deps.apiKeyEnvName || `${deps.envPrefix}_API_KEY`;
  const progressPrefix = `${deps.envPrefix}PROGRESS `;

  async function syncN8nWebhookPublicUrl(onLog?: (line: string) => void): Promise<void> {
    const pub = deps.hosts.tunnel().publicUrlForEmbedService("n8n");
    if (!pub) return;
    const r = await deps.hosts.n8n().applyN8nPublicBaseUrl({
      publicBaseUrl: pub,
      connectionMode: "local",
      onLog: onLog || scoped("n8n"),
    });
    if (r) n8n = r;
  }

  let win: any | null = null;
  let appView: any | null = null;
  let server: any | null = null;
  let meili: any | null = null;
  let hermes: any | null = null;
  let n8n: any | null = null;
  let bridge: BridgeClient | null = null;
  let tabs: any | null = null;
  let aiWorkspaces: AiWorkspaceManager | null = null;
  let aiScreencaster: AiScreencaster | null = null;
  let assistantChrome: AssistantChromeOverlay | null = null;
  let trayController: TrayController | null = null;
  let quitting = false;
  /** true une fois setupAndStart OK — avant ça, X/Alt+F4 quitte (pas close-to-tray). */
  let bootReady = false;
  /** Début du boot local (boîte noire : durée totale boot.done / boot.failed). */
  let bootLocalStartedAt = 0;
  /** true pendant un redémarrage Next (changement de clé BYOK) — ignore child-exit. */
  let restartingServer = false;
  /** Clés réellement injectées dans le dernier process Next (source de vérité runtime). */
  let serverLlmActive = { openai: false, anthropic: false };
  /** Profil actif pour cette session (local embarqué ou remote) — fixé après Continuer. */
  let activeConnectionProfile: any = {
    mode: "local",
    localBind: "127.0.0.1",
    chosen: false,
  };
  /** Base URL chargée dans la WebView CRM (127.0.0.1:port ou URL distante). */
  let activeCrmBaseUrl: string | null = null;
  /** Résolveur du picker de connexion (boot). */
  let connectionChoiceResolver: ((profile: any) => void) | null = null;

  type LlmStatusPayload = {
    openai: boolean;
    anthropic: boolean;
    serverOpenAi: boolean;
    serverAnthropic: boolean;
    /** Offre locale : l'assistant chat exige OpenAI actif côté serveur. */
    assistantReady: boolean;
    restarting: boolean;
  };

  function readStoredLlmFlags(): { openai: boolean; anthropic: boolean } {
    const keys = deps.store().getLlmKeys();
    return { openai: Boolean(keys.openai), anthropic: Boolean(keys.anthropic) };
  }

  function syncServerLlmActiveFromStored(): void {
    serverLlmActive = readStoredLlmFlags();
  }

  /** Splash : uniquement le progrès utile (pas les timeouts Strapi / stack traces). */
  function isSplashProgressLine(line: string): boolean {
    const s = String(line || "").trim();
    if (!s) return false;
    if (
      /strapi|api\.n8n\.io|mcp-servers|timeout of|AxiosError|deprecat|Failed to (fetch|refresh|start Python)|Database ping failed|license SDK|Task Broker|Registered runner|Building workflow|Finished building|Instance registered|Discovered \d+ cluster|Recorded version|N8N_UNVERIFIED|N8N_RUNNERS|N8N_COMPRESSION|Running n8n outside|virtual environment is missing|allowlist|GATEWAY_ALLOW|TELEGRAM_ALLOWED|No env user allowlists/i.test(
        s,
      )
    ) {
      return false;
    }
    return /bootstrap|download|npm install|runtime (déjà|manquant)|spawn (cold|warm)|redémarrage n8n|première initialisation|données déjà présentes|réutilise n8n|déjà prêt|owner:|CLI Hermes|checksum|pip install WebUI|local_trusted|jwt=ok|Node |ready v|UI prêt|attente n8n|signal prêt|charge encore ses modules|Editor is now accessible|Installation runtime|doctor|postgres|migrations|install|venv|gateway|listening|health/i.test(
      s,
    );
  }

  /** Ingress Cloudflare CRM + embeds (ports locaux réels après splash). */
  async function syncTunnelIngress(): Promise<void> {
    if (!server) return;
    await deps.hosts.tunnel().configureTunnelIngress({
      crmPort: server.port,
      n8nPort: deps.vertical.portFromLocalUrl(n8n?.uiUrl),
      hermesPort: deps.vertical.portFromLocalUrl(hermes?.webuiUrl),
    });
  }

  function remoteStatusOpts(): { remoteCrmOrigin?: string | null } {
    return { remoteCrmOrigin: activeConnectionProfile.remoteUrl ?? null };
  }

  /**
   * Statuts hermes/n8n côté CLIENT léger : mêmes formes de payload que les
   * launchers, calculées SANS les modules host-only (exclus du paquet Client).
   * Un client est toujours en mode remote → URLs dérivées du profil rejoint.
   */
  function clientHermesStatusPayload() {
    const pub = deps.vertical.hermesPublicStatus({
      connectionMode: "remote",
      config: deps.store().getHermesEmbedConfig(),
      binaryFound: false,
      running: false,
      apiUrl: null,
      lastError: null,
      version: null,
      remoteCrmOrigin: activeConnectionProfile.remoteUrl ?? null,
    });
    return {
      ...pub,
      webuiStatus: pub.webuiUrl ? ("running" as const) : ("skipped" as const),
      binaryPath: null,
      homeDir: null,
      bootstrapPhase: "idle" as const,
      bootstrapError: null,
      installing: false,
      logs: [] as string[],
    };
  }

  function clientN8nStatusPayload() {
    const pub = deps.vertical.n8nPublicStatus({
      connectionMode: "remote",
      config: deps.store().getN8nEmbedConfig(),
      entryFound: false,
      running: false,
      uiUrl: null,
      lastError: null,
      version: null,
      remoteCrmOrigin: activeConnectionProfile.remoteUrl ?? null,
    });
    return {
      ...pub,
      entryPath: null,
      homeDir: null,
      bootstrapPhase: "idle" as const,
      bootstrapError: null,
      installing: false,
      ownerReady: false,
      logs: [] as string[],
      localUiUrl: null,
      publicWebhookUrl: null,
      listenHost: "127.0.0.1",
      listenPort: 0,
    };
  }

  function llmStatusPayload(): LlmStatusPayload {
    const stored = readStoredLlmFlags();
    return {
      openai: stored.openai,
      anthropic: stored.anthropic,
      serverOpenAi: serverLlmActive.openai,
      serverAnthropic: serverLlmActive.anthropic,
      assistantReady: serverLlmActive.openai,
      restarting: restartingServer,
    };
  }

  function emitLlmStatusChanged(): void {
    try {
      if (appView && !appView.webContents.isDestroyed()) {
        appView.webContents.send("config:llm-status-changed", llmStatusPayload());
      }
    } catch (e) {
      logError("ipc", e);
    }
  }

  function attachNextExitHandler(childServer: any): void {
    childServer.child.on("exit", (code) => {
      log("next", `serveur terminé (code ${code})`);
      if (quitting || restartingServer) return;
      if (code !== 0 && code !== null) {
        deps.vertical.reportCrash("child-exit", { child: "next-server", code });
        if (appView && !appView.webContents.isDestroyed()) {
          void appView.webContents.loadURL(
            errorHtml(
              "Le serveur local s'est arrêté",
              `Le serveur interne de ${productName} s'est arrêté de façon inattendue (code ${code}).`,
            ),
          );
        }
      }
    });
  }

  type RestartNextOpts = {
    /** Forcer la pose du cookie (ex. fin de wizard /setup). */
    forceAutoLogin?: boolean;
    /** URL à charger après restart (ex. /onboarding). */
    navigateTo?: string;
    /** Toujours recharger la vue CRM même si le baseUrl est inchangé. */
    reload?: boolean;
  };

  /**
   * Redémarre le process Next pour réinjecter AUTH_* / BYOK (env figée au spawn).
   * Préserve le port si possible → tunnel Cloudflare inchangé.
   */
  function currentBindHost(): "127.0.0.1" | "0.0.0.0" {
    return activeConnectionProfile.localBind === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  }

  function crmBaseUrl(): string | null {
    return activeCrmBaseUrl || server?.baseUrl || null;
  }

  async function restartNextServer(opts: RestartNextOpts = {}): Promise<{
    ok: boolean;
    error?: string;
    status: LlmStatusPayload;
  }> {
    if (activeConnectionProfile.mode === "remote") {
      return {
        ok: false,
        error: "Mode serveur distant : pas de serveur local à redémarrer",
        status: llmStatusPayload(),
      };
    }
    if (!server) {
      syncServerLlmActiveFromStored();
      emitLlmStatusChanged();
      return { ok: true, status: llmStatusPayload() };
    }
    if (restartingServer) {
      return {
        ok: false,
        error: "Redémarrage du serveur déjà en cours",
        status: llmStatusPayload(),
      };
    }

    restartingServer = true;
    emitLlmStatusChanged();
    const prevPort = server.port;
    const prevBase = server.baseUrl;
    try {
      bridge?.stop();
      bridge = null;

      const old = server;
      server = null;
      old.stop();
      // Laisser le port TCP se libérer (surtout sous Windows / Defender).
      for (let i = 0; i < 20; i++) {
        try {
          const free = await deps.hosts.server().findFreePort(prevPort);
          if (free === prevPort) break;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 250));
      }

      const publicUrl = deps.hosts.tunnel().publicUrlForServer();
      // Préférer l'ancien port pour ne pas casser le tunnel / cookies.
      process.env[`${deps.envPrefix}_DESKTOP_PORT`] = String(prevPort);
      server = await deps.hosts.server().startNextServer({
        meiliHost: meili?.host ?? null,
        meiliMasterKey: meili?.masterKey ?? null,
        bindHost: currentBindHost(),
        extraEnv: {
          ...(publicUrl
            ? { APP_PUBLIC_URL: publicUrl, MCP_PUBLIC_URL: publicUrl }
            : {}),
          ...deps.hosts.hermes().getHermesNextEnv(activeConnectionProfile.mode),
          ...deps.hosts.n8n().getN8nNextEnv(activeConnectionProfile.mode),
          ...deps.store().getEmailNextEnv(),
          // Onglets Données / n8n du Product Hub côté Next (pluginDataPath).
          [pluginsDirEnvKey]: deps.hosts.pluginRuntime().pluginsRootDir(),
        },
        onLog: scoped("next"),
      });
      attachNextExitHandler(server);
      activeCrmBaseUrl = server.baseUrl;
      syncServerLlmActiveFromStored();
      log(
        "main",
        `serveur Next relancé sur ${server.baseUrl} (bind ${currentBindHost()}, BYOK openai=${serverLlmActive.openai} anthropic=${serverLlmActive.anthropic})`,
      );

      if (publicUrl && server.port !== prevPort) {
        try {
          await syncTunnelIngress();
        } catch (e) {
          logError("tunnel", e);
        }
      }

      await startBridgeIfReady();

      const doLogin = opts.forceAutoLogin || deps.store().shouldAutoLoginOnBoot();
      if (doLogin) {
        try {
          await autoLogin(server.baseUrl);
        } catch (e) {
          logError("auto-login", e);
        }
      }

      const target =
        opts.navigateTo != null
          ? `${server.baseUrl}${opts.navigateTo.startsWith("/") ? opts.navigateTo : `/${opts.navigateTo}`}`
          : server.baseUrl;
      const shouldReload =
        Boolean(opts.reload || opts.navigateTo) || server.baseUrl !== prevBase;
      if (appView && !appView.webContents.isDestroyed() && shouldReload) {
        await appView.webContents.loadURL(target).catch(() => {});
      }

      return { ok: true, status: llmStatusPayload() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logError("main", e);
      deps.vertical.reportCrash("boot-failure", {
        step: "next-restart",
        message: message.slice(0, 500),
      });
      return { ok: false, error: message, status: llmStatusPayload() };
    } finally {
      restartingServer = false;
      emitLlmStatusChanged();
    }
  }

  async function restartNextServerForLlm(): Promise<{
    ok: boolean;
    error?: string;
    status: LlmStatusPayload;
  }> {
    return restartNextServer({ reload: false });
  }

  /**
   * Réinjecte HERMES_* dans Next après un spawn Hermes réussi.
   * No-op au boot (Next pas encore up) — évite le double restart.
   * Delta M12p porté plateforme.
   */
  async function maybeRestartNextAfterHermesSpawn(
    hermesSpawned: boolean,
  ): Promise<void> {
    const should =
      typeof deps.vertical.shouldRestartNextAfterHermesStart === "function"
        ? deps.vertical.shouldRestartNextAfterHermesStart({
            hermesSpawned,
            nextServerRunning: Boolean(server),
          })
        : Boolean(hermesSpawned) && Boolean(server);
    if (!should) return;
    log(
      "main",
      "Hermes (re)spawné alors que Next tourne — réinjection HERMES_*…",
    );
    const r = await restartNextServer({ reload: false });
    if (!r.ok) {
      logError(
        "main",
        new Error(r.error || "redémarrage Next après Hermes échoué"),
      );
    }
  }

  /** Exécuteur bridge partagé local/remote (workspaces IA + onglets fournisseurs). */
  function bridgeExecutor() {
    return async (req: any) => {
      if (deps.vertical.isAiWorkspaceActionType(req.type) && aiWorkspaces) {
        return deps.vertical.executeAiWorkspaceAction(
          aiWorkspaces,
          req,
          aiScreencaster ?? undefined,
        );
      }
      // Actions supplier « classiques » : si un espace IA est affiché,
      // cibler son TabManager (sinon owner).
      const activeAi = aiWorkspaces?.getActiveUserId();
      const activeTabs =
        activeAi && aiWorkspaces
          ? aiWorkspaces.getTabs(activeAi)
          : null;
      const targetTabs = activeTabs || tabs!;
      const targetView =
        activeAi && aiWorkspaces
          ? aiWorkspaces.getView(activeAi)
          : appView;
      return deps.vertical.executeSupplierAction(targetTabs, req, {
        onTabOpened: (info: any) => {
          if (targetView) emitSupplierTabOpened(targetView, info);
        },
      });
    };
  }

  /** Screencaster IA posté via la session du bridge courant. */
  function attachAiScreencaster(): void {
    if (!aiWorkspaces) return;
    aiScreencaster = deps.vertical.createAiScreencaster({
      manager: aiWorkspaces,
      postFrame: async (payload) =>
        bridge
          ? bridge.postJson("/api/v1/desktop/screencast/frame", payload)
          : null,
    });
  }

  async function startBridgeIfReady(): Promise<void> {
    if (!server) return;
    const auth = deps.store().getLocalAuth();
    if (!auth) return;
    try {
      bridge?.stop();
      aiScreencaster?.stopAll();
      bridge = deps.vertical.createBridgeClient({
        baseUrl: server.baseUrl,
        authUser: auth.authUser,
        authPassword: auth.authPassword,
        sessionCookieName: deps.sessionCookieName,
        executor: bridgeExecutor(),
        onLog: scoped("bridge"),
      });
      await bridge.start();
      // Vue live : capture CDP des espaces IA, frames POSTées via la session
      // bridge (start/stop pilotés par le serveur au 1er/dernier spectateur).
      attachAiScreencaster();
    } catch (e) {
      logError("bridge", e);
    }
  }

  /**
   * Bridge computer-use en mode REMOTE (client thin) : auth « session » —
   * réutilise le cookie CRM posé par le login UI dans la partition appView.
   * Tant que l'utilisateur n'est pas connecté, le loop du bridge retente avec
   * backoff (aucun credential local sur le poste client).
   */
  async function startRemoteBridge(baseUrl: string): Promise<void> {
    try {
      bridge?.stop();
      aiScreencaster?.stopAll();
      const cookieName = deps.sessionCookieName;
      bridge = deps.vertical.createBridgeClient({
        baseUrl,
        sessionCookieName: cookieName,
        getSessionCookie: async () => {
          try {
            const ses = session.fromPartition(deps.sessionPartition);
            const cookies = await ses.cookies.get({
              url: baseUrl,
              name: cookieName,
            });
            const c = cookies?.[0];
            return c ? `${cookieName}=${c.value}` : null;
          } catch {
            return null;
          }
        },
        deviceId: `desktop-${os.hostname() || "client"}`,
        deviceLabel: `${productName} (${os.hostname() || "poste"})`,
        executor: bridgeExecutor(),
        onLog: scoped("bridge"),
      });
      await bridge.start();
      attachAiScreencaster();
      log("bridge", `bridge remote démarré vers ${baseUrl} (auth session)`);
    } catch (e) {
      logError("bridge", e);
    }
  }

  /** Efface le cookie de session CRM uniquement (pas les partitions fournisseurs). */
  async function clearCrmSessionCookie(baseUrl: string): Promise<void> {
    const ses = session.fromPartition(deps.sessionPartition);
    try {
      await ses.cookies.remove(baseUrl, deps.sessionCookieName);
    } catch {
      /* ignore */
    }
  }


  /** Réaffiche la fenêtre principale (masquée dans le tray, minimisée…). */
  function showMainWindow(): void {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  /**
   * Relance le même exécutable en instance détachée pour un lancement de profil
   * (join/ai) arrivé sur cette instance : le nouveau process prendra son propre
   * userData → son propre lock (aucun conflit avec l'instance courante).
   */
  function spawnProfileInstance(commandLine: string[]): void {
    const profileArgs = commandLine.filter(
      (a) => a.startsWith(`--${deps.profileArgPrefix}-profile`) || a.toLowerCase().startsWith(`${deps.deepLinkProtocol}://`),
    );
    if (!profileArgs.length) return;
    const args = app.isPackaged ? profileArgs : [app.getAppPath(), ...profileArgs];
    try {
      spawn(process.execPath, args, { detached: true, stdio: "ignore" }).unref();
      log("profile", `relance instance profil : ${profileArgs.join(" ")}`);
    } catch (e) {
      logError("profile", e);
    }
  }

  app.on("second-instance", (_event, commandLine) => {
    // Ne pas avaler un lancement de profil : le déléguer à sa propre instance.
    // App Serveur : jamais de profil client — double-clic = refocus fenêtre.
    const launch = deps.vertical.parseProfileArgv(commandLine || []);
    if (deps.appKind !== "server" && launch.mode !== "server") {
      spawnProfileInstance(commandLine || []);
      return;
    }
    if (win && !win.isDestroyed()) {
      showMainWindow();
    }
  });

  /*
   * Deep-link `{protocol}://join/<host>` — lien d'invitation collaborateur humain.
   * Enregistrement du protocole : packagé → simple ; dev → binaire electron +
   * chemin de l'app (pattern officiel Electron).
   */
  try {
    // Le deep-link join appartient à l'app CLIENT (et au legacy) : l'app
    // Serveur ne s'enregistre pas sur le protocole join (installables côte à côte).
    if (deps.bootBehavior.registerDeepLink) {
      if (process.defaultApp) {
        if (process.argv.length >= 2) {
          app.setAsDefaultProtocolClient(deps.deepLinkProtocol, process.execPath, [
            path.resolve(process.argv[1]),
          ]);
        }
      } else {
        app.setAsDefaultProtocolClient(deps.deepLinkProtocol);
      }
    }
  } catch (e) {
    logError("profile", e);
  }

  // macOS : le deep-link arrive via open-url sur l'instance en cours →
  // déléguer au profil join dédié (Windows/Linux passent par argv/second-instance).
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (deps.appKind === "server") return; // l'app Serveur ignore les deep-links join
    const target = deps.vertical.parseJoinDeepLink(url);
    if (!target) return;
    if (
      deps.bootProfileLaunch?.mode === "join" &&
      deps.bootProfileLaunch?.serverUrl === target
    ) {
      showMainWindow();
      return;
    }
    const joinArg = deps.vertical.profileArgFor({ mode: "join", serverUrl: target });
    if (joinArg) spawnProfileInstance([joinArg]);
  });

  /* ────────────────────────── Splash / progression ───────────────────────── */

  /** Écran multi-lignes : étapes, barres, chronos (SoT kit splash-ui). */
  function splashHtmlUrl(): string {
    return splashDataUrl({
      productName: deps.manifest.client.productName,
      bridgeName: deps.bridgeName,
      windowChrome: process.platform === "win32",
      accentColor: deps.accentColor,
      cssPrefix: deps.cssPrefix,
    });
  }

  let splashModel: any | null = null;
  let lastSplashPush = 0;

  function pushSplashModel(force = false): void {
    if (!splashModel || !appView) return;
    const now = Date.now();
    if (!force && now - lastSplashPush < 120) return;
    lastSplashPush = now;
    appView.webContents
      .executeJavaScript(
        `window.__setBoot && window.__setBoot(${JSON.stringify(splashModel)})`,
      )
      .catch(() => {});
  }

  function splashBeginLocal(opts: {
    needNode: boolean;
    needHermes: boolean;
    needN8n: boolean;
    needTunnel: boolean;
  }): void {
    splashModel = createSplashModel(
      deps.createLocalSplashSteps(opts),
      `Préparation de la stack ${deps.manifest.client.productName}…`,
    );
    pushSplashModel(true);
  }

  function splashBeginRemote(): void {
    splashModel = createSplashModel(
      createRemoteSplashSteps(),
      "Connexion au serveur distant…",
    );
    splashModel.footer =
      "Mode Rejoindre — la stack (Hermes / n8n) tourne sur l’hôte.";
    pushSplashModel(true);
  }

  function splashGo(
    id: any,
    opts?: {
      detail?: string;
      percent?: number | null;
      parallel?: boolean;
      headline?: string;
    },
  ): void {
    if (!splashModel) return;
    splashModel = activateSplashStep(splashModel, id, opts);
    pushSplashModel(true);
  }

  function splashPatch(
    id: any,
    patch: {
      detail?: string;
      percent?: number | null;
      status?: "pending" | "running" | "done" | "error" | "skip";
      headline?: string;
    },
  ): void {
    if (!splashModel) return;
    splashModel = updateSplashStep(splashModel, id, patch);
    pushSplashModel();
  }

  function splashDone(id: any, detail = "Terminé"): void {
    if (!splashModel) return;
    splashModel = completeSplashStep(splashModel, id, detail);
    pushSplashModel(true);
  }

  function splashEmbedLine(id: "hermes" | "n8n", line: string): void {
    const detail = sanitizeSplashDetail(line);
    if (!detail) return;
    splashPatch(id, {
      detail,
      percent: estimateEmbedPercent(detail),
      status: "running",
    });
  }

  // L'écran de profils (ex-connectionPickerHtml) vit dans profile-picker-html.ts.

  function errorHtml(title: string, message: string): string {
    return deps.vertical.errorPageDataUrl(title, message);
  }

  function setSplashStatus(text: string): void {
    if (splashModel) {
      splashModel = { ...splashModel, headline: text };
      pushSplashModel();
      return;
    }
    appView?.webContents
      .executeJavaScript(`window.__setStatus && window.__setStatus(${JSON.stringify(text)})`)
      .catch(() => {});
  }

  let lastProgressLog = 0;

  function setSplashProgress(p: any | null): void {
    // Trace throttlée dans le log persistant (diagnostic support à distance).
    if (p && Date.now() - lastProgressLog > 2000) {
      lastProgressLog = Date.now();
      log("setup", `${p.phase} ${p.percent?.toFixed(1) ?? "?"}% — ${p.detail ?? ""}`);
    }
    if (splashModel && p) {
      const id: any =
        p.phase === "index" ? "index" : "catalog";
      const detail = sanitizeSplashDetail(p.detail || "");
      splashPatch(id, {
        status: "running",
        percent: typeof p.percent === "number" ? p.percent : null,
        detail:
          detail ||
          (typeof p.percent === "number"
            ? `${p.percent.toFixed(0)} %`
            : "En cours…"),
        headline:
          id === "index"
            ? "Indexation du catalogue…"
            : p.phase === "verify"
              ? "Vérification du catalogue…"
              : p.phase === "decompress"
                ? "Installation du catalogue…"
                : "Téléchargement du catalogue…",
      });
      return;
    }
    appView?.webContents
      .executeJavaScript(
        `window.__setProgress && window.__setProgress(${JSON.stringify(
          p ? { percent: p.percent, detail: p.detail || "" } : { percent: null, detail: "" },
        )})`,
      )
      .catch(() => {});
  }

  /* ─────────────────────── Sous-process Node vanilla ─────────────────────── */

  /**
   * Migrations SQLite dans un process Node vanilla (ABI better-sqlite3).
   * Retourne la voie réellement empruntée pour un jalon splash honnête.
   */
  function runMigrationsInNode(): Promise<"runner" | "kernel"> {
    const script = deps.paths.nodeScript(path.join("migrations", "runner.js"));
    // Marques native-kernel (factory) : migrations core/brand déjà
    // appliquées in-process par createBrandKernel — le runner.js legacy
    // n'existe pas. Ce n'est pas un « skip » : la base est bien à jour.
    if (!fs.existsSync(script)) {
      log("migrate", "migrations kernel appliquées in-process (pas de runner.js legacy)");
      return Promise.resolve("kernel");
    }
    return new Promise<"runner" | "kernel">((resolve, reject) => {
      const bin = deps.paths.nodeBinary();
      const env = envForNodeScriptSpawn(bin);
      const nm = deps.paths.nodeModulesPathForScripts();
      if (nm) env.NODE_PATH = nm;
      // Packagé : resources/seeds ; aussi exposé via ${envPrefix}_RESOURCES_PATH.
      if (process.resourcesPath) {
        env[`${deps.envPrefix}_RESOURCES_PATH`] = process.resourcesPath;
        const seeds = path.join(process.resourcesPath, "seeds");
        if (!env[`${deps.envPrefix}_SEEDS_DIR`]) env[`${deps.envPrefix}_SEEDS_DIR`] = seeds;
      }
      log(
        "migrate",
        `spawn ${bin} ${script}${env.ELECTRON_RUN_AS_NODE ? " (ELECTRON_RUN_AS_NODE)" : ""}`,
      );
      const child = spawn(bin, [script, deps.paths.dbPath()], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const stderrTail: string[] = [];
      child.stdout?.on("data", (d: Buffer) => {
        for (const lineRaw of d.toString().split("\n")) {
          const s = lineRaw.trim();
          if (!s) continue;
          if (!consumeOpsLine("migrations", s)) log("migrate", s);
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        const s = d.toString().trim();
        stderrTail.push(s);
        if (stderrTail.length > 30) stderrTail.shift();
        log("migrate", `stderr: ${s}`);
      });
      child.on("error", (e) => {
        deps.vertical.reportCrash("child-exit", { child: "migrations", spawnError: e.message });
        reject(e);
      });
      child.on("exit", (code) => {
        if (code === 0) return resolve("runner");
        deps.vertical.reportCrash("child-exit", { child: "migrations", code, stderr: stderrTail.join("\n") });
        reject(new Error(`migrations exit ${code}`));
      });
    });
  }

  /** État disque des données Meili (joint à la décision de readiness). */
  function meiliDiskState(): { dataMsPresent: boolean; dataMsBytes?: number } {
    try {
      const dataMs = path.join(deps.paths.meiliDataDir(), "data.ms");
      if (!fs.existsSync(dataMs)) return { dataMsPresent: false };
      let bytes = 0;
      for (const f of fs.readdirSync(dataMs)) {
        try {
          bytes += fs.statSync(path.join(dataMs, f)).size;
        } catch {
          /* fichier volatil */
        }
      }
      return { dataMsPresent: true, dataMsBytes: bytes };
    } catch {
      return { dataMsPresent: false };
    }
  }

  /**
   * Indexes GED prêts ? Fingerprint + chaque index attendu peuplé si SQL > 0.
   * (remplace l'ancien totalDocs > 0 qui skippait dès que le 1er index était plein)
   */
  async function meiliIndexReady(m: any): Promise<any> {
    const started = Date.now();
    let decision: any;
    try {
      decision = await deps.hosts
        .meiliCoherence()
        .decideMeiliReady(m, deps.paths.dbPath());
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      // La vérification de cohérence est une optimisation de recherche : un
      // script absent/corrompu ne doit jamais bloquer l'ouverture du CRM.
      log("main", `meili.ready skip (cohérence indisponible): ${reason}`);
      trackDecision("meili.ready", "skip-coherence-unavailable", {
        reason: reason.slice(0, 300),
        durationMs: Date.now() - started,
      });
      return null;
    }
    log(
      "main",
      `meili.ready ready=${decision.ready} reason=${decision.reason} ` +
        `sql=${JSON.stringify(decision.sql)} meili=${JSON.stringify(decision.meili)}`,
    );
    trackDecision("meili.ready", decision.ready ? "skip" : "full-reindex", {
      reason: decision.reason,
      durationMs: Date.now() - started,
      ctx: {
        sql: decision.sql,
        meili: decision.meili,
        sqliteSchema: decision.sqliteSchema,
        fingerprintPresent: Boolean(decision.fingerprint),
        fingerprintBuiltAt: decision.fingerprint?.builtAt,
        interruptedPrevious: decision.interruptedPrevious,
        ...meiliDiskState(),
      },
    });
    return decision;
  }

  /**
   * Indexation Meili BLOQUANTE avec progression live (lignes {ENVPREFIX}PROGRESS émises
   * par meili-indexer sur stdout : {done, total} → %, ETA rafraîchie chaque
   * seconde). L'app n'affiche pas la recherche tant que l'index n'est pas prêt.
   */
  function runIndexerWithProgress(m: any): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = deps.paths.nodeScript("meili-indexer.js");
      const bin = deps.paths.nodeBinary();
      const env = envForNodeScriptSpawn(bin);
      const nm = deps.paths.nodeModulesPathForScripts();
      if (nm) env.NODE_PATH = nm;
      env.DB_PATH = deps.paths.dbPath();
      env.MEILI_HOST = m.host;
      env.MEILI_MASTER_KEY = m.masterKey;
      env[`${deps.envPrefix}_APP_VERSION`] = app.getVersion();
      log("indexer", `indexation initiale (${script})`);
      const child = spawn(bin, [script], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      const rate = new (deps.hosts.catalog().RateEstimator)();
      let done = 0;
      let total = 0;
      const stderrTail: string[] = [];

      // ETA rafraîchie chaque seconde même entre deux lots.
      const ticker = setInterval(() => {
        if (total <= 0) return;
        const { eta } = rate.etaFor(done, total);
        setSplashProgress({
          phase: "index",
          percent: (done / total) * 100,
          doneDocs: done,
          totalDocs: total,
          etaSeconds: eta,
          detail: `${done.toLocaleString("fr-FR")} / ${total.toLocaleString("fr-FR")} documents · reste ${deps.hosts.catalog().formatEta(eta)}`,
        });
      }, 1000);

      child.stdout?.on("data", (d: Buffer) => {
        for (const line of d.toString().split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith(progressPrefix)) {
            try {
              const p = JSON.parse(trimmed.slice(progressPrefix.length)) as {
                done: number;
                total: number;
              };
              done = p.done;
              total = p.total;
            } catch {
              /* ligne malformée */
            }
          } else if (!consumeOpsLine("indexer", trimmed)) {
            log("indexer", trimmed);
          }
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        const s = d.toString().trim();
        stderrTail.push(s);
        if (stderrTail.length > 30) stderrTail.shift();
        log("indexer", `stderr: ${s}`);
      });
      child.on("error", (e) => {
        clearInterval(ticker);
        deps.vertical.reportCrash("child-exit", { child: "meili-indexer", spawnError: e.message });
        reject(e);
      });
      child.on("exit", (code) => {
        clearInterval(ticker);
        log("indexer", `terminé (code ${code})`);
        if (code === 0) return resolve();
        deps.vertical.reportCrash("child-exit", {
          child: "meili-indexer",
          code,
          stderr: stderrTail.join("\n"),
        });
        reject(new Error(`indexation Meilisearch échouée (code ${code})`));
      });
    });
  }

  /* ────────────────────────────── Auto-login ─────────────────────────────── */

  /** Pose le cookie de session dans la partition CRM (pas les partitions fournisseurs). */
  async function autoLogin(baseUrl: string): Promise<void> {
    const auth = deps.store().getLocalAuth();
    if (!auth) return;
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: auth.authUser, password: auth.authPassword }),
      signal: AbortSignal.timeout(10000),
    });
    const setCookie = res.headers.get("set-cookie") || "";
    const m = setCookie.match(new RegExp(`${deps.sessionCookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`));
    if (!m) return; // login refusé : l'UI affichera /login
    const ses = session.fromPartition(deps.sessionPartition);
    await ses.cookies.set({
      url: baseUrl,
      name: deps.sessionCookieName,
      value: m[1],
      httpOnly: true,
      sameSite: "lax",
    });
  }

  /* ─────────────────────── Liens externes → onglets ──────────────────────── */

  /** Id de site opaque : entier historique ou UUID marque — jamais NaN. */
  function normalizeSiteId(raw: unknown): number | string {
    if (typeof raw === "string" && raw.trim()) {
      const asNum = Number(raw);
      return Number.isFinite(asNum) && String(asNum) === raw.trim() ? asNum : raw.trim();
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Routage des liens EXTERNES : onglet site intégré + event renderer.
   * SoT = site externe (pas « fournisseur »). Dual-emit wire legacy TF.
   */
  function emitExternalTabOpened(
    view: any,
    info: { tabId: string; siteId: number | string; url: string; title: string },
  ): void {
    const payload = {
      ...info,
      fournisseurId: info.siteId, // miroir déprécié
    };
    try {
      if (!view.webContents.isDestroyed()) {
        view.webContents.send("tabs:external-opened", payload);
        view.webContents.send("tabs:supplier-opened", payload); // alias déprécié
        // Alias historique (certains preload écoutent encore ce nom)
        view.webContents.send("desktop:supplier-tab-opened", payload);
      }
    } catch (e) {
      logError("tabs", e);
    }
  }

  /** @deprecated → emitExternalTabOpened */
  function emitSupplierTabOpened(
    view: any,
    info: { tabId: string; fournisseurId: number | string; url: string; title: string },
  ): void {
    emitExternalTabOpened(view, {
      tabId: info.tabId,
      siteId: info.fournisseurId,
      url: info.url,
      title: info.title,
    });
  }

  /** Manager d’onglets du sender IPC (owner ou espace IA). */
  function tabsManagerForEvent(e: any): any {
    const info = aiWorkspaces?.findByWebContentsId(e.sender.id);
    if (info) {
      const m = aiWorkspaces!.getTabs(info.userId);
      if (m) return m;
    }
    if (!tabs) throw new Error("tabs manager absent");
    return tabs;
  }

  function tabsManagerForView(view: any): any | null {
    try {
      const info = aiWorkspaces?.findByWebContentsId(view.webContents.id);
      if (info) return aiWorkspaces!.getTabs(info.userId);
    } catch {
      /* ignore */
    }
    return tabs;
  }

  function routeExternalLinksToTabs(view: any, baseUrl: string): void {
    const openInTab = (url: string, fournisseurId: number | string) => {
      const manager = tabsManagerForView(view);
      if (!manager) return;
      void manager
        .openTab(fournisseurId, url)
        .then((tab) => {
          const title = tab.view.webContents.isDestroyed()
            ? url
            : tab.view.webContents.getTitle() || url;
          const finalUrl = tab.view.webContents.isDestroyed()
            ? url
            : tab.view.webContents.getURL() || url;
          emitSupplierTabOpened(view, {
            tabId: tab.tabId,
            fournisseurId: tab.fournisseurId,
            url: finalUrl,
            title,
          });
        })
        .catch((e) => {
          logError("tabs", e);
          deps.vertical.reportCrash("tab-error", {
            step: "openInTab",
            url: String(url).slice(0, 300),
            fournisseurId,
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          });
        });
    };

    view.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const u = new URL(url);
        if (u.protocol === "http:" || u.protocol === "https:") {
          if (isBinaryDownloadUrl(url)) {
            // Installeur / archive : navigateur système. Un onglet interne
            // resterait blanc par-dessus l'UI le temps du téléchargement
            // (bug cockpit → Invitations → « téléchargement »).
            void shell.openExternal(url).catch((e) => logError("tabs", e));
          } else if (url.startsWith(baseUrl)) {
            // Lien interne ouvert en _blank : navigation dans la vue CRM.
            void view.webContents.loadURL(url);
          } else {
            // supplierFidQueryParam : id fournisseur (SiteLink).
            const fidParam = supplierFidQueryParam;
            const fid = Number(u.searchParams.get(fidParam) || "0") || 0;
            u.searchParams.delete(fidParam);
            openInTab(u.toString(), fid);
          }
        }
      } catch {
        /* URL invalide : ignorée */
      }
      return { action: "deny" };
    });

    // Lien externe SANS target=_blank : ne jamais quitter l'UI CRM.
    view.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(baseUrl) && !url.startsWith("data:")) {
        event.preventDefault();
        if (isBinaryDownloadUrl(url)) {
          void shell.openExternal(url).catch((e) => logError("tabs", e));
        } else {
          openInTab(url, 0);
        }
      }
    });
  }

  /**
   * URL de binaire téléchargeable (installeurs desktop, archives) : à ouvrir
   * dans le navigateur de l'OS, jamais dans un onglet/vue interne.
   */
  const BINARY_DOWNLOAD_RE = /\.(exe|msi|dmg|pkg|appimage|zip|7z)$/i;
  function isBinaryDownloadUrl(raw: string): boolean {
    try {
      return BINARY_DOWNLOAD_RE.test(new URL(raw).pathname);
    } catch {
      return false;
    }
  }

  /**
   * Garde-fou de l'app Serveur (kind=server) : la fenêtre principale n'affiche
   * QUE le cockpit autonome. Toute navigation même-origin vers l'UI CRM
   * (/dashboard, /admin, /produits…) est rabattue sur /server-cockpit —
   * y compris les navigations in-page du router Next (non annulables).
   */
  function installServerCockpitGuard(view: any, baseUrl: string): void {
    const cockpitUrl = `${baseUrl}${deps.bootBehavior.cockpitPath}`;
    const allowed = (url: string): boolean => {
      if (!url.startsWith(baseUrl)) return true; // externe / data: → handlers existants
      try {
        return deps.vertical.isAllowedServerCockpitPath(new URL(url).pathname);
      } catch {
        return true;
      }
    };
    view.webContents.on("will-navigate", (event, url) => {
      if (!allowed(url)) {
        event.preventDefault();
        log("main", `garde-fou cockpit : navigation bloquée → ${url}`);
        void view.webContents.loadURL(cockpitUrl).catch(() => {});
      }
    });
    view.webContents.on("did-navigate-in-page", (_e, url) => {
      if (!allowed(url)) {
        log("main", `garde-fou cockpit : navigation in-page rabattue → ${url}`);
        void view.webContents.loadURL(cockpitUrl).catch(() => {});
      }
    });
  }

  /* ─────────────────────────────── IPC ───────────────────────────────────── */

  /**
   * Refus attendu d'un canal host-only sur l'app Client : rejet propre côté
   * renderer, mais PAS de deps.vertical.reportCrash (sinon chaque clic sur un bouton non
   * gardé de l'UI distante spammerait le collecteur).
   */
  class HostOnlyRefusedError extends Error {}

  /**
   * ipcMain.handle blindé : toute exception est loggée + rapportée au
   * collecteur (kind "tab-error") puis re-levée en Error propre — le renderer
   * reçoit un rejet de promesse explicite, l'app ne tombe JAMAIS.
   */
  function safeHandle(
    channel: string,
    fn: (event: any, ...args: unknown[]) => unknown,
  ): void {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args);
      } catch (e) {
        logError("ipc", e);
        if (!(e instanceof HostOnlyRefusedError)) {
          deps.vertical.reportCrash("tab-error", {
            step: `ipc:${channel}`,
            args: JSON.stringify(args).slice(0, 500),
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          });
        }
        throw new Error(e instanceof Error ? e.message : String(e));
      }
    });
  }

  /**
   * Variante hôte-uniquement : canaux qui pilotent la stack locale (spawn
   * Hermes/n8n, plugins, tunnel, reindex, setup hôte…). L'app Client
   * (kind=client, allowLocalStack=false) ne doit JAMAIS pouvoir les déclencher,
   * même si l'UI distante en expose un bouton — défense en profondeur au-delà
   * des checks `connectionMode` individuels.
   */
  function hostOnlyHandle(
    channel: string,
    fn: (event: any, ...args: unknown[]) => unknown,
  ): void {
    safeHandle(channel, (event, ...args) => {
      if (!deps.bootBehavior.allowLocalStack) {
        throw new HostOnlyRefusedError(
          `Action réservée à l'app Serveur (${channel} refusé sur un client léger)`,
        );
      }
      return fn(event, ...args);
    });
  }

  function registerIpc(view: any): void {
    const ownerManager = tabs!;

    safeHandle("desktop:info", () => ({
      version: app.getVersion(),
      serverPort: server?.port ?? 0,
      license: deps.vertical.checkLicense().state,
      platform: process.platform,
      customWindowChrome: process.platform === "win32",
      connectionMode: activeConnectionProfile.mode,
      baseUrl: crmBaseUrl(),
      localBind: activeConnectionProfile.localBind ?? "127.0.0.1",
      /** Split 0.10.0 : "server" | "client" | "legacy". */
      appKind: deps.appKind,
    }));

    safeHandle("connection:get", () => {
      const p = deps.store().getConnectionProfile();
      return {
        mode: activeConnectionProfile.mode || p.mode,
        remoteUrl: activeConnectionProfile.remoteUrl ?? p.remoteUrl ?? null,
        localBind: activeConnectionProfile.localBind ?? p.localBind ?? "127.0.0.1",
        chosen: (activeConnectionProfile.chosen ?? p.chosen) !== false,
        activeBaseUrl: crmBaseUrl(),
        serverPort: server?.port ?? null,
      };
    });

    safeHandle("connection:test", async (_e, rawUrl) => {
      // Lien d'invitation collé tel quel ({protocol}://join/…) : accepté
      // partout où on saisit une URL de serveur.
      const raw = String(rawUrl || "").trim();
      const fromDeepLink = deps.vertical.parseJoinDeepLink(raw);
      return deps.vertical.testRemoteHealth(fromDeepLink || raw);
    });

    /** Écran de profils : oublier un serveur mémorisé (tuile ✕). */
    safeHandle("profiles:forget-server", (_e, rawId) => {
      const id = String(rawId || "").trim();
      if (!id) return { ok: false as const, error: "id requis" };
      const servers = deps.store().forgetRememberedServer(id);
      return { ok: true as const, servers };
    });

    safeHandle("connection:choose", async (_e, rawProfile) => {
      try {
        const raw = (rawProfile || {}) as Partial<any>;
        if (deps.bootBehavior.requireRemoteProfile && raw.mode !== "remote") {
          return {
            ok: false as const,
            error:
              `Cette app est le client ${productName} : installez « ${productNameServer} » pour héberger.`,
          };
        }
        const prev = deps.store().getConnectionProfile();
        // Boot picker n'envoie plus localBind : on conserve la valeur hôte déjà
        // enregistrée (Configuration avancée). Défaut produit = loopback.
        const localBind =
          raw.localBind === "0.0.0.0" || raw.localBind === "127.0.0.1"
            ? raw.localBind
            : prev.localBind === "0.0.0.0"
              ? "0.0.0.0"
              : "127.0.0.1";
        const ready = deps.vertical.assertProfileReady({
          mode: raw.mode === "remote" ? "remote" : "local",
          remoteUrl: raw.remoteUrl,
          localBind,
          chosen: true,
        });
        if (ready.mode === "remote") {
          const health = await deps.vertical.testRemoteHealth(ready.remoteUrl || "");
          if (!health.ok) {
            return { ok: false as const, error: health.error || "Serveur injoignable" };
          }
          ready.remoteUrl = health.baseUrl || ready.remoteUrl;
        }
        const saved = deps.store().setConnectionProfile(ready);
        if (saved.mode === "remote" && saved.remoteUrl) {
          // Tuile « serveur mémorisé » sur l'écran de profils au prochain boot.
          deps.store().rememberServer(saved.remoteUrl);
        }
        activeConnectionProfile = saved;
        connectionChoiceResolver?.(saved);
        connectionChoiceResolver = null;
        return { ok: true as const, profile: saved };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    /** Depuis Configuration : enregistre + relance l'app pour appliquer le profil. */
    safeHandle("connection:apply", async (_e, rawProfile) => {
      try {
        const raw = (rawProfile || {}) as Partial<any>;
        if (deps.bootBehavior.requireRemoteProfile && raw.mode !== "remote") {
          return {
            ok: false as const,
            error:
              `Cette app est le client ${productName} : installez « ${productNameServer} » pour héberger.`,
          };
        }
        if (deps.bootBehavior.forceLocalProfile && raw.mode === "remote") {
          return {
            ok: false as const,
            error:
              `Cette app est le serveur ${productName} : utilisez l'app Client pour rejoindre un autre serveur.`,
          };
        }
        const ready = deps.vertical.assertProfileReady({
          mode: raw.mode === "remote" ? "remote" : "local",
          remoteUrl: raw.remoteUrl,
          localBind: raw.localBind === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1",
          chosen: true,
        });
        if (ready.mode === "remote") {
          const health = await deps.vertical.testRemoteHealth(ready.remoteUrl || "");
          if (!health.ok) {
            return { ok: false as const, error: health.error || "Serveur injoignable" };
          }
          ready.remoteUrl = health.baseUrl || ready.remoteUrl;
        }
        deps.store().setConnectionProfile(ready);
        log("main", `profil connexion appliqué (${ready.mode}) — relance app`);
        setTimeout(() => {
          app.relaunch();
          app.quit();
        }, 150);
        return { ok: true as const, relaunching: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    /**
     * Depuis logout desktop / setup : efface le choix mémorisé et relance →
     * picker natif Héberger / Rejoindre (pas de factory-reset, pas de /login web).
     */
    safeHandle("connection:rechoose", async () => {
      try {
        deps.store().clearConnectionProfileChoice();
        try {
          assistantChrome?.setMode("hidden");
        } catch {
          /* ignore */
        }
        log("main", "rechoose connexion — picker au prochain boot");
        setTimeout(() => {
          app.relaunch();
          app.quit();
        }, 150);
        return { ok: true as const, relaunching: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    /* ── Chrome fenêtre (frameless Windows) ── */
    safeHandle("window:minimize", () => {
      win?.minimize();
    });
    safeHandle("window:maximize-toggle", () => {
      if (!win) return { isMaximized: false };
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { isMaximized: win.isMaximized() };
    });
    safeHandle("window:close", () => {
      win?.close();
    });
    safeHandle("window:isMaximized", () => win?.isMaximized() ?? false);

    /* ── Fonctionnement en arrière-plan (tray + démarrage auto) ── */
    safeHandle("background:get", () => ({
      ...deps.store().getBackgroundSettings(),
      trayActive: trayController?.active ?? false,
      platform: process.platform,
    }));
    safeHandle("background:set", (_e, rawPatch) => {
      const raw = (rawPatch || {}) as {
        closeToTray?: unknown;
        launchAtStartup?: unknown;
      };
      const patch: { closeToTray?: boolean; launchAtStartup?: boolean } = {};
      if (typeof raw.closeToTray === "boolean") patch.closeToTray = raw.closeToTray;
      if (typeof raw.launchAtStartup === "boolean") {
        patch.launchAtStartup = raw.launchAtStartup;
      }
      const settings = deps.store().setBackgroundSettings(patch);
      if (typeof patch.launchAtStartup === "boolean") {
        if (app.isPackaged) {
          applyLaunchAtStartup(settings.launchAtStartup);
        } else {
          log("tray", "dev : setLoginItemSettings ignoré (app non packagée)");
        }
      }
      return {
        ok: true as const,
        settings,
        trayActive: trayController?.active ?? false,
      };
    });

    safeHandle("tabs:open", async (e, a, b) => {
      const manager = tabsManagerForEvent(e);
      // Compat : (siteId, url) OU { siteId|fournisseurId, url }
      // siteId opaque : UUID marque (string) ou entier historique.
      let siteId: number | string;
      let openUrl: string;
      if (a && typeof a === "object") {
        const o = a as {
          siteId?: number | string;
          fournisseurId?: number | string;
          url?: string;
        };
        siteId = normalizeSiteId(o.siteId ?? o.fournisseurId);
        openUrl = String(o.url ?? "");
      } else {
        siteId = normalizeSiteId(a);
        openUrl = String(b ?? "");
      }
      const tab = await manager.openTab(siteId, openUrl);
      let url = "";
      try {
        if (!tab.view.webContents.isDestroyed()) url = tab.view.webContents.getURL();
      } catch {
        /* ignore */
      }
      try {
        const host = url ? new URL(url).host : "";
        recordFleetAction({
          type: "embed.navigate",
          name: "embed.navigate",
          category: "embed",
          label: `Onglet site externe #${siteId}${host ? ` · ${host}` : ""}`,
          path: host ? `https://${host}/` : undefined,
          surface: "external_site_tab",
          meta: { siteId, fournisseurId: siteId, host },
        });
      } catch {
        /* ignore */
      }
      return {
        tabId: tab.tabId,
        siteId: tab.siteId ?? siteId,
        fournisseurId: tab.siteId ?? tab.fournisseurId ?? siteId,
        loadState: tab.loadState,
        url: url || undefined,
      };
    });
    safeHandle("tabs:close", (e, tabId) =>
      tabsManagerForEvent(e).closeTab(String(tabId)),
    );
    safeHandle("tabs:activate", (e, rawArgs) => {
      const manager = tabsManagerForEvent(e);
      const args = rawArgs as {
        tabId: string;
        rect?: { x: number; y: number; width: number; height: number };
        /** @deprecated compat topOffset → rect y seule */
        topOffset?: number;
      };
      const rect = args.rect
        ? args.rect
        : typeof args.topOffset === "number"
          ? { x: 0, y: args.topOffset, width: 10_000, height: 10_000 }
          : undefined;
      return manager.activate(String(args.tabId), rect);
    });
    safeHandle("tabs:activate-site", (e, a, b, c) => {
      const manager = tabsManagerForEvent(e);
      // Compat : (siteId, url, rect?) OU { siteId, url, rect? }
      let siteId: number | string;
      let url: string;
      let rect: { x: number; y: number; width: number; height: number } | undefined;
      if (a && typeof a === "object" && !Array.isArray(a) && ("siteId" in a || "url" in a)) {
        const o = a as {
          siteId?: number | string;
          url?: string;
          rect?: { x: number; y: number; width: number; height: number };
        };
        siteId = normalizeSiteId(o.siteId);
        url = String(o.url || "");
        rect = o.rect;
      } else {
        siteId = normalizeSiteId(a);
        url = String(b ?? "");
        rect = c as typeof rect;
      }
      return manager.activateSite(siteId, url, rect);
    });
    safeHandle("tabs:set-content-rect", (e, rawRect) => {
      const rect = rawRect as { x: number; y: number; width: number; height: number };
      tabsManagerForEvent(e).setContentRect(rect);
    });
    safeHandle("tabs:show-crm", (e) => tabsManagerForEvent(e).showCrm());
    safeHandle("tabs:list", (e) => tabsManagerForEvent(e).list());

    /* ── Espaces workspace collaborateurs IA ── */
    safeHandle("ai-workspace:identity", (e) => {
      const wcId = e.sender.id;
      const info = aiWorkspaces?.findByWebContentsId(wcId) || null;
      if (!info) return { userId: null as string | null, label: "", active: false };
      return {
        userId: info.userId,
        label: info.label,
        active: info.active,
      };
    });
    safeHandle("ai-workspace:list", () => aiWorkspaces?.list() || []);
    safeHandle("ai-workspace:ensure", async (_e, raw) => {
      if (!aiWorkspaces) return { ok: false as const, error: "manager absent" };
      const args = raw as {
        userId: string;
        token: string;
        baseUrl?: string;
        label?: string;
        show?: boolean;
      };
      const baseUrl =
        (typeof args.baseUrl === "string" && args.baseUrl) ||
        crmBaseUrl() ||
        server?.baseUrl ||
        "";
      try {
        const info = await aiWorkspaces.ensure({
          userId: String(args.userId || ""),
          token: String(args.token || ""),
          baseUrl,
          label: args.label,
        });
        if (args.show) aiWorkspaces.show(info.userId);
        return { ok: true as const, workspace: info };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    safeHandle("ai-workspace:show", (_e, userId) => {
      if (!aiWorkspaces) return { ok: false as const, error: "manager absent" };
      try {
        const info = aiWorkspaces.show(String(userId || ""));
        return { ok: true as const, workspace: info };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    safeHandle("ai-workspace:show-owner", () => {
      aiWorkspaces?.showOwner();
      return { ok: true as const };
    });
    // P3 cockpit : « Ouvrir l'app admin » → fenêtre /dashboard séparée
    // (même partition session que la vue CRM principale — cookies owner).
    safeHandle("admin-window:open", async () => {
      // L'app Serveur ne doit JAMAIS afficher l'UI CRM, même en fenêtre à part
      // (audit split : trou admin-window sans garde cockpit). Legacy /cockpit
      // conserve ce chemin.
      if (deps.appKind === "server") {
        return {
          ok: false as const,
          error:
            "L'UI d'administration CRM s'ouvre depuis l'app Client (l'app Serveur n'affiche que le cockpit).",
        };
      }
      const baseUrl = crmBaseUrl() || server?.baseUrl || "";
      if (!baseUrl) return { ok: false as const, error: "serveur non démarré" };
      const adminPreload = deps.paths.preloadPath("preload.js");
      return openAdminWindow({
        baseUrl,
        partition: deps.sessionPartition,
        productName: deps.manifest.client.productName,
        preloadPath: adminPreload,
        instrument: (v) => deps.vertical.instrumentWebContents(v.webContents, "admin-window"),
      });
    });
    ipcMain.on("ai-workspace:action-result", (_e, raw) => {
      const payload = raw as {
        actionId?: string;
        result?: Record<string, unknown>;
      };
      if (!payload?.actionId || !aiWorkspaces) return;
      aiWorkspaces.resolvePending(
        String(payload.actionId),
        payload.result && typeof payload.result === "object"
          ? payload.result
          : { ok: false, error: "result manquant" },
      );
    });

    safeHandle("assistant:set-chrome", (_e, rawMode) => {
      const mode = String(rawMode) === "fab" ? "fab" : "hidden";
      assistantChrome?.setMode(mode);
    });

    if (typeof ownerManager?.setOnChanged === "function") {
      ownerManager.setOnChanged(() => {
        try {
          if (!view.webContents.isDestroyed()) {
            view.webContents.send(
              "tabs:changed",
              typeof ownerManager.list === "function" ? ownerManager.list() : [],
            );
          }
        } catch (e) {
          logError("tabs", e);
        }
      });
    }

    if (typeof ownerManager?.setOnLoadState === "function") {
      ownerManager.setOnLoadState((ev: unknown) => {
        try {
          if (!view.webContents.isDestroyed()) {
            view.webContents.send("tabs:load-state", ev);
          }
        } catch (e) {
          logError("tabs", e);
        }
      });
    }

    if (typeof ownerManager?.setOnAfterBounds === "function") {
      ownerManager.setOnAfterBounds(() => {
        assistantChrome?.ensureTop();
      });
    }

    // Erreurs JS de la page (window.onerror / unhandledrejection), forwardées
    // par le preload : log persistant + rapport débouncé au collecteur.
    ipcMain.on("renderer-error", (_e, rawPayload) => {
      try {
        const p = (rawPayload ?? {}) as {
          kind?: string;
          message?: string;
          stack?: string;
          file?: string;
          line?: number;
          url?: string;
        };
        const msg = String(p.message ?? "").slice(0, 1000);
        log("web", `[crm] ${p.kind}: ${msg} (${p.file ?? "?"}:${p.line ?? "?"})`);
        deps.vertical.reportCrashDebounced("renderer-error", `js:${msg.slice(0, 120)}`, {
          view: "crm",
          source: p.kind || "window-error",
          message: msg,
          stack: String(p.stack ?? "").slice(0, 4000),
          file: p.file,
          line: p.line,
          url: p.url,
        });
      } catch (e) {
        logError("web", e);
      }
    });

    safeHandle("hermes:status", () => {
      if (!deps.bootBehavior.allowLocalStack) return clientHermesStatusPayload();
      return deps.hosts.hermes().getHermesStatusPayload(
        activeConnectionProfile.mode,
        remoteStatusOpts(),
      );
    });
    safeHandle("hermes:logs", () =>
      deps.bootBehavior.allowLocalStack ? deps.hosts.hermes().getHermesLogs() : [],
    );
    hostOnlyHandle("hermes:retry", async () => {
      if (activeConnectionProfile.mode !== "local") {
        return deps.hosts.hermes().getHermesStatusPayload(
          activeConnectionProfile.mode,
          remoteStatusOpts(),
        );
      }
      const current = deps.hosts.hermes().getRunningHermes();
      if (current?.webuiUrl) {
        hermes = current;
        return deps.hosts.hermes().getHermesStatusPayload("local");
      }
      if (current) await deps.hosts.hermes().stopHermesAndWait();
      const started = await deps.hosts.hermes().startHermes({
        connectionMode: "local",
        hermesConfig: deps.store().getHermesEmbedConfig(),
        autoBootstrap: true,
        crmPort: server?.port ?? null,
        onLog: (line) => log("hermes", line),
      });
      hermes = started;
      await maybeRestartNextAfterHermesSpawn(Boolean(started));
      const status = deps.hosts.hermes().getHermesStatusPayload("local");
      if (!started?.webuiUrl) {
        deps.vertical.reportCrashDebounced(
          "child-exit",
          `hermes-retry:${status.detail}`,
          {
            service: "hermes",
            action: "ui-retry",
            status: status.status,
            webuiStatus: status.webuiStatus,
            detail: status.detail,
            bootstrapError: status.bootstrapError,
            logs: deps.hosts.hermes().getHermesLogs().slice(-80),
          },
        );
      }
      return status;
    });
    safeHandle("hermes:get-config", () => deps.store().getHermesEmbedConfig());
    hostOnlyHandle("hermes:set-config", async (_e, raw) => {
      const next = deps.store().setHermesEmbedConfig(
        deps.vertical.sanitizeHermesEmbedConfig(
          raw && typeof raw === "object"
            ? (raw as Parameters<typeof deps.vertical.sanitizeHermesEmbedConfig>[0])
            : {},
        ),
      );
      // Changement de mode : demander un relaunch pour (re)spawner proprement.
      return { ok: true as const, config: next, relaunchRequired: true as const };
    });
    hostOnlyHandle("hermes:ensure-runtime", async () => {
      if (activeConnectionProfile.mode !== "local") {
        return {
          ok: false as const,
          detail: "Client distant — pas de runtime Hermes local.",
          binaryPath: null,
          webuiDir: null,
          relaunchRequired: false as const,
        };
      }
      const r = await deps.hosts.hermes().ensureHermesRuntimeFromUi({
        onLog: (line) => log("hermes", line),
      });
      return {
        ...r,
        relaunchRequired: r.ok as boolean,
      };
    });

    safeHandle("n8n:status", () => {
      if (!deps.bootBehavior.allowLocalStack) return clientN8nStatusPayload();
      return deps.hosts.n8n().getN8nStatusPayload(
        activeConnectionProfile.mode,
        remoteStatusOpts(),
      );
    });
    safeHandle("n8n:logs", () =>
      deps.bootBehavior.allowLocalStack ? deps.hosts.n8n().getN8nLogs() : [],
    );
    safeHandle("n8n:get-config", () => deps.store().getN8nEmbedConfig());
    hostOnlyHandle("n8n:set-config", async (_e, raw) => {
      const next = deps.store().setN8nEmbedConfig(
        deps.vertical.sanitizeN8nEmbedConfig(
          raw && typeof raw === "object"
            ? (raw as Parameters<typeof deps.vertical.sanitizeN8nEmbedConfig>[0])
            : {},
        ),
      );
      return { ok: true as const, config: next, relaunchRequired: true as const };
    });
    hostOnlyHandle("n8n:ensure-runtime", async () => {
      if (activeConnectionProfile.mode !== "local") {
        return {
          ok: false as const,
          detail: "Client distant — pas de runtime n8n local.",
          entryPath: null,
          runtimeDir: null,
          uiUrl: null as string | null,
          relaunchRequired: false as const,
        };
      }
      const r = await deps.hosts.n8n().ensureN8nRuntimeFromUi({
        onLog: (line) => log("n8n", line),
      });
      let uiUrl: string | null = n8n?.uiUrl ?? null;
      if (r.ok) {
        try {
          const started = await deps.hosts.n8n().startN8n({
            connectionMode: "local",
            n8nConfig: deps.store().getN8nEmbedConfig(),
            autoBootstrap: false,
            onLog: (line) => log("n8n", line),
          });
          if (started) {
            n8n = started;
            uiUrl = started.uiUrl;
          }
        } catch (e) {
          logError("n8n", e);
        }
      }
      return {
        ...r,
        uiUrl,
        relaunchRequired: false as const,
      };
    });
    hostOnlyHandle("n8n:prepare-session", async () => deps.hosts.n8n().prepareN8nUiSession());

    safeHandle("embed-env:get", (_e, rawService) => {
      const service = String(rawService || "");
      if (!deps.vertical.isEmbedEnvService(service)) {
        throw new Error(`service env inconnu: ${service}`);
      }
      const lockedValues: Record<string, string | null | undefined> = {};
      if (service === "n8n") {
        const st = deps.hosts.n8n().getN8nStatusPayload(
          activeConnectionProfile.mode,
          remoteStatusOpts(),
        );
        lockedValues.WEBHOOK_URL = st.publicWebhookUrl;
        lockedValues.N8N_EDITOR_BASE_URL = st.publicWebhookUrl;
        lockedValues.N8N_LISTEN_ADDRESS = st.listenHost;
        lockedValues.N8N_PORT = String(st.listenPort);
        lockedValues.N8N_USER_FOLDER = st.homeDir;
        lockedValues.N8N_ENCRYPTION_KEY = `•••• (gérée par ${productName})`;
        lockedValues.N8N_MCP_ACCESS_ENABLED = "true";
        lockedValues.N8N_MCP_MANAGED_BY_ENV = "true";
      } else if (service === "hermes") {
        const st = deps.hosts.hermes().getHermesStatusPayload(
          activeConnectionProfile.mode,
          remoteStatusOpts(),
        );
        lockedValues.HERMES_HOME = st.homeDir;
        lockedValues.API_SERVER_HOST = "127.0.0.1";
        lockedValues.API_SERVER_PORT = st.apiUrl
          ? String(new URL(st.apiUrl).port || "")
          : "";
        lockedValues.API_SERVER_KEY = `•••• (gérée par ${productName})`;
        lockedValues.TERMINAL_CWD = st.homeDir
          ? `${st.homeDir.replace(/[/\\]$/, "")}/workspace`
          : "";
      }
      return deps.vertical.buildEmbedEnvPanel({
        service,
        userOverlay: deps.store().getEmbedUserEnv(service),
        lockedValues,
      });
    });

    safeHandle("plugins:status", async () => {
      // Client léger : les plugins vivent sur l'app Serveur — payload vide
      // propre plutôt que des sondes git/vendor sur des chemins absents.
      if (!deps.bootBehavior.allowLocalStack) {
        return { root: "", plugins: [], running: [], logs: [] };
      }
      return deps.hosts.plugins().pluginsStatusPayloadWithGit();
    });
    hostOnlyHandle("plugins:set-enabled", async (_e, rawId, rawEnabled) => {
      const id = String(rawId || "").trim();
      const enabled = Boolean(rawEnabled);
      const p = deps.hosts.plugins().enablePlugin(id, enabled);
      if (!p) throw new Error(`plugin inconnu: ${id}`);
      recordFleetAction({
        type: "plugin.toggle",
        name: "plugin.toggle",
        category: "system",
        label: `${enabled ? "Active" : "Désactive"} plugin ${id}`,
        surface: "system",
        meta: { pluginId: id, enabled },
      });
      if (enabled) {
        await deps.hosts.plugins().startEnabledPlugins({ onLog: (line) => scoped("plugins")(line) });
      }
      return {
        ok: true as const,
        plugin: p,
        status: await deps.hosts.plugins().pluginsStatusPayloadWithGit(),
      };
    });
    hostOnlyHandle("plugins:scaffold", async (_e, raw) => {
      const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const id = String(o.id || "");
      const grant = deps.hosts.pluginControl().validatePluginExecutionGrant({
        token: String(o.executionGrant || ""),
        pluginId: id,
        action: "create",
      });
      if (!grant.ok) throw new Error(grant.error);
      const r = await deps.hosts.plugins().createPluginScaffoldWithGit({
        id,
        name: o.name != null ? String(o.name) : undefined,
        description: o.description != null ? String(o.description) : undefined,
      });
      if (!r.ok) throw new Error(r.error);
      await deps.hosts.plugins().startEnabledPlugins({ onLog: (line) => scoped("plugins")(line) });
      return {
        ok: true as const,
        plugin: r.plugin,
        git: r.git,
        status: await deps.hosts.plugins().pluginsStatusPayloadWithGit(),
      };
    });
    hostOnlyHandle("plugins:execution-grant", async (_e, raw) => {
      const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return deps.hosts.pluginControl().createPluginExecutionGrant({
        productId: String(o.productId || ""),
        prdRevisionId: String(o.prdRevisionId || ""),
        pluginId: String(o.pluginId || ""),
        ttlSeconds: Number(o.ttlSeconds || 600),
      });
    });
    hostOnlyHandle("plugins:run-tests", async (_e, rawId) =>
      deps.hosts.pluginTests().runPluginTests(String(rawId || "").trim()),
    );
    hostOnlyHandle("plugins:data-migrate", async (_e, rawId) =>
      deps.hosts.pluginControl().migratePluginData(String(rawId || "").trim()),
    );
    // Redémarrage métier « Mettre à jour » : migrations DB auto puis relance.
    hostOnlyHandle("plugins:restart", async (_e, rawId) => {
      const id = String(rawId || "").trim();
      // Migrations data AVANT la relance, en sous-process Node vanilla
      // (better-sqlite3 est interdit dans le main Electron — cf. plugin-data.ts).
      // Best-effort : un échec de migration n'empêche pas le restart.
      if (fs.existsSync(path.join(deps.hosts.pluginRuntime().pluginsRootDir(), id, "migrations"))) {
        try {
          await deps.hosts.pluginControl().migratePluginData(id);
        } catch (e) {
          scoped("plugins")(
            `migrations data échouées pour ${id} — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      const r = await deps.hosts.plugins().restartPlugin(id);
      if (!r.ok) throw new Error(r.error);
      return {
        ok: true as const,
        running: r.running,
        status: await deps.hosts.plugins().pluginsStatusPayloadWithGit(),
      };
    });
    hostOnlyHandle("plugins:archive-runtime", async (_e, rawId) =>
      deps.hosts.pluginControl().archivePluginRuntime(String(rawId || "").trim()),
    );
    hostOnlyHandle("plugins:delete", async (_e, rawId) => {
      const id = String(rawId || "").trim();
      const r = deps.hosts.plugins().deletePlugin(id);
      if (!r.ok) throw new Error(r.error);
      recordFleetAction({
        type: "plugin.delete",
        name: "plugin.delete",
        category: "system",
        label: `Supprime plugin ${id}`,
        surface: "system",
        meta: { pluginId: id },
      });
      return {
        ok: true as const,
        deleted: r.deleted,
        status: await deps.hosts.plugins().pluginsStatusPayloadWithGit(),
      };
    });
    safeHandle("plugins:versions", async (_e, rawId) => {
      const id = String(rawId || "").trim();
      if (!deps.bootBehavior.allowLocalStack) {
        return {
          ok: false,
          pluginId: id,
          available: false,
          commits: [],
          head: null,
          error: "Plugins gérés par l'app Serveur",
        };
      }
      return deps.hosts.plugins().getPluginVersions(id);
    });
    hostOnlyHandle("plugins:restore-version", async (_e, rawId, rawRef) => {
      const id = String(rawId || "").trim();
      const ref = String(rawRef || "").trim();
      const r = await deps.hosts.plugins().restorePluginToVersion(id, ref);
      if (!r.ok) throw new Error(r.error);
      return {
        ok: true as const,
        sha: r.sha,
        detail: r.detail,
        running: r.running,
        status: await deps.hosts.plugins().pluginsStatusPayloadWithGit(),
      };
    });
    // Boîte noire : événements structurés depuis le renderer (UI CRM).
    safeHandle("ops:track", (_e, raw) => ({
      ok: trackExternal(raw, "renderer"),
    }));
    hostOnlyHandle("fleet:get-telemetry", () => deps.store().getFleetTelemetry());
    hostOnlyHandle("fleet:action", (_e, raw) => {
      const o =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const meta =
        o.meta && typeof o.meta === "object"
          ? (o.meta as Record<string, unknown>)
          : {};
      if (meta.setContextOnly === true || o.type === "session.context") {
        setFleetSessionContext({
          userId: o.userId != null ? String(o.userId) : null,
          username: o.username != null ? String(o.username) : null,
          sessionId:
            meta.sessionId != null ? String(meta.sessionId) : undefined,
        });
        if (meta.setContextOnly === true) return { ok: true as const };
      }
      const name =
        meta.name != null
          ? String(meta.name)
          : o.type != null
            ? String(o.type)
            : "event";
      const durationRaw =
        typeof o.durationMs === "number"
          ? o.durationMs
          : typeof meta.durationMs === "number"
            ? meta.durationMs
            : undefined;
      recordFleetAction({
        type: String(o.type || name),
        name,
        category: meta.category != null ? String(meta.category) : "ui",
        label: String(o.label || name),
        path: o.path != null ? String(o.path) : undefined,
        referrerPath:
          meta.referrerPath != null ? String(meta.referrerPath) : undefined,
        userId: o.userId != null ? String(o.userId) : undefined,
        username: o.username != null ? String(o.username) : undefined,
        sessionId: meta.sessionId != null ? String(meta.sessionId) : undefined,
        surface:
          meta.surface === "supplier_tab" ||
          meta.surface === "hermes" ||
          meta.surface === "n8n" ||
          meta.surface === "ai_workspace" ||
          meta.surface === "system"
            ? meta.surface
            : "crm",
        durationMs:
          typeof durationRaw === "number" && Number.isFinite(durationRaw)
            ? durationRaw
            : undefined,
        meta,
      });
      return { ok: true as const };
    });
    hostOnlyHandle("fleet:set-telemetry", (_e, raw) => {
      const o =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const patch: Parameters<
        Record<string, unknown>
      >[0] = {};
      if (typeof o.enabled === "boolean") patch.enabled = o.enabled;
      if (o.preset === "basic" || o.preset === "off" || o.preset === "keep") {
        patch.preset = o.preset;
      }
      if (o.scopes && typeof o.scopes === "object") {
        patch.scopes = o.scopes as (typeof patch)["scopes"];
      }
      const next = deps.store().setFleetTelemetry(patch);
      deps.hosts.fleetAgent().notifyFleetConfigChanged();
      return next;
    });

    safeHandle("plugins:resolve-panel", (_e, rawId) => {
      const id = String(rawId || "").trim();
      if (!deps.bootBehavior.allowLocalStack) {
        return { ok: false as const, error: "Plugins gérés par l'app Serveur" };
      }
      return deps.hosts.plugins().resolvePluginPanel(id);
    });
    hostOnlyHandle("plugins:accept-check", async (_e, rawId) => {
      const id = String(rawId || "").trim();
      return deps.hosts.pluginAccept().runPluginAcceptCheck(id);
    });

    hostOnlyHandle("embed-env:set", async (_e, rawService, rawValues) => {
      const service = String(rawService || "");
      if (!deps.vertical.isEmbedEnvService(service)) {
        throw new Error(`service env inconnu: ${service}`);
      }
      const values =
        rawValues && typeof rawValues === "object"
          ? (rawValues as Record<string, string>)
          : {};
      const saved = deps.store().setEmbedUserEnv(service, values);
      let restarted = false;
      let detail = "Variables enregistrées.";
      if (activeConnectionProfile.mode === "local") {
        try {
          if (service === "n8n") {
            deps.hosts.n8n().stopN8n();
            const started = await deps.hosts.n8n().startN8n({
              connectionMode: "local",
              n8nConfig: deps.store().getN8nEmbedConfig(),
              autoBootstrap: false,
              onLog: (line) => log("n8n", line),
            });
            if (started) n8n = started;
            restarted = true;
            detail = "Variables enregistrées — n8n redémarré.";
          } else if (service === "hermes") {
            await deps.hosts.hermes().stopHermesAndWait();
            const started = await deps.hosts.hermes().startHermes({
              connectionMode: "local",
              hermesConfig: deps.store().getHermesEmbedConfig(),
              autoBootstrap: false,
              onLog: (line) => log("hermes", line),
            });
            if (started) hermes = started;
            await maybeRestartNextAfterHermesSpawn(Boolean(started));
            restarted = true;
            detail = "Variables enregistrées — Hermes redémarré.";
          }
        } catch (e) {
          logError("embed-env", e);
          detail =
            e instanceof Error
              ? `Enregistré, redémarrage échoué : ${e.message}`
              : "Enregistré, redémarrage échoué.";
        }
      }
      return {
        ok: true as const,
        service: service as any,
        values: saved,
        restarted,
        detail,
        panel: deps.vertical.buildEmbedEnvPanel({
          service,
          userOverlay: saved,
        }),
      };
    });

    safeHandle("config:llm-status", () => llmStatusPayload());
    hostOnlyHandle("config:set-llm-key", async (_e, rawArgs) => {
      const args = rawArgs as { provider: "openai" | "anthropic"; key: string | null };
      const key = typeof args.key === "string" ? args.key.trim() || null : null;
      deps.store().setLlmKey(args.provider, key);
      log(
        "main",
        `clé BYOK ${args.provider} ${key ? "enregistrée" : "supprimée"} — propagation Next + Hermes…`,
      );
      // Hermes lit OPENAI_API_KEY au spawn (.env + process) — restart obligatoire.
      if (activeConnectionProfile.mode === "local") {
        try {
          const hermesSync = await deps.hosts.hermes().reapplyHermesLlmKeys({
            connectionMode: "local",
            crmPort: server?.port ?? null,
            onLog: (line) => log("hermes", line),
          });
          if (hermesSync.restarted) {
            hermes = deps.hosts.hermes().getRunningHermes() ?? hermes;
          }
          log("main", `BYOK→Hermes: ${hermesSync.detail}`);
        } catch (e) {
          logError("hermes-byok", e);
        }
      }
      // Env Next figée au spawn : redémarrage propre obligatoire pour activer la clé.
      const result = await restartNextServerForLlm();
      return result;
    });

    safeHandle("tunnel:status", () => {
      if (!deps.bootBehavior.allowLocalStack) {
        // Client léger : jamais de cloudflared local — payload inerte stable.
        return {
          configured: false,
          slug: null,
          hostname: null,
          publicUrl: null,
          publicUrls: null,
          online: false,
          error: null,
          pcMustBeOn: true,
        };
      }
      return deps.hosts.tunnel().getTunnelStatus();
    });
    hostOnlyHandle("tunnel:check-slug", async (_e, rawSlug) => {
      const slug = String(rawSlug || "");
      return deps.hosts.tunnel().checkTunnelSlug(slug);
    });
    hostOnlyHandle("tunnel:reserve", async (_e, rawSlug) => {
      const slug = String(rawSlug || "");
      const port = server?.port ?? Number(process.env[`${deps.envPrefix}_DESKTOP_PORT`] || deps.defaultDesktopPort);
      const r = await deps.hosts.tunnel().reserveTunnel(slug, port);
      if (!r.ok) return r;
      try {
        await syncTunnelIngress();
        await deps.hosts.tunnel().startCloudflared();
        await syncN8nWebhookPublicUrl();
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
      // Aligner APP_PUBLIC_URL / MCP_PUBLIC_URL (issuer OAuth MCP) sur le slug.
      const restarted = await restartNextServer({ reload: false });
      if (!restarted.ok) {
        return {
          ok: false as const,
          error:
            restarted.error ||
            "Tunnel réservé, mais redémarrage serveur impossible (URL MCP non alignée)",
        };
      }
      return r;
    });
    hostOnlyHandle("tunnel:start", async () => {
      if (server) await syncTunnelIngress();
      await deps.hosts.tunnel().startCloudflared();
      await syncN8nWebhookPublicUrl();
      return deps.hosts.tunnel().getTunnelStatus();
    });
    hostOnlyHandle("tunnel:stop", () => {
      deps.hosts.tunnel().stopCloudflared();
      return deps.hosts.tunnel().getTunnelStatus();
    });

    safeHandle("oauth:google-login", () => deps.vertical.googleLoginLoopback());

    safeHandle("setup:status", () => deps.store().getSetupDraft());

    safeHandle("setup:generate-recovery-key", () => ({
      recoveryKey: deps.store().generateRecoveryKey(),
    }));

    hostOnlyHandle("setup:complete", async (_e, rawArgs) => {
      const args = (rawArgs ?? {}) as {
        username?: string;
        password?: string;
        openaiKey?: string;
        slug?: string;
        recoveryKey?: string;
        stayLoggedIn?: boolean;
      };
      const username = String(args.username || "").trim();
      const password = String(args.password || "");
      const openaiKey = String(args.openaiKey || "").trim();
      const slug = String(args.slug || "").trim().toLowerCase();
      const recoveryKey = String(args.recoveryKey || "").trim();
      if (!username || !password) {
        return { ok: false as const, error: "Identifiant et mot de passe requis" };
      }
      if (!recoveryKey) {
        return { ok: false as const, error: "Clé de récupération requise" };
      }
      if (!openaiKey) {
        return { ok: false as const, error: "Clé OpenAI requise" };
      }
      if (!slug) {
        return { ok: false as const, error: "Slug tunnel requis" };
      }
      if (!server) {
        return { ok: false as const, error: "Serveur local non démarré" };
      }

      try {
        // 1) Tunnel d'abord (réseau) — si échec, aucun compte écrit.
        // Reprise après crash : réutiliser le tunnel déjà réservé pour ce slug.
        const port = server.port;
        const existingTunnel = deps.store().getTunnelConfig();
        let reserved: { ok: true; hostname: string; publicUrl: string } | { ok: false; error: string };
        if (existingTunnel && existingTunnel.slug === slug) {
          reserved = {
            ok: true,
            hostname: existingTunnel.hostname,
            publicUrl: existingTunnel.publicUrl,
          };
        } else {
          reserved = await deps.hosts.tunnel().reserveTunnel(slug, port);
        }
        if (!reserved.ok) {
          return { ok: false as const, error: reserved.error || "Réservation tunnel impossible" };
        }
        try {
          await syncTunnelIngress();
          await deps.hosts.tunnel().startCloudflared();
          await syncN8nWebhookPublicUrl();
        } catch (e) {
          logError("tunnel", e);
          // Non bloquant : le tunnel peut être relancé depuis Configuration.
        }

        // 2) Compte + recovery + OpenAI + flags — écriture atomique.
        deps.store().applyFirstRunSetup({
          username,
          password,
          openaiKey,
          recoveryKey,
          stayLoggedIn: args.stayLoggedIn !== false,
        });

        // features.onboarding=false (demo-app) → home ; absent/true → /onboarding.
        const postSetupHref = isFeatureEnabled(deps.manifest, "onboarding")
          ? "/onboarding"
          : "/";
        const restarted = await restartNextServer({
          forceAutoLogin: true,
          navigateTo: postSetupHref,
          reload: true,
        });
        if (!restarted.ok) {
          return {
            ok: false as const,
            error: restarted.error || "Redémarrage serveur échoué",
          };
        }
        return {
          ok: true as const,
          hostname: reserved.hostname,
          publicUrl: reserved.publicUrl,
        };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    safeHandle("config:account", () => ({
      ...deps.store().getAccountPublic(),
      hasRecoveryKey: deps.store().hasRecoveryKeyConfigured(),
    }));

    // Host-only : mute le compte propriétaire LOCAL — sur un client léger le
    // compte vit sur le serveur distant, muter la config locale n'a aucun sens.
    hostOnlyHandle("config:change-password", async (_e, rawArgs) => {
      const args = (rawArgs ?? {}) as {
        currentPassword?: string;
        newPassword?: string;
      };
      try {
        deps.store().changeLocalPassword(String(args.currentPassword || ""), String(args.newPassword || ""));
        const restarted = await restartNextServer({
          forceAutoLogin: deps.store().shouldAutoLoginOnBoot(),
          reload: true,
        });
        if (!restarted.ok) {
          return {
            ok: false as const,
            error: restarted.error || "Mot de passe enregistré, mais redémarrage échoué",
          };
        }
        return { ok: true as const };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    hostOnlyHandle("auth:recover-password", async (_e, rawArgs) => {
      const args = (rawArgs ?? {}) as {
        recoveryKey?: string;
        newPassword?: string;
      };
      try {
        const r = deps.store().resetPasswordWithRecoveryKey(
          String(args.recoveryKey || ""),
          String(args.newPassword || ""),
        );
        const restarted = await restartNextServer({
          forceAutoLogin: false,
          navigateTo: "/login",
          reload: true,
        });
        if (!restarted.ok) {
          return {
            ok: false as const,
            error: restarted.error || "Mot de passe réinitialisé, mais redémarrage échoué",
          };
        }
        return { ok: true as const, username: r.username };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    hostOnlyHandle("search:reindex", async () => {
      if (!meili) {
        return { ok: false as const, error: "Meilisearch indisponible" };
      }
      try {
        log("main", "réindexation Meili demandée (IPC search:reindex)");
        deps.vertical.setBootStage("index");
        const reindexStarted = Date.now();
        await runIndexerWithProgress(meili);
        const decision = await meiliIndexReady(meili);
        if (!decision) {
          return {
            ok: true as const,
            degraded: true as const,
            detail: "Réindexation lancée, contrôle de cohérence indisponible",
          };
        }
        log(
          "main",
          `meili.reindex done ready=${decision.ready} reason=${decision.reason}`,
        );
        track({
          level: "event",
          kind: "index.run",
          outcome: decision.ready ? "ok" : "still-not-ready",
          reason: "manual-reindex",
          durationMs: Date.now() - reindexStarted,
        });
        return {
          ok: true as const,
          ready: decision.ready,
          reason: decision.reason,
          sql: decision.sql,
          meili: decision.meili,
        };
      } catch (e) {
        logError("indexer", e);
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    hostOnlyHandle("config:factory-reset", async () => {
      try {
        log("main", "factory-reset demandé");
        track({ level: "event", kind: "factory.reset", outcome: "requested" });
        recordFleetAction({
          type: "system.factory_reset",
          name: "system.factory_reset",
          category: "system",
          label: "Factory reset demandé",
          surface: "system",
        });
        // Empêche le handler child-exit Next de crier pendant l'arrêt volontaire.
        restartingServer = true;
        deps.hosts.tunnel().stopCloudflared();
        bridge?.stop();
        bridge = null;
        try {
          tabs?.closeAll();
        } catch {
          /* ignore */
        }
        try {
          assistantChrome?.setMode("hidden");
        } catch {
          /* ignore */
        }
        if (server) {
          try {
            await clearCrmSessionCookie(server.baseUrl);
          } catch {
            /* ignore */
          }
          const old = server;
          server = null;
          old.stop();
        }
        if (meili) {
          try {
            meili.stop();
          } catch {
            /* ignore */
          }
          meili = null;
        }
        // Embeds AVANT wipe : hermes-home / n8n-home / runtimes sont dans les
        // cibles — un process encore vivant verrouille les fichiers (Windows).
        try {
          deps.hosts.plugins().stopAllPlugins();
        } catch {
          /* ignore */
        }
        try {
          deps.hosts.n8n().stopN8n();
        } catch {
          /* ignore */
        }
        try {
          await deps.hosts.hermes().stopHermesAndWait();
        } catch {
          /* ignore */
        }
        hermes = null;
        n8n = null;

        const { wiped } = await deps.hosts.factoryReset().wipeLocalUserData();
        log("main", `factory-reset : ${wiped.length} cibles effacées`);
        track({
          level: "event",
          kind: "factory.reset",
          outcome: "done",
          ctx: { wiped },
        });
        restartingServer = false;

        // Relance : picker connexion (config effacée) puis first-run local si choisi.
        activeCrmBaseUrl = null;
        deps.store().markConnectionPickerRequired();
        activeConnectionProfile = { mode: "local", localBind: "127.0.0.1", chosen: false };
        if (appView && !appView.webContents.isDestroyed()) {
          await appView.webContents.loadURL(splashHtmlUrl()).catch(() => {});
          void (async () => {
            try {
              await ensureConnectionChosen(appView!);
              await setupAndStart(appView!);
            } catch (e) {
              logError("main", e);
              void appView!
                .webContents.loadURL(
                  errorHtml(
                    "Échec après remise à zéro",
                    e instanceof Error ? e.message : String(e),
                  ),
                )
                .catch(() => {});
            }
          })();
        }
        return { ok: true as const };
      } catch (e) {
        restartingServer = false;
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });

    safeHandle("auth:set-stay-logged-in", (_e, rawStay) => {
      deps.store().setStayLoggedIn(Boolean(rawStay));
      return { ok: true as const, stayLoggedIn: Boolean(rawStay) };
    });

    safeHandle("auth:logout", async () => {
      deps.store().setSkipAutoLogin(true);
      const base = crmBaseUrl();
      if (base) {
        await clearCrmSessionCookie(base);
      }
      return { ok: true as const };
    });
  }

  /* ─────────────────────────────── Boot ──────────────────────────────────── */

  /** Coquille : fenêtre + vue CRM + gestion onglets + IPC (créée UNE fois). */
  async function createShell(): Promise<any> {
    // Windows : frameless façon Notion (boutons min/max/close dans le header onglets).
    // Autres plateformes : cadre natif + menu application masqué.
    const framelessWin = process.platform === "win32";
    win = new BaseWindow({
      width: 1400,
      height: 900,
      minWidth: 1000,
      minHeight: 640,
      title: deps.appKind === "server" ? productNameServer : productName,
      backgroundColor: "#14182f",
      autoHideMenuBar: true,
      // Linux/XFCE/xrdp : décorations natives explicites (X / Alt+F4).
      closable: true,
      minimizable: true,
      maximizable: true,
      ...(framelessWin
        ? { frame: false, thickFrame: true }
        : { frame: true }),
    });
    const w = win;

    // Preload unique `preload.js` (H10 — le basename historique des clients
    // legacy n'est plus sonde ; migration via codemod scripts/codemods/H10).
    // Un preload manquant/incassable = plus d'API desktop → on veut le SAVOIR.
    const appPreload = deps.paths.preloadPath("preload.js");
    if (!fs.existsSync(appPreload)) {
      deps.vertical.reportCrash("web-event", { view: "crm", event: "preload-missing", preloadPath: appPreload });
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: deps.sessionPartition,
        ...(fs.existsSync(appPreload) ? { preload: appPreload } : {}),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    appView = view;
    w.contentView.addChildView(view);
    const fit = () => {
      const { width, height } = w.getContentBounds();
      view.setBounds({ x: 0, y: 0, width, height });
    };
    fit();
    w.on("resize", fit);

    // Fermer = masquer (tray) : l'app et le serveur restent actifs en arrière-plan
    // (collaborateurs IA joignables via MCP/API fenêtre fermée). Le vrai quit
    // passe par le menu tray (flag quitting) ou before-quit. Si le tray n'a pas
    // pu être créé, on garde le comportement historique : fermer = quitter.
    installCloseToTray(w, {
      productName: deps.manifest.client.productName,
      trayActive: () => trayController?.active ?? false,
      isQuitting: () => quitting,
      closeToTrayEnabled: () => deps.store().getBackgroundSettings().closeToTray,
      // Boot raté / splash : quitter vraiment (évite fenêtre grise zombie sous RDP).
      forceQuitOnClose: () => !bootReady,
    });

    // Fermeture RÉELLE de la fenêtre principale (tray inactif / closeToTray
    // désactivé) : les fenêtres IA masquées ne doivent pas maintenir l'app en
    // vie (window-all-closed ne se déclencherait jamais).
    w.on("closed", () => {
      if (!quitting) {
        quitting = true;
        app.quit();
      }
    });

    // Sync état maximisé → UI (icône restore / maximize).
    const emitMaximized = () => {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send("window:maximized-changed", w.isMaximized());
        }
      } catch (e) {
        logError("window", e);
      }
    };
    w.on("maximize", emitMaximized);
    w.on("unmaximize", emitMaximized);

    // Télémétrie complète de la vue CRM : render-process-gone, preload-error,
    // did-fail-load, unresponsive, console-message error…
    deps.vertical.instrumentWebContents(view.webContents, "crm");

    // Activité flotte : navigations CRM (opt-in côté consentement à l’envoi).
    // Navigations CRM aussi capturées côté renderer (page.view + dwell).
    // Ici : filet de sécurité si le tracker React n’est pas monté.
    let lastFleetNavPath = "";
    const trackCrmNav = (url: string) => {
      try {
        const u = new URL(url);
        const p = `${u.pathname}${u.search}`.slice(0, 300);
        if (!p || p === lastFleetNavPath) return;
        lastFleetNavPath = p;
        recordFleetAction({
          type: "page.view",
          name: "page.view",
          category: "navigation",
          label: `Page ${u.pathname}`,
          path: p,
          surface: "crm",
        });
      } catch {
        /* ignore */
      }
    };
    view.webContents.on("did-navigate", (_e, url) => trackCrmNav(url));
    view.webContents.on("did-navigate-in-page", (_e, url) => trackCrmNav(url));

    // Crash renderer (UI CRM) : rechargement automatique (le rapport est émis
    // par deps.vertical.instrumentWebContents).
    view.webContents.on("render-process-gone", (_e, details) => {
      if (details.reason !== "clean-exit" && server) {
        setTimeout(() => {
          if (!view.webContents.isDestroyed()) {
            void view.webContents.loadURL(server!.baseUrl).catch(() => {});
          }
        }, 1000);
      }
    });

    await view.webContents.loadURL(splashHtmlUrl());
    tabs = deps.vertical.createSupplierTabs(w, view);
    // Workspaces IA : fenêtres parallèles persistantes par défaut (Q1/Q8) ;
    // réglage local-config "embedded" = compat « Voir comme IA » historique.
    aiWorkspaces = deps.vertical.createAiWorkspaces(w, view, tabs, {
      defaultPresentation: () => deps.store().getAiWorkspacePresentation(),
      isQuitting: () => quitting,
      onWindowsChanged: () => trayController?.refresh(),
    });
    assistantChrome = deps.vertical.createAssistantChrome(w, () => {
      try {
        if (!view.webContents.isDestroyed()) {
          view.webContents.send("assistant:open-request");
        }
      } catch (e) {
        logError("assistant-chrome", e);
      }
    });
    registerIpc(view);
    return view;
  }

  /**
   * Picker Héberger / Rejoindre — **toujours** avant Next/Meili/tunnel (Option A).
   * Dernier mode + URL pré-cochés ; Continuer démarre ensuite le boot choisi.
   * Aucun serveur local en arrière-plan pendant l’affichage du picker.
   * Pas de case bind LAN ici : tunnel = accès distant (config serveur / onboarding).
   */
  async function ensureConnectionChosen(view: any): Promise<void> {
    const safeFallback = defaultProfileForAppKind(deps.appKind);

    // App Serveur : pas de picker — la stack locale démarre directement
    // (le splash de progression prend le relais tout de suite).
    if (deps.bootBehavior.forceLocalProfile) {
      const stored = deps.store().getConnectionProfile?.() ?? null;
      const bind =
        stored && typeof stored === "object" && stored.localBind === "0.0.0.0"
          ? "0.0.0.0"
          : "127.0.0.1";
      const direct: any = {
        mode: "local",
        localBind: bind,
        chosen: true,
      };
      activeConnectionProfile = direct;
      try {
        deps.store().setConnectionProfile(direct);
      } catch (e) {
        logError("main", e);
      }
      log("main", "app kind=server → boot local direct (picker sauté)");
      return;
    }

    // Profil join (argv --{prefix}-profile=join: ou deep-link {protocol}://join/…) :
    // le serveur cible est déjà connu → picker sauté, connexion directe.
    const launch = deps.bootProfileLaunch;
    if (launch && launch.mode === "join" && launch.serverUrl) {
      const direct = deps.vertical.assertProfileReady({
        mode: "remote",
        remoteUrl: launch.serverUrl,
        chosen: true,
      });
      activeConnectionProfile = direct;
      try {
        deps.store().setConnectionProfile(direct);
        deps.store().rememberServer(direct.remoteUrl || "");
      } catch (e) {
        logError("main", e);
      }
      log("main", `profil join direct → ${direct.remoteUrl} — picker sauté`);
      return;
    }

    let resolved: unknown;
    try {
      resolved = deps.vertical.resolveBootProfile(
        deps.store().getConnectionProfileStored?.() ?? null,
      );
    } catch (e) {
      logError("main", e);
      resolved = null;
    }
    // Compat stubs marque : `{ profile, showPicker }` OU profil nu OU undefined.
    const { profile, showPicker } = unwrapBootProfileResult(
      resolved,
      deps.appKind,
    );
    if (!showPicker) {
      // Garde-fou : deps.vertical.resolveBootProfile doit toujours renvoyer true (pas de skip silencieux).
      log("main", "WARN deps.vertical.resolveBootProfile.showPicker=false — forçage picker");
    }

    deps.vertical.setBootStage("connection-picker");
    const joinOnly = deps.bootBehavior.pickerVariant === "join-only";
    setSplashStatus(
      joinOnly ? "Choix du serveur à rejoindre…" : "Choix : héberger ou rejoindre…",
    );
    let last: any;
    try {
      last = deps.vertical.sanitizeConnectionProfile?.(profile);
    } catch (e) {
      logError("main", e);
      last = null;
    }
    if (!last || typeof last !== "object" || !last.mode) {
      last = { ...safeFallback };
    }
    const localSetupDone = deps.store().isSetupComplete();
    let recallLine = "";
    if (joinOnly) {
      recallLine =
        last.mode === "remote" && last.remoteUrl
          ? `Dernier serveur rejoint : ${last.remoteUrl}. Confirmez ou changez, puis Continuer.`
          : `Cette app est le client ${productName} : elle se connecte à un serveur (app ${productNameServer} ou hôte du cabinet).`;
    } else if (last.mode === "remote" && last.remoteUrl) {
      recallLine = `Dernier choix : rejoindre ${last.remoteUrl}. Confirmez ou changez, puis Continuer.`;
    } else if (last.chosen && localSetupDone) {
      recallLine =
        "Dernier choix : héberger le serveur local sur ce PC. Confirmez ou rejoignez un autre serveur.";
    } else if (localSetupDone) {
      recallLine =
        "Un serveur local est déjà configuré sur ce PC. Choisissez « Héberger » pour le reprendre, ou « Rejoindre » un autre serveur.";
    } else {
      recallLine =
        "Premier démarrage : choisissez si ce PC héberge le cabinet, ou s’il rejoint un serveur existant.";
    }
    log(
      "main",
      `picker connexion (${joinOnly ? "join-only" : "complet"}, pré-sélection ${last.mode}` +
        (last.mode === "remote" ? ` → ${last.remoteUrl || "?"}` : "") +
        ") — pas de startLocalServer tant que Continuer n'est pas validé",
    );
    // URL pré-provisionnée (installateur client d'un cabinet) : env prioritaire
    // puis manifest.defaultServerUrl — ne remplace jamais un dernier choix.
    const presetServerUrl = String(
      process.env[`${deps.envPrefix}_DEFAULT_SERVER_URL`] ||
        (deps.manifest as { defaultServerUrl?: string } | undefined)
          ?.defaultServerUrl ||
        "",
    ).trim();
    await view.webContents.loadURL(
      deps.vertical.profilePickerHtml({
        initialMode: joinOnly || last.mode === "remote" ? "remote" : "local",
        remoteUrl: last.remoteUrl || presetServerUrl || "",
        localSetupDone,
        recallLine,
        rememberedServers: deps.store().listRememberedServers().map((s) => ({
          id: s.id,
          url: s.url,
          label: s.label,
        })),
        joinOnly,
      }),
    );

    const chosen = await new Promise<any>((resolve) => {
      connectionChoiceResolver = resolve;
    });
    activeConnectionProfile =
      chosen && typeof chosen === "object" && chosen.mode
        ? chosen
        : { ...safeFallback, chosen: true };
    log(
      "main",
      `profil connexion choisi : ${activeConnectionProfile.mode}` +
        (activeConnectionProfile.mode === "remote"
          ? ` → ${activeConnectionProfile.remoteUrl}`
          : ` (bind ${activeConnectionProfile.localBind})`) +
        " — démarrage serveur / remote ensuite",
    );
    await view.webContents.loadURL(splashHtmlUrl()).catch(() => {});
  }

  /** Client thin : charge l'UI depuis un serveur distant (pas de Next/Meili locaux). */
  /**
   * Garde offline du client thin : perte du serveur en cours de session →
   * page « Hors ligne » (retry backoff testConnection + rechooseConnection).
   * Idempotent (un seul listener par vue, retentable via setupAndStart).
   */
  let remoteOfflineGuardInstalled = false;
  function installRemoteOfflineGuard(view: any, crmUrl: string): void {
    if (remoteOfflineGuardInstalled) return;
    remoteOfflineGuardInstalled = true;
    view.webContents.on(
      "did-fail-load",
      (
        _e: unknown,
        errorCode: number,
        errorDescription: string,
        validatedURL: string,
        isMainFrame: boolean,
      ) => {
        if (!isMainFrame) return;
        if (errorCode === -3) return; // ERR_ABORTED (navigation remplacée)
        if (activeConnectionProfile.mode !== "remote") return;
        // Seules les pertes du CRM distant comptent (pas les data:/devtools).
        if (validatedURL && !validatedURL.startsWith(activeCrmBaseUrl || crmUrl)) {
          return;
        }
        log(
          "main",
          `remote offline (${errorCode} ${errorDescription}) → écran reconnexion`,
        );
        view.webContents
          .loadURL(
            remoteOfflineHtml({
              productName,
              bridgeName: deps.manifest.bridgeName,
              crmUrl: activeCrmBaseUrl || crmUrl,
              detail: errorDescription || undefined,
            }),
          )
          .catch((err: unknown) => logError("main", err));
      },
    );
  }

  async function setupAndStartRemote(view: any): Promise<void> {
    const ready = deps.vertical.assertProfileReady(activeConnectionProfile);
    splashBeginRemote();
    deps.vertical.setBootStage("remote-health");
    splashGo("remote", {
      headline: "Connexion au serveur distant…",
      detail: ready.remoteUrl || "Vérification…",
      percent: 20,
    });
    const health = await deps.vertical.testRemoteHealth(ready.remoteUrl || "", 12000);
    if (!health.ok || !health.baseUrl) {
      splashPatch("remote", {
        status: "error",
        detail: health.error || "Serveur injoignable",
      });
      throw new Error(
        health.error ||
          `Serveur distant injoignable (${ready.remoteUrl}). Vérifiez l'URL, le réseau et le pare-feu.`,
      );
    }
    activeCrmBaseUrl = health.baseUrl;
    activeConnectionProfile = { ...ready, remoteUrl: health.baseUrl };
    log("main", `mode remote → ${activeCrmBaseUrl}`);
    splashDone("remote", health.baseUrl);

    deps.vertical.setBootStage("load-ui");
    routeExternalLinksToTabs(view, activeCrmBaseUrl);
    splashGo("login", {
      headline: "Ouverture de l’interface…",
      detail: activeCrmBaseUrl,
      percent: 90,
    });
    // Cookie session = origin distante ; login via /login si pas de session.
    await view.webContents.loadURL(activeCrmBaseUrl);
    splashDone("login", "Interface chargée");

    // UX reconnexion : serveur KO en cours de session → écran offline
    // (retry auto backoff via testConnection + « Changer de serveur »).
    installRemoteOfflineGuard(view, activeCrmBaseUrl);

    // Bridge computer-use vers le serveur distant (auth session — le loop
    // attend le login utilisateur avec backoff si pas encore de cookie).
    await startRemoteBridge(activeCrmBaseUrl);

    deps.vertical.setBootStage("ready");
    setUpdaterRenderer(sendUpdateToWebContents(view.webContents));
    log("main", "démarrage remote terminé.");
  }

  /**
   * Séquence de démarrage complète (retentable via l'écran d'erreur) :
   * connexion → [local: catalogue → migrations → Meili → index → serveur → login → bridge]
   *            | [remote: health → loadURL]
   */
  async function setupAndStart(view: any): Promise<void> {
    if (activeConnectionProfile.mode === "remote") {
      await setupAndStartRemote(view);
      return;
    }

    // App Client (join-only) : AUCUN code serveur local ne doit s'exécuter.
    // Garde-fou dur : si un profil local arrive jusqu'ici, on refuse le boot
    // plutôt que de démarrer Meili/Next/n8n/Hermes sur un poste client.
    if (!deps.bootBehavior.allowLocalStack) {
      throw new Error(
        `Cette app est le client ${productName} (join-only) : impossible d'héberger un serveur local. ` +
          `Installez « ${productNameServer} » pour héberger.`,
      );
    }

    bootLocalStartedAt = Date.now();
    track({
      level: "event",
      kind: "boot.start",
      ctx: { mode: activeConnectionProfile.mode },
    });

    const hermesCfg = deps.store().getHermesEmbedConfig();
    const n8nCfg = deps.store().getN8nEmbedConfig();
    const configuredNeedHermes = deps.vertical.shouldSpawnEmbeddedHermes({
      connectionMode: "local",
      hermes: hermesCfg,
    });
    const configuredNeedN8n = deps.vertical.shouldSpawnEmbeddedN8n({
      connectionMode: "local",
      n8n: n8nCfg,
    });
    // Contrat produit : la stack native s'installe et démarre PENDANT le
    // splash, avec une ligne + barre + chrono par outil. L'utilisateur voit la
    // progression et arrive sur un CRM dont les services sont réellement
    // disponibles. Opt-out diagnostic : CREEZIO_EMBEDS_BLOCK_UI=0 (warm différé
    // après l'UI, services indisponibles au premier écran).
    const deferEmbedWarm = process.env.CREEZIO_EMBEDS_BLOCK_UI === "0";
    const needHermes = configuredNeedHermes && !deferEmbedWarm;
    const needN8n = configuredNeedN8n && !deferEmbedWarm;
    const needNode = needN8n;
    const needTunnel = Boolean(deps.hosts.tunnel().publicUrlForServer());

    splashBeginLocal({
      needNode,
      needHermes,
      needN8n,
      needTunnel,
    });

    /* 1. Catalogue (téléchargé au 1er lancement, avec progression live) */
    deps.vertical.setBootStage("catalog");
    splashGo("catalog", {
      headline: "Catalogue fournisseurs…",
      detail: "Vérification / téléchargement si besoin",
      percent: 5,
    });
    const catalogStarted = Date.now();
    const catalogState = await deps.hosts.catalog().ensureCatalogPresent((p) => {
      setSplashProgress(p);
    });
    splashDone(
      "catalog",
      catalogState === "present" ? "Déjà présent" : "Installé",
    );
    log("main", `catalogue : ${catalogState}`);
    trackDecision("catalog.ensure", catalogState, {
      durationMs: Date.now() - catalogStarted,
    });

    /* 2. Migrations — BLOQUANTES : indexer une base KO produit un Meili stale. */
    deps.vertical.setBootStage("migrations");
    splashGo("migrations", {
      headline: "Mise à jour de la base de données…",
      detail: "Migrations SQLite",
      percent: 30,
    });
    const migrationsStarted = Date.now();
    const migrationsPath = await runMigrationsInNode();
    splashDone(
      "migrations",
      migrationsPath === "kernel"
        ? "Migrations kernel appliquées (core + brand)"
        : "Migrations appliquées",
    );
    track({
      level: "event",
      kind: "migrations.done",
      outcome: "ok",
      durationMs: Date.now() - migrationsStarted,
      ctx: { path: migrationsPath },
    });

    /* 2b. Runtime brand H6 — nominal (échec VISIBLE sur splash + crash-collector).
     * Fail-soft conservé pour l’UI Hono historique, mais plus jamais silencieux. */
    deps.vertical.setBootStage("brand-runtime");
    splashGo("runtime", {
      headline: "Runtime plateforme…",
      detail: "Core + brand SQLite, modules",
      percent: 40,
    });
    try {
      const brandRt = deps.vertical.bootBrandRuntime({
        userDataRoot: deps.paths.userDataDir(),
        isPackaged: deps.paths.isPackaged(),
        appVersion: app.getVersion(),
      });
      const mods = Array.isArray(brandRt.mountedModules)
        ? brandRt.mountedModules
        : [];
      log(
        "h3",
        `brand runtime ready — modules=[${mods.join(",")}] ` +
          `core=${brandRt.runtime?.paths?.core} brand=${brandRt.runtime?.paths?.brand}`,
      );
      track({
        level: "event",
        kind: "h3.brand_runtime.ready",
        outcome: "ok",
        ctx: { modules: mods.join(",") },
      });
      splashDone(
        "runtime",
        `OK — modules ${mods.join(", ") || "kit"}`,
      );
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      logError("h3", e);
      track({
        level: "event",
        kind: "h3.brand_runtime.ready",
        outcome: "error",
        reason: reason.slice(0, 300),
      });
      splashPatch("runtime", {
        status: "error",
        detail: `Échec runtime brand — ${reason.slice(0, 220)}`,
        percent: 100,
        headline: "Runtime plateforme en échec (mode dégradé)",
      });
      deps.vertical.reportCrash("boot-failure", {
        step: "brand-runtime",
        message: reason.slice(0, 500),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }

    /* 3. Meilisearch (recherche) — démarré AVANT le serveur Next */
    deps.vertical.setBootStage("meili");
    splashGo("meili", {
      headline: "Moteur de recherche…",
      detail: "Démarrage Meilisearch",
      percent: 20,
    });
    const meiliStarted = Date.now();
    try {
      meili = await deps.hosts.meili().startMeili(scoped("meili"));
    } catch (e) {
      logError("meili", e);
      meili = null;
    }
    trackDecision("meili.start", meili ? "ok" : "unavailable", {
      durationMs: Date.now() - meiliStarted,
      ctx: meiliDiskState(),
    });
    if (!meili) {
      splashPatch("meili", {
        status: "error",
        detail: "Échec — recherche en mode dégradé",
        percent: 100,
      });
      splashPatch("index", { status: "skip", detail: "Meili indisponible" });
      deps.vertical.reportCrash("boot-failure", {
        step: "meili",
        message: "Meilisearch n'a pas démarré — recherche en mode dégradé explicite",
      });
    } else {
      splashDone("meili", meili.host);
    }

    /* 4. Indexation catalogue (produits / marketplaces) */
    if (meili) {
      deps.vertical.setBootStage("index");
      splashGo("index", {
        headline: "Indexation du catalogue…",
        detail: "Contrôle des indexes…",
        percent: 10,
      });
      try {
        const decision = await meiliIndexReady(meili);
        if (!decision) {
          splashPatch("index", {
            status: "skip",
            detail: "Contrôle de cohérence indisponible — indexation reportée",
            percent: 100,
          });
        } else if (!decision.ready) {
          // Le POURQUOI de la réindexation, visible utilisateur (fini le muet).
          splashPatch("index", {
            detail: `Réindexation nécessaire : ${decision.reason}`,
            percent: 10,
          });
          const indexStarted = Date.now();
          await runIndexerWithProgress(meili);
          track({
            level: "event",
            kind: "index.run",
            outcome: "ok",
            reason: decision.reason,
            durationMs: Date.now() - indexStarted,
          });
          splashDone("index", "Index prêt");
        } else {
          log("main", "indexation Meili : indexes déjà prêts — skip");
          splashDone("index", "Indexes déjà prêts");
        }
      } catch (e) {
        logError("indexer", e);
        track({
          level: "error",
          kind: "index.run",
          outcome: "error",
          reason: e instanceof Error ? e.message.slice(0, 300) : String(e),
        });
        splashPatch("index", {
          status: "error",
          detail: e instanceof Error ? e.message : "Erreur indexation",
          percent: 100,
        });
      }
    } else {
      log("main", "indexation Meili : skip (Meili indisponible)");
      track({
        level: "decision",
        kind: "meili.ready",
        outcome: "skip-no-meili",
        reason: "meili-indisponible",
      });
    }

    /*
     * Stack embeds (contrat produit) :
     * - install + start UNIQUEMENT ici, pendant le splash ;
     * - pas d’interface CRM tant que tout n’est pas prêt ;
     * - l’utilisateur ne télécharge / démarre / arrête rien au clic.
     */

    /* 4a+. Runtime Node marque (pin ≥22.22) — requis dès qu’un outil npm démarre. */
    if (needNode) {
      deps.vertical.setBootStage("node-runtime");
      splashGo("node", {
        headline: `${nodeLabel}…`,
        detail: "Vérification / installation du runtime Node piné",
        percent: 10,
      });
      const nodeRt = deps.hosts.nodeRuntime() as {
        ensureDesktopNode?: (
          o: unknown,
        ) => Promise<{ ok: boolean; detail?: string }>;
      };
      const ensureNode = nodeRt.ensureDesktopNode;
      if (!ensureNode) {
        throw new Error("nodeRuntime.ensureDesktopNode manquant");
      }
      const nodeReady = await ensureNode({
        onLog: (line: string) => {
          scoped("node")(line);
          if (isSplashProgressLine(line)) {
            const detail = sanitizeSplashDetail(line);
            splashPatch("node", {
              detail,
              percent: estimateEmbedPercent(detail),
              headline: `${nodeLabel}…`,
            });
          }
        },
      });
      if (!nodeReady.ok) {
        splashPatch("node", {
          status: "error",
          detail: nodeReady.detail,
          percent: 100,
        });
        throw new Error(
          `${nodeLabel} requis pour n8n : ${nodeReady.detail}`,
        );
      }
      splashDone(
        "node",
        `v${nodeReady.version} (${nodeReady.source})\n${nodeReady.node}`,
      );
      log(
        "main",
        `${nodeLabel} v${nodeReady.version} (${nodeReady.source}) → ${nodeReady.node}`,
      );
    }

    /*
     * 4b–c. Hermes + n8n EN PARALLÈLE après Node.
     * Temps splash ≈ max(des 2). Chaque outil a sa propre ligne + barre + chrono.
     */
    deps.vertical.setBootStage("embeds");
    setSplashStatus("Stack native — démarrage parallèle…");

    const startEmbed = async (
      name: "hermes" | "n8n",
      label: string,
      run: () => Promise<unknown>,
    ): Promise<unknown> => {
      splashGo(name, {
        parallel: true,
        headline: "Stack native — démarrage parallèle…",
        detail: `Démarrage ${label}…`,
        percent: 8,
      });
      const embedStarted = Date.now();
      // Honnêteté splash + flotte : install réelle vs runtime déjà présent
      // (ex. userData conservé par une désinstallation sans purge).
      const startPath = (): "bootstrap" | "reuse" | null => {
        try {
          return name === "hermes"
            ? deps.hosts.hermes().getHermesLastStartPath()
            : deps.hosts.n8n().getN8nLastStartPath();
        } catch {
          return null;
        }
      };
      try {
        const r = await run();
        const p = startPath();
        track({
          level: "event",
          kind: `embed.${name}`,
          outcome: r ? "ok" : "skipped",
          durationMs: Date.now() - embedStarted,
          ctx: { startPath: p },
        });
        const readyLabel = name === "hermes" ? "API + WebUI prêts" : "UI prête";
        const pathLabel =
          p === "bootstrap"
            ? "installation complète"
            : p === "reuse"
              ? "runtime existant réutilisé"
              : null;
        splashDone(
          name,
          r
            ? pathLabel
              ? `OK (${pathLabel}) — ${readyLabel}`
              : `OK — ${readyLabel}`
            : "Ignoré",
        );
        return r;
      } catch (e) {
        track({
          level: "error",
          kind: `embed.${name}`,
          outcome: "error",
          reason: e instanceof Error ? e.message.slice(0, 300) : String(e),
          durationMs: Date.now() - embedStarted,
          ctx: { startPath: startPath() },
        });
        splashPatch(name, {
          status: "error",
          detail: e instanceof Error ? e.message : String(e),
          percent: 100,
        });
        throw e;
      }
    };

    const [hermesR, n8nR] = await Promise.allSettled([
      needHermes
        ? startEmbed("hermes", "Hermes", () =>
            deps.hosts.hermes().startHermes({
              connectionMode: "local",
              hermesConfig: hermesCfg,
              onLog: (line) => {
                scoped("hermes")(line);
                if (isSplashProgressLine(line)) splashEmbedLine("hermes", line);
              },
              autoBootstrap: true,
            }),
          )
        : Promise.resolve(null),
      needN8n
        ? startEmbed("n8n", "n8n", () =>
            deps.hosts.n8n().startN8n({
              connectionMode: "local",
              n8nConfig: n8nCfg,
              publicBaseUrl: deps.hosts.tunnel().publicUrlForEmbedService("n8n"),
              onLog: (line) => {
                scoped("n8n")(line);
                if (isSplashProgressLine(line)) splashEmbedLine("n8n", line);
              },
              autoBootstrap: true,
            }),
          )
        : Promise.resolve(null),
    ]);

    hermes =
      hermesR.status === "fulfilled"
        ? (hermesR.value as typeof hermes)
        : null;
    n8n = n8nR.status === "fulfilled" ? (n8nR.value as typeof n8n) : null;

    if (hermesR.status === "rejected") logError("hermes", hermesR.reason);
    if (n8nR.status === "rejected") logError("n8n", n8nR.reason);

    // Pont Hermes ↔ n8n (clé API) — restart Hermes si 1er provisionnement.
    if (needHermes && needN8n && hermes && n8n) {
      try {
        const bridge = await deps.hosts.hermes().reapplyHermesBridge({
          connectionMode: "local",
          onLog: (line) => {
            scoped("hermes")(line);
            if (isSplashProgressLine(line)) splashEmbedLine("hermes", line);
          },
        });
        if (bridge.restarted) hermes = deps.hosts.hermes().getRunningHermes() ?? hermes;
        log("main", `bridge n8n→Hermes: ${bridge.detail}`);
      } catch (e) {
        logError("hermes-bridge", e);
      }
    }

    if (needHermes && (!hermes?.apiUrl || !hermes.webuiUrl)) {
      // Soft-boot : un install.sh exit 126 / CLI absente ne doit pas bloquer l'UI.
      // On ouvre l’UI quand même + retry Hermes en arrière-plan (pas fail-hard).
      const st = deps.hosts.hermes().getHermesStatusPayload("local");
      const hermesSoftMsg = `Hermes indisponible pour l’instant — interface ouverte, retry en arrière-plan.\n${st.detail}${st.bootstrapError ? `\n${st.bootstrapError}` : ""}`;
      logError("hermes", hermesSoftMsg);
      splashPatch("hermes", {
        status: "error",
        detail: hermesSoftMsg,
        percent: 100,
      });
      track({
        level: "error",
        kind: "embed.hermes",
        outcome: "degraded",
        reason: hermesSoftMsg.slice(0, 300),
      });
      const hermesCfgRetry = hermesCfg;
      const retryHermesBg = async () => {
        const delaysMs = [5_000, 15_000, 45_000, 90_000, 180_000];
        for (let i = 0; i < delaysMs.length; i++) {
          await new Promise((r) => setTimeout(r, delaysMs[i]!));
          try {
            if (deps.hosts.hermes().getRunningHermes()?.apiUrl) return;
            log(
              "hermes",
              `retry background Hermes (${i + 1}/${delaysMs.length})…`,
            );
            const again = await deps.hosts.hermes().startHermes({
              connectionMode: "local",
              hermesConfig: hermesCfgRetry,
              onLog: (line) => scoped("hermes")(line),
              autoBootstrap: true,
            });
            if (again?.apiUrl) {
              hermes = again;
              log(
                "main",
                `Hermes API prêt (retry) sur ${again.apiUrl}${again.webuiUrl ? ` · WebUI ${again.webuiUrl}` : ""}`,
              );
              return;
            }
          } catch (e) {
            logError("hermes-retry", e);
          }
        }
        log("hermes", "retry background épuisé — Hermes reste indisponible");
      };
      void retryHermesBg();
    }
    if (needN8n && !n8n?.uiUrl) {
      const st = deps.hosts.n8n().getN8nStatusPayload("local");
      const extra =
        st.bootstrapError && st.bootstrapError !== st.detail
          ? `\n${st.bootstrapError}`
          : "";
      throw new Error(
        `n8n doit être prêt avant l’interface (install + démarrage au splash uniquement).\n${st.detail}${extra}`,
      );
    }
    if (hermes) {
      splashDone(
        "hermes",
        `API ${hermes.apiUrl}\nWebUI ${hermes.webuiUrl || "—"}`,
      );
      log(
        "main",
        `Hermes API prêt sur ${hermes.apiUrl}${hermes.webuiUrl ? ` · WebUI ${hermes.webuiUrl}` : ""}`,
      );
    } else {
      log("main", `Hermes skip (mode=${hermesCfg.mode})`);
    }
    if (n8n) {
      splashDone("n8n", `UI ${n8n.uiUrl}`);
      log("main", `n8n UI prêt sur ${n8n.uiUrl}`);
    } else log("main", `n8n skip (mode=${n8nCfg.mode})`);

    setSplashStatus("Stack native prête — finalisation…");

    /* 5. Serveur Next */
    deps.vertical.setBootStage("next-server");
    splashGo("next", {
      headline: "Démarrage du serveur local…",
      detail: "Next.js CRM",
      percent: 25,
    });
    const publicUrl = deps.hosts.tunnel().publicUrlForServer();
    const bindHost = currentBindHost();
    server = await deps.hosts.server().startNextServer({
      meiliHost: meili?.host ?? null,
      meiliMasterKey: meili?.masterKey ?? null,
      bindHost,
      extraEnv: {
        ...(publicUrl
          ? { APP_PUBLIC_URL: publicUrl, MCP_PUBLIC_URL: publicUrl }
          : {}),
        ...deps.hosts.hermes().getHermesNextEnv("local"),
        ...deps.hosts.n8n().getN8nNextEnv("local"),
        ...deps.store().getEmailNextEnv(),
        // Onglets Données / n8n du Product Hub côté Next (pluginDataPath).
        [pluginsDirEnvKey]: deps.hosts.pluginRuntime().pluginsRootDir(),
      },
      onLog: scoped("next"),
    });
    attachNextExitHandler(server);
    activeCrmBaseUrl = server.baseUrl;
    syncServerLlmActiveFromStored();
    splashDone("next", server.baseUrl);
    log(
      "main",
      `serveur Next prêt sur ${server.baseUrl} (bind ${bindHost}, BYOK openai=${serverLlmActive.openai} anthropic=${serverLlmActive.anthropic})`,
    );

    /* 5a. Clé CRM Hermes + plugins control plane, puis seed context/MCP + 1 restart */
    let hermesCrmApiKey: string | null = null;
    if (needHermes && hermes) {
      try {
        const crmKey = await deps.hosts.hermesCrmKey().ensureHermesCrmApiKey({
          log: (line) => scoped("hermes")(line),
        });
        log("main", `crm-key Hermes: ${crmKey.detail}`);
        hermesCrmApiKey = crmKey.apiKey;
      } catch (e) {
        logError("hermes-crm-bridge", e);
      }
    }

    /* 5a1b. D1 — façade MCP → proxy Hono dès que Next écoute */
    try {
      const brandRt = deps.vertical.getActiveBrandRuntime();
      if (brandRt) {
        brandRt.setMcpUpstream(
          server.baseUrl,
          hermesCrmApiKey || process.env[apiKeyEnvName] || null,
        );
        log(
          "mcp",
          `D1 upstream Hono → ${server.baseUrl}/mcp ` +
            `(executor=${brandRt.mcpProductExecutor})`,
        );
      }
    } catch (e) {
      logError("mcp-upstream", e);
    }

    /* 5a2. Plugins user (sidecars) + control plane */
    try {
      deps.hosts.plugins().setPluginsCrmPort(server.port);
      const plug = await deps.hosts.plugins().startEnabledPlugins({
        onLog: (line) => scoped("plugins")(line),
      });
      if (plug.started.length) {
        log("main", `plugins démarrés: ${plug.started.join(", ")}`);
      }
      if (plug.errors.length) {
        log("main", `plugins erreurs: ${plug.errors.join(" | ")}`);
      }
      const plugApi = await deps.hosts.pluginControl().startPluginControlApi({
        log: (line) => scoped("plugins")(line),
      });
      log("main", `plugins-api: ${plugApi.url}`);
    } catch (e) {
      logError("plugins", e);
    }

    /* 5a3. Context pack (prefs, OpenAPI, glossaire) + MCP marque + bridge Hermes */
    if (needHermes && hermes) {
      try {
        if (hermesCrmApiKey) {
          const ctx = await deps.hosts.hermesSeed().seedHermesContext({
            crmPort: server.port,
            apiKey: hermesCrmApiKey,
            log: (line) => scoped("hermes")(line),
          });
          log(
            "main",
            `hermes-context: ${ctx.files.length} fichiers → ${ctx.dir} (mcp ${ctx.mcpUrl})`,
          );
        }
        const bridge = await deps.hosts.hermes().reapplyHermesBridge({
          connectionMode: "local",
          crmPort: server.port,
          forceRestart: Boolean(hermesCrmApiKey),
          forceReason: "context+mcp+plugins",
          onLog: (line) => scoped("hermes")(line),
        });
        if (bridge.restarted) {
          hermes = deps.hosts.hermes().getRunningHermes() ?? hermes;
          // Hermes a pu prendre un nouveau port — Next doit recevoir HERMES_API_URL.
          await maybeRestartNextAfterHermesSpawn(true);
        } else if (!deps.hosts.hermes().getRunningHermes()?.webuiUrl) {
          throw new Error(bridge.detail);
        }
        log("main", `bridge CRM→Hermes: ${bridge.detail}`);
      } catch (e) {
        logError("hermes-context-bridge", e);
        const status = deps.hosts.hermes().getHermesStatusPayload("local");
        deps.vertical.reportCrashDebounced(
          "child-exit",
          `hermes-context-bridge:${status.detail}`,
          {
            service: "hermes",
            action: "context-bridge-restart",
            status: status.status,
            webuiStatus: status.webuiStatus,
            detail: status.detail,
            bootstrapError: status.bootstrapError,
            error: e instanceof Error ? e.message : String(e),
            logs: deps.hosts.hermes().getHermesLogs().slice(-80),
          },
        );
      }
    }

    /* 5b. Tunnel Cloudflare (si réservé) — accès distant (desktop / browser / mobile) */
    if (publicUrl) {
      deps.vertical.setBootStage("tunnel");
      splashGo("tunnel", {
        headline: "Tunnel d’accès distant…",
        detail: publicUrl,
        percent: 30,
      });
      try {
        await syncTunnelIngress();
        await deps.hosts.tunnel().startCloudflared();
        // n8n a démarré avant le tunnel → réinjecter WEBHOOK_URL publique.
        if (needN8n) {
          splashPatch("n8n", {
            status: "running",
            detail: "Alignement webhooks sur le tunnel…",
            percent: 92,
            headline: "Tunnel d’accès distant…",
          });
          await syncN8nWebhookPublicUrl((line) => {
            scoped("n8n")(line);
            if (isSplashProgressLine(line)) splashEmbedLine("n8n", line);
          });
        }
        const st = deps.hosts.tunnel().getTunnelStatus();
        const urls = st.publicUrls;
        trackDecision("tunnel.connect", st.online ? "online" : "configured", {
          ctx: { slug: deps.store().getTunnelConfig()?.slug },
        });
        splashDone(
          "tunnel",
          urls
            ? `CRM ${publicUrl}\nn8n ${urls.n8n}\nHermes ${urls.hermes}`
            : publicUrl,
        );
        log(
          "main",
          `tunnel d'accès distant prêt → CRM ${publicUrl}` +
            (urls ? ` · n8n ${urls.n8n} · hermes ${urls.hermes}` : ""),
        );
      } catch (e) {
        logError("tunnel", e);
        trackDecision("tunnel.connect", "error", {
          reason: e instanceof Error ? e.message.slice(0, 300) : String(e),
        });
        splashPatch("tunnel", {
          status: "error",
          detail:
            (e instanceof Error ? e.message : String(e)) +
            "\n(CRM local reste utilisable)",
          percent: 100,
        });
      }
    }

    /* 6. First-run setup OU login conditionnel + UI */
    deps.vertical.setBootStage("load-ui");
    routeExternalLinksToTabs(view, server.baseUrl);
    if (deps.appKind === "server") {
      installServerCockpitGuard(view, server.baseUrl);
    }

    if (!deps.store().isSetupComplete()) {
      splashGo("login", {
        headline: "Configuration initiale…",
        detail: "Ouverture de /setup",
        percent: 90,
      });
      log("main", "setup incomplet → /setup");
      await view.webContents.loadURL(`${server.baseUrl}/setup`);
      splashDone("login", "Écran de configuration");
    } else {
      if (deps.store().shouldAutoLoginOnBoot()) {
        deps.vertical.setBootStage("auto-login");
        splashGo("login", {
          headline: "Connexion…",
          detail: "Session locale",
          percent: 80,
        });
        try {
          await autoLogin(server.baseUrl);
        } catch (e) {
          logError("auto-login", e);
        }
        // Q5 (multi-profils) : en mode serveur (« Héberger »), la fenêtre
        // principale ouvre le COCKPIT ; app Serveur (kind=server) → cockpit
        // AUTONOME /server-cockpit (sans sidebar CRM) ; legacy → /cockpit.
        await view.webContents.loadURL(`${server.baseUrl}${deps.bootBehavior.cockpitPath}`);
        splashDone("login", "Cockpit ouvert");
      } else {
        splashGo("login", {
          headline: "Prêt",
          detail: "Ouverture de /login",
          percent: 90,
        });
        log("main", "pas d'auto-login (rester connecté désactivé ou déconnexion) → /login");
        // Après login manuel, atterrir sur le cockpit (Q5) via ?next=.
        await view.webContents.loadURL(
          `${server.baseUrl}/login?next=${encodeURIComponent(deps.bootBehavior.cockpitPath)}`,
        );
        splashDone("login", "Écran de connexion");
      }
    }

    // La fenêtre CRM est maintenant visible. Les embeds peuvent télécharger
    // Node/n8n/Hermes sans écran noir et sans dialogue bloquant. Les statuts
    // restent consultables dans le shell, les logs et le cockpit.
    if (deferEmbedWarm && (configuredNeedHermes || configuredNeedN8n)) {
      void (async () => {
        log(
          "native",
          "warm différé après UI — Hermes/n8n s'installent en arrière-plan",
        );
        if (configuredNeedN8n) {
          const nodeRuntime = deps.hosts.nodeRuntime() as {
            ensureDesktopNode?: (opts: {
              onLog?: (line: string) => void;
            }) => Promise<{ ok: boolean; detail?: string }>;
          };
          try {
            const node = await nodeRuntime.ensureDesktopNode?.({
              onLog: (line) => log("node", line),
            });
            if (!node?.ok) {
              log(
                "native",
                `warm n8n différé ignoré: ${node?.detail || "Node indisponible"}`,
              );
              return;
            }
          } catch (e) {
            logError("node", e);
            return;
          }
        }
        const [hermesWarm, n8nWarm] = await Promise.allSettled([
          configuredNeedHermes
            ? deps.hosts.hermes().startHermes({
                connectionMode: "local",
                hermesConfig: hermesCfg,
                autoBootstrap: true,
                onLog: (line) => log("hermes", line),
              })
            : Promise.resolve(null),
          configuredNeedN8n
            ? deps.hosts.n8n().startN8n({
                connectionMode: "local",
                n8nConfig: n8nCfg,
                autoBootstrap: true,
                onLog: (line) => log("n8n", line),
              })
            : Promise.resolve(null),
        ]);
        if (hermesWarm.status === "fulfilled" && hermesWarm.value) {
          hermes = hermesWarm.value as typeof hermes;
          log("native", "warm Hermes différé prêt");
        } else if (hermesWarm.status === "rejected") {
          logError("hermes", hermesWarm.reason);
        }
        if (n8nWarm.status === "fulfilled" && n8nWarm.value) {
          n8n = n8nWarm.value as typeof n8n;
          log("native", "warm n8n différé prêt");
        } else if (n8nWarm.status === "rejected") {
          logError("n8n", n8nWarm.reason);
        }
      })();
    }

    /* 7. Bridge bot ↔ onglets fournisseurs (après compte créé) */
    deps.vertical.setBootStage("bridge");
    await startBridgeIfReady();

    /* 8. Agent flotte (opt-in Config → Support) */
    deps.hosts.fleetAgent().startFleetAgent({
      appKind: deps.appKind,
      getHealth: () => {
        const hermes = deps.hosts.hermes().getHermesStatusPayload(
          activeConnectionProfile.mode,
          remoteStatusOpts(),
        );
        const n8nSt = deps.hosts.n8n().getN8nStatusPayload(
          activeConnectionProfile.mode,
          remoteStatusOpts(),
        );
        const tun = deps.hosts.tunnel().getTunnelStatus();
        return {
          next: server ? "running" : "stopped",
          meili: meili ? "running" : "stopped",
          hermes: hermes.status,
          n8n: n8nSt.status,
          tunnel: tun.online ? "running" : tun.configured ? "configured" : "off",
        };
      },
      getHeartbeatExtras: () => {
        if (typeof deps.vertical.getHeartbeatExtras === "function") {
          try {
            return deps.vertical.getHeartbeatExtras();
          } catch {
            return null;
          }
        }
        return null;
      },
      getPluginsSummary: () => {
        try {
          const st = deps.hosts.plugins().pluginsStatusPayload();
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
      getAssistantChatsSample: () => deps.hosts.fleetSamples().sampleAssistantChats(40),
      getHermesChatsSample: () => deps.hosts.fleetSamples().sampleHermesChats(20),
      getRequestLogsSample: () => deps.hosts.fleetSamples().sampleRequestLogs(40),
      getUsersSummary: () => deps.hosts.fleetSamples().sampleUsers(),
      getSessionsSummary: () => {
        const live = deps.hosts.fleetSamples().sampleSessions();
        if (live.length) return live;
        return deps.hosts.fleetSamples().sampleUsers()
          .filter((u) => u.active)
          .map((u) => ({
            userId: u.id,
            username: u.username,
            lastSeen: new Date().toISOString(),
          }));
      },
      getHermesStats: () => {
        try {
          const st = deps.hosts.hermes().getHermesStatusPayload(
            activeConnectionProfile.mode,
            remoteStatusOpts(),
          );
          return {
            status: st.status,
            webuiStatus: st.webuiStatus,
            version: st.version,
            bootstrapPhase: st.bootstrapPhase,
            installing: st.installing,
          };
        } catch {
          return {};
        }
      },
      getActionsSample: () => {
        const ctx = getFleetSessionContext();
        let userId = ctx.userId;
        let username = ctx.username;
        if (!userId) {
          const users = deps.hosts.fleetSamples().sampleUsers().filter(
            (u) => u.kind !== "ai" && u.active !== false,
          );
          const owner =
            users.find((u) => u.role === "owner") || users[0] || null;
          if (owner) {
            userId = owner.id;
            username = owner.username;
          }
        }
        return sampleFleetActions(150).map((a) => ({
          ...a,
          userId: a.userId || userId || undefined,
          username: a.username || username || undefined,
          sessionId: a.sessionId || ctx.sessionId || undefined,
        }));
      },
      executeRemoteCommand: async (cmd) => {
        switch (cmd) {
          case "force-update-check": {
            const s = await checkForUpdatesNow();
            return { ok: true, detail: `update state=${s.state}` };
          }
          case "sync-now": {
            const ok = await deps.hosts.fleetAgent().sendFleetHeartbeat();
            return { ok, detail: ok ? "heartbeat sent" : "heartbeat skipped/failed" };
          }
          case "upload-diagnostics": {
            return deps.hosts.fleetAgent().uploadFleetDiagnostics("remote-command");
          }
          case "restart-n8n": {
            if (activeConnectionProfile.mode !== "local") {
              return { ok: false, detail: "client distant" };
            }
            deps.hosts.n8n().stopN8n();
            const started = await deps.hosts.n8n().startN8n({
              connectionMode: "local",
              n8nConfig: deps.store().getN8nEmbedConfig(),
              autoBootstrap: false,
              onLog: (line) => log("n8n", line),
            });
            n8n = started;
            return {
              ok: Boolean(started),
              detail: started ? `n8n ${started.uiUrl}` : "n8n start failed",
            };
          }
          case "restart-hermes": {
            if (activeConnectionProfile.mode !== "local") {
              return { ok: false, detail: "client distant" };
            }
            await deps.hosts.hermes().stopHermesAndWait();
            const started = await deps.hosts.hermes().startHermes({
              connectionMode: "local",
              hermesConfig: deps.store().getHermesEmbedConfig(),
              onLog: (line) => log("hermes", line),
            });
            hermes = started;
            await maybeRestartNextAfterHermesSpawn(Boolean(started));
            return {
              ok: Boolean(started),
              detail: started ? `hermes ${started.apiUrl}` : "hermes start failed",
            };
          }
          default:
            return { ok: false, detail: `commande refusée: ${cmd}` };
        }
      },
    });

    deps.vertical.setBootStage("ready");
    setUpdaterRenderer(sendUpdateToWebContents(view.webContents));
    log("main", "démarrage terminé.");

    // Boîte noire : boot terminé + durées par étape (timeline crash-reporter),
    // résumé persisté (index.json) puis règles d'anomalies sur l'historique.
    try {
      const timeline = deps.vertical.getBootTimeline();
      const stageDurations: Record<string, number> = {};
      for (let i = 0; i < timeline.length - 1; i++) {
        const cur = timeline[i];
        const next = timeline[i + 1];
        stageDurations[cur.stage] =
          (stageDurations[cur.stage] || 0) +
          Math.max(0, new Date(next.at).getTime() - new Date(cur.at).getTime());
      }
      const bootDuration = bootLocalStartedAt ? Date.now() - bootLocalStartedAt : undefined;
      track({
        level: "event",
        kind: "boot.done",
        outcome: "ok",
        durationMs: bootDuration,
        ctx: { stages: stageDurations },
      });
      persistBootSummary({
        endedAt: new Date().toISOString(),
        durationMs: bootDuration,
      });
      evaluateBootRules();
    } catch (e) {
      logError("ops", e);
    }
  }

  function waitForRetry(): Promise<void> {
    return new Promise((resolve) => ipcMain.once("setup:retry", () => resolve()));
  }

  /** Snapshot embeds + stages pour diagnostiquer un splash KO à distance. */
  function bootFailureContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
    try {
      return {
        ...extra,
        hermes: (() => {
          try {
            const s = deps.hosts.hermes().getHermesStatusPayload("local");
            return {
              status: s.status,
              detail: s.detail,
              bootstrapPhase: s.bootstrapPhase,
              bootstrapError: s.bootstrapError,
              logs: deps.hosts.hermes().getHermesLogs().slice(-60),
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        })(),
        n8n: (() => {
          try {
            const s = deps.hosts.n8n().getN8nStatusPayload("local");
            return {
              status: s.status,
              detail: s.detail,
              bootstrapPhase: s.bootstrapPhase,
              bootstrapError: s.bootstrapError,
              logs: deps.hosts.n8n().getN8nLogs().slice(-60),
            };
          } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
          }
        })(),
      };
    } catch {
      return { ...extra };
    }
  }

  async function bootWithRetry(): Promise<void> {
    const view = await createShell();
    // Tray dès la coquille créée : fermer la fenêtre pendant le boot ne tue pas
    // le serveur. Dégradation gracieuse : sans tray, close = quit (historique).
    trayController = new TrayController({
      productName: deps.manifest.client.productName,
      resourcesRoot: deps.paths.resourcesRoot(),
      isPackaged: deps.paths.isPackaged(),
      showWindow: showMainWindow,
      quit: () => {
        quitting = true;
        app.quit();
      },
      // Sous-menu « Workspaces IA » : fenêtres profils IA (P2, Q8).
      listAiWorkspaces: () => aiWorkspaces?.listWindows() ?? [],
      openAiWorkspace: (userId) => {
        aiWorkspaces?.openWindow(userId);
        trayController?.refresh();
      },
      closeAiWorkspace: (userId) => {
        aiWorkspaces?.closeWorkspace(userId);
        trayController?.refresh();
      },
    });
    trayController.setup();
    // Prefs NSIS (démarrage auto) → sync config locale une seule fois.
    if (app.isPackaged) {
      try {
        const installerPrefs = deps.vertical.consumeInstallerPrefsFile(deps.paths.userDataDir());
        if (typeof installerPrefs?.launchAtStartup === "boolean") {
          deps.store().setBackgroundSettings({
            launchAtStartup: installerPrefs.launchAtStartup,
          });
        }
      } catch (e) {
        logError("installer-prefs", e);
      }
    }
    // Démarrage auto : réappliqué à chaque boot (l'OS reste la source de vérité,
    // setLoginItemSettings est idempotent). Packagé uniquement — en dev on ne
    // veut pas enregistrer le binaire electron du repo.
    if (app.isPackaged) {
      applyLaunchAtStartup(deps.store().getBackgroundSettings().launchAtStartup);
    }
    // Check update dès l’entrée (splash / picker) — pas après le boot Next.
    const updaterLog = scoped("updater");
    void setupAutoUpdater({
      log: updaterLog,
      send: sendUpdateToWebContents(view.webContents),
      feedUrl:
        deps.appKind === "server"
          ? deps.manifest.server.feedUrl
          : deps.manifest.client.feedUrl,
      onTrack: (event) => {
        if (event.kind === "updater.downloaded") {
          track({
            level: "event",
            kind: "updater.downloaded",
            ctx: event.ctx,
          });
          return;
        }
        if (event.outcome === "error") {
          track({
            level: "error",
            kind: "updater.check",
            outcome: "error",
            reason: event.reason,
          });
          return;
        }
        track({
          level: "decision",
          kind: "updater.check",
          outcome: event.outcome,
          ctx: event.ctx,
        });
      },
    });
    for (;;) {
      try {
        await ensureConnectionChosen(view);
        await setupAndStart(view);
        bootReady = true;
        return;
      } catch (e) {
        bootReady = false;
        logError("main", e);
        track({
          level: "error",
          kind: "boot.failed",
          reason: e instanceof Error ? e.message.slice(0, 300) : String(e),
          durationMs: bootLocalStartedAt ? Date.now() - bootLocalStartedAt : undefined,
        });
        persistBootSummary({ endedAt: new Date().toISOString() });
        deps.vertical.reportCrash(
          "boot-failure",
          bootFailureContext({
            step: "boot",
            message: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack : undefined,
          }),
        );
        if (view.webContents.isDestroyed()) return;
        await view.webContents
          .loadURL(
            errorHtml("Le démarrage a échoué", e instanceof Error ? e.message : String(e)),
          )
          .catch(() => {});
        await waitForRetry();
        // Réafficher le picker si le profil distant est HS (ou laisser l'utilisateur changer).
        connectionChoiceResolver = null;
        await view.webContents.loadURL(splashHtmlUrl()).catch(() => {});
      }
    }
  }

  app.whenReady().then(() => {
    // Pas de menu File/Edit/View (chrome Notion-like).
    Menu.setApplicationMenu(null);

    // Logger + crash reporting AVANT toute étape susceptible d'échouer.
    initLogger(deps.paths.userDataDir(), deps.manifest.logBasename);
    deps.vertical.initCrashReporter(deps.paths.userDataDir(), app.getVersion());
    deps.vertical.installGlobalHandlers();

    // Boîte noire : journal structuré + routage des lignes ops (préfixe filaire) des
    // sous-process (indexeur, migrations, Next, embeds) via le hook logger.
    setOpsJournalHooks({
      log: (scope, line) => log(scope, line),
      onAnomaly: (evt: any) => {
        void deps.vertical.reportCrashDebounced("ops-anomaly", evt.kind, {
          kind: evt.kind,
          outcome: evt.outcome,
          reason: evt.reason,
          ctx: evt.ctx,
          bootId: evt.bootId,
        });
      },
    });
    initOpsJournal(deps.paths.userDataDir(), app.getVersion());
    setOpsLineHandler(consumeOpsLine);
    track({ level: "event", kind: "app.start" });

    // Agent flotte DÈS le boot (hooks minimaux) — hôte uniquement : le Client
    // n'embarque pas host-runtime-ctx (paquet slim). Les hooks complets
    // remplacent ceux-ci en fin de boot local.
    if (deps.bootBehavior.allowLocalStack) {
      try {
        deps.hosts.fleetAgent().startFleetAgent({
          appKind: deps.appKind,
          getHealth: () => ({ next: `boot:${deps.vertical.getBootStage()}` }),
          executeRemoteCommand: async (cmd) => {
            if (cmd === "upload-diagnostics") {
              return deps.hosts.fleetAgent().uploadFleetDiagnostics("remote-command(boot)");
            }
            return { ok: false, detail: `boot en cours — commande différée: ${cmd}` };
          },
        });
      } catch (e) {
        logError("fleet", e);
      }
    }

    app.on("child-process-gone", (_e, details) => {
      // GPU/utility process Chromium : rapport (fréquent sur certains drivers Windows).
      if (details.reason !== "clean-exit" && details.reason !== "killed") {
        deps.vertical.reportCrash("child-process-gone", { type: details.type, reason: details.reason });
      }
    });

    // Filet app-level : TOUT webContents (y compris popups OAuth, fenêtres
    // annexes) dont le rendu meurt est rapporté, même sans instrumentation
    // dédiée sur la vue.
    app.on("render-process-gone", (_e, contents, details) => {
      if (details.reason === "clean-exit") return;
      let url = "(?)";
      try {
        url = contents.isDestroyed() ? "(destroyed)" : contents.getURL();
      } catch {
        /* best-effort */
      }
      deps.vertical.reportCrash("renderer-gone", {
        view: "app-level",
        reason: details.reason,
        exitCode: details.exitCode,
        url,
      });
    });

    app.on("web-contents-created", (_e, contents) => {
      // Les webContents créés hors de notre code (popups OAuth des onglets
      // fournisseurs) reçoivent aussi la télémétrie de base. Différé d'un tick :
      // les vues instrumentées explicitement (crm, onglets) gardent leur label
      // précis, deps.vertical.instrumentWebContents est idempotent.
      setImmediate(() => {
        try {
          if (!contents.isDestroyed()) {
            deps.vertical.instrumentWebContents(contents, `wc-${contents.id}`);
          }
        } catch (err) {
          logError("web", err);
        }
      });
    });

    bootWithRetry().catch((e) => {
      logError("main", e);
      deps.vertical.reportCrash("boot-failure", {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        stage: deps.vertical.getBootStage(),
      });
      const dataRoot = deps.paths.userDataDir();
      dialog.showErrorBox(
        `${productName} — le démarrage a échoué`,
        `${e instanceof Error ? e.message : e}\n\n` +
          `Journal : ${crashLogHint() || `${dataRoot}\\logs`}\n` +
          `Rapports : ${crashReportsDir() || `${dataRoot}\\crash-reports`}\n` +
          `Données : ${dataRoot}\n\n` +
          `Un rapport a été enregistré localement et envoyé au support si le réseau est disponible.`,
      );
      app.quit();
    });
  });

  function shutdown(): void {
    quitting = true;
    trayController?.destroy();
    trayController = null;
    aiScreencaster?.stopAll();
    aiScreencaster = null;
    bridge?.stop();
    // Fenêtres profils IA : vraie fermeture à l'arrêt (Q8).
    aiWorkspaces?.destroyAllWindows();
    closeAdminWindow();
    tabs?.closeAll();
    try {
      assistantChrome?.destroy();
    } catch {
      /* ignore */
    }
    assistantChrome = null;
    server?.stop();
    // Stack hôte : modules absents du paquet Client (host-stack lazy).
    if (deps.bootBehavior.allowLocalStack) {
      deps.hosts.tunnel().stopCloudflared();
      deps.hosts.plugins().stopAllPlugins();
      deps.hosts.pluginControl().stopPluginControlApi();
      deps.hosts.hermes().stopHermes();
      deps.hosts.n8n().stopN8n();
    }
    hermes = null;
    n8n = null;
    meili?.stop();
    try {
      deps.vertical.shutdownBrandRuntime();
    } catch {
      /* ignore */
    }
  }

  app.on("before-quit", shutdown);
  app.on("window-all-closed", () => {
    shutdown();
    app.quit();
  });

}
