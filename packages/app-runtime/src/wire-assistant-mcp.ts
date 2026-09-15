/**
 * Branche la façade MCP kernel dans configureAssistantBrand.
 * À appeler après createMcpFacade (harness + desktop) — le beforeBoot marque
 * peut avoir posé AppMap/prompts avant que le MCP existe.
 */
import {
  mergeAssistantBrandConfig,
  mcpFacadeToAssistantConfig,
} from "@creezio/assistant";
import type { McpFacade } from "@creezio/mcp-facade";

export function wireAssistantMcp(mcp: McpFacade): void {
  mergeAssistantBrandConfig({
    mcp: mcpFacadeToAssistantConfig(mcp),
  });
}
