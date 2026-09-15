/**
 * H1 « Hermes cerveau unique » — pont JSON-RPC 2.0 stateless pour le
 * endpoint `/mcp` du kit (listen-brand-os-http).
 *
 * Le client MCP natif de Hermes (`config.yaml → mcp_servers`, transport
 * Streamable HTTP) parle JSON-RPC 2.0 (`initialize`, `tools/list`,
 * `tools/call`, `ping`, notifications). Le endpoint kit historique est un
 * transport JSON simple (`{ok, tools}` / `{name, arguments}`) — conservé tel
 * quel pour les clients existants : seuls les corps portant `jsonrpc:"2.0"`
 * passent par ce pont (mode réponse JSON du spec Streamable HTTP, sans
 * session — `skip_preflight: true` côté Hermes).
 */
import type { McpFacade } from "@creezio/mcp-facade";

export type McpJsonRpcResponse = {
  status: number;
  /** null = notification acceptée sans corps (202). */
  body: Record<string, unknown> | null;
};

export function isJsonRpcBody(body: unknown): body is Record<string, unknown> {
  return Boolean(
    body &&
      typeof body === "object" &&
      (body as { jsonrpc?: unknown }).jsonrpc === "2.0",
  );
}

const PROTOCOL_VERSION = "2025-03-26";

/**
 * Traite une requête JSON-RPC MCP (stateless). Jamais de throw : les erreurs
 * façade deviennent des erreurs JSON-RPC (`-32603`) ou des résultats
 * `isError: true` (tools/call), conformément au spec MCP.
 */
export async function handleMcpJsonRpcRequest(opts: {
  mcp: McpFacade;
  body: Record<string, unknown>;
  bearerToken?: string | null;
  serverName?: string;
}): Promise<McpJsonRpcResponse> {
  const { mcp, body } = opts;
  const id = (body.id ?? null) as string | number | null;
  const method = String(body.method || "");
  const params =
    body.params && typeof body.params === "object"
      ? (body.params as Record<string, unknown>)
      : {};

  const result = (payload: Record<string, unknown>): McpJsonRpcResponse => ({
    status: 200,
    body: { jsonrpc: "2.0", id, result: payload },
  });
  const rpcError = (code: number, message: string): McpJsonRpcResponse => ({
    status: 200,
    body: { jsonrpc: "2.0", id, error: { code, message } },
  });

  // Notification (pas d'id) : accusé 202 sans corps (notifications/initialized…).
  if (body.id === undefined || body.id === null) {
    return { status: 202, body: null };
  }

  try {
    switch (method) {
      case "initialize": {
        const requested =
          typeof params.protocolVersion === "string"
            ? params.protocolVersion
            : PROTOCOL_VERSION;
        return result({
          protocolVersion: requested,
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: opts.serverName || "creezio-mcp",
            version: "1.0.0",
          },
        });
      }
      case "ping":
        return result({});
      case "tools/list": {
        const listed = await mcp.listTools({
          bearerToken: opts.bearerToken ?? null,
        });
        return result({
          tools: listed.tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema:
              (t.inputSchema as Record<string, unknown> | undefined) || {
                type: "object",
                properties: {},
              },
          })),
        });
      }
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (!name) return rpcError(-32602, "params.name requis");
        const args =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        const call = await mcp.callTool(name, args, {
          bearerToken: opts.bearerToken ?? null,
        });
        if (call.ok) {
          const content = call.content;
          return result({
            content: [
              {
                type: "text",
                text:
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content ?? {}, null, 1),
              },
            ],
            isError: false,
          });
        }
        return result({
          content: [
            { type: "text", text: JSON.stringify({ error: call.error }) },
          ],
          isError: true,
        });
      }
      default:
        return rpcError(-32601, `Méthode inconnue: ${method}`);
    }
  } catch (error) {
    // listTools/callTool peuvent throw sur auth invalide.
    return rpcError(
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}
