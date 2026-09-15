/**
 * Génération des tools MCP depuis les opérations de module (SoT).
 * Handler = requête synthétique vers le même mount HTTP — zéro 2e implémentation.
 */

import type {
  ApiKernel,
  ApiMount,
  ApiRequest,
  ApiResponse,
  ApiSpace,
  EntitySpec,
  ListedModuleOperation,
  ModuleOperation,
  MountedApiInfo,
} from "@creezio/api-kernel";
import {
  entityOperationsFromSpec,
  resolveOperationHttpPath,
} from "@creezio/api-kernel";
import { dynImport } from "./dyn-import.js";
import { verifyAccessToken } from "./oauth/store.js";
import type {
  McpRegisteredTool,
  McpToolCallActor,
  McpToolCallResult,
} from "./types.js";

/**
 * Access token OAuth MCP (HS256 MCP_JWT_SECRET — ChatGPT & co) → session
 * plateforme mintée pour le user du consentement (`uid`). Les gardes marque
 * (`requireSession`) ne connaissent que les JWT session AUTH_SECRET : sans
 * cette conversion, tout tool `module.*` répond 401 malgré un OAuth valide.
 * Fail-closed : uid absent/inconnu ou stores indisponibles → null (le 401
 * métier reste la réponse).
 */
async function mintSessionFromMcpAccessToken(
  token: string,
): Promise<string | null> {
  let userId = "";
  try {
    const payload = await verifyAccessToken(token);
    userId = (payload?.user_id || "").trim();
  } catch {
    return null; // adapters OAuth non configurés (façade standalone)
  }
  if (!userId) return null;
  try {
    type CrmUser = {
      id: string;
      username: string;
      role?: string;
      permissions?: string[];
      active?: boolean;
    };
    const [authMod, tasksMod] = await Promise.all([
      dynImport("@creezio/auth") as Promise<{
        createSessionToken?: (input: {
          user: {
            id: string;
            username: string;
            role: string;
            permissions: string[];
          };
        }) => Promise<string>;
      }>,
      dynImport("@creezio/tasks") as Promise<{
        getTasksBrandConfig?: () => {
          users: {
            list: () => CrmUser[];
            getOwner?: () => CrmUser | null;
          };
        } | null;
      }>,
    ]);
    if (!authMod.createSessionToken) return null;
    const users = tasksMod.getTasksBrandConfig?.()?.users;
    let user: {
      id: string;
      username: string;
      role: string;
      permissions: string[];
    } | null = null;
    try {
      const found =
        users?.list().find((u) => u.id === userId && u.active !== false) ??
        null;
      if (found) {
        user = {
          id: found.id,
          username: found.username,
          role: found.role === "owner" ? "owner" : found.role || "collaborator",
          permissions: [...(found.permissions || [])],
        };
      }
    } catch {
      /* store users indisponible → fallback owner ci-dessous */
    }
    if (!user) {
      try {
        const owner = users?.getOwner?.() ?? null;
        if (owner && owner.id === userId) {
          user = {
            id: owner.id,
            username: owner.username,
            role: "owner",
            permissions: [...(owner.permissions || [])],
          };
        }
      } catch {
        /* fail-closed */
      }
    }
    if (!user) return null;
    return await authMod.createSessionToken({ user });
  } catch {
    return null;
  }
}

/** Cookie + Authorization pour `requireSession` sur la req synthétique. */
async function headersFromActor(
  actor?: McpToolCallActor,
): Promise<Record<string, string> | undefined> {
  const headers: Record<string, string> = {};
  if (actor?.headers) {
    for (const [key, value] of Object.entries(actor.headers)) {
      if (value == null || value === "") continue;
      headers[key.toLowerCase()] = String(value);
    }
  }
  const raw = (actor?.bearerToken || "").trim();
  if (raw) {
    const token = raw.replace(/^Bearer\s+/i, "").trim();
    if (token && !headers.authorization) {
      headers.authorization = `Bearer ${token}`;
    }
  }
  // Bearer JWT : si c'est un access token OAuth MCP, le convertir en
  // session plateforme mintée (sinon inchangé — JWT session déjà valide).
  const authz = (headers.authorization || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (authz && authz.split(".").length === 3) {
    const minted = await mintSessionFromMcpAccessToken(authz);
    if (minted) headers.authorization = `Bearer ${minted}`;
  }
  return Object.keys(headers).length ? headers : undefined;
}

export type GenerateModuleToolsInvoke = (
  req: ApiRequest,
) => Promise<ApiResponse>;

export type GenerateModuleToolsOptions = {
  /** Id HTTP du mount (défaut = moduleId). */
  mountId?: string;
  space?: Exclude<ApiSpace, "core">;
};

function interpolatePath(
  template: string,
  args: Record<string, unknown>,
): { path: string; used: Set<string> } {
  const used = new Set<string>();
  const path = template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    used.add(name);
    const value = args[name];
    return encodeURIComponent(value == null ? "" : String(value));
  });
  return { path, used };
}

