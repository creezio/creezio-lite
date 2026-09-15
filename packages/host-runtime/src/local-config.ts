/**
 * Config locale + safeStorage — factory brand-agnostic (TF2 local-config.ts).
 *
 * Usage :
 * ```ts
 * const store = await createLocalConfigStore({
 *   configPath: resolveLocalConfigPath(ctx),
 *   manifest,
 * });
 * store.ensureAuthSecret();
 * ```
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import {
  applyFleetTelemetryPatch,
  assertProfileReady,
  createRecoveryVerifier,
  defaultLocalProfile,
  emptyLocalConfig,
  generateRecoveryKey,
  isEmbedEnvService,
  isLocalConfigV1,
  normalizeRecoveryKey,
  sanitizeConnectionProfile,
  sanitizeFleetTelemetry,
  sanitizeHermesEmbedConfig,
  sanitizeN8nEmbedConfig,
  sanitizeUserEnvOverlay,
  unwrapSecretsWithRecoveryKey,
  verifyRecoveryKey,
  wrapSecretsWithRecoveryKey,
  type BackgroundSettings,
  type ConnectionProfile,
  type EmbedEnvService,
  type FleetTelemetryConfig,
  type FleetTelemetryPatch,
  type HermesEmbedConfig,
  type LocalConfigFileV1,
  type N8nEmbedConfig,
  type RememberedServer,
  type AiWorkspacePresentationSetting,
  type TunnelConfigPublic,
  type TunnelMetaStored,
  buildTunnelPublicUrls,
  resolveTunnelHostMode,
} from "@creezio/platform-core";
import {
  canEncrypt,
  loadElectronSafeStorage,
  loadElectronSafeStorageSync,
  openValue,
  sealValue,
  type SafeStorageBackend,
} from "./safe-storage.js";

export type LocalAuth = {
  authUser: string;
  authPassword: string;
  authSecret: string;
};

export type TunnelConfig = TunnelMetaStored & { tunnelToken: string };

/** Chemin fixe ou getter (userData peut changer au boot profil join). */
export type LocalConfigPath = string | (() => string);

export type LocalConfigStoreOptions = {
  configPath: LocalConfigPath;
  manifest: AppManifest;
  /** Injecter un backend (tests) — sinon Electron safeStorage. */
  safeStorage?: SafeStorageBackend | null;
  /** Skip load Electron (tests Node). */
  encryption?: "electron" | "plain" | "inject";
};

export type LocalConfigStore = ReturnType<typeof buildStore>;

async function resolveBackend(
  opts: LocalConfigStoreOptions,
): Promise<SafeStorageBackend | null> {
  if (opts.encryption === "plain") return null;
  if (opts.encryption === "inject" || opts.safeStorage !== undefined) {
    return opts.safeStorage ?? null;
  }
  try {
    return await loadElectronSafeStorage();
  } catch {
    return null;
  }
}

function resolveConfigPath(configPath: LocalConfigPath): string {
  return typeof configPath === "function" ? configPath() : configPath;
}

