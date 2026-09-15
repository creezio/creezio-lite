/**
 * Moteur CRUD déclaratif « entity mounts » — un `ApiMount` complet généré
 * depuis un `EntitySpec` (table + colonnes + hooks métier).
 *
 * Le kit fournit le moteur (routes, SQL paramétré, pagination, validations),
 * la marque fournit le schéma (specs) et le métier (hooks/extraRoutes).
 *
 * Routes générées pour un mount `/api/v1/modules/<id>` :
 * - `GET    /`            liste (`q`, `archived`, filtres égalité, `limit`, `offset`,
 *                         `ids` = hydratation par PK). Si un index Meili est
 *                         configuré (`configureEntityMeili`) et que les filtres
 *                         sont exprimables → Meili, **y compris q vide**.
 *                         Meili = core fail-closed : entité indexée + Meili KO
 *                         → **503 `meili_unavailable`** (ou `engine:"indexing"`
 *                         pendant l'indexation initiale) — zéro LIKE SQL de
 *                         secours. SQL reste légitime hors index seulement
 *                         (entité non indexée, filtre hors index visible,
 *                         `?ids=`, archives) ou avec `CREEZIO_ALLOW_NO_MEILI=1`
 *                         (dev/tests hors-browse, fallback SQL visible).
 * - `POST   /`            création (colonnes déclarées uniquement)
 * - `GET    /:id`         lecture (hook `afterRead` pour enrichissement)
 * - `PATCH  /:id`         merge partiel (colonnes déclarées uniquement)
 * - `DELETE /:id`         suppression (400 `use_archive` si soft-delete only)
 * - `POST   /:id/archive` archivage (si `archivable`)
 * - tout autre subPath    → `extraRoutes` (fallback métier) sinon 404
 *
 * Sécurité : identifiants table/colonne validés `[a-z_][a-z0-9_]*` à la
 * création du mount ; toutes les valeurs passent en paramètres SQL liés.
 */

import { randomUUID } from "node:crypto";
import type { ScopedDbAccess } from "./db-scope.js";
import type {
  ApiHandlerContext,
  ApiMount,
  ApiRequest,
  ApiResponse,
  ModuleOperation,
} from "./types.js";
import type { ApiKernel } from "./kernel.js";
import {
  browseMeiliIndexOutcome,
  getEntityMeiliConfig,
  hydrateRowsByIds,
  meiliFilterEq,
  type MeiliBrowseOutcome,
} from "./meili-browse.js";

/* ── Contrat public ─────────────────────────────────────────────────────── */

export type EntityColumnType = "string" | "number" | "boolean" | "date";

export type EntityColumnSpec = {
  /** Nom de colonne SQL — validé `[a-z_][a-z0-9_]*`. */
  name: string;
  /** POST : 400 `<name>_required` si absent/vide. */
  required?: boolean;
  type?: EntityColumnType;
  /** POST/PATCH : 400 `<name>_invalide` si valeur hors liste. */
  enum?: readonly string[];
  /** Participe au filtre `?q=` (LIKE SQL, insensible à la casse). */
  searchable?: boolean;
  /** Filtre égalité `?<name>=<val>` sur la liste. */
  filterable?: boolean;
};

/** Contexte handler avec DB garantie (le moteur répond 503 sinon). */
export type EntityHookContext = ApiHandlerContext & { db: ScopedDbAccess };

/** Header HTTP → bus client `creezio:data-changed` (voir @creezio/shell-ui). */
export const CREEZIO_DATA_CHANGED_HEADER = "x-creezio-data-changed";

