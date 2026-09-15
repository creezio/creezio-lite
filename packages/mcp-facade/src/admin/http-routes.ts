/**
 * Routes Hono Admin MCP (port kit — N6).
 * Auth owner reste côté marque (montage sous /admin).
 */
import { Hono } from "hono";
import {
  listMcpClients,
  listMcpAuditLogs,
  listMcpToolPolicies,
  mcpAdminStatus,
  mcpDiagnostics,
  mcpMetrics,
  revokeMcpClient,
  rotateMcpClientSecret,
  setMcpClientEnabled,
  updateMcpToolPolicy,
  exportMcpDiagnostics,
} from "./mcp-admin.js";
import { getMcpAdminAdapters } from "./adapters.js";

export type CreateMcpAdminRoutesOptions = {
  /** Préfixe filename export (sinon adapters.diagnosticFilenamePrefix || creezio). */
  diagnosticFilenamePrefix?: string;
};

export function createMcpAdminRoutes(
  opts: CreateMcpAdminRoutesOptions = {},
): Hono {
  const app = new Hono();

  app.get("/mcp/status", (c) => c.json(mcpAdminStatus()));
  app.get("/mcp/tools", (c) => c.json({ tools: listMcpToolPolicies() }));
  app.get("/mcp/clients", (c) => c.json({ clients: listMcpClients() }));
  app.get("/mcp/diagnostics", (c) => c.json(mcpDiagnostics()));
  app.get("/mcp/metrics", (c) => c.json(mcpMetrics()));
  app.get("/mcp/audit-logs", (c) =>
    c.json({ logs: listMcpAuditLogs(Number(c.req.query("limit")) || 200) }),
  );
  app.get("/mcp/diagnostics/export", (c) => {
    const prefix =
      opts.diagnosticFilenamePrefix ||
      getMcpAdminAdapters().diagnosticFilenamePrefix ||
      "creezio";
    c.header(
      "Content-Disposition",
      `attachment; filename="${prefix}-mcp-diagnostic-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    return c.json(exportMcpDiagnostics());
  });

  app.patch("/mcp/policies/:tool", async (c) => {
    let body: {
      enabled?: boolean;
      allowedRoles?: string[];
      allowedScopes?: string[];
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    const policy = updateMcpToolPolicy(c.req.param("tool"), body);
    if (!policy) return c.json({ error: "Tool inconnu" }, 404);
    return c.json({ policy });
  });

  app.patch("/mcp/clients/:clientId", async (c) => {
    let body: { enabled?: boolean };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "enabled booléen requis" }, 400);
    }
    const ok = setMcpClientEnabled(c.req.param("clientId"), body.enabled);
    return ok ? c.json({ ok: true }) : c.json({ error: "Client introuvable" }, 404);
  });

  app.delete("/mcp/clients/:clientId", (c) => {
    const ok = revokeMcpClient(c.req.param("clientId"));
    return ok ? c.json({ ok: true }) : c.json({ error: "Client introuvable" }, 404);
  });

  app.post("/mcp/clients/:clientId/rotate-secret", (c) => {
    const result = rotateMcpClientSecret(c.req.param("clientId"));
    if (!result) {
      return c.json(
        { error: "Client introuvable, révoqué ou public (sans secret)" },
        400,
      );
    }
    return c.json({
      clientSecret: result.clientSecret,
      warning:
        "Ce secret ne sera plus affiché. Les refresh tokens précédents sont révoqués.",
    });
  });

  return app;
}