function asQuery(
  rest: Record<string, unknown>,
): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      query[key] = value.map((v) => String(v)).join(",");
      continue;
    }
    if (typeof value === "object") continue;
    query[key] = String(value);
  }
  return query;
}

function defaultInputSchema(op: ModuleOperation): Record<string, unknown> {
  if (op.inputSchema && typeof op.inputSchema === "object") {
    return op.inputSchema as Record<string, unknown>;
  }
  const params = [
    ...normalizePath(op.path).matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g),
  ].map((m) => m[1]!);
  const properties: Record<string, { type: string }> = {};
  for (const name of params) properties[name] = { type: "string" };
  return {
    type: "object",
    properties,
    required: params,
    additionalProperties: true,
  };
}

function normalizePath(path: string): string {
  const raw = String(path || "").trim();
  if (!raw || raw === "/") return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function restArgs(
  args: Record<string, unknown>,
  used: Set<string>,
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (used.has(key)) continue;
    rest[key] = value;
  }
  return rest;
}

function responseToToolResult(res: ApiResponse): McpToolCallResult {
  if (res.status >= 400) {
    const body = res.body as { error?: string } | undefined;
    return {
      ok: false,
      error:
        (body && typeof body === "object" && body.error) ||
        `http_${res.status}`,
      content: res.body,
    };
  }
  return { ok: true, content: res.body };
}

/**
 * Génère un tool MCP par op — `module.<id>.<op.id>`.
 * Handler = requête synthétique (method/path/body) vers le même
 * `ApiMount.handle` via `invokeMount` (typiquement `api.handle`) —
 * zéro 2ᵉ implémentation métier.
 */
export function generateModuleToolsFromOperations(
  moduleId: string,
  ops: readonly ModuleOperation[],
  invokeMount: GenerateModuleToolsInvoke,
  options: GenerateModuleToolsOptions = {},
): McpRegisteredTool[] {
  const mountId = options.mountId || moduleId;
  const space = options.space || "module";
  const tools: McpRegisteredTool[] = [];
  for (const op of ops) {
    const template = resolveOperationHttpPath(space, mountId, op.path);
    tools.push({
      name: `module.${mountId}.${op.id}`,
      description: op.description,
      space: "module",
      ownerId: moduleId,
      inputSchema: defaultInputSchema(op),
      ...(op.roles?.length ? { defaultRoles: op.roles } : {}),
      mcpPublishDefault: op.mcpPublishDefault === true,
      requiredScope:
        op.method === "GET" ? "crm:read" : op.permission || "crm:write",
      handler: async (args, actor) => {
        const { path, used } = interpolatePath(template, args);
        const rest = restArgs(args, used);
        const method = op.method;
        const headers = await headersFromActor(actor);
        const req: ApiRequest = {
          method,
          path,
          ...(headers ? { headers } : {}),
          ...(method === "GET"
            ? { query: asQuery(rest) }
            : { body: rest }),
        };
        return responseToToolResult(await invokeMount(req));
      },
    });
  }
  return tools;
}

