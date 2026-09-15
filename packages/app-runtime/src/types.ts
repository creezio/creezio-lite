import type { AppManifest } from "@creezio/brand-config";
import type { ApiKernel } from "@creezio/api-kernel";
import type { PluginAclPolicy } from "@creezio/product-hub";
import type {
  SqliteMigration,
  SqliteRuntime,
} from "@creezio/platform-core";
import type { BrandMeiliFeed } from "@creezio/search";
import type { CoreNavItem } from "@creezio/shell-ui";
import type { McpRegisteredTool } from "@creezio/mcp-facade";
import type { BrandPermissionGroup } from "./module-contract.js";

/** Kernel marque déjà booted (SQLite + api-kernel + mounts). */
export type BrandKernelHandle = {
  api: ApiKernel;
  runtime: SqliteRuntime;
  /**
   * ACL plugins Product Hub (H5) — policy pour `decidePluginAccess`.
   * Fourni par createBrandKernel ; bootKernel custom peut l'omettre
   * (fail-closed : sans policy, seuls owner / clé service passent).
   */
  getPluginAclPolicy?: (pluginId: string) => PluginAclPolicy | undefined;
  close: () => void;
};

export type BootBrandKernelFn = (opts: {
  userDataDir: string;
  isPackaged?: boolean;
}) => BrandKernelHandle;

/**
 * Host catalogue distant (marque CHR) — injecté dans composeBrandOs.
 * Contrat minimal consommé par brand-desktop-runtime splash.
 */
export type BrandCatalogHost = {
  RateEstimator: unknown;
  formatEta: (seconds: number | null | undefined) => string;
  ensureCatalogPresent: (
    onProgress: (p: {
      phase: string;
      percent: number | null;
      detail?: string;
    }) => void,
  ) => Promise<"present" | "installed" | string>;
  /**
   * Projection du snapshot dans brand.db via l'API kernel (POST
   * /api/v1/modules/catalog/import). Le harness l'appelle APRÈS le listen
   * HTTP (METIER_BASE_URL posé) — parité desktop où le listen précède le
   * splash catalogue. Optionnel : marques sans import projeté.
   */
  ensureCatalogImported?: (
    onProgress: (p: {
      phase: string;
      percent: number | null;
      detail?: string;
    }) => void,
  ) => Promise<"imported" | "up-to-date" | "skipped" | string>;
};

/**
 * Déclaration marque pour startBrandDesktop.
 * Soit `bootKernel`, soit migrations + registerModuleApi (recommandé).
 */
export type StartBrandDesktopConfig = {
  manifest: AppManifest;
  /** `__dirname` du main Electron compilé (pour preload + app-kind). */
  electronDirname: string;
  /** Callback custom (legacy). Préférer brandMigrations + registerModuleApi. */
  bootKernel?: BootBrandKernelFn;
  brandMigrations?: readonly SqliteMigration[];
  registerModuleApi?: (api: ApiKernel) => void;
  beforeBoot?: () => void;
  /** Monter tasks/mails/assistant natifs (défaut true). */
  enablePlatformServices?: boolean;
  /**
   * `full` (défaut) = compose hosts Hermes/n8n/tunnel + MCP HTTP + OS status.
   * `lite` = kernel HTTP + Meili seulement (sonde minimale).
   */
  desktopProfile?: "full" | "lite";
  /**
   * `runtime` (défaut P&P) = installBrandDesktopRuntime (splash/tray/embeds).
   * `window` = BrowserWindow seule (opt-out tests/CI).
   */
  desktopShell?: "window" | "runtime";
  /**
   * Host plugins kit — activé par défaut. OFF si `features.plugins=false`
   * (feature-off) ou kill-switch `CREEZIO_PLUGINS=0`.
   */
  pluginsFeatureOff?: boolean;
  /** Feed Meili marque (optionnel — sans feed = pas de boot Meili). */
  meiliFeed?: BrandMeiliFeed;
  /** Items nav brand (slot vertical). */
  navItems?: CoreNavItem[];
  /** Permissions owner (`collectNavPermissions`) — beforeBoot / kernel. */
  ownerPermissions?: readonly string[];
  /** Groupes access-control (`collectPermissionGroups`) si AC déjà on. */
  permissionGroups?: readonly BrandPermissionGroup[];
  /**
   * Catalogue distant marque (ensureCatalogPresent). Sans = seed local no-op.
   */
  catalogHost?: BrandCatalogHost;
  /**
   * Hook apps (extras / JWT). Le runtime génère toujours les tools
   * `module.<mount>.<op>` depuis `api.listOperations()` (space module).
   * SoT = `operations[]` — pas de `mcpTools` manuscrit.
   */
  discoverModuleTools?: (
    api: ApiKernel,
  ) => McpRegisteredTool[] | Promise<McpRegisteredTool[]>;
  window?: {
    width?: number;
    height?: number;
  };
  /** Chemin relatif resources depuis electronDirname (défaut ../../resources). */
  resourcesRel?: string;
  /** Log basename override. */
  logBasename?: string;
  /**
   * URL collecteur crash (POST JSON). Sinon env
   * `{ENV_PREFIX}_CRASH_ENDPOINT` / `CREEZIO_CRASH_ENDPOINT`.
   * Sans valeur → upload désactivé (fichiers locaux uniquement).
   */
  crashEndpoint?: string;
};

export type BrandDesktopHandle = {
  baseUrl: string;
  port: number;
  searchEngine: "meili" | "sql-fallback" | "off";
  desktopProfile: "full" | "lite";
  close: () => Promise<void>;
};

export type StartBrandKernelHarnessConfig = {
  brandId: string;
  bootKernel?: BootBrandKernelFn;
  manifest?: AppManifest;
  brandMigrations?: readonly SqliteMigration[];
  registerModuleApi?: (api: ApiKernel) => void;
  beforeBoot?: () => void;
  enablePlatformServices?: boolean;
  /** Défaut `full` — même composition OS que le desktop. */
  desktopProfile?: "full" | "lite";
  meiliFeed?: BrandMeiliFeed;
  /** Racine app (pour binaire meili resources/). */
  appRoot: string;
  port?: number;
  dataDir?: string;
  meiliBinary?: string | null;
  skipIndex?: boolean;
  catalogHost?: BrandCatalogHost;
  ownerPermissions?: readonly string[];
  permissionGroups?: readonly BrandPermissionGroup[];
  /**
   * Tools MCP marque additionnels — unionnés avec ceux générés depuis
   * `api.listOperations()` (space module).
   */
  discoverModuleTools?: (
    api: ApiKernel,
  ) => McpRegisteredTool[] | Promise<McpRegisteredTool[]>;
};

export type BrandKernelHarnessHandle = {
  baseUrl: string;
  port: number;
  dataDir: string;
  searchEngine: "meili" | "sql-fallback" | "off";
  desktopProfile: "full" | "lite";
  api: ApiKernel;
  runtime: SqliteRuntime;
  /** Composition OS (null en profil lite / sans manifest). */
  os: import("./compose-brand-os.js").BrandOsComposition | null;
  close: () => Promise<void>;
};
