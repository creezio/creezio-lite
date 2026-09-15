/**
 * Contrat MCP produit (D1/C2 → M9) — une seule stack.
 *
 * - Exécuteur HTTP public : **Hono** `GET|POST /mcp`.
 * - Façade Electron `@creezio/mcp-facade` : adaptateur brand-mounts (tests /
 *   offline) **ou** proxy vers Hono dès qu'un upstream local est annoncé.
 *
 * Hermes / Cursor / ChatGPT → toujours `{base}/mcp`, jamais un 2ᵉ serveur
 * MCP dans le process Electron.
 */

export const MCP_PRODUCT_EXECUTOR = "hono" as const;

export type McpProductExecutor = typeof MCP_PRODUCT_EXECUTOR;

/** Rôle de la façade Electron (pas un 2ᵉ exécuteur produit). */
export type McpFacadeRole = "local-brand-adapter" | "hono-proxy";

export type McpFacadeMode = "local-adapter" | "hono-proxy" | "hono-preferred";

export type McpUpstreamRef = {
  /** Base URL Next locale, ex. http://127.0.0.1:3920 — sans slash final. */
  getBaseUrl: () => string | null;
  getApiKey: () => string | null;
};

export function resolveMcpFacadeRole(
  mode: McpFacadeMode,
  upstream: string | null,
): McpFacadeRole {
  if (mode === "local-adapter") return "local-brand-adapter";
  if (mode === "hono-proxy") return "hono-proxy";
  // hono-preferred
  return upstream ? "hono-proxy" : "local-brand-adapter";
}
