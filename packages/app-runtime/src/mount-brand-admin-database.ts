/**
 * Monte l'Admin Database natif sur la surface `/api/v1/admin` du kernel marque.
 *
 * Enregistre automatiquement les stores runtime `core` + `brand` (+ plugins
 * ouverts) — toute marque factory/demo obtient la liste sans glue locale.
 */
import type { SqliteRuntime } from "@creezio/platform-core";
import {
  DATABASE_CORE_SQL,
  clearDatabaseStores,
  createAdminDatabaseRoutes,
  registerDatabaseStore,
  type SqliteDatabase,
} from "@creezio/database";
import type { Hono } from "hono";

function asSqliteDatabase(handle: {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => unknown;
}): SqliteDatabase {
  return handle as unknown as SqliteDatabase;
}

export function registerRuntimeDatabaseStores(runtime: SqliteRuntime): void {
  clearDatabaseStores();

  const core = runtime.getCore();
  const brand = runtime.getBrand();

  // Schéma admin (accès log / vues / automations) sur chaque store exposé.
  try {
    core.exec(DATABASE_CORE_SQL);
  } catch {
    /* best-effort */
  }
  try {
    brand.exec(DATABASE_CORE_SQL);
  } catch {
    /* best-effort */
  }

  registerDatabaseStore({
    id: "brand",
    label: "Brand",
    layer: "brand",
    path: runtime.paths.brand,
    getDb: () => asSqliteDatabase(runtime.getBrand()),
    getWriteDb: () => asSqliteDatabase(runtime.getBrand()),
  });
  registerDatabaseStore({
    id: "core",
    label: "Core",
    layer: "core",
    path: runtime.paths.core,
    getDb: () => asSqliteDatabase(runtime.getCore()),
    getWriteDb: () => asSqliteDatabase(runtime.getCore()),
  });

  for (const pluginId of runtime.listOpenPlugins()) {
    try {
      const plugin = runtime.getPlugin(pluginId);
      try {
        plugin.exec(DATABASE_CORE_SQL);
      } catch {
        /* best-effort */
      }
      registerDatabaseStore({
        id: `plugin:${pluginId}`,
        label: `Plugin ${pluginId}`,
        layer: "plugin",
        path: plugin.path,
        getDb: () => asSqliteDatabase(runtime.getPlugin(pluginId)),
        getWriteDb: () => asSqliteDatabase(runtime.getPlugin(pluginId)),
      });
    } catch {
      /* plugin fermé entre list et get */
    }
  }
}

export function createBrandAdminDatabaseRoutes(opts: {
  runtime: SqliteRuntime;
  brandId: string;
}): Hono {
  registerRuntimeDatabaseStores(opts.runtime);
  return createAdminDatabaseRoutes({
    getDb: () => asSqliteDatabase(opts.runtime.getBrand()),
    getWriteDb: () => asSqliteDatabase(opts.runtime.getBrand()),
    defaultStoreId: "brand",
    webhookTestSource: `${opts.brandId}-database`,
    getActor: (c) => {
      const session = c.get("session") as
        | { email?: string; sub?: string; userId?: string }
        | undefined;
      return (
        session?.email ||
        session?.sub ||
        session?.userId ||
        "owner"
      );
    },
  });
}

/** Chemins proxy HTTP kernel → surface admin Database. */
export function adminDatabaseHandlesPath(pathname: string): boolean {
  return pathname.startsWith("/api/v1/admin/database");
}
