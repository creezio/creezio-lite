export type McpToolSpace = "core" | "module" | "plugin";

/**
 * Surface publique listTools :
 * - `canonical` — noms namespacés uniquement (module.panier.get)
 * - `legacy-preferred` — si un alias legacy existe, masquer le canonique
 * - `both` — alias + canonique (déconseillé — double exposition)
 */
export type McpPublicSurfaceMode =
  | "canonical"
  | "legacy-preferred"
  | "both";

export type McpToolDefinition = {
  name: string;
  description: string;
  space: McpToolSpace;
  /** Id module/plugin si space !== core. */
  ownerId?: string;
  inputSchema?: Record<string, unknown>;
  /** Nom canonique si cette entrée est un alias legacy exposé. */
  aliasOf?: string;
  /** Rôles seedés dans `mcp_tool_policies` (ops de module). */
  defaultRoles?: string[];
  /**
   * Seed policy `enabled` — false = à activer dans `/admin/mcp`.
   * Absent = comportement historique (enabled).
   */
  mcpPublishDefault?: boolean;
  requiredScope?: string;
};

export type McpToolCallResult = {
  ok: boolean;
  content?: unknown;
  error?: string;
};

/**
 * Acteur du call courant, transmis aux handlers (2ᵉ argument optionnel —
 * rétro-compatible : les handlers existants à un argument restent valides).
 */
export type McpToolCallActor = {
  subject?: string;
  orgId?: string;
  claims?: Record<string, unknown>;
  /**
   * Bearer (JWT session ou clé service) du call — à poser sur la requête
   * synthétique `module.*` pour que `requireSession` / cookie+Authorization
   * voient le même acteur que le chat OS.
   */
  bearerToken?: string | null;
  /** Headers HTTP d'origine (Cookie, Authorization) à propager. */
  headers?: Record<string, string>;
};

/** Options de `callTool` — Bearer + headers de la requête chat. */
export type McpCallToolOpts = {
  bearerToken?: string | null;
  headers?: Record<string, string>;
};

export type McpToolHandler = (
  args: Record<string, unknown>,
  actor?: McpToolCallActor,
) => McpToolCallResult | Promise<McpToolCallResult>;

/**
 * Acteur résolu depuis un Bearer opaque (ex. clé API service vérifiée par
 * l'app contre sa table `api_keys`). `null` = token inconnu → fallback JWT.
 */
export type McpBearerActor = {
  subject: string;
  orgId?: string;
  claims?: Record<string, unknown>;
};

export type McpResolveBearerActorFn = (
  token: string,
) => McpBearerActor | null | Promise<McpBearerActor | null>;

export type McpRegisteredTool = McpToolDefinition & {
  handler: McpToolHandler;
};

export type DiscoverToolsFn = () =>
  | McpRegisteredTool[]
  | Promise<McpRegisteredTool[]>;

/** Discovery scindée par couche (H2.3) — préférée à une liste plate. */
export type DiscoverToolsBySpaceFn = () =>
  | Partial<Record<"module" | "plugin", McpRegisteredTool[]>>
  | Promise<Partial<Record<"module" | "plugin", McpRegisteredTool[]>>>;

export type McpAuthorizeContext = {
  name: string;
  canonicalName: string;
  space: McpToolSpace;
  ownerId?: string;
  subject?: string;
  /** H5 — org claim JWT / opaque actor. */
  orgId?: string;
  /** Claims JWT bruts (orgId, isOwner, …). */
  claims?: Record<string, unknown>;
  args: Record<string, unknown>;
  isAlias: boolean;
};

export type McpToolPolicyDecision =
  | { allow: true }
  | { allow: false; reason: string };

export type McpAuthorizeToolCallFn = (
  ctx: McpAuthorizeContext,
) => McpToolPolicyDecision | Promise<McpToolPolicyDecision>;

export type McpFacadeOptions = {
  /** Secret JWT (local-config `mcpJwtSecret` / env MCP_JWT_SECRET). */
  jwtSecret?: string | null;
  /** Si true, auth JWT optionnelle (dev/sandbox). Défaut false en prod. */
  allowUnauthenticated?: boolean;
  /**
   * Résolution d'acteur pour Bearer OPAQUE (non-JWT) — consultée AVANT la
   * vérification JWT (ex. clé API service Hermes → owner). `null`/throw =
   * fallback JWT inchangé. Ne jamais y mettre de métier marque.
   */
  resolveBearerActor?: McpResolveBearerActorFn;
  /** Discoverer plat (H1 compat). */
  discoverTools?: DiscoverToolsFn;
  /**
   * Discoverer scindé (H2) — tools modules vs plugins.
   * Si fourni, fusionné avec `discoverTools` (plat).
   */
  discoverToolsBySpace?: DiscoverToolsBySpaceFn;
  architectureVersion?: string;
  brandId?: string;
  /** Liste mounts api-kernel (optionnel, pour tool admin). */
  listApiMounts?: () => Array<{ space: string; id: string }>;
  /**
   * H4 — impose préfixes `core.*` / `creezio.*` · `module.<id>.*` · `plugin.<id>.*`
   * Défaut true.
   */
  enforceNamespaces?: boolean;
  /**
   * H4 — aliases legacy → nom canonique namespacé
   * (ex. get_panier → module.panier.get).
   */
  aliases?: Record<string, string>;
  /**
   * H4 — surface listTools (défaut `legacy-preferred` pour éviter
   * la double exposition panier historique ↔ module.*).
   */
  publicSurface?: McpPublicSurfaceMode;
  /** H4 — policy avant callTool (deny cross-layer par défaut). */
  authorizeToolCall?: McpAuthorizeToolCallFn;
  /**
   * H4 — si false, ne pas installer denyCrossLayerToolCall par défaut.
   * Défaut true.
   */
  defaultCrossLayerDeny?: boolean;
  /**
   * H5 — filtre listTools space=plugin selon ACL (optionnel).
   * Si fourni, les tools plugin non visibles sont masqués.
   */
  filterPluginToolsForActor?: (
    tools: McpToolDefinition[],
    ctx: { subject?: string; orgId?: string; claims?: Record<string, unknown> },
  ) => McpToolDefinition[] | Promise<McpToolDefinition[]>;
};

export type McpListToolsResult = {
  tools: McpToolDefinition[];
};

export type McpToolsBySpace = Record<McpToolSpace, McpToolDefinition[]>;

export type McpAuthResult =
  | {
      ok: true;
      subject?: string;
      /** H5 — orgId depuis claim JWT `orgId` / `org_id`. */
      orgId?: string;
      claims?: Record<string, unknown>;
    }
  | { ok: false; error: string; status: number };
