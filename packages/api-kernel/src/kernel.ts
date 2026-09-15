/**
 * Façade API Creezio — registre + routes cœur + deny-by-default cross-write.
 * H2 : ScopedDbAccess injecté quand `sqliteRuntime` est fourni.
 * P17 : espaces core / platform / modules / plugins.
 */

import { ARCHITECTURE_VERSION } from "../../platform-core/src/architecture-version.js";
import {
  CrossLayerWriteDeniedError,
  createScopedDbAccess,
  mountLayerRef,
} from "./db-scope.js";
import { matchModuleOperation } from "./operations.js";
import type {
  ApiKernelOptions,
  ApiMount,
  ApiRequest,
  ApiResponse,
  ApiSpace,
  ListedModuleOperation,
  MountedApiInfo,
} from "./types.js";

export const API_V1_PREFIX = "/api/v1" as const;
export const API_CORE_PREFIX = `${API_V1_PREFIX}/core` as const;
export const API_PLATFORM_PREFIX = `${API_V1_PREFIX}/platform` as const;
export const API_MODULES_PREFIX = `${API_V1_PREFIX}/modules` as const;
export const API_PLUGINS_PREFIX = `${API_V1_PREFIX}/plugins` as const;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MOUNT_ID_RE = /^[a-z][a-z0-9_-]{0,62}$/;

function normalizePath(raw: string): string {
  const noQuery = raw.split("?")[0] || "/";
  if (!noQuery.startsWith("/")) return `/${noQuery}`;
  return noQuery.replace(/\/{2,}/g, "/");
}

function json(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): ApiResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body,
  };
}

function assertMountId(id: string, kind: string): void {
  if (!MOUNT_ID_RE.test(id)) {
    throw new Error(`${kind} id invalide: ${id}`);
  }
}

/**
 * Interdit d'abuser `registerModuleApi("platform-*")` — utiliser
 * `registerPlatformApi` (espace `/api/v1/platform/<id>`, DB core).
 */
function assertNotPlatformModuleAbuse(id: string): void {
  if (id.startsWith("platform-")) {
    throw new Error(
      `registerModuleApi("${id}") interdit — utiliser registerPlatformApi("${id}", mount) ` +
        `(espace /api/v1/platform/${id}, couche DB core)`,
    );
  }
}

function isCrossWriteAttempt(subPath: string): boolean {
  return (
    subPath.startsWith("__cross/") ||
    subPath === "__cross" ||
    subPath.startsWith("core/") ||
    subPath === "core" ||
    /(^|\/)\.\.(?:\/|$)/.test(subPath)
  );
}

export type ApiKernel = {
  registerPlatformApi(id: string, mount: ApiMount): void;
  registerModuleApi(id: string, mount: ApiMount): void;
  registerPluginApi(id: string, mount: ApiMount): void;
  unregisterPlatformApi(id: string): boolean;
  unregisterModuleApi(id: string): boolean;
  unregisterPluginApi(id: string): boolean;
  listMounts(): MountedApiInfo[];
  /** Toutes les ops de tous les mounts (id mount + op). */
  listOperations(): ListedModuleOperation[];
  handle(req: ApiRequest): Promise<ApiResponse>;
  /** Préfixe domaine unique documenté. */
  readonly prefix: typeof API_V1_PREFIX;
  /** Runtime multi-DB attaché (H2), si fourni. */
  readonly sqliteRuntime: ApiKernelOptions["sqliteRuntime"];
};

