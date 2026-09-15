/**
 * Registre des stores SQLite exposés à l'Admin Database.
 *
 * Les marques factory / `createBrandKernel` enregistrent au moins `core` +
 * `brand` au boot ; les plugins ouverts peuvent s'ajouter ensuite.
 */
import type { SqliteDatabase } from "./sqlite-driver.js";

export type DatabaseStoreLayer = "core" | "brand" | "plugin";

export type DatabaseStoreDef = {
  id: string;
  label: string;
  layer: DatabaseStoreLayer;
  getDb: () => SqliteDatabase;
  getWriteDb?: () => SqliteDatabase;
  /** Chemin fichier (info UI / diagnostics). */
  path?: string;
};

export type DatabaseStoreInfo = {
  id: string;
  label: string;
  layer: DatabaseStoreLayer;
  path?: string;
};

const stores = new Map<string, DatabaseStoreDef>();

export function clearDatabaseStores(): void {
  stores.clear();
}

export function registerDatabaseStore(def: DatabaseStoreDef): void {
  const id = String(def.id || "").trim();
  if (!id) throw new Error("registerDatabaseStore: id requis");
  stores.set(id, { ...def, id });
}

export function unregisterDatabaseStore(id: string): boolean {
  return stores.delete(id);
}

export function getDatabaseStore(id: string): DatabaseStoreDef | undefined {
  return stores.get(id);
}

export function listDatabaseStores(): DatabaseStoreInfo[] {
  return [...stores.values()]
    .map((s) => ({
      id: s.id,
      label: s.label,
      layer: s.layer,
      path: s.path,
    }))
    .sort((a, b) => {
      const order = { brand: 0, core: 1, plugin: 2 } as const;
      const d = (order[a.layer] ?? 9) - (order[b.layer] ?? 9);
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
}

export function resolveDatabaseStore(opts: {
  requestedId?: string | null;
  defaultStoreId?: string;
  fallbackGetDb: () => SqliteDatabase;
  fallbackGetWriteDb: () => SqliteDatabase;
}): {
  id: string;
  getDb: () => SqliteDatabase;
  getWriteDb: () => SqliteDatabase;
} | null {
  const registered = listDatabaseStores();
  if (registered.length === 0) {
    return {
      id: opts.defaultStoreId || "default",
      getDb: opts.fallbackGetDb,
      getWriteDb: opts.fallbackGetWriteDb,
    };
  }

  const preferred =
    (opts.requestedId || "").trim() ||
    opts.defaultStoreId ||
    registered.find((s) => s.id === "brand")?.id ||
    registered[0]?.id;
  if (!preferred) return null;

  const store = getDatabaseStore(preferred);
  if (!store) return null;
  return {
    id: store.id,
    getDb: store.getDb,
    getWriteDb: store.getWriteDb ?? store.getDb,
  };
}