function buildStore(
  configPath: LocalConfigPath,
  manifest: AppManifest,
  backend: SafeStorageBackend | null,
) {
  const seal = (v: string) => sealValue(backend, v);
  const open = (v: LocalConfigFileV1[keyof LocalConfigFileV1] | undefined) =>
    openValue(
      backend,
      v as Parameters<typeof openValue>[1],
    );

  function readFile(): LocalConfigFileV1 {
    try {
      const raw = fs.readFileSync(resolveConfigPath(configPath), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (isLocalConfigV1(parsed)) return parsed;
    } catch {
      /* premier lancement */
    }
    return emptyLocalConfig();
  }

  function writeFile(cfg: LocalConfigFileV1): void {
    const filePath = resolveConfigPath(configPath);
    const dir = path.dirname(filePath);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), {
      mode: 0o600,
    });
  }

  function ensureAuthSecret(): string {
    const cfg = readFile();
    let authSecret = open(cfg.authSecret);
    if (!authSecret) {
      authSecret = crypto.randomBytes(32).toString("hex");
      cfg.authSecret = seal(authSecret);
      writeFile(cfg);
    }
    return authSecret;
  }

  function ensureMcpJwtSecret(): string {
    const cfg = readFile();
    let secret = open(cfg.mcpJwtSecret);
    if (!secret) {
      secret = crypto.randomBytes(32).toString("hex");
      cfg.mcpJwtSecret = seal(secret);
      writeFile(cfg);
    }
    return secret;
  }

  function getLocalAuth(): LocalAuth | null {
    const cfg = readFile();
    const authSecret = open(cfg.authSecret);
    const authUser = open(cfg.authUser);
    const authPassword = open(cfg.authPassword);
    if (!authSecret || !authUser || !authPassword) return null;
    return { authUser, authPassword, authSecret };
  }

  function ensureLocalAuth(): LocalAuth {
    ensureAuthSecret();
    const auth = getLocalAuth();
    if (!auth) {
      throw new Error("Compte local non configuré — terminer le wizard /setup");
    }
    return auth;
  }

  function setLocalAuthCredentials(user: string, password: string): void {
    const u = user.trim();
    const p = password;
    if (!u || u.length < 2)
      throw new Error("Identifiant trop court (min. 2 caractères)");
    if (!p || p.length < 6)
      throw new Error("Mot de passe trop court (min. 6 caractères)");
    const cfg = readFile();
    cfg.authSecret = seal(ensureAuthSecret());
    cfg.authUser = seal(u);
    cfg.authPassword = seal(p);
    writeFile(cfg);
  }

  function changeLocalPassword(
    currentPassword: string,
    newPassword: string,
  ): void {
    const auth = getLocalAuth();
    if (!auth) throw new Error("Compte local non configuré");
    if (currentPassword !== auth.authPassword) {
      throw new Error("Mot de passe actuel incorrect");
    }
    if (!newPassword || newPassword.length < 6) {
      throw new Error("Nouveau mot de passe trop court (min. 6 caractères)");
    }
    const cfg = readFile();
    cfg.authPassword = seal(newPassword);
    writeFile(cfg);
  }

  function hasRecoveryKeyConfigured(): boolean {
    const cfg = readFile();
    return Boolean(cfg.recoveryVerifier && cfg.recoveryEnvelope);
  }

  function resetPasswordWithRecoveryKey(
    recoveryKey: string,
    newPassword: string,
  ): { username: string } {
    if (!newPassword || newPassword.length < 6) {
      throw new Error("Nouveau mot de passe trop court (min. 6 caractères)");
    }
    const cfg = readFile();
    if (!verifyRecoveryKey(recoveryKey, cfg.recoveryVerifier)) {
      throw new Error("Clé de récupération incorrecte");
    }
    const unwrapped = unwrapSecretsWithRecoveryKey(
      recoveryKey,
      cfg.recoveryEnvelope,
    );
    const authSecret = open(cfg.authSecret) || unwrapped.authSecret;
    cfg.authSecret = seal(authSecret);
    cfg.authUser = seal(unwrapped.authUser);
    cfg.authPassword = seal(newPassword);
    cfg.recoveryEnvelope = wrapSecretsWithRecoveryKey(recoveryKey, {
      authUser: unwrapped.authUser,
      authPassword: newPassword,
      authSecret,
    });
    cfg.skipAutoLogin = false;
    writeFile(cfg);
    return { username: unwrapped.authUser };
  }

  function isSetupComplete(): boolean {
    const cfg = readFile();
    if (cfg.setupComplete === true) return true;
    if (cfg.setupComplete === false) return false;
    const authUser = open(cfg.authUser);
    const authPassword = open(cfg.authPassword);
    const authSecret = open(cfg.authSecret);
    if (authUser && authPassword && authSecret) {
      cfg.setupComplete = true;
      writeFile(cfg);
      return true;
    }
    return false;
  }

  function applyFirstRunSetup(opts: {
    username: string;
    password: string;
    openaiKey: string;
    recoveryKey: string;
    stayLoggedIn?: boolean;
  }): void {
    const u = opts.username.trim();
    const p = opts.password;
    const key = opts.openaiKey.trim();
    const recoveryKey = String(opts.recoveryKey || "").trim();
    if (!u || u.length < 2)
      throw new Error("Identifiant trop court (min. 2 caractères)");
    if (!p || p.length < 6)
      throw new Error("Mot de passe trop court (min. 6 caractères)");
    if (!key) throw new Error("Clé OpenAI requise");
    if (!recoveryKey) throw new Error("Clé de récupération requise");

    const cfg = readFile();
    let authSecret = open(cfg.authSecret);
    if (!authSecret) authSecret = crypto.randomBytes(32).toString("hex");
    cfg.authSecret = seal(authSecret);
    cfg.authUser = seal(u);
    cfg.authPassword = seal(p);
    cfg.openaiApiKey = seal(key);
    cfg.recoveryVerifier = createRecoveryVerifier(recoveryKey);
    cfg.recoveryEnvelope = wrapSecretsWithRecoveryKey(recoveryKey, {
      authUser: u,
      authPassword: p,
      authSecret,
    });
    cfg.setupComplete = true;
    cfg.skipAutoLogin = false;
    cfg.stayLoggedIn = opts.stayLoggedIn !== false;
    writeFile(cfg);
  }

  function markSetupComplete(): void {
    const cfg = readFile();
    cfg.setupComplete = true;
    cfg.skipAutoLogin = false;
    if (cfg.stayLoggedIn == null) cfg.stayLoggedIn = true;
    writeFile(cfg);
  }

  function getLlmKeys(): { openai: string | null; anthropic: string | null } {
    const cfg = readFile();
    // BYOK store prioritaire (clé posée par l'utilisateur via l'UI) ; sinon
    // clé opérateur au niveau hôte (serveurs Docker headless : server-docker
    // forward OPENAI_API_KEY / ANTHROPIC_API_KEY dans l'env du container).
    return {
      openai:
        open(cfg.openaiApiKey) ||
        (process.env.OPENAI_API_KEY || "").trim() ||
        null,
      anthropic:
        open(cfg.anthropicApiKey) ||
        (process.env.ANTHROPIC_API_KEY || "").trim() ||
        null,
    };
  }

  function setLlmKey(
    provider: "openai" | "anthropic",
    key: string | null,
  ): void {
    const cfg = readFile();
    const field = provider === "openai" ? "openaiApiKey" : "anthropicApiKey";
    if (key) cfg[field] = seal(key);
    else delete cfg[field];
    writeFile(cfg);
  }

  function getGoogleTokens(): string | null {
    return open(readFile().googleTokens);
  }

  function setGoogleTokens(json: string | null): void {
    const cfg = readFile();
    if (json) cfg.googleTokens = seal(json);
    else delete cfg.googleTokens;
    writeFile(cfg);
  }

  function getTunnelConfig(): TunnelConfig | null {
    const cfg = readFile();
    const meta = cfg.tunnelMeta;
    if (!meta) return null;
    // Token vide autorisé = surface locale (sans Cloudflare).
    const token = open(cfg.tunnelToken) ?? "";
    return { ...meta, tunnelToken: token };
  }

  function setTunnelConfig(cfg: TunnelConfig): void {
    const file = readFile();
    const { tunnelToken, ...meta } = cfg;
    file.tunnelMeta = meta;
    file.tunnelToken = seal(tunnelToken);
    writeFile(file);
  }

  function clearTunnelConfig(): void {
    const file = readFile();
    delete file.tunnelMeta;
    delete file.tunnelToken;
    writeFile(file);
  }

  function getTunnelPublic(): TunnelConfigPublic {
    const cfg = getTunnelConfig();
    const envFlat = String(process.env.CREEZIO_TUNNEL_FLAT_HOSTS || "").trim();
    const hostMode = envFlat
      ? resolveTunnelHostMode()
      : resolveTunnelHostMode(cfg?.hostMode ?? manifest.tunnelHostMode);
    const storedOk =
      Boolean(cfg?.publicUrls?.n8n && cfg?.publicUrls?.hermes) &&
      cfg?.hostMode === hostMode;
    const publicUrls = storedOk
      ? cfg!.publicUrls!
      : cfg?.hostname
        ? buildTunnelPublicUrls(cfg.hostname, hostMode)
        : null;
    return {
      configured: Boolean(cfg),
      slug: cfg?.slug ?? null,
      hostname: cfg?.hostname ?? null,
      publicUrl: cfg?.publicUrl ?? null,
      publicUrls,
    };
  }

  function getEmailInboundSecret(): string | null {
    return open(readFile().emailInboundSecret);
  }

  function setEmailInboundSecret(secret: string | null): void {
    const cfg = readFile();
    if (secret) cfg.emailInboundSecret = seal(secret);
    else delete cfg.emailInboundSecret;
    writeFile(cfg);
  }

  function getEmailNextEnv(mailRootDomain?: string): Record<string, string> {
    const tunnel = getTunnelConfig();
    const secret = getEmailInboundSecret();
    const out: Record<string, string> = {};
    if (secret) out.EMAIL_INBOUND_SECRET = secret;
    const root =
      mailRootDomain || `mail.${manifest.tunnelRootDomain}`;
    const domain =
      tunnel?.emailDomain ||
      (tunnel?.slug ? `${tunnel.slug}.${root}` : "");
    if (domain) out.EMAIL_DOMAIN = domain;
    return out;
  }

  function getSkipAutoLogin(): boolean {
    return readFile().skipAutoLogin === true;
  }

  function setSkipAutoLogin(skip: boolean): void {
    const cfg = readFile();
    cfg.skipAutoLogin = skip;
    if (skip) cfg.stayLoggedIn = false;
    writeFile(cfg);
  }

  function getStayLoggedIn(): boolean {
    return readFile().stayLoggedIn === true;
  }

  function setStayLoggedIn(stay: boolean): void {
    const cfg = readFile();
    cfg.stayLoggedIn = stay;
    if (stay) cfg.skipAutoLogin = false;
    writeFile(cfg);
  }

  function shouldAutoLoginOnBoot(): boolean {
    if (!isSetupComplete()) return false;
    if (getSkipAutoLogin()) return false;
    return getStayLoggedIn();
  }

  function getConnectionProfileStored(): ConnectionProfile | null {
    const cfg = readFile();
    if (!cfg.connectionProfile) return null;
    return sanitizeConnectionProfile(cfg.connectionProfile);
  }

  function getConnectionProfile(): ConnectionProfile {
    return getConnectionProfileStored() ?? defaultLocalProfile();
  }

  function setConnectionProfile(
    profile: ConnectionProfile,
  ): ConnectionProfile {
    const ready = assertProfileReady({ ...profile, chosen: true });
    const cfg = readFile();
    cfg.connectionProfile = ready;
    writeFile(cfg);
    return ready;
  }

  function clearConnectionProfileChoice(): void {
    const cfg = readFile();
    const cur = sanitizeConnectionProfile(
      cfg.connectionProfile ?? defaultLocalProfile(),
    );
    cfg.connectionProfile = { ...cur, chosen: false };
    writeFile(cfg);
  }

  function markConnectionPickerRequired(): void {
    const cfg = readFile();
    cfg.connectionProfile = {
      mode: "local",
      remoteUrl: null,
      localBind: "127.0.0.1",
      chosen: false,
    };
    writeFile(cfg);
  }

  function hermesRaw(
    cfg: LocalConfigFileV1,
  ): Partial<HermesEmbedConfig> | null | undefined {
    return cfg.hermesEmbed ?? cfg.hermes;
  }

  function n8nRaw(
    cfg: LocalConfigFileV1,
  ): Partial<N8nEmbedConfig> | null | undefined {
    return cfg.n8nEmbed ?? cfg.n8n;
  }

  function getHermesEmbedConfig(): HermesEmbedConfig {
    return sanitizeHermesEmbedConfig(hermesRaw(readFile()));
  }

  function setHermesEmbedConfig(
    raw: Partial<HermesEmbedConfig>,
  ): HermesEmbedConfig {
    const next = sanitizeHermesEmbedConfig({
      ...getHermesEmbedConfig(),
      ...raw,
      chosen: true,
    });
    const cfg = readFile();
    cfg.hermesEmbed = next;
    writeFile(cfg);
    return next;
  }

  function getN8nEmbedConfig(): N8nEmbedConfig {
    return sanitizeN8nEmbedConfig(n8nRaw(readFile()));
  }

  function setN8nEmbedConfig(raw: Partial<N8nEmbedConfig>): N8nEmbedConfig {
    const next = sanitizeN8nEmbedConfig({
      ...getN8nEmbedConfig(),
      ...raw,
      chosen: true,
    });
    const cfg = readFile();
    cfg.n8nEmbed = next;
    writeFile(cfg);
    return next;
  }

  function getEmbedUserEnv(service: EmbedEnvService): Record<string, string> {
    const raw = readFile().embedEnv?.[service];
    return sanitizeUserEnvOverlay(service, raw);
  }

  function getFleetTelemetry(): FleetTelemetryConfig {
    return sanitizeFleetTelemetry(readFile().fleetTelemetry);
  }

  function setFleetTelemetry(patch: FleetTelemetryPatch): FleetTelemetryConfig {
    const next = applyFleetTelemetryPatch(getFleetTelemetry(), patch);
    const cfg = readFile();
    cfg.fleetTelemetry = next;
    writeFile(cfg);
    return next;
  }

  function setEmbedUserEnv(
    service: EmbedEnvService,
    values: Record<string, string>,
  ): Record<string, string> {
    if (!isEmbedEnvService(service)) {
      throw new Error(`service env inconnu: ${service}`);
    }
    const next = sanitizeUserEnvOverlay(service, values);
    const cfg = readFile();
    cfg.embedEnv = { ...(cfg.embedEnv || {}), [service]: next };
    writeFile(cfg);
    return next;
  }

  function getBackgroundSettings(): BackgroundSettings {
    const cfg = readFile();
    const raw = cfg.background;
    return {
      closeToTray:
        raw?.closeToTray !== false && cfg.closeToTray !== false,
      launchAtStartup:
        raw?.launchAtStartup === true || cfg.launchAtStartup === true,
    };
  }

  function setBackgroundSettings(
    patch: Partial<BackgroundSettings>,
  ): BackgroundSettings {
    const cur = getBackgroundSettings();
    const next: BackgroundSettings = {
      closeToTray:
        typeof patch.closeToTray === "boolean"
          ? patch.closeToTray
          : cur.closeToTray,
      launchAtStartup:
        typeof patch.launchAtStartup === "boolean"
          ? patch.launchAtStartup
          : cur.launchAtStartup,
    };
    const cfg = readFile();
    cfg.background = next;
    writeFile(cfg);
    return next;
  }

  function getAiWorkspacePresentation(): AiWorkspacePresentationSetting {
    return readFile().aiWorkspacePresentation === "embedded"
      ? "embedded"
      : "window";
  }

  function setAiWorkspacePresentation(
    value: AiWorkspacePresentationSetting,
  ): AiWorkspacePresentationSetting {
    const next: AiWorkspacePresentationSetting =
      value === "embedded" ? "embedded" : "window";
    const cfg = readFile();
    cfg.aiWorkspacePresentation = next;
    writeFile(cfg);
    return next;
  }

  const MAX_REMEMBERED_SERVERS = 8;

  function rememberedServerId(url: string): string {
    try {
      const u = new URL(url);
      const hostPort = u.port ? `${u.hostname}-${u.port}` : u.hostname;
      return hostPort
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .slice(0, 64);
    } catch {
      return url
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .slice(0, 64);
    }
  }

  function sanitizeRememberedServers(raw: unknown): RememberedServer[] {
    if (!Array.isArray(raw)) return [];
    const out: RememberedServer[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const r = item as Partial<RememberedServer>;
      if (typeof r.url !== "string" || !r.url.trim()) continue;
      const url = r.url.trim().replace(/\/+$/, "");
      out.push({
        id: typeof r.id === "string" && r.id ? r.id : rememberedServerId(url),
        url,
        label:
          typeof r.label === "string" && r.label.trim()
            ? r.label.trim()
            : rememberedServerId(url),
        lastUsedAt:
          typeof r.lastUsedAt === "string" && r.lastUsedAt
            ? r.lastUsedAt
            : new Date(0).toISOString(),
      });
    }
    out.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    return out.slice(0, MAX_REMEMBERED_SERVERS);
  }

  function listRememberedServers(): RememberedServer[] {
    return sanitizeRememberedServers(readFile().profiles?.servers);
  }

  function rememberServer(
    rawUrl: string,
    label?: string,
  ): RememberedServer[] {
    const url = String(rawUrl || "")
      .trim()
      .replace(/\/+$/, "");
    if (!url) return listRememberedServers();
    const id = rememberedServerId(url);
    let displayLabel = label?.trim() || "";
    if (!displayLabel) {
      try {
        displayLabel = new URL(url).hostname;
      } catch {
        displayLabel = id;
      }
    }
    const entry: RememberedServer = {
      id,
      url,
      label: displayLabel,
      lastUsedAt: new Date().toISOString(),
    };
    const cur = listRememberedServers().filter((s) => s.id !== id);
    const next = [entry, ...cur].slice(0, MAX_REMEMBERED_SERVERS);
    const cfg = readFile();
    cfg.profiles = { ...(cfg.profiles || {}), servers: next };
    writeFile(cfg);
    return next;
  }

  function forgetRememberedServer(id: string): RememberedServer[] {
    const next = listRememberedServers().filter((s) => s.id !== id);
    const cfg = readFile();
    cfg.profiles = { ...(cfg.profiles || {}), servers: next };
    writeFile(cfg);
    return next;
  }

  function getSetupDraft(): {
    setupComplete: boolean;
    hasAuth: boolean;
    username: string | null;
    hasOpenai: boolean;
    hasTunnel: boolean;
    tunnelSlug: string | null;
  } {
    const cfg = readFile();
    const llm = getLlmKeys();
    const tunnel = cfg.tunnelMeta;
    return {
      setupComplete: isSetupComplete(),
      hasAuth: Boolean(open(cfg.authUser) && open(cfg.authPassword)),
      username: open(cfg.authUser),
      hasOpenai: Boolean(llm.openai),
      hasTunnel: Boolean(tunnel && open(cfg.tunnelToken)),
      tunnelSlug: tunnel?.slug ?? null,
    };
  }

  function getAccountPublic(): {
    username: string | null;
    setupComplete: boolean;
  } {
    return {
      username: open(readFile().authUser),
      setupComplete: isSetupComplete(),
    };
  }

  return {
    get configPath() {
      return resolveConfigPath(configPath);
    },
    manifest,
    encryptionAvailable: () => canEncrypt(backend),
    readRaw: readFile,
    writeRaw: writeFile,
    ensureAuthSecret,
    ensureMcpJwtSecret,
    getLocalAuth,
    ensureLocalAuth,
    setLocalAuthCredentials,
    changeLocalPassword,
    hasRecoveryKeyConfigured,
    resetPasswordWithRecoveryKey,
    isSetupComplete,
    applyFirstRunSetup,
    markSetupComplete,
    getSetupDraft,
    getAccountPublic,
    getSkipAutoLogin,
    setSkipAutoLogin,
    getStayLoggedIn,
    setStayLoggedIn,
    shouldAutoLoginOnBoot,
    getLlmKeys,
    setLlmKey,
    getGoogleTokens,
    setGoogleTokens,
    getTunnelConfig,
    setTunnelConfig,
    clearTunnelConfig,
    getTunnelPublic,
    getEmailInboundSecret,
    setEmailInboundSecret,
    getEmailNextEnv,
    getConnectionProfileStored,
    getConnectionProfile,
    setConnectionProfile,
    clearConnectionProfileChoice,
    markConnectionPickerRequired,
    getHermesEmbedConfig,
    setHermesEmbedConfig,
    getN8nEmbedConfig,
    setN8nEmbedConfig,
    getEmbedUserEnv,
    setEmbedUserEnv,
    getFleetTelemetry,
    setFleetTelemetry,
    getBackgroundSettings,
    setBackgroundSettings,
    getAiWorkspacePresentation,
    setAiWorkspacePresentation,
    listRememberedServers,
    rememberServer,
    forgetRememberedServer,
    generateRecoveryKey,
    normalizeRecoveryKey,
  };
}

export async function createLocalConfigStore(
  opts: LocalConfigStoreOptions,
): Promise<LocalConfigStore> {
  const backend = await resolveBackend(opts);
  return buildStore(opts.configPath, opts.manifest, backend);
}

/** Variante sync — tests (plain/inject) ou main Electron (encryption electron). */
export function createLocalConfigStoreSync(
  opts: LocalConfigStoreOptions & {
    encryption: "plain" | "inject" | "electron";
  },
): LocalConfigStore {
  let backend: SafeStorageBackend | null = null;
  if (opts.encryption === "inject") {
    backend = opts.safeStorage ?? null;
  } else if (opts.encryption === "electron") {
    backend = loadElectronSafeStorageSync();
  }
  return buildStore(opts.configPath, opts.manifest, backend);
}
