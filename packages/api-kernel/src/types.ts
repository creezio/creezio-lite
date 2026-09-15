/**
 * Contrats HTTP façade Creezio — indépendants d'Express/Fastify/Next.
 */

import type { SqliteRuntime } from "@creezio/platform-core";
import type { ScopedDbAccess } from "./db-scope.js";

/**
 * Espaces de la façade unique `/api/v1`.
 * - `core` — routes kit (health/version/architecture)
 * - `platform` — APIs plateforme kit (tasks/mails/obs/automations) → DB core
 * - `module` — métier marque → DB brand
 * - `plugin` — plugins installés → DB plugin/<id>
 */
export type ApiSpace = "core" | "platform" | "module" | "plugin";

export type ApiRequest = {
  method: string;
  /** Path absolu commençant par `/api/v1/...` (query string optionnelle stripée). */
  path: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  /**
   * Corps brut (UTF-8) tel que reçu sur le fil — requis pour vérifier les
   * signatures HMAC de webhooks (ex. Stripe) où le JSON re-sérialisé ne
   * correspond pas à l'octet près. Renseigné par l'adaptateur HTTP.
   */
  rawBody?: string;
  query?: Record<string, string | string[] | undefined>;
};

/**
 * H5 — garde ACL plugin avant dispatch mount.
 * Même décision que MCP / control-plane via `decidePluginAccess`.
 */
export type ApiPluginAccessDecision =
  | { allow: true }
  | { allow: false; reason: string; status?: number };

export type ApiAuthorizePluginAccessFn = (ctx: {
  pluginId: string;
  method: string;
  subPath: string;
  req: ApiRequest;
}) => ApiPluginAccessDecision | Promise<ApiPluginAccessDecision>;

/**
 * Garde permission déclarée par un mount module/platforme (`permission`).
 * Implémentée par app-runtime : session cookie/Bearer → owner ou permission
 * effective (résolution access-control si configuré, sinon claim JWT).
 */
export type ApiAuthorizeModuleAccessFn = (ctx: {
  space: Exclude<ApiSpace, "core" | "plugin">;
  mountId: string;
  permission: string;
  method: string;
  subPath: string;
  req: ApiRequest;
}) => ApiPluginAccessDecision | Promise<ApiPluginAccessDecision>;

export type ApiResponse = {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
};

export type ApiHandlerContext = {
  req: ApiRequest;
  /** Espace monté (module/plugin/platform id ou `core`). */
  space: ApiSpace;
  mountId: string;
  /** Sous-chemin relatif au préfixe de montage (sans slash initial). */
  subPath: string;
  /**
   * Accès DB scopé (H2) — présent si le kernel a un `sqliteRuntime`.
   * Écriture hors couche → CrossLayerWriteDeniedError / 403.
   */
  db?: ScopedDbAccess;
};

export type ApiMountHandler = (
  ctx: ApiHandlerContext,
) => ApiResponse | Promise<ApiResponse>;

export type ModuleOperationMethod =
  | "GET"
  | "POST"
  | "PATCH"
  | "PUT"
  | "DELETE";

/**
 * Une capacité du module = une opération déclarée (SoT).
 * Le kit collecte puis génère : route HTTP + ligne `/admin/api` + tool MCP
 * `module.<mountId>.<id>`. Un handler manuscrit n'existe que derrière une
 * op déjà déclarée.
 */
export type ModuleOperation = {
  /** Identifiant stable — "list" | "from-panier". */
  id: string;
  method: ModuleOperationMethod;
  /** Relatif au mount, ex. "/" | "/:id" | "/from-panier". */
  path: string;
  description: string;
  /** Rôles par défaut de la policy MCP (seed `/admin/mcp`). */
  roles?: string[];
  /** Permission HTTP (sinon `ApiMount.permission`). */
  permission?: string;
  inputSchema?: object;
  /**
   * Tool MCP seedé `enabled` si true. Défaut false : à activer dans
   * `/admin/mcp`.
   */
  mcpPublishDefault?: boolean;
};

export type ApiMount = {
  handle: ApiMountHandler;
  /**
   * Opérations servies par ce mount. Obligatoire pour un mount métier
   * manuscrit (doctor `MODULE_OP_MISSING`). EntitySpec : CRUD auto.
   */
  operations?: ModuleOperation[];
  /**
   * Permission requise pour appeler ce mount (ex. "nav.crm"). Vérifiée par
   * le hook `authorizeModuleAccess` du kernel (401 sans session, 403 sans
   * la permission) — la sidebar n'est plus la seule frontière. Absente =
   * pas de contrôle au-delà de la garde session de bordure.
   */
  permission?: string;
  /**
   * Justification explicite d'un mount SANS `permission` (règle d'or n°7,
   * audit F3.4) : route volontairement publique / machine (webhook signé,
   * Bearer flotte…) ou dette qualifiée (`"à qualifier"` — posée par le
   * codemod H9, doctor warn). Un mount métier sans `permission` NI
   * `accessJustification` = doctor `MODULE_PERMISSION_MISSING`
   * (fail-closed pin ≥ 0.16).
   */
  accessJustification?: string;
  /**
   * Si true, le handler peut recevoir des écritures cross-space
   * (défaut false = deny-by-default).
   */
  allowCrossWrite?: boolean;
  /**
   * Couche DB attendue pour ce mount (H2).
   * - platform → core (défaut)
   * - module → brand (défaut)
   * - plugin → plugin/<id> (défaut = mount id)
   * Ignoré pour les routes core kit.
   */
  dbLayer?: "core" | "brand" | "plugin";
};

export type ApiKernelOptions = {
  brandId?: string;
  /** Override version architecture (défaut = platform-core). */
  architectureVersion?: string;
  /** Version package kit / app exposée sur /version. */
  appVersion?: string;
  /**
   * Runtime multi-DB (H2) — injecte `ctx.db` scopé sur chaque mount.
   * Sans runtime, les routes fonctionnent mais sans garde DB (compat H1).
   */
  sqliteRuntime?: SqliteRuntime;
  /**
   * H5 — ACL plugin (see/execute) avant dispatch.
   * Absent ⇒ compat H2/H4 (pas de filtre org).
   */
  authorizePluginAccess?: ApiAuthorizePluginAccessFn;
  /**
   * Garde permissions des mounts `permission` (modules + platform).
   * Absent ⇒ les `permission` déclarées ne sont PAS vérifiées (compat).
   */
  authorizeModuleAccess?: ApiAuthorizeModuleAccessFn;
};

export type MountedApiInfo = {
  space: Exclude<ApiSpace, "core">;
  id: string;
  allowCrossWrite: boolean;
  dbLayer: "core" | "brand" | "plugin";
  /** Permission déclarée par le mount, si présente. */
  permission?: string;
  /** Ops déclarées (catalogue + génération MCP). */
  operations?: ModuleOperation[];
};

/** Une op aplatie : id du mount + opération (sortie de `listOperations()`). */
export type ListedModuleOperation = {
  space: Exclude<ApiSpace, "core">;
  mountId: string;
  op: ModuleOperation;
};
