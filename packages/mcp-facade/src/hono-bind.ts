/**
 * O4r3 — bind Hono `/mcp` (SDK McpServer) → façade `create*BrandMcp`.
 *
 * Un seul SoT handlers : `facade.callTool`. Hono ne garde que transport,
 * auth Bearer, policies admin — pas de second registre métier.
 */

import type { McpFacade } from "./facade.js";
import type {
  McpPublicSurfaceMode,
  McpToolCallResult,
  McpToolDefinition,
} from "./types.js";

/** Shape minimal compatible `@modelcontextprotocol/sdk` registerTool result. */
export type HonoMcpSdkResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type HonoMcpToolRegisterFn = (
  name: string,
  config: {
    title?: string;
    description: string;
    inputSchema?: Record<string, unknown>;
  },
  handler: (input: Record<string, unknown>) => Promise<HonoMcpSdkResult>,
) => void;

export type BindFacadeToolsToHonoOptions = {
  /** Surface listTools (défaut legacy-preferred — aligné marques marques). */
  publicSurface?: McpPublicSurfaceMode;
  /**
   * Si fourni : n'enregistrer que ces noms (ex. `MCP_TOOL_REGISTRY`).
   * Permet de garder policies admin / scopes sur un sous-ensemble.
   */
  allowNames?: ReadonlySet<string> | readonly string[];
  /** Exclure des noms même s'ils sont dans listTools (host-only ailleurs). */
  excludeNames?: ReadonlySet<string> | readonly string[];
  /**
   * Hook avant/après callTool — policies, audit (ex. `registerMcpTool` wrap).
   * Si omis : enregistrement direct via `registerTool`.
   */
  registerTool?: HonoMcpToolRegisterFn;
};

function toSet(
  names: ReadonlySet<string> | readonly string[] | undefined,
): Set<string> | null {
  if (!names) return null;
  return names instanceof Set ? names : new Set(names);
}

/** Convertit `McpToolCallResult` → payload tools/call SDK. */
export function mcpFacadeResultToSdk(
  result: McpToolCallResult,
): HonoMcpSdkResult {
  if (!result.ok) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: result.error || "tool_failed" }),
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result.content ?? { ok: true }, null, 1),
      },
    ],
  };
}

/**
 * Enregistre sur le binder Hono tous les tools publics de la façade.
 * Dispatch = `facade.callTool` (aliases résolus par la façade).
 */
export async function bindFacadeToolsToHono(
  facade: McpFacade,
  registerTool: HonoMcpToolRegisterFn,
  options: BindFacadeToolsToHonoOptions = {},
): Promise<{ registered: string[]; skipped: string[] }> {
  const allow = toSet(options.allowNames);
  const exclude = toSet(options.excludeNames);
  const listed = await facade.listTools({
    publicSurface: options.publicSurface ?? "legacy-preferred",
  });
  const registered: string[] = [];
  const skipped: string[] = [];

  for (const tool of listed.tools as McpToolDefinition[]) {
    if (allow && !allow.has(tool.name)) {
      skipped.push(tool.name);
      continue;
    }
    if (exclude && exclude.has(tool.name)) {
      skipped.push(tool.name);
      continue;
    }
    const description =
      tool.description || `Tool MCP ${tool.name} (façade marque)`;

    registerTool(
      tool.name,
      {
        title: tool.name,
        description,
        // Pas de JSON Schema ici : le SDK MCP attend Zod ; args validés côté handler façade.
      },
      async (input) => {
        const result = await facade.callTool(
          tool.name,
          (input && typeof input === "object"
            ? input
            : {}) as Record<string, unknown>,
        );
        return mcpFacadeResultToSdk(result);
      },
    );
    registered.push(tool.name);
  }

  return { registered, skipped };
}
