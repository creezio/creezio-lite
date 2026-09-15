/**
 * Adaptateur Hono officiel — délègue les espaces façade au kernel.
 *
 * Usage typique (app marque avec `.basePath("/api/v1")`) :
 *
 * ```ts
 * import { mountApiKernelOnHono } from "@creezio/api-kernel";
 * import { getBrandModuleApi } from "@/lib/brand-module-api";
 *
 * mountApiKernelOnHono(api, getBrandModuleApi(), {
 *   spaces: ["core", "platform", "modules", "plugins"],
 * });
 * ```
 *
 * Contrat de composition : une app Hono marque peut garder ses propres routes
 * en parallèle des espaces kernel — un 404 kernel « not mounted » appelle
 * `next()` (`fallthroughOnNotFound`, défaut true) pour laisser ces routes
 * répondre. Aucune marque du kit n'en dépend aujourd'hui, mais le mécanisme
 * fait partie de l'API publique.
 */

import type { Context, Next } from "hono";
import type { ApiKernel } from "./kernel.js";
import { API_V1_PREFIX } from "./kernel.js";
import type { ApiRequest, ApiResponse } from "./types.js";

/** Surface minimale Hono / OpenAPIHono pour le bridge. */
export type HonoLike = {
  all: (path: string, ...handlers: unknown[]) => unknown;
};

export type ApiKernelHonoSpace =
  | "core"
  | "platform"
  | "modules"
  | "plugins";

export type MountApiKernelOnHonoOptions = {
  /**
   * Espaces à monter (défaut : les 4).
   * Sur une app `.basePath("/api/v1")`, les chemins relatifs sont
   * `/core/*`, `/platform/:id/*`, `/modules/:id/*`, `/plugins/:id/*`.
   */
  spaces?: ApiKernelHonoSpace[];
  /**
   * Préfixe absolu reconstruit pour `kernel.handle` (défaut `/api/v1`).
   * Utile si l'app Hono n'a pas de `basePath` et monte sous `/api/v1` explicitement.
   */
  apiPrefix?: string;
  /**
   * Si true (défaut), un 404 kernel (`*_not_mounted` / `not_found` /
   * `core_route_not_found`) appelle `next()` pour laisser d'éventuelles
   * routes Hono propres à la marque répondre (contrat de composition).
   */
  fallthroughOnNotFound?: boolean;
};

function headersFromHono(c: Context): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function queryFromHono(
  c: Context,
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  const url = new URL(c.req.url);
  for (const key of url.searchParams.keys()) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length <= 1 ? all[0] : all;
  }
  return out;
}

async function bodyFromHono(c: Context): Promise<unknown> {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return undefined;
  }
  const contentType = (c.req.header("content-type") || "").toLowerCase();
  try {
    if (contentType.includes("application/json")) {
      return await c.req.json();
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      return await c.req.parseBody();
    }
    const text = await c.req.text();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

function resolveAbsolutePath(c: Context, apiPrefix: string): string {
  const rawPath = c.req.path || new URL(c.req.url).pathname;
  if (rawPath === apiPrefix || rawPath.startsWith(`${apiPrefix}/`)) {
    return rawPath;
  }
  // App avec basePath("/api/v1") : c.req.path peut déjà être absolu ;
  // sinon on préfixe.
  if (rawPath.startsWith("/")) {
    return `${apiPrefix}${rawPath}`;
  }
  return `${apiPrefix}/${rawPath}`;
}

function isFallthroughNotFound(res: ApiResponse): boolean {
  if (res.status !== 404) return false;
  const body = res.body as { error?: string } | undefined;
  const err = body?.error;
  return (
    err === "not_found" ||
    err === "platform_not_mounted" ||
    err === "module_not_mounted" ||
    err === "plugin_not_mounted" ||
    err === "core_route_not_found"
  );
}

export async function applyApiResponse(
  c: Context,
  res: ApiResponse,
): Promise<Response> {
  if (res.headers) {
    for (const [k, v] of Object.entries(res.headers)) {
      c.header(k, v);
    }
  }
  const status = res.status as 200;
  if (res.body === undefined || res.body === null) {
    return c.body(null, status);
  }
  if (typeof res.body === "string") {
    return c.body(res.body, status);
  }
  // Arrays / objets — JSON générique (évite le cast Record trop strict).
  return c.json(res.body as never, status);
}

export type ApiKernelLike = Pick<ApiKernel, "handle">;
export type ApiKernelResolver = ApiKernelLike | (() => ApiKernelLike);

function resolveKernel(kernel: ApiKernelResolver): ApiKernelLike {
  return typeof kernel === "function" ? kernel() : kernel;
}

/**
 * Convertit un Context Hono → ApiRequest + appelle `kernel.handle`.
 * Accepte un kernel ou un getter lazy (évite d'ouvrir SQLite au import).
 */
export function apiKernelToHonoHandler(
  kernel: ApiKernelResolver,
  options: Pick<
    MountApiKernelOnHonoOptions,
    "apiPrefix" | "fallthroughOnNotFound"
  > = {},
) {
  const apiPrefix = options.apiPrefix ?? API_V1_PREFIX;
  const fallthrough = options.fallthroughOnNotFound !== false;

  return async (c: Context, next: Next) => {
    const req: ApiRequest = {
      method: c.req.method,
      path: resolveAbsolutePath(c, apiPrefix),
      headers: headersFromHono(c),
      query: queryFromHono(c),
      body: await bodyFromHono(c),
    };
    const res = await resolveKernel(kernel).handle(req);
    if (fallthrough && isFallthroughNotFound(res)) {
      return next();
    }
    return applyApiResponse(c, res);
  };
}

/**
 * Monte les espaces façade du kernel sur une app Hono (souvent
 * `OpenAPIHono().basePath("/api/v1")`).
 *
 * Les routes Hono propres à la marque (hors espaces kernel) restent servies
 * grâce au fallthrough — voir en-tête de fichier.
 *
 * Preferer `() => getBrandModuleApi()` pour ne pas toucher SQLite au import.
 */
export function mountApiKernelOnHono(
  app: HonoLike,
  kernel: ApiKernelResolver,
  options: MountApiKernelOnHonoOptions = {},
): void {
  const spaces = options.spaces ?? [
    "core",
    "platform",
    "modules",
    "plugins",
  ];
  const handler = apiKernelToHonoHandler(kernel, options);
  const set = new Set(spaces);

  if (set.has("core")) {
    app.all("/core", handler);
    app.all("/core/*", handler);
  }
  if (set.has("platform")) {
    app.all("/platform/:id", handler);
    app.all("/platform/:id/*", handler);
  }
  if (set.has("modules")) {
    app.all("/modules/:id", handler);
    app.all("/modules/:id/*", handler);
  }
  if (set.has("plugins")) {
    app.all("/plugins/:id", handler);
    app.all("/plugins/:id/*", handler);
  }
}