export type EntityHooks = {
  /**
   * Avant INSERT — `row` est mutable (coercions, colonnes dérivées,
   * écritures annexes via `ctx.db`). Retourner une `ApiResponse` rejette.
   */
  beforeCreate?(
    row: Record<string, unknown>,
    ctx: EntityHookContext,
  ): void | ApiResponse | Promise<void | ApiResponse>;
  /**
   * Avant UPDATE — `patch` (colonnes déclarées uniquement) est mutable.
   * Retourner une `ApiResponse` rejette.
   */
  beforeUpdate?(
    patch: Record<string, unknown>,
    existing: Record<string, unknown>,
    ctx: EntityHookContext,
  ): void | ApiResponse | Promise<void | ApiResponse>;
  /** GET :id — retourne le body enrichi (défaut : la row brute). */
  afterRead?(
    row: Record<string, unknown>,
    ctx: EntityHookContext,
  ):
    | Record<string, unknown>
    | undefined
    | Promise<Record<string, unknown> | undefined>;
  /**
   * GET liste — retourne le body complet (remplace `{ items, total }`).
   * `undefined` ⇒ payload standard.
   */
  afterList?(
    rows: Array<Record<string, unknown>>,
    ctx: EntityHookContext,
  ): unknown | Promise<unknown>;
  /** Après INSERT réussi (side-effects métier ; le header data-changed est déjà posé). */
  afterCreate?(
    row: Record<string, unknown>,
    ctx: EntityHookContext,
  ): void | Promise<void>;
  /** Après UPDATE réussi. */
  afterUpdate?(
    row: Record<string, unknown>,
    ctx: EntityHookContext,
  ): void | Promise<void>;
  /** Après DELETE réussi. */
  afterDelete?(
    row: Record<string, unknown>,
    ctx: EntityHookContext,
  ): void | Promise<void>;
  /** Après archive réussi. */
  afterArchive?(
    row: Record<string, unknown>,
    ctx: EntityHookContext,
  ): void | Promise<void>;
};

export type EntitySpec = {
  /** Table SQL (couche brand) — validée `[a-z_][a-z0-9_]*`. */
  table: string;
  /**
   * Resource pour le bus UI `creezio:data-changed` (header HTTP).
   * Défaut = `table`. Les pages liste déclarent la même resource via
   * `useCreezioResource(resource)`.
   */
  resource?: string;
  /**
   * Colonnes métier. `id`, `created_at`, `updated_at` (+ `archived_at` si
   * `archivable`) sont implicites — inutile de les déclarer.
   */
  columns: EntityColumnSpec[];
  /** POST :id/archive + filtre liste `?archived=0|1` (défaut 0). */
  archivable?: boolean;
  /** DELETE → 400 `use_archive` (défaut = `archivable`). */
  softDeleteOnly?: boolean;
  /** Plafond de liste sans `?limit=` explicite (grosses tables). */
  defaultLimit?: number;
  /** `ORDER BY` de la liste — `<colonne> [ASC|DESC]` validé. */
  orderBy?: string;
  hooks?: EntityHooks;
  /**
   * Permission requise pour le mount CRUD généré (threadée sur
   * `ApiMount.permission`, garde `authorizeModuleAccess`).
   */
  permission?: string;
  /** Justification explicite si pas de `permission` (voir `ApiMount`). */
  accessJustification?: string;
  /** Fallback pour les subPaths métier non couverts par le moteur. */
  extraRoutes?: ApiMount["handle"];
  /**
   * Ops hors CRUD (extraRoutes). Le moteur ajoute list/get/create/update/delete
   * (+ archive si `archivable`) — ne pas re-déclarer le CRUD.
   */
  operations?: ModuleOperation[];
};

/** CRUD auto d'un EntitySpec + extras `spec.operations` (hors ids CRUD). */
export function operationsFromEntitySpec(spec: EntitySpec): ModuleOperation[] {
  const table = spec.table;
  const crud: ModuleOperation[] = [
    { id: "list", method: "GET", path: "/", description: `Lister ${table}` },
    { id: "create", method: "POST", path: "/", description: `Créer ${table}` },
    { id: "get", method: "GET", path: "/:id", description: `Lire ${table}` },
    {
      id: "update",
      method: "PATCH",
      path: "/:id",
      description: `Mettre à jour ${table}`,
    },
    {
      id: "delete",
      method: "DELETE",
      path: "/:id",
      description: `Supprimer ${table}`,
    },
  ];
  if (spec.archivable) {
    crud.push({
      id: "archive",
      method: "POST",
      path: "/:id/archive",
      description: `Archiver ${table}`,
    });
  }
  const seen = new Set(crud.map((op) => op.id));
  const extras: ModuleOperation[] = [];
  for (const extra of spec.operations ?? []) {
    if (seen.has(extra.id)) continue;
    extras.push(extra);
    seen.add(extra.id);
  }
  return [...crud, ...extras];
}