export function createApiKernel(opts: ApiKernelOptions = {}): ApiKernel {
  const platform = new Map<string, ApiMount>();
  const modules = new Map<string, ApiMount>();
  const plugins = new Map<string, ApiMount>();
  const architectureVersion = opts.architectureVersion ?? ARCHITECTURE_VERSION;
  const appVersion = opts.appVersion ?? "0.0.0";
  const brandId = opts.brandId ?? null;
  const runtime = opts.sqliteRuntime;

  function handleCore(method: string, subPath: string): ApiResponse {
    const m = method.toUpperCase();
    if (subPath === "health" || subPath === "") {
      if (m !== "GET" && m !== "HEAD") {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
      return json(200, {
        ok: true,
        space: "core",
        brandId,
        ts: new Date().toISOString(),
      });
    }
    if (subPath === "version") {
      if (m !== "GET") {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
      return json(200, {
        ok: true,
        version: appVersion,
        architectureVersion,
        brandId,
      });
    }
    if (subPath === "architecture") {
      if (m !== "GET") {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
      const sqliteStatus = runtime?.status();
      return json(200, {
        ok: true,
        architectureVersion,
        sqliteLayout: ["core", "brand", "plugin/<id>"],
        apiPrefix: API_V1_PREFIX,
        spaces: ["core", "platform", "modules", "plugins"],
        isolation: {
          crossWriteDefault: "deny",
          scopedDb: Boolean(runtime),
          platformDbLayer: "core",
        },
        mounts: {
          platform: [...platform.keys()],
          modules: [...modules.keys()],
          plugins: [...plugins.keys()],
        },
        sqlite: sqliteStatus
          ? {
              coreOpen: sqliteStatus.coreOpen,
              brandOpen: sqliteStatus.brandOpen,
              openPlugins: sqliteStatus.openPlugins,
            }
          : null,
      });
    }
    if (subPath === "sqlite/status") {
      if (m !== "GET") {
        return json(405, { ok: false, error: "method_not_allowed" });
      }
      if (!runtime) {
        return json(503, { ok: false, error: "sqlite_runtime_unavailable" });
      }
      return json(200, { ok: true, ...runtime.status() });
    }
    return json(404, { ok: false, error: "core_route_not_found", path: subPath });
  }

  async function dispatchMount(
    space: Exclude<ApiSpace, "core">,
    id: string,
    mount: ApiMount,
    req: ApiRequest,
    subPath: string,
  ): Promise<ApiResponse> {
    if (subPath.includes("..")) {
      return json(400, { ok: false, error: "invalid_path" });
    }

    // Garde permission : op.match.permission sinon mount.permission.
    // Compat : sans hook authorizeModuleAccess, aucun contrôle ajouté.
    const matchedOp = matchModuleOperation(
      mount.operations,
      req.method,
      subPath,
    );
    const permission = matchedOp?.permission ?? mount.permission;
    if (
      permission &&
      opts.authorizeModuleAccess &&
      (space === "module" || space === "platform")
    ) {
      const decision = await opts.authorizeModuleAccess({
        space,
        mountId: id,
        permission,
        method: req.method.toUpperCase(),
        subPath,
        req,
      });
      if (!decision.allow) {
        return json(decision.status ?? 403, {
          ok: false,
          error: decision.reason,
          mount: id,
          permission,
        });
      }
    }

    const method = req.method.toUpperCase();
    if (
      WRITE_METHODS.has(method) &&
      mount.allowCrossWrite !== true &&
      isCrossWriteAttempt(subPath)
    ) {
      return json(403, {
        ok: false,
        error: "cross_write_denied",
        space,
        id,
      });
    }

    const layerRef = mountLayerRef(space, id);
    const db = runtime ? createScopedDbAccess(runtime, layerRef) : undefined;

    try {
      return await mount.handle({
        req,
        space,
        mountId: id,
        subPath,
        db,
      });
    } catch (err) {
      if (err instanceof CrossLayerWriteDeniedError) {
        return json(403, {
          ok: false,
          error: err.code,
          from: err.from,
          to: err.to,
          message: err.message,
        });
      }
      throw err;
    }
  }

  function listMounts(): MountedApiInfo[] {
    const out: MountedApiInfo[] = [];
    for (const [id, m] of platform) {
      out.push({
        space: "platform",
        id,
        allowCrossWrite: Boolean(m.allowCrossWrite),
        dbLayer: m.dbLayer ?? "core",
        ...(m.permission ? { permission: m.permission } : {}),
        ...(m.operations?.length ? { operations: m.operations } : {}),
      });
    }
    for (const [id, m] of modules) {
      out.push({
        space: "module",
        id,
        allowCrossWrite: Boolean(m.allowCrossWrite),
        dbLayer: m.dbLayer ?? "brand",
        ...(m.permission ? { permission: m.permission } : {}),
        ...(m.operations?.length ? { operations: m.operations } : {}),
      });
    }
    for (const [id, m] of plugins) {
      out.push({
        space: "plugin",
        id,
        allowCrossWrite: Boolean(m.allowCrossWrite),
        dbLayer: m.dbLayer ?? "plugin",
        ...(m.operations?.length ? { operations: m.operations } : {}),
      });
    }
    return out;
  }

  function listOperations(): ListedModuleOperation[] {
    const out: ListedModuleOperation[] = [];
    for (const mount of listMounts()) {
      for (const op of mount.operations ?? []) {
        out.push({ space: mount.space, mountId: mount.id, op });
      }
    }
    return out;
  }

  return {
    prefix: API_V1_PREFIX,
    sqliteRuntime: runtime,

    registerPlatformApi(id, mount) {
      assertMountId(id, "platform");
      platform.set(id, mount);
    },

    registerModuleApi(id, mount) {
      assertMountId(id, "module");
      assertNotPlatformModuleAbuse(id);
      modules.set(id, mount);
    },

    registerPluginApi(id, mount) {
      assertMountId(id, "plugin");
      plugins.set(id, mount);
    },

    unregisterPlatformApi(id) {
      return platform.delete(id);
    },

    unregisterModuleApi(id) {
      return modules.delete(id);
    },

    unregisterPluginApi(id) {
      return plugins.delete(id);
    },

    listMounts,
    listOperations,

    async handle(req) {
      const path = normalizePath(req.path);
      const method = (req.method || "GET").toUpperCase();

      if (!path.startsWith(`${API_V1_PREFIX}/`) && path !== API_V1_PREFIX) {
        return json(404, {
          ok: false,
          error: "outside_api_v1",
          hint: `Utiliser le préfixe ${API_V1_PREFIX}`,
        });
      }

      if (path === API_V1_PREFIX || path === `${API_V1_PREFIX}/`) {
        return json(200, {
          ok: true,
          prefix: API_V1_PREFIX,
          spaces: ["core", "platform", "modules", "plugins"],
        });
      }

      if (path.startsWith(`${API_CORE_PREFIX}/`) || path === API_CORE_PREFIX) {
        const sub =
          path === API_CORE_PREFIX
            ? ""
            : path.slice(API_CORE_PREFIX.length + 1);

        // Routes core avec DB scopée core (H2)
        if (runtime && (sub.startsWith("db/") || sub === "db")) {
          const db = createScopedDbAccess(runtime, { kind: "core" });
          if (sub === "db/ping" && method === "GET") {
            return json(200, {
              ok: true,
              layer: db.layer,
              path: db.path,
            });
          }
        }

        return handleCore(method, sub);
      }

      const platMatch = path.match(
        /^\/api\/v1\/platform\/([a-z][a-z0-9_-]{0,62})(?:\/(.*))?$/,
      );
      if (platMatch) {
        const id = platMatch[1]!;
        const subPath = platMatch[2] || "";
        const mount = platform.get(id);
        if (!mount) {
          return json(404, { ok: false, error: "platform_not_mounted", id });
        }
        return dispatchMount(
          "platform",
          id,
          mount,
          { ...req, method, path },
          subPath,
        );
      }

      const modMatch = path.match(
        /^\/api\/v1\/modules\/([a-z][a-z0-9_-]{0,62})(?:\/(.*))?$/,
      );
      if (modMatch) {
        const id = modMatch[1]!;
        const subPath = modMatch[2] || "";
        const mount = modules.get(id);
        if (!mount) {
          return json(404, { ok: false, error: "module_not_mounted", id });
        }
        return dispatchMount("module", id, mount, { ...req, method, path }, subPath);
      }

      const plgMatch = path.match(
        /^\/api\/v1\/plugins\/([a-z][a-z0-9_-]{0,62})(?:\/(.*))?$/,
      );
      if (plgMatch) {
        const id = plgMatch[1]!;
        const subPath = plgMatch[2] || "";
        const mount = plugins.get(id);
        if (!mount) {
          return json(404, { ok: false, error: "plugin_not_mounted", id });
        }
        if (opts.authorizePluginAccess) {
          const decision = await opts.authorizePluginAccess({
            pluginId: id,
            method,
            subPath,
            req: { ...req, method, path },
          });
          if (!decision.allow) {
            return json(decision.status ?? 403, {
              ok: false,
              error: decision.reason,
              pluginId: id,
            });
          }
        }
        return dispatchMount("plugin", id, mount, { ...req, method, path }, subPath);
      }

      return json(404, { ok: false, error: "not_found", path });
    },
  };
}
