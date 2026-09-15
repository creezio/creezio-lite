/**
 * Admin — lecture / purge des logs API + MCP (session UI).
 * Hono « nu » : hors doc OpenAPI publique.
 * O5 — gold. Auth owner reste côté marque (montage).
 */
import { Hono } from "hono";
import {
  clearRequestLogs,
  listRequestLogs,
  type RequestLogSource,
} from "./request-logs.js";

export function createRequestLogsRoutes(): Hono {
  const app = new Hono();

  app.get("/request-logs", (c) => {
    const limit = Number(c.req.query("limit")) || 100;
    const sourceRaw = (c.req.query("source") || "all").toLowerCase();
    const source =
      sourceRaw === "mcp" || sourceRaw === "api"
        ? (sourceRaw as RequestLogSource)
        : "all";
    const q = c.req.query("q") || undefined;
    const errorsOnly =
      c.req.query("errorsOnly") === "1" ||
      c.req.query("errorsOnly") === "true" ||
      c.req.query("errors") === "1";

    const result = listRequestLogs({ limit, source, q, errorsOnly });
    return c.json(result);
  });

  app.delete("/request-logs", (c) => {
    const { cleared } = clearRequestLogs();
    return c.json({ ok: true, cleared });
  });

  return app;
}
