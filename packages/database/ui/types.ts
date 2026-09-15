export type CatalogEntry = {
  name: string;
  sql: string | null;
  rowCount: number;
  kind: "table" | "view";
  group: "metier" | "systeme" | "vues";
  system: boolean;
};

export type TableDetail = {
  table: {
    name: string;
    sql: string | null;
    kind: "table" | "view";
    columns: Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }>;
    foreignKeys: Array<Record<string, unknown>>;
    indexes: Array<Record<string, unknown>>;
    system: boolean;
    canCrud: boolean;
    canAutomate: boolean;
  };
  columns: string[];
  rows: Array<Record<string, unknown>>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
  sort: string | null;
  sortDir: "asc" | "desc";
};

export type Automation = {
  id: string;
  tableName: string;
  name: string;
  enabled: boolean;
  triggerType: "row_added" | "row_updated" | "row_deleted" | "button_pressed";
  watchColumns: string[] | null;
  conditions: {
    op: "and" | "or";
    rules: Array<Record<string, unknown>>;
  };
  actions: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
};

export type SavedView = {
  id: string;
  tableName: string;
  name: string;
  config: {
    sort?: string;
    sortDir?: "asc" | "desc";
    q?: string;
    columns?: string[];
    filters?: Array<{ column: string; op: string; value?: string }>;
  };
  createdAt: string;
  updatedAt: string;
};

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function columnTypeLabel(type: string): string {
  const t = (type || "ANY").toUpperCase();
  if (t.includes("INT")) return "number";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "number";
  if (t.includes("BOOL")) return "checkbox";
  if (t.includes("DATE") || t.includes("TIME")) return "date";
  if (t.includes("BLOB")) return "file";
  return "text";
}
