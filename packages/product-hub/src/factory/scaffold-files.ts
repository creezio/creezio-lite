/**
 * Fichiers scaffold plugin réels générés depuis un PRD (C3 — plus de stub console.log-only).
 */

import type { PluginPrdRevisionRecord } from "../store/types.js";
import { parsePluginPrdSections } from "../prd.js";

export type ScaffoldPluginFiles = Record<string, string>;

function sqlType(t?: string): string {
  const u = String(t || "TEXT").toUpperCase();
  if (u.includes("INT")) return "INTEGER";
  if (u.includes("REAL") || u.includes("FLOAT") || u.includes("DOUBLE")) {
    return "REAL";
  }
  if (u.includes("BLOB")) return "BLOB";
  return "TEXT";
}

function buildSchemaSql(
  tables: Array<{
    table: string;
    columns: Array<{ name: string; type?: string; description?: string }>;
  }>,
): string {
  const lines: string[] = [
    "-- Schema plugin généré par la fabrique Creezio (C3)",
    "CREATE TABLE IF NOT EXISTS plugin_kv (",
    "  key TEXT PRIMARY KEY NOT NULL,",
    "  value TEXT NOT NULL DEFAULT '',",
    "  updated_at TEXT NOT NULL",
    ");",
    "",
  ];
  for (const t of tables) {
    const name = String(t.table || "").trim();
    if (!name || name === "plugin_kv") continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    const cols = Array.isArray(t.columns) ? t.columns : [];
    const colDefs = cols
      .filter((c) => c?.name && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.name))
      .map((c) => `  ${c.name} ${sqlType(c.type)}`);
    if (!colDefs.length) {
      colDefs.push("  id TEXT PRIMARY KEY NOT NULL");
      colDefs.push("  payload TEXT");
      colDefs.push("  updated_at TEXT");
    } else if (!cols.some((c) => c.name === "id")) {
      colDefs.unshift("  id TEXT PRIMARY KEY NOT NULL");
    }
    lines.push(`CREATE TABLE IF NOT EXISTS ${name} (`);
    lines.push(colDefs.join(",\n"));
    lines.push(");");
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function buildPluginScaffoldFiles(input: {
  pluginId: string;
  name: string;
  description?: string;
  prd?: PluginPrdRevisionRecord | null;
}): ScaffoldPluginFiles {
  const sections = input.prd
    ? parsePluginPrdSections(input.prd.sections_json)
    : {};
  const tables = Array.isArray(sections.db_schema) ? sections.db_schema : [];
  const schemaSql = buildSchemaSql(tables);
  const tableNames = [
    "plugin_kv",
    ...tables
      .map((t) => String(t.table || "").trim())
      .filter((n) => n && n !== "plugin_kv" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)),
  ];

  const manifest = {
    id: input.pluginId,
    name: input.name,
    version: "0.1.0",
    description: input.description || input.prd?.problem || "",
    main: "index.js",
    permissions: ["net:loopback"],
    creezio: {
      factory: "c3",
      db: "plugin",
      mcpSpace: "plugin",
      schema: "schema.sql",
      api: "api.js",
      mcpTools: "mcp-tools.js",
    },
  };

  const indexJs = `"use strict";
/**
 * Plugin ${input.pluginId} — généré par fabrique Creezio C3.
 * Point d'entrée runtime : start(ctx) → handlers KV + applySchema.
 */
const fs = require("fs");
const path = require("path");

const PLUGIN_ID = ${JSON.stringify(input.pluginId)};
const TABLES = ${JSON.stringify(tableNames)};

function applySchema(db) {
  if (!db || typeof db.exec !== "function") {
    return { ok: false, error: "db_unavailable" };
  }
  const schemaPath = path.join(__dirname, "schema.sql");
  if (fs.existsSync(schemaPath)) {
    db.exec(fs.readFileSync(schemaPath, "utf8"));
  }
  return { ok: true, tables: TABLES };
}

function kvGet(db, key) {
  const row = db.prepare("SELECT value, updated_at FROM plugin_kv WHERE key = ?").get(key);
  return row || null;
}

function kvSet(db, key, value) {
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO plugin_kv(key, value, updated_at) VALUES(?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, String(value ?? ""), ts);
  return { key, value: String(value ?? ""), updated_at: ts };
}

function kvList(db) {
  return db.prepare("SELECT key, value, updated_at FROM plugin_kv ORDER BY key").all();
}

function start(ctx) {
  const db = ctx && ctx.db ? ctx.db : null;
  if (db) applySchema(db);
  return {
    ok: true,
    pluginId: PLUGIN_ID,
    tables: TABLES,
    handlers: {
      applySchema: () => applySchema(db),
      kvGet: (key) => kvGet(db, key),
      kvSet: (key, value) => kvSet(db, key, value),
      kvList: () => kvList(db),
    },
  };
}

module.exports = {
  id: PLUGIN_ID,
  name: ${JSON.stringify(input.name)},
  tables: TABLES,
  applySchema,
  kvGet,
  kvSet,
  kvList,
  start,
};
`;

  const apiJs = `"use strict";
/**
 * Mount API HTTP plugin (contrat api-kernel) — list/get/set KV.
 */
const plugin = require("./index.js");

function createApiMount() {
  return {
    dbLayer: "plugin",
    handle: async ({ req, subPath, db }) => {
      if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };
      plugin.applySchema(db);
      const method = String(req.method || "GET").toUpperCase();
      const path = String(subPath || "").replace(/^\\/+/, "");

      if ((path === "" || path === "status") && method === "GET") {
        return {
          status: 200,
          body: {
            ok: true,
            pluginId: plugin.id,
            tables: plugin.tables,
            factory: "c3",
          },
        };
      }

      if (path === "kv" && method === "GET") {
        return { status: 200, body: { ok: true, items: plugin.kvList(db) } };
      }

      if (path.startsWith("kv/") && method === "GET") {
        const key = decodeURIComponent(path.slice(3));
        const row = plugin.kvGet(db, key);
        if (!row) return { status: 404, body: { ok: false, error: "not_found" } };
        return { status: 200, body: { ok: true, key, ...row } };
      }

      if ((path === "kv" || path.startsWith("kv/")) && method === "POST") {
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const key =
          path.startsWith("kv/") && path.length > 3
            ? decodeURIComponent(path.slice(3))
            : String(body.key || "");
        if (!key) return { status: 400, body: { ok: false, error: "key_required" } };
        const saved = plugin.kvSet(db, key, body.value);
        return { status: 201, body: { ok: true, ...saved } };
      }

      return { status: 404, body: { ok: false, error: "not_found", subPath: path } };
    },
  };
}

module.exports = { createApiMount };
`;

  const mcpToolsJs = `"use strict";
/**
 * Tools MCP space plugin.<id>.* — kv_list / kv_get / kv_set.
 */
const plugin = require("./index.js");

function createMcpTools(ctx) {
  const db = ctx && ctx.db ? ctx.db : null;
  const prefix = "plugin." + plugin.id;
  return [
    {
      name: prefix + ".kv_list",
      description: "Liste les clés KV du plugin " + plugin.id,
      space: "plugin",
      ownerId: plugin.id,
      handler: async () => {
        if (!db) return { ok: false, content: { error: "db_unavailable" } };
        plugin.applySchema(db);
        return { ok: true, content: { items: plugin.kvList(db) } };
      },
    },
    {
      name: prefix + ".kv_get",
      description: "Lit une clé KV",
      space: "plugin",
      ownerId: plugin.id,
      handler: async (args) => {
        if (!db) return { ok: false, content: { error: "db_unavailable" } };
        const key = String((args && args.key) || "");
        if (!key) return { ok: false, content: { error: "key_required" } };
        plugin.applySchema(db);
        const row = plugin.kvGet(db, key);
        return row
          ? { ok: true, content: { key, ...row } }
          : { ok: false, content: { error: "not_found" } };
      },
    },
    {
      name: prefix + ".kv_set",
      description: "Écrit une clé KV",
      space: "plugin",
      ownerId: plugin.id,
      handler: async (args) => {
        if (!db) return { ok: false, content: { error: "db_unavailable" } };
        const key = String((args && args.key) || "");
        if (!key) return { ok: false, content: { error: "key_required" } };
        plugin.applySchema(db);
        const saved = plugin.kvSet(db, key, args && args.value);
        return { ok: true, content: saved };
      },
    },
  ];
}

module.exports = { createMcpTools };
`;

  const readme = `# ${input.name}

Plugin isolé généré par la fabrique conversationnelle Creezio (**C3** — scaffold réel).

| Surface | Fichier / contrat |
|---------|-------------------|
| Entrée runtime | \`index.js\` — \`start(ctx)\`, handlers KV, \`applySchema\` |
| Schéma SQLite | \`schema.sql\` → DB \`plugin/${input.pluginId}.db\` |
| API HTTP | \`api.js\` — \`createApiMount()\` (status + kv) |
| MCP | \`mcp-tools.js\` — \`plugin.${input.pluginId}.kv_*\` |
| ACL | Product Hub L3 (see / install / execute) |

${input.prd?.scope ? `## Périmètre\n\n${input.prd.scope}\n` : ""}
`;

  const prdMd = input.prd
    ? [
        `# PRD — ${input.name}`,
        "",
        `## Problème`,
        input.prd.problem,
        "",
        `## Utilisateurs`,
        input.prd.users,
        "",
        `## Périmètre`,
        input.prd.scope,
        "",
        `## Hors périmètre`,
        input.prd.out_of_scope || "(néant)",
        "",
        `## Critères d'acceptation`,
        input.prd.acceptance_criteria,
        "",
      ].join("\n")
    : `# PRD — ${input.name}\n`;

  const packageJson = {
    name: `@plugin/${input.pluginId}`,
    version: "0.1.0",
    private: true,
    main: "index.js",
    description: input.description || input.prd?.problem || input.name,
    creezio: { factory: "c3", pluginId: input.pluginId },
  };

  return {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "schema.sql": schemaSql,
    "index.js": indexJs,
    "api.js": apiJs,
    "mcp-tools.js": mcpToolsJs,
    "README.md": readme,
    "PRD.md": prdMd,
  };
}