/** Alias conservé — préférer `operationsFromEntitySpec`. */
export const entityOperationsFromSpec = operationsFromEntitySpec;

/* ── Validation d'identifiants SQL ──────────────────────────────────────── */

const SQL_IDENT_RE = /^[a-z_][a-z0-9_]*$/;
const ORDER_BY_RE = /^[a-z_][a-z0-9_]*(\s+(?:asc|desc))?$/i;

function assertSqlIdent(name: string, kind: string): void {
  if (!SQL_IDENT_RE.test(name)) {
    throw new Error(
      `entity ${kind} invalide: "${name}" (attendu [a-z_][a-z0-9_]*)`,
    );
  }
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function now(): string {
  return new Date().toISOString();
}

function qstr(req: ApiRequest, key: string): string {
  const v = req.query?.[key];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return v == null ? "" : String(v);
}

function escapeLike(needle: string): string {
  return needle.replace(/([\\%_])/g, "\\$1");
}

/**
 * `lower()` SQLite ne replie que l'ASCII — on replie aussi les majuscules
 * accentuées latines courantes pour rester aligné sur `toLowerCase()` JS
 * (le needle est replié côté JS).
 */
const ACCENT_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ["À", "à"], ["Â", "â"], ["Ä", "ä"], ["Ç", "ç"], ["É", "é"], ["È", "è"],
  ["Ê", "ê"], ["Ë", "ë"], ["Î", "î"], ["Ï", "ï"], ["Ô", "ô"], ["Ö", "ö"],
  ["Ù", "ù"], ["Û", "û"], ["Ü", "ü"], ["Œ", "œ"], ["Æ", "æ"],
];

function foldedLowerSql(column: string): string {
  let expr = column;
  for (const [up, low] of ACCENT_FOLDS) {
    expr = `replace(${expr}, '${up}', '${low}')`;
  }
  return `lower(${expr})`;
}

function isTruthyFlag(v: string): boolean {
  return v === "1" || v === "true";
}

/**
 * Indexation initiale en cours / jamais aboutie : marqueur posé par
 * l'indexeur kit (`meta.meili_index_in_progress`) ou fingerprint jamais
 * écrit. Sert à répondre `engine:"indexing"` (le client réessaie) au lieu
 * d'un 503 pendant la fenêtre de première indexation.
 */
function meiliIndexingInProgress(db: {
  prepare(sql: string): { get(...args: unknown[]): unknown };
}): boolean {
  try {
    const hasMeta = db
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='meta'",
      )
      .get() as { c: number } | undefined;
    if (!hasMeta || Number(hasMeta.c) === 0) return true;
    const inProgress = db
      .prepare("SELECT value FROM meta WHERE key='meili_index_in_progress'")
      .get();
    if (inProgress) return true;
    const fingerprint = db
      .prepare("SELECT value FROM meta WHERE key='meili_index_fingerprint'")
      .get();
    return !fingerprint;
  } catch {
    return false;
  }
}

function isFalsyFlag(v: string): boolean {
  return v === "0" || v === "false";
}

/* ── Moteur ─────────────────────────────────────────────────────────────── */

