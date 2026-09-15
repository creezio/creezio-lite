/**
 * Configuration marque pour le runtime tasks plateforme.
 * Les marques appellent `configureTasksBrand` au boot (server / instrumentation).
 */
import type { Context } from "hono";

export type TasksUserKind = "human" | "ai";

export type TasksUser = {
  id: string;
  username: string;
  role: "owner" | "collaborator";
  kind: TasksUserKind;
  active: boolean;
  permissions: string[];
};

export type TasksSession = {
  sub: string;
  email: string;
  role: "owner" | "collaborator";
  permissions?: string[];
  actorSub?: string;
  actorRole?: "owner";
};

export type TasksSqliteStatement = {
  run: (...args: unknown[]) => { changes: number };
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};

export type TasksSqliteDb = {
  prepare: (sql: string) => TasksSqliteStatement;
};

export type TasksDbAdapter = {
  getWriteDb: () => TasksSqliteDb;
  queryAll: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => T[];
  queryOne: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => T | null | undefined;
  tableExists: (name: string) => boolean;
};

export type TasksUsersAdapter = {
  getById: (id: string) => TasksUser | null;
  list: () => TasksUser[];
  getOwner: () => TasksUser | null;
  ready: () => boolean;
};

export type TasksPresenceAdapter = {
  isDesktopOnline: (userId: string) => boolean;
  listOnlineBridges: () => Array<{
    userId: string;
    deviceId: string;
    deviceLabel?: string | null;
    bridgeConnected: boolean;
    online: boolean;
  }>;
};

export type TasksWorkspaceAdapter = {
  ensureOnHost: (opts: {
    aiUserId: string;
    hostUserId: string;
    show?: boolean;
    label?: string;
  }) => Promise<Record<string, unknown>>;
  navigate: (opts: {
    aiUserId: string;
    hostUserId: string;
    href: string;
  }) => Promise<Record<string, unknown>>;
  openTab: (opts: {
    aiUserId: string;
    hostUserId: string;
    params: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  listTabs: (opts: {
    aiUserId: string;
    hostUserId: string;
  }) => Promise<Record<string, unknown>>;
  webAction: (opts: {
    aiUserId: string;
    hostUserId: string;
    webType: string;
    params?: Record<string, unknown>;
    tabId?: string;
  }) => Promise<Record<string, unknown>>;
  startScreencast: (aiUserId: string) => Promise<Record<string, unknown>>;
  stopScreencast: (aiUserId: string) => Promise<Record<string, unknown>>;
};

export type TasksNavAdapter = {
  permissionForPath: (pathname: string) => string | null;
  hasPermission: (
    permissions: readonly string[] | undefined,
    required: string | null,
  ) => boolean;
};

export type ResolvedExternalTab = {
  url: string;
  title: string;
  /** Id partition site externe (SoT). */
  siteId?: number;
  /** @deprecated → siteId */
  fournisseurId?: number;
  source?: string;
};

export type TasksExternalTabsAdapter = {
  resolve: (input: {
    url?: string;
    /** Id partition site externe (SoT). */
    site_id?: number;
    /** @deprecated → site_id */
    fournisseur_id?: number;
    title?: string;
  }) =>
    | ({ ok: true } & ResolvedExternalTab)
    | { ok: false; error: string; code?: string };
  toWorkspaceParams: (resolved: ResolvedExternalTab) => Record<string, unknown>;
};

export type ScreencastFrame = {
  data: string;
  seq: number;
  ts?: number;
};

export type TasksScreencastAdapter = {
  viewerCount: (aiUserId: string) => number;
  subscribe: (
    aiUserId: string,
    listener: (frame: ScreencastFrame) => void,
  ) => () => void;
};

export type TasksAuthAdapter = {
  getSessionFromContext: (c: Context) => Promise<TasksSession | null>;
  sessionActorIsOwner: (session: TasksSession | null) => boolean;
  sessionIsImpersonating: (session: TasksSession | null) => boolean;
};

export type TasksBrandConfig = {
  /** Nom produit (prompt agent, labels Hermes). */
  productName: string;
  /** Description courte domaine métier pour le prompt agent. */
  productDomain: string;
  /** Label footer Hermes, ex. "CRM". */
  hermesSourceLabel: string;
  /** Skill Hermes à charger, ex. "tempoflow2-crm". */
  hermesSkill: string;
  /** Préfixe env AI, ex. "TF2_AI" → TF2_AI_MODEL, etc. */
  envPrefix: string;
  /** Préfixe idempotency clés CRM, ex. "crm". */
  idempotencyPrefix: string;
  /** Préfixe idempotency assistant, ex. "asst". */
  assistantIdempotencyPrefix: string;
  /** Chemin UI kanban, défaut "/taches". */
  taskHref: string;
  /** Exemples de routes dans le prompt agent. */
  examplePaths: string[];

  db: TasksDbAdapter;
  users: TasksUsersAdapter;
  presence: TasksPresenceAdapter;
  workspace: TasksWorkspaceAdapter;
  navigation: TasksNavAdapter;
  externalTabs: TasksExternalTabsAdapter;
  screencast: TasksScreencastAdapter;
  auth: TasksAuthAdapter;
};

/**
 * État global via globalThis — évite le dual-package hazard
 * (tsx charge parfois le CJS `dist-cjs` depuis un fichier marque transformé
 * en CJS, alors que le runtime ESM lit `dist`).
 */
const BRAND_KEY = "__creezioTasksBrandConfig";

function brandSlot(): { current: TasksBrandConfig | null } {
  const g = globalThis as unknown as {
    [BRAND_KEY]?: { current: TasksBrandConfig | null };
  };
  if (!g[BRAND_KEY]) g[BRAND_KEY] = { current: null };
  return g[BRAND_KEY];
}

export function configureTasksBrand(config: TasksBrandConfig): void {
  brandSlot().current = config;
}

export function getTasksBrandConfig(): TasksBrandConfig | null {
  return brandSlot().current;
}

export function requireTasksBrand(): TasksBrandConfig {
  const cfg = brandSlot().current;
  if (!cfg) {
    throw new Error(
      "@creezio/tasks: configureTasksBrand() requis avant d'utiliser le runtime kanban",
    );
  }
  return cfg;
}

export function resetTasksBrandForTests(): void {
  brandSlot().current = null;
}

/** Lit process.env[`${envPrefix}_${suffix}`]. */
export function tasksEnv(suffix: string, fallback = ""): string {
  const cfg = brandSlot().current;
  const prefix = cfg?.envPrefix || "CREEZIO_AI";
  return (process.env[`${prefix}_${suffix}`] || fallback).trim();
}

export function tasksEnvNumber(suffix: string, fallback: number): number {
  const raw = Number(tasksEnv(suffix, String(fallback)));
  return Number.isFinite(raw) ? raw : fallback;
}
