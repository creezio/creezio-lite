/**
 * Contexte runtime hôte injecté dans tous les launchers B.2.
 * Remplace les singletons kit (userDataDir(), paths.ts, logger).
 */

import type { AppManifest } from "@creezio/brand-config";
import { displayNameFor, type RuntimeAppKind } from "@creezio/platform-core";

export type HostLogFn = (scope: string, line: string) => void;

export type HostRuntimeContext = {
  manifest: AppManifest;
  userDataDir: string;
  resourcesRoot: string;
  isPackaged: boolean;
  appKind?: RuntimeAppKind;
  log?: HostLogFn;
  /** Install ID pour reserve tunnel. */
  getInstallId?: () => string;
  /**
   * Seed skills Hermes vertical (marque) — optionnel.
   * Appelé après création HERMES_HOME.
   */
  seedHermesSkills?: (hermesHome: string) => void | Promise<void>;
  /**
   * Bridge CRM key pour Hermes (insertion DB verticale).
   * Si absent, le launcher n'injecte que n8n bridge.
   */
  getHermesBridgeEnv?: (opts?: {
    crmPort?: number | null;
  }) => Record<string, string>;
  /**
   * H1 « Hermes cerveau unique » — config `mcp_servers.<brandId>` à écrire
   * dans le config.yaml Hermes (URL /mcp loopback + Bearer clé CRM Hermes).
   * null = pas encore disponible (clé absente / serveur pas démarré) → le
   * launcher n'écrit pas de bloc (retiré s'il existait).
   */
  getHermesMcpServerConfig?: (opts?: { crmPort?: number | null }) => {
    serverName: string;
    url: string;
    bearerToken: string;
  } | null;
  /** Env bridge plugins control plane. */
  getPluginControlBridgeEnv?: () => Record<string, string>;
  /** Binaire git emballé (MinGit) pour PATH confiné Hermes/outils. */
  getGitBinary?: () => string | null;
  /**
   * Après owner n8n silencieux — provision clé API Product Hub / Hermes.
   * Vertical (n8n-api-key) reste hors kit.
   */
  onN8nReady?: (opts: {
    uiUrl: string;
    homeDir: string;
    email: string;
    password: string;
    log: (line: string) => void;
  }) => void | Promise<void>;
  /** Extra env Next pour n8n (N8N_API_KEY bridge, etc.). */
  getN8nNextEnvExtra?: (opts: {
    connectionMode: "local" | "remote";
    homeDir: string;
    localUiUrl: string | null;
  }) => Record<string, string>;
  /** Segment userData npm (`tempoflow-npm` / `desktop-npm`). */
  npmUserDataSegment?: string;
  /** Prefixe fichiers secrets n8n/hermes (dual-read legacy `.tempoflow-*`). */
  secretFilePrefix?: string;
};

export function hostProductName(ctx: HostRuntimeContext): string {
  const kind = ctx.appKind === "server" ? "server" : "client";
  return displayNameFor(ctx.manifest, kind);
}

export function hostLog(
  ctx: HostRuntimeContext,
  scope: string,
  line: string,
): void {
  if (ctx.log) ctx.log(scope, line);
  else console.log(`[${scope}] ${line}`);
}