export function createEntityApiMount(spec: EntitySpec): ApiMount {
  assertSqlIdent(spec.table, "table");
  for (const col of spec.columns) {
    assertSqlIdent(col.name, "column");
  }
  if (spec.orderBy !== undefined && !ORDER_BY_RE.test(spec.orderBy.trim())) {
    throw new Error(
      `entity orderBy invalide: "${spec.orderBy}" (attendu "<colonne> [ASC|DESC]")`,
    );
  }

  const table = spec.table;
  const resource = (spec.resource || spec.table).trim() || spec.table;
  const archivable = spec.archivable === true;
  const softDeleteOnly = spec.softDeleteOnly ?? archivable;
  const orderBy = spec.orderBy?.trim();
  const hooks = spec.hooks ?? {};

  function withDataChanged(res: ApiResponse): ApiResponse {
    if (res.status < 200 || res.status >= 300) return res;
    return {
      ...res,
      headers: {
        ...(res.headers || {}),
        [CREEZIO_DATA_CHANGED_HEADER]: resource,
      },
    };
  }

  const baseColumns = ["id", "created_at", "updated_at"];
  if (archivable) baseColumns.push("archived_at");
  const allowed = new Set<string>([
    ...baseColumns,
    ...spec.columns.map((c) => c.name),
  ]);
  const searchable = spec.columns.filter((c) => c.searchable);
  const filterable = spec.columns.filter((c) => c.filterable);
  const enums = spec.columns.filter((c) => c.enum && c.enum.length > 0);

  function selectById(db: ScopedDbAccess, id: string) {
    return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
  }

  function validateEnums(body: Record<string, unknown>): ApiResponse | null {
    for (const col of enums) {
      const v = body[col.name];
      if (v != null && !col.enum!.includes(String(v))) {
        return { status: 400, body: { error: `${col.name}_invalide` } };
      }
    }
    return null;
  }

  function buildListWhere(req: ApiRequest): { where: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (archivable) {
      const archived = qstr(req, "archived") || "0";
      if (archived === "0") {
        clauses.push(`(archived_at IS NULL OR archived_at = '')`);
      } else if (archived === "1") {
        clauses.push(`(archived_at IS NOT NULL AND archived_at <> '')`);
      }
    }

    const q = qstr(req, "q").trim().toLowerCase();
    if (q && searchable.length > 0) {
      const like = `%${escapeLike(q)}%`;
      const ors = searchable.map(
        (c) => `${foldedLowerSql(c.name)} LIKE ? ESCAPE '\\'`,
      );
      clauses.push(`(${ors.join(" OR ")})`);
      for (let i = 0; i < searchable.length; i++) params.push(like);
    }

    for (const col of filterable) {
      const raw = qstr(req, col.name);
      if (!raw) continue;
      if (col.type === "boolean") {
        if (isTruthyFlag(raw)) {
          clauses.push(
            `(${col.name} IS NOT NULL AND ${col.name} != 0 AND ${col.name} != '')`,
          );
        } else if (isFalsyFlag(raw)) {
          clauses.push(
            `(${col.name} IS NULL OR ${col.name} = 0 OR ${col.name} = '')`,
          );
        }
        continue;
      }
      if (col.type === "number") {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        clauses.push(`${col.name} = ?`);
        params.push(n);
        continue;
      }
      clauses.push(`${col.name} = ?`);
      params.push(raw);
    }

    return {
      where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
      params,
    };
  }

  async function listFromSql(
    ctx: EntityHookContext,
    extras?: { engine?: string; fallback?: string },
  ): Promise<ApiResponse> {
    const { req, db } = ctx;
    const { where, params } = buildListWhere(req);

    const total = (
      db.prepare(`SELECT COUNT(*) AS c FROM ${table}${where}`).get(...params) as {
        c: number;
      }
    ).c;

    const limitRaw = Number(qstr(req, "limit") || "");
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.trunc(limitRaw)
        : spec.defaultLimit ?? null;
    const offsetRaw = Number(qstr(req, "offset") || "");
    const offset =
      Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.trunc(offsetRaw) : 0;

    let sql = `SELECT * FROM ${table}${where}`;
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    const sqlParams = [...params];
    if (limit != null || offset > 0) {
      sql += ` LIMIT ? OFFSET ?`;
      sqlParams.push(limit ?? -1, offset);
    }
    const rows = db.prepare(sql).all(...sqlParams) as Array<
      Record<string, unknown>
    >;

    if (hooks.afterList) {
      const body = await hooks.afterList(rows, ctx);
      if (body !== undefined) return { status: 200, body };
    }
    return {
      status: 200,
      body: {
        items: rows,
        total,
        ...(extras?.engine ? { engine: extras.engine } : {}),
        ...(extras?.fallback ? { fallback: extras.fallback } : {}),
      },
    };
  }

  async function handleList(ctx: EntityHookContext): Promise<ApiResponse> {
    const { req, db } = ctx;
    const idsRaw = qstr(req, "ids").trim();
    if (idsRaw) {
      const ids = idsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 200);
      const rows = hydrateRowsByIds(db, table, ids);
      if (hooks.afterList) {
        const body = await hooks.afterList(rows, ctx);
        if (body !== undefined) return { status: 200, body };
      }
      return { status: 200, body: { items: rows, total: rows.length } };
    }

    const meiliCfg = getEntityMeiliConfig();
    const binding = meiliCfg?.indexes[table];
    const archived = archivable ? qstr(req, "archived") || "0" : "0";
    if (binding && archived !== "1") {
      const inexpressible: string[] = [];
      for (const col of filterable) {
        const raw = qstr(req, col.name);
        if (!raw) continue;
        const meiliAttr = binding.filterMap?.[col.name] ?? col.name;
        if (!binding.filterable.includes(meiliAttr)) {
          inexpressible.push(col.name);
        }
      }
      if (inexpressible.length > 0) {
        return listFromSql(ctx, {
          engine: "sql",
          fallback: "filter_not_indexable",
        });
      }

      const filters: string[] = [];
      for (const col of filterable) {
        const raw = qstr(req, col.name);
        if (!raw) continue;
        const meiliAttr = binding.filterMap?.[col.name] ?? col.name;
        filters.push(meiliFilterEq(meiliAttr, raw));
      }

      const limitRaw = Number(qstr(req, "limit") || "");
      const limit =
        Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.trunc(limitRaw)
          : spec.defaultLimit ?? 50;
      const offsetRaw = Number(qstr(req, "offset") || "");
      const offset =
        Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.trunc(offsetRaw) : 0;
      const hitsPerPage = Math.min(Math.max(limit, 1), 200);
      const page = Math.floor(offset / hitsPerPage) + 1;
      const host =
        meiliCfg?.host || process.env.MEILI_HOST || "";
      const apiKey =
        meiliCfg?.apiKey ||
        process.env.MEILI_API_KEY ||
        process.env.MEILI_MASTER_KEY ||
        "";
      const browseReq = {
        host,
        apiKey,
        indexUid: binding.indexUid,
        query: qstr(req, "q").trim(),
        filters,
        page,
        hitsPerPage,
        attributesToRetrieve: ["id"],
        facets: binding.facets,
      };
      let outcome: MeiliBrowseOutcome;
      if (meiliCfg?.browse) {
        // Override tests : null = incident (indistinguable → fail-closed).
        const r = await meiliCfg.browse(browseReq);
        outcome = r
          ? { kind: "ok", result: r }
          : { kind: "unavailable", reason: "browse_override_null" };
      } else {
        outcome = await browseMeiliIndexOutcome(browseReq);
      }

      const indexingResponse = (): ApiResponse => ({
        status: 200,
        body: { items: [], total: 0, engine: "indexing" },
      });

      if (outcome.kind === "ok") {
        // 0 hit sur un index peuplé = succès Meili (jamais un fallback).
        const meili = outcome.result;
        const hitIds = meili.hits
          .map((h) => String(h.id ?? "").trim())
          .filter(Boolean);
        const rows = hydrateRowsByIds(db, table, hitIds);
        if (hooks.afterList) {
          const body = await hooks.afterList(rows, ctx);
          if (body !== undefined) return { status: 200, body };
        }
        return {
          status: 200,
          body: {
            items: rows,
            total: meili.total,
            engine: "meili",
            ...(meili.facetDistribution
              ? { facetDistribution: meili.facetDistribution }
              : {}),
          },
        };
      }

      // Cas hors index légitime : filtre déclaré filterable côté binding
      // mais rejeté par l'index réel (drift settings) → SQL VISIBLE.
      if (outcome.kind === "filter_rejected") {
        return listFromSql(ctx, {
          engine: "sql",
          fallback: "filter_rejected",
        });
      }

      // Index vide ou absent pendant l'indexation initiale → état explicite,
      // le client réessaie (jamais de LIKE SQL de secours).
      if (
        (outcome.kind === "empty_index" || outcome.kind === "index_missing") &&
        meiliIndexingInProgress(db)
      ) {
        return indexingResponse();
      }
      // Index peuplé côté fingerprint mais 0 doc (catalogue réellement
      // vide) : succès Meili — liste vide.
      if (outcome.kind === "empty_index") {
        if (hooks.afterList) {
          const body = await hooks.afterList([], ctx);
          if (body !== undefined) return { status: 200, body };
        }
        return {
          status: 200,
          body: { items: [], total: 0, engine: "meili" },
        };
      }

      // Meili core fail-closed : incident (down / index jamais créé /
      // non configuré) sur une entité indexée = erreur visible, PAS de
      // LIKE SQL. Échappatoire dev/tests hors-browse : CREEZIO_ALLOW_NO_MEILI=1.
      if (process.env.CREEZIO_ALLOW_NO_MEILI === "1") {
        return listFromSql(ctx, {
          engine: "sql",
          fallback: host ? "meili_unavailable" : "meili_unconfigured",
        });
      }
      return {
        status: 503,
        body: {
          error: "meili_unavailable",
          index: binding.indexUid,
          reason:
            outcome.kind === "unavailable" ? outcome.reason : outcome.kind,
        },
      };
    }

    return listFromSql(ctx);
  }

  async function handleCreate(ctx: EntityHookContext): Promise<ApiResponse> {
    const { req, db } = ctx;
    const body = (req.body || {}) as Record<string, unknown>;

    for (const col of spec.columns) {
      if (!col.required) continue;
      const v = body[col.name];
      const missing =
        col.type === "number" || col.type === "boolean"
          ? v == null
          : !String(v || "").trim();
      if (missing) {
        return { status: 400, body: { error: `${col.name}_required` } };
      }
    }
    const enumErr = validateEnums(body);
    if (enumErr) return enumErr;

    const id = String(body.id || randomUUID());
    const row: Record<string, unknown> = {
      id,
      created_at: now(),
      updated_at: now(),
    };
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k) && k !== "id" && k !== "created_at") row[k] = v;
    }
    if (archivable && row.archived_at === undefined) {
      row.archived_at = null;
    }

    if (hooks.beforeCreate) {
      const rejected = await hooks.beforeCreate(row, ctx);
      if (rejected) return rejected;
    }

    const cols = Object.keys(row).filter((c) => allowed.has(c));
    db.prepare(
      `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols
        .map(() => "?")
        .join(",")})`,
    ).run(...cols.map((c) => row[c]));
    const created = selectById(db, String(row.id ?? id)) || row;
    if (hooks.afterCreate) await hooks.afterCreate(created, ctx);
    return withDataChanged({ status: 201, body: created });
  }

  async function handleRead(
    ctx: EntityHookContext,
    id: string,
  ): Promise<ApiResponse> {
    const row = selectById(ctx.db, id);
    if (!row) return { status: 404, body: { error: "not_found" } };
    if (hooks.afterRead) {
      const body = await hooks.afterRead(row, ctx);
      return { status: 200, body: body ?? row };
    }
    return { status: 200, body: row };
  }

  async function handlePatch(
    ctx: EntityHookContext,
    id: string,
  ): Promise<ApiResponse> {
    const { req, db } = ctx;
    const body = (req.body || {}) as Record<string, unknown>;

    // Parité mount historique : enums validées avant le check d'existence.
    const enumErr = validateEnums(body);
    if (enumErr) return enumErr;

    const existing = selectById(db, id);
    if (!existing) return { status: 404, body: { error: "not_found" } };

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k) && k !== "id") patch[k] = v;
    }

    if (hooks.beforeUpdate) {
      const rejected = await hooks.beforeUpdate(patch, existing, ctx);
      if (rejected) return rejected;
    }

    const next: Record<string, unknown> = {
      ...existing,
      ...patch,
      id,
      updated_at: now(),
    };
    // Uniquement les colonnes déclarées (+ timestamps) — SELECT * peut
    // exposer des VIRTUAL/GENERATED (alias brand) qu'il ne faut pas UPDATE.
    const cols = Object.keys(next).filter((k) => k !== "id" && allowed.has(k));
    db.prepare(
      `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
    ).run(...cols.map((c) => next[c]), id);
    const updated = selectById(db, id) || next;
    if (hooks.afterUpdate) await hooks.afterUpdate(updated, ctx);
    return withDataChanged({ status: 200, body: updated });
  }

  async function handleDelete(
    ctx: EntityHookContext,
    id: string,
  ): Promise<ApiResponse> {
    if (softDeleteOnly) {
      return { status: 400, body: { error: "use_archive" } };
    }
    const existing = selectById(ctx.db, id);
    if (!existing) return { status: 404, body: { error: "not_found" } };
    ctx.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    if (hooks.afterDelete) await hooks.afterDelete(existing, ctx);
    return withDataChanged({ status: 200, body: existing });
  }

  async function handleArchive(
    ctx: EntityHookContext,
    id: string,
  ): Promise<ApiResponse> {
    if (!archivable) {
      return { status: 400, body: { error: "not_archivable" } };
    }
    const row = selectById(ctx.db, id);
    if (!row) return { status: 404, body: { error: "not_found" } };
    const ts = now();
    ctx.db
      .prepare(`UPDATE ${table} SET archived_at = ?, updated_at = ? WHERE id = ?`)
      .run(ts, ts, id);
    const archived = selectById(ctx.db, id) || { ...row, archived_at: ts };
    if (hooks.afterArchive) await hooks.afterArchive(archived, ctx);
    return withDataChanged({ status: 200, body: archived });
  }

  return {
    dbLayer: "brand",
    ...(spec.permission ? { permission: spec.permission } : {}),
    ...(spec.accessJustification
      ? { accessJustification: spec.accessJustification }
      : {}),
    operations: operationsFromEntitySpec(spec),
    handle: async (ctx) => {
      if (!ctx.db) return { status: 503, body: { error: "db_unavailable" } };
      const hctx = ctx as EntityHookContext;
      const method = ctx.req.method.toUpperCase();
      const parts = ctx.subPath.split("/").filter(Boolean);

      if (parts.length === 2 && parts[1] === "archive" && method === "POST") {
        return handleArchive(hctx, parts[0]!);
      }
      if (parts.length === 1) {
        const id = parts[0]!;
        if (method === "GET") return handleRead(hctx, id);
        if (method === "PATCH") return handlePatch(hctx, id);
        if (method === "DELETE") return handleDelete(hctx, id);
      }
      if (parts.length === 0 && method === "GET") return handleList(hctx);
      if (parts.length === 0 && method === "POST") return handleCreate(hctx);

      if (spec.extraRoutes) {
        return spec.extraRoutes(ctx);
      }
      return { status: 404, body: { error: "not_found", subPath: ctx.subPath } };
    },
  };
}

/** Enregistre un lot d'entités : mount id → spec. */
export function registerEntityMounts(
  api: ApiKernel,
  specs: Record<string, EntitySpec>,
): void {
  for (const [id, spec] of Object.entries(specs)) {
    api.registerModuleApi(id, createEntityApiMount(spec));
  }
}
