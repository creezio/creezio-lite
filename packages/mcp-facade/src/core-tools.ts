/**
 * Tools MCP cœur (`creezio.*`) — SoT kit (H1/H4 → M9).
 *
 * Les marques importent les noms / factories ; handlers Hono peuvent
 * rester brand-specific tant que les noms restent alignés.
 */

import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import { API_V1_PREFIX } from "@creezio/api-kernel";
import type { McpRegisteredTool, McpToolsBySpace } from "./types.js";

export const CREEZIO_CORE_MCP_TOOL_NAMES = [
  "creezio.health",
  "creezio.architecture",
  "creezio.admin.list_mounts",
  "creezio.admin.list_tools_by_space",
  "creezio.admin.list_aliases",
] as const;

export type CreezioCoreMcpToolName =
  (typeof CREEZIO_CORE_MCP_TOOL_NAMES)[number];

export type CreateCoreMcpToolsOptions = {
  architectureVersion?: string;
  brandId?: string;
  listApiMounts?: () => Array<{ space: string; id: string }>;
  listToolsBySpaceSync?: () => McpToolsBySpace;
  listAliasesSync?: () => Record<string, string>;
};

function emptyBySpace(): McpToolsBySpace {
  return { core: [], module: [], plugin: [] };
}

/** Factory tools cœur — utilisée par `createMcpFacade`. */
export function createCoreMcpTools(
  opts: CreateCoreMcpToolsOptions = {},
): McpRegisteredTool[] {
  const architectureVersion =
    opts.architectureVersion ?? ARCHITECTURE_VERSION;
  return [
    {
      name: "creezio.health",
      description: "Ping santé façade MCP / API cœur",
      space: "core",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        ok: true,
        content: { ok: true, brandId: opts.brandId ?? null },
      }),
    },
    {
      name: "creezio.architecture",
      description: "Version architecture + préfixe API unique",
      space: "core",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        ok: true,
        content: {
          architectureVersion,
          apiPrefix: API_V1_PREFIX,
          note: "Une seule façade MCP = MCP de l'app (proxy unifié H4)",
          toolSpaces: ["core", "module", "plugin"],
          publicSurfaceModes: [
            "canonical",
            "legacy-preferred",
            "both",
          ],
        },
      }),
    },
    {
      name: "creezio.admin.list_mounts",
      description: "Liste les montages API modules/plugins connus",
      space: "core",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        ok: true,
        content: {
          mounts: opts.listApiMounts ? opts.listApiMounts() : [],
        },
      }),
    },
    {
      name: "creezio.admin.list_tools_by_space",
      description:
        "Liste les tools MCP groupés par couche (core / module / plugin)",
      space: "core",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        ok: true,
        content: {
          bySpace: opts.listToolsBySpaceSync
            ? opts.listToolsBySpaceSync()
            : emptyBySpace(),
        },
      }),
    },
    {
      name: "creezio.admin.list_aliases",
      description:
        "Liste les aliases legacy → tools canoniques (anti double exposition)",
      space: "core",
      inputSchema: { type: "object", properties: {} },
      handler: async () => ({
        ok: true,
        content: {
          aliases: opts.listAliasesSync ? opts.listAliasesSync() : {},
        },
      }),
    },
  ];
}