function toolsFromListedOps(
  api: ApiKernel,
  listed: readonly ListedModuleOperation[],
  spaces: ReadonlySet<Exclude<ApiSpace, "core">>,
): McpRegisteredTool[] {
  const byMount = new Map<
    string,
    { space: Exclude<ApiSpace, "core">; ops: ModuleOperation[] }
  >();
  for (const { space, mountId, op } of listed) {
    if (!spaces.has(space)) continue;
    const cur = byMount.get(mountId);
    if (cur) {
      cur.ops.push(op);
      continue;
    }
    byMount.set(mountId, { space, ops: [op] });
  }
  const invokeMount: GenerateModuleToolsInvoke = (req) => api.handle(req);
  const out: McpRegisteredTool[] = [];
  for (const [mountId, { space, ops }] of byMount) {
    out.push(
      ...generateModuleToolsFromOperations(mountId, ops, invokeMount, {
        mountId,
        space,
      }),
    );
  }
  return out;
}

/**
 * Tools `module.*` générés depuis `api.listOperations()` (space module).
 * SoT runtime — `BrandModuleDef.mcpTools` n'existe plus.
 */
export function generateModuleToolsFromListedOps(
  api: ApiKernel,
  listed?: readonly ListedModuleOperation[],
): McpRegisteredTool[] {
  return toolsFromListedOps(
    api,
    listed ?? api.listOperations(),
    new Set(["module"]),
  );
}

/** Tools générés depuis les mounts déjà enregistrés sur le kernel. */
export function generateModuleToolsFromMountedOps(
  api: ApiKernel,
  mounts?: readonly MountedApiInfo[],
): McpRegisteredTool[] {
  if (!mounts) {
    return toolsFromListedOps(
      api,
      api.listOperations(),
      new Set(["module", "platform"]),
    );
  }
  const out: McpRegisteredTool[] = [];
  for (const mount of mounts) {
    if (mount.space !== "module" && mount.space !== "platform") continue;
    if (!mount.operations?.length) continue;
    out.push(
      ...generateModuleToolsFromOperations(
        mount.id,
        mount.operations,
        (req) => api.handle(req),
        { mountId: mount.id, space: mount.space },
      ),
    );
  }
  return out;
}

/**
 * Discovery runtime : uniquement `listOperations()` (space module).
 * `extraTools` = hook apps (health, JWT) — pas de `mcpTools` manuscrit.
 */
export function discoverModuleToolsFromKernel(
  api: ApiKernel,
  extraTools: readonly McpRegisteredTool[] = [],
): McpRegisteredTool[] {
  const generated = generateModuleToolsFromListedOps(api);
  if (!extraTools.length) return generated;
  const seen = new Set(generated.map((t) => t.name));
  return [...generated, ...extraTools.filter((t) => !seen.has(t.name))];
}

export type BrandModuleOpsSource = {
  id: string;
  entitySpecs?: Record<string, EntitySpec>;
  apiMounts?: Record<string, ApiMount>;
};

/**
 * Discovery kit-side : SoT = `api.listOperations()` (space module).
 * Fallback : ops des BrandModuleDef (EntitySpec CRUD + apiMounts) si le
 * kernel n'a pas encore les mounts. Pas de champ `mcpTools`.
 */
export function discoverModuleToolsFromBrandModules(
  modules: readonly BrandModuleOpsSource[],
  api: ApiKernel,
): McpRegisteredTool[] {
  const fromKernel = generateModuleToolsFromListedOps(api);
  if (fromKernel.length) return fromKernel;

  const generated: McpRegisteredTool[] = [];
  const invoke: GenerateModuleToolsInvoke = (req) => api.handle(req);

  for (const mod of modules) {
    const seenOp = new Set<string>();
    for (const [mountId, spec] of Object.entries(mod.entitySpecs ?? {})) {
      const ops = entityOperationsFromSpec(spec);
      for (const op of ops) seenOp.add(`${mountId}:${op.id}`);
      generated.push(
        ...generateModuleToolsFromOperations(mod.id, ops, invoke, {
          mountId,
          space: "module",
        }),
      );
    }
    for (const [mountId, mount] of Object.entries(mod.apiMounts ?? {})) {
      const extras = (mount.operations ?? []).filter(
        (op) => !seenOp.has(`${mountId}:${op.id}`),
      );
      if (!extras.length) continue;
      generated.push(
        ...generateModuleToolsFromOperations(mod.id, extras, invoke, {
          mountId,
          space: "module",
        }),
      );
    }
  }
  return generated;
}
