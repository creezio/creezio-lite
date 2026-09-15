/**
 * Routes Hono Admin Database (catalogue, browse, automations, CRUD, export).
 * port kit → kit (M2). Auth owner reste côté marque (montage).
 *
 * Multi-stores : `GET /database/dbs` + query `?db=<id>` (registre
 * `registerDatabaseStore`). Sans registre → comportement legacy mono-DB.
 */
import { Hono } from "hono";
import type { SqliteDatabase } from "../sqlite-driver.js";
import { isSafeIdentifier } from "../identifiers.js";
import { canAutomateTable, canCrudTable } from "../whitelist.js";
import { listCatalog, getTableMeta } from "../catalog.js";
import { browseTable, getRowByRowid, type BrowseFilter } from "../query.js";
import { logDatabaseAccess, listAccessLog } from "../access-log.js";
import {
  listAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  listAutomationRuns,
  type AutomationAction,
  type AutomationTriggerType,
} from "../automations-store.js";
import type { ConditionGroup } from "../conditions.js";
import {
  processPendingEvents,
  processRetries,
  fireButtonAutomations,
} from "../engine.js";
import { deliverWebhook, assertWebhookUrl } from "../webhooks.js";
import {
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from "../views.js";
import { insertRow, updateRow, deleteRow } from "../crud.js";
import { exportTable } from "../export.js";
import {
  listDatabaseStores,
  resolveDatabaseStore,
} from "../stores.js";

export type AdminDatabaseRouteDeps = {
  getDb: () => SqliteDatabase;
  getWriteDb: () => SqliteDatabase;
  getActor: (c: { get: (k: string) => unknown }) => string;
  /** Label `source` du payload test webhook (défaut kit). */
  webhookTestSource?: string;
  /** Store par défaut quand `?db=` est omis (défaut : `brand` si enregistré). */
  defaultStoreId?: string;
};

type RouteContext = {
  req: { query: (k: string) => string | undefined };
  json: (body: unknown, status?: number) => Response;
};

export function createAdminDatabaseRoutes(
  deps: AdminDatabaseRouteDeps,
): Hono {
  const { getActor } = deps;
  const webhookTestSource = deps.webhookTestSource ?? "creezio-database";
  const app = new Hono();

  function parseFilters(raw: string | undefined): BrowseFilter[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as BrowseFilter[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parseColumns(raw: string | undefined): string[] | undefined {
    if (!raw) return undefined;
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function storeOf(c: RouteContext) {
    return resolveDatabaseStore({
      requestedId: c.req.query("db"),
      defaultStoreId: deps.defaultStoreId,
      fallbackGetDb: deps.getDb,
      fallbackGetWriteDb: deps.getWriteDb,
    });
  }

  function unknownDb(c: RouteContext, requested: string | undefined) {
    return c.json(
      {
        ok: false,
        error: "not_found",
        detail: "unknown_db",
        db: requested || null,
        dbs: listDatabaseStores().map((s) => s.id),
      },
      404,
    );
  }

  /* ---- Stores (multi-DB) ---- */
  app.get("/database/dbs", (c) => {
    const registered = listDatabaseStores();
    const dbs =
      registered.length > 0
        ? registered
        : [
            {
              id: deps.defaultStoreId || "default",
              label: "Default",
              layer: "brand" as const,
            },
          ];
    const defaultStoreId =
      deps.defaultStoreId ||
      dbs.find((s) => s.id === "brand")?.id ||
      dbs[0]?.id ||
      "default";
    return c.json({ ok: true, dbs, defaultStoreId });
  });

  /* ---- Catalogue ---- */
  app.get("/database/tables", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const includeSystem = c.req.query("includeSystem") === "1";
    const db = store.getDb();
    const tables = listCatalog(db, { includeSystem });
    logDatabaseAccess(store.getWriteDb(), {
      actor: getActor(c),
      action: "list_tables",
      detail: { count: tables.length, includeSystem, db: store.id },
    });
    return c.json({
      db: store.id,
      tables: tables.map((t) => ({
        name: t.name,
        sql: t.sql,
        rowCount: t.rowCount,
        kind: t.kind,
        group: t.group,
        system: t.system,
      })),
      catalog: tables,
    });
  });

  app.get("/database/tables/:table", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const name = c.req.param("table");
    if (!isSafeIdentifier(name)) return c.json({ error: "Table invalide" }, 400);
    try {
      const result = browseTable(store.getDb(), name, {
        page: Number.parseInt(c.req.query("page") || "1", 10),
        pageSize: Number.parseInt(c.req.query("pageSize") || "50", 10),
        sort: c.req.query("sort") || undefined,
        sortDir: (c.req.query("sortDir") as "asc" | "desc") || undefined,
        q: c.req.query("q") || undefined,
        columns: parseColumns(c.req.query("columns") || undefined),
        filters: parseFilters(c.req.query("filters") || undefined),
      });
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "browse",
        tableName: name,
        detail: {
          page: result.pagination.page,
          total: result.pagination.total,
          db: store.id,
        },
      });
      return c.json({
        db: store.id,
        table: {
          name: result.table.name,
          sql: result.table.sql,
          kind: result.table.kind,
          columns: result.table.columns,
          foreignKeys: result.table.foreignKeys,
          indexes: result.table.indexes,
          system: result.table.system,
          canCrud: canCrudTable(name),
          canAutomate: canAutomateTable(name),
        },
        columns: result.columns,
        rows: result.rows,
        pagination: result.pagination,
        sort: result.sort,
        sortDir: result.sortDir,
      });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Lecture impossible" },
        404,
      );
    }
  });

  app.get("/database/tables/:table/schema", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const meta = getTableMeta(store.getDb(), c.req.param("table"));
    if (!meta) return c.json({ error: "Table introuvable" }, 404);
    return c.json({ db: store.id, table: meta });
  });

  app.get("/database/tables/:table/rows/:rowid", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const rowid = Number.parseInt(c.req.param("rowid"), 10);
    if (!Number.isFinite(rowid)) return c.json({ error: "rowid invalide" }, 400);
    const row = getRowByRowid(store.getDb(), c.req.param("table"), rowid);
    if (!row) return c.json({ error: "Ligne introuvable" }, 404);
    return c.json({ db: store.id, row });
  });

  /* ---- Export ---- */
  app.get("/database/tables/:table/export", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const format = (c.req.query("format") || "json") as "json" | "csv";
    if (format !== "json" && format !== "csv") {
      return c.json({ error: "format json|csv" }, 400);
    }
    try {
      const exported = exportTable(store.getDb(), c.req.param("table"), format, {
        q: c.req.query("q") || undefined,
        sort: c.req.query("sort") || undefined,
        sortDir: (c.req.query("sortDir") as "asc" | "desc") || undefined,
        filters: parseFilters(c.req.query("filters") || undefined),
        pageSize: Number.parseInt(c.req.query("limit") || "1000", 10),
      });
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "export",
        tableName: c.req.param("table"),
        detail: { format, db: store.id },
      });
      c.header("Content-Type", exported.contentType);
      c.header(
        "Content-Disposition",
        `attachment; filename="${exported.filename}"`,
      );
      return c.body(exported.body);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Export impossible" },
        400,
      );
    }
  });

  /* ---- CRUD contrôlé ---- */
  app.post("/database/tables/:table/rows", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    let body: { values?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    try {
      const row = insertRow(
        store.getWriteDb(),
        c.req.param("table"),
        body.values || {},
      );
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "insert",
        tableName: c.req.param("table"),
        detail: { db: store.id },
      });
      void processPendingEvents(store.getWriteDb(), 10);
      return c.json({ db: store.id, row }, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Insertion impossible" },
        400,
      );
    }
  });

  app.patch("/database/tables/:table/rows/:rowid", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const rowid = Number.parseInt(c.req.param("rowid"), 10);
    if (!Number.isFinite(rowid)) return c.json({ error: "rowid invalide" }, 400);
    let body: { values?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    try {
      const row = updateRow(
        store.getWriteDb(),
        c.req.param("table"),
        rowid,
        body.values || {},
      );
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "update",
        tableName: c.req.param("table"),
        detail: { rowid, db: store.id },
      });
      void processPendingEvents(store.getWriteDb(), 10);
      return c.json({ db: store.id, row });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Mise à jour impossible" },
        400,
      );
    }
  });

  app.delete("/database/tables/:table/rows/:rowid", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const rowid = Number.parseInt(c.req.param("rowid"), 10);
    if (!Number.isFinite(rowid)) return c.json({ error: "rowid invalide" }, 400);
    try {
      const ok = deleteRow(store.getWriteDb(), c.req.param("table"), rowid);
      if (!ok) return c.json({ error: "Ligne introuvable" }, 404);
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "delete",
        tableName: c.req.param("table"),
        detail: { rowid, db: store.id },
      });
      void processPendingEvents(store.getWriteDb(), 10);
      return c.json({ ok: true, db: store.id });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Suppression impossible" },
        400,
      );
    }
  });

  /* ---- Vues sauvegardées ---- */
  app.get("/database/tables/:table/views", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    return c.json({
      db: store.id,
      views: listSavedViews(store.getDb(), c.req.param("table")),
    });
  });

  app.post("/database/tables/:table/views", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    let body: { name?: string; config?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    try {
      const view = createSavedView(store.getWriteDb(), {
        tableName: c.req.param("table"),
        name: body.name || "Vue",
        config: (body.config || {}) as Parameters<
          typeof createSavedView
        >[1]["config"],
      });
      return c.json({ db: store.id, view }, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Création impossible" },
        400,
      );
    }
  });

  app.patch("/database/views/:id", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    let body: { name?: string; config?: Record<string, unknown> };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    const view = updateSavedView(store.getWriteDb(), c.req.param("id"), {
      name: body.name,
      config: body.config as Parameters<typeof updateSavedView>[2]["config"],
    });
    return view
      ? c.json({ db: store.id, view })
      : c.json({ error: "Vue introuvable" }, 404);
  });

  app.delete("/database/views/:id", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const ok = deleteSavedView(store.getWriteDb(), c.req.param("id"));
    return ok
      ? c.json({ ok: true, db: store.id })
      : c.json({ error: "Vue introuvable" }, 404);
  });

  /* ---- Automations ---- */
  app.get("/database/tables/:table/automations", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    return c.json({
      db: store.id,
      automations: listAutomations(store.getDb(), c.req.param("table")),
      canAutomate: canAutomateTable(c.req.param("table")),
    });
  });

  app.post("/database/tables/:table/automations", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    let body: {
      name?: string;
      triggerType?: AutomationTriggerType;
      watchColumns?: string[] | null;
      conditions?: ConditionGroup;
      actions?: AutomationAction[];
      enabled?: boolean;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    try {
      const automation = createAutomation(store.getWriteDb(), {
        tableName: c.req.param("table"),
        name: body.name || "Automation",
        triggerType: body.triggerType || "row_added",
        watchColumns: body.watchColumns,
        conditions: body.conditions,
        actions: body.actions || [],
        enabled: body.enabled,
      });
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "automation_create",
        tableName: c.req.param("table"),
        detail: { id: automation.id, db: store.id },
      });
      return c.json({ db: store.id, automation }, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Création impossible" },
        400,
      );
    }
  });

  app.patch("/database/automations/:id", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    const automation = updateAutomation(store.getWriteDb(), c.req.param("id"), {
      name: body.name as string | undefined,
      enabled: body.enabled as boolean | undefined,
      triggerType: body.triggerType as AutomationTriggerType | undefined,
      watchColumns: body.watchColumns as string[] | null | undefined,
      conditions: body.conditions as ConditionGroup | undefined,
      actions: body.actions as AutomationAction[] | undefined,
    });
    return automation
      ? c.json({ db: store.id, automation })
      : c.json({ error: "Automation introuvable" }, 404);
  });

  app.delete("/database/automations/:id", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const current = getAutomation(store.getDb(), c.req.param("id"));
    const ok = deleteAutomation(store.getWriteDb(), c.req.param("id"));
    if (ok && current) {
      logDatabaseAccess(store.getWriteDb(), {
        actor: getActor(c),
        action: "automation_delete",
        tableName: current.tableName,
        detail: { id: current.id, db: store.id },
      });
    }
    return ok
      ? c.json({ ok: true, db: store.id })
      : c.json({ error: "Automation introuvable" }, 404);
  });

  app.get("/database/automations/:id/runs", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    return c.json({
      db: store.id,
      runs: listAutomationRuns(store.getDb(), {
        automationId: c.req.param("id"),
        limit: Number.parseInt(c.req.query("limit") || "50", 10),
      }),
    });
  });

  app.post("/database/automations/process", async (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    const processed = await processPendingEvents(store.getWriteDb(), 50);
    const retries = await processRetries(store.getWriteDb(), 20);
    return c.json({ db: store.id, ...processed, retries });
  });

  app.post("/database/automations/test-webhook", async (c) => {
    let body: {
      url?: string;
      secret?: string;
      payload?: Record<string, unknown>;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON attendu" }, 400);
    }
    if (!body.url) return c.json({ error: "url requise" }, 400);
    try {
      assertWebhookUrl(body.url);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "URL invalide" },
        400,
      );
    }
    process.env.TF2_WEBHOOK_ALLOW_LOOPBACK = "1";
    const result = await deliverWebhook({
      url: body.url,
      secret: body.secret,
      body: body.payload || {
        test: true,
        source: webhookTestSource,
        at: new Date().toISOString(),
      },
    });
    return c.json({ result });
  });

  app.post(
    "/database/tables/:table/rows/:rowid/run-button",
    async (c) => {
      const store = storeOf(c);
      if (!store) return unknownDb(c, c.req.query("db"));
      const rowid = Number.parseInt(c.req.param("rowid"), 10);
      if (!Number.isFinite(rowid)) {
        return c.json({ error: "rowid invalide" }, 400);
      }
      let body: { automationId?: string } = {};
      try {
        body = await c.req.json();
      } catch {
        body = {};
      }
      const row = getRowByRowid(store.getDb(), c.req.param("table"), rowid);
      if (!row) return c.json({ error: "Ligne introuvable" }, 404);
      const matched = await fireButtonAutomations(store.getWriteDb(), {
        tableName: c.req.param("table"),
        row,
        rowid,
        automationId: body.automationId,
      });
      return c.json({ db: store.id, matched });
    },
  );

  /* ---- Activité / journal ---- */
  app.get("/database/activity", (c) => {
    const store = storeOf(c);
    if (!store) return unknownDb(c, c.req.query("db"));
    return c.json({
      db: store.id,
      accessLog: listAccessLog(
        store.getDb(),
        Number.parseInt(c.req.query("limit") || "100", 10),
      ),
      runs: listAutomationRuns(store.getDb(), {
        limit: Number.parseInt(c.req.query("runsLimit") || "50", 10),
      }),
    });
  });

  return app;
}
