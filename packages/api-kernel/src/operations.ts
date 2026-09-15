/**
 * Opérations de module — SoT unique (HTTP + catalogue + MCP).
 * Collecte / matching / chemins complets. La génération des tools MCP
 * vit dans `@creezio/mcp-facade` (`generateModuleToolsFromOperations`).
 */

import type {
  ApiSpace,
  ListedModuleOperation,
  ModuleOperation,
  ModuleOperationMethod,
  MountedApiInfo,
} from "./types.js";

/** Aligné sur `kernel.ts` — pas d'import circulaire. */
const API_MODULES_PREFIX = "/api/v1/modules";
const API_PLATFORM_PREFIX = "/api/v1/platform";
const API_PLUGINS_PREFIX = "/api/v1/plugins";

/** Mounts kit internes — doctor n'exige pas `operations` (hors métier). */
export const KIT_INTERNAL_MODULE_MOUNT_IDS = [
  "schema",
  "dashboard",
  "search",
  "interactive-demo",
] as const;

export function isKitInternalModuleMount(id: string): boolean {
  return (KIT_INTERNAL_MODULE_MOUNT_IDS as readonly string[]).includes(id);
}

const HTTP_METHODS = new Set<string>([
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
]);

export function isModuleOperationMethod(
  value: string,
): value is ModuleOperationMethod {
  return HTTP_METHODS.has(value.toUpperCase());
}

/** Normalise un path d'op : "" → "/" ; "from-panier" → "/from-panier". */
export function normalizeModuleOperationPath(path: string): string {
  const raw = String(path || "").trim();
  if (!raw || raw === "/") return "/";
  return raw.startsWith("/") ? raw.replace(/\/{2,}/g, "/") : `/${raw}`;
}

export function kernelMountPrefix(
  space: Exclude<ApiSpace, "core">,
  id: string,
): string {
  if (space === "platform") return `${API_PLATFORM_PREFIX}/${id}`;
  if (space === "plugin") return `${API_PLUGINS_PREFIX}/${id}`;
  return `${API_MODULES_PREFIX}/${id}`;
}

/** Path HTTP complet `/api/v1/{space}/{mount}{op.path}`. */
export function resolveOperationHttpPath(
  space: Exclude<ApiSpace, "core">,
  mountId: string,
  opPath: string,
): string {
  const prefix = kernelMountPrefix(space, mountId);
  const rel = normalizeModuleOperationPath(opPath);
  return rel === "/" ? prefix : `${prefix}${rel}`;
}

/**
 * Match d'une requête (method + subPath relatif au mount) sur les ops
 * déclarées. Préfère le plus de segments statiques (pas `:param`).
 */
export function matchModuleOperation(
  operations: readonly ModuleOperation[] | undefined,
  method: string,
  subPath: string,
): ModuleOperation | undefined {
  if (!operations?.length) return undefined;
  const methodU = method.toUpperCase();
  const parts = String(subPath || "")
    .split("/")
    .filter(Boolean);
  let best: ModuleOperation | undefined;
  let bestStatic = -1;
  for (const op of operations) {
    if (op.method.toUpperCase() !== methodU) continue;
    const opParts = normalizeModuleOperationPath(op.path)
      .split("/")
      .filter(Boolean);
    if (opParts.length !== parts.length) continue;
    let staticCount = 0;
    let ok = true;
    for (let i = 0; i < opParts.length; i++) {
      const token = opParts[i]!;
      if (token.startsWith(":")) continue;
      if (token !== parts[i]) {
        ok = false;
        break;
      }
      staticCount += 1;
    }
    if (!ok) continue;
    if (staticCount > bestStatic) {
      best = op;
      bestStatic = staticCount;
    }
  }
  return best;
}

export type KernelOperationRoute = {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
};

/** Routes catalogue depuis `listOperations()` (id mount + op). */
export function collectListedOperationRoutes(
  listed: ReadonlyArray<Pick<ListedModuleOperation, "space" | "mountId" | "op">>,
): KernelOperationRoute[] {
  const out: KernelOperationRoute[] = [];
  const seen = new Set<string>();
  for (const { space, mountId, op } of listed) {
    const path = resolveOperationHttpPath(space, mountId, op.path);
    const method = op.method.toUpperCase();
    const key = `${method} ${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      method,
      path,
      summary: `${method} ${path}`,
      description: op.description,
      tags: [space, mountId],
    });
  }
  return out;
}

/** Routes catalogue : une ligne par op de chaque mount kernel. */
export function collectKernelOperationRoutes(
  mounts: ReadonlyArray<
    Pick<MountedApiInfo, "space" | "id" | "operations">
  >,
): KernelOperationRoute[] {
  return collectListedOperationRoutes(
    mounts.flatMap((mount) =>
      (mount.operations ?? []).map((op) => ({
        space: mount.space,
        mountId: mount.id,
        op,
      })),
    ),
  );
}
