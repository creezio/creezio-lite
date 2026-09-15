#!/usr/bin/env node
/**
 * Gate entity mounts — moteur CRUD déclaratif `@creezio/api-kernel`
 * (`createEntityApiMount` / `registerEntityMounts`).
 *
 * Couvre : CRUD complet, archive, validations required/enum, pagination SQL
 * (limit/offset + total COUNT), filtre `q` (LIKE + repli accents), filtres
 * égalité, hooks (beforeCreate mutant + rejetant, beforeUpdate, afterRead,
 * afterList, extraRoutes), rejet d'identifiants SQL invalides, et
 * non-régression du deny cross-write H2.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { demobrandManifest } from "../packages/brand-config/dist/index.js";
import {
  composeMigrations,
  createSqliteRuntime,
} from "../packages/platform-core/dist/index.js";
import {
  configureEntityMeili,
  createApiKernel,
  createEntityApiMount,
  registerEntityMounts,
  resetEntityMeiliForTests,
} from "../packages/api-kernel/dist/index.js";

const BRAND_SQL = `
CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  nom TEXT,
  label TEXT,
  group_id TEXT,
  statut TEXT,
  actif INTEGER,
  derived TEXT
);
CREATE TABLE IF NOT EXISTS readings (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  valeur REAL,
  widget_id TEXT
);
`;

const WIDGET_SPEC = {
  table: "widgets",
  archivable: true,
  columns: [
    { name: "nom", required: true, searchable: true },
    { name: "label", searchable: true },
    { name: "group_id", filterable: true },
    { name: "statut", enum: ["actif", "inactif", "test"] },
    { name: "actif", type: "boolean", filterable: true },
    { name: "derived" },
  ],
};

function makeHarness({ specs, runtime: withRuntime = true } = {}) {
  const userDataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "creezio-entity-mount-"),
  );
  const ctx = { manifest: demobrandManifest, userDataRoot, isPackaged: true };
  const runtime = withRuntime
    ? createSqliteRuntime({
        ctx,
        coreMigrations: composeMigrations(),
        brandMigrations: composeMigrations({
          id: "entity_mount_brand_001",
          sql: BRAND_SQL,
        }),
      })
    : undefined;
  const api = createApiKernel({ brandId: "demobrand", sqliteRuntime: runtime });
  registerEntityMounts(api, specs ?? { widgets: WIDGET_SPEC });
  const call = (method, mountPath, { body, query } = {}) =>
    api.handle({
      method,
      path: `/api/v1/modules/${mountPath}`,
      body,
      query,
    });
  return { api, runtime, call, close: () => runtime?.close() };
}

test("entity-mount rejette les identifiants SQL invalides", () => {
  assert.throws(
    () => createEntityApiMount({ table: "widgets; DROP TABLE x", columns: [] }),
    /entity table invalide/,
  );
  assert.throws(
    () => createEntityApiMount({ table: "Widgets", columns: [] }),
    /entity table invalide/,
  );
  assert.throws(
    () =>
      createEntityApiMount({
        table: "widgets",
        columns: [{ name: "nom = 'x' WHERE 1=1 --" }],
      }),
    /entity column invalide/,
  );
  assert.throws(
    () =>
      createEntityApiMount({
        table: "widgets",
        columns: [],
        orderBy: "nom; DROP TABLE widgets",
      }),
    /entity orderBy invalide/,
  );
  // Formes valides
  createEntityApiMount({ table: "widgets", columns: [{ name: "nom" }] });
  createEntityApiMount({ table: "widgets", columns: [], orderBy: "nom DESC" });
});

test("entity-mount CRUD auto → operations[] (list/get/create/update/delete/archive)", () => {
  const mount = createEntityApiMount(WIDGET_SPEC);
  const ids = (mount.operations || []).map((op) => op.id);
  assert.deepEqual(ids, ["list", "create", "get", "update", "delete", "archive"]);
  assert.equal(mount.operations.find((op) => op.id === "list")?.method, "GET");
  assert.equal(mount.operations.find((op) => op.id === "get")?.path, "/:id");
});

test("entity-mount CRUD complet + colonnes non déclarées ignorées", async () => {
  const h = makeHarness();
  try {
    const created = await h.call("POST", "widgets", {
      body: { nom: "Alpha", label: "premier", hack_col: "ignore-moi" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.nom, "Alpha");
    assert.equal(created.body.archived_at, null);
    assert.ok(created.body.id);
    assert.ok(created.body.created_at);
    assert.equal("hack_col" in created.body, false);
    assert.equal(
      created.headers?.["x-creezio-data-changed"],
      "widgets",
      "POST émet le header data-changed (resource=table)",
    );

    const id = created.body.id;
    const read = await h.call("GET", `widgets/${id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.label, "premier");

    const missing = await h.call("GET", "widgets/nope");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, "not_found");

    const patched = await h.call("PATCH", `widgets/${id}`, {
      body: { label: "modifié", hack_col: "ignore-moi" },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.label, "modifié");
    assert.equal(patched.body.nom, "Alpha"); // merge partiel
    assert.notEqual(patched.body.updated_at, created.body.updated_at);
    assert.equal("hack_col" in patched.body, false);

    const patchMissing = await h.call("PATCH", "widgets/nope", {
      body: { label: "x" },
    });
    assert.equal(patchMissing.status, 404);

    // widgets est archivable ⇒ soft-delete only par défaut
    const del = await h.call("DELETE", `widgets/${id}`);
    assert.equal(del.status, 400);
    assert.equal(del.body.error, "use_archive");
  } finally {
    h.close();
  }
});

test("entity-mount PATCH ignore les colonnes GENERATED/VIRTUAL (SELECT *)", async () => {
  const userDataRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "creezio-entity-gen-"),
  );
  const ctx = { manifest: demobrandManifest, userDataRoot, isPackaged: true };
  const runtime = createSqliteRuntime({
    ctx,
    coreMigrations: composeMigrations(),
    brandMigrations: composeMigrations({
      id: "entity_mount_generated_001",
      sql: `
CREATE TABLE IF NOT EXISTS alias_rows (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  statut TEXT,
  cree_le TEXT GENERATED ALWAYS AS (created_at) VIRTUAL,
  modifie_le TEXT GENERATED ALWAYS AS (updated_at) VIRTUAL
);
`,
    }),
  });
  const api = createApiKernel({ brandId: "demobrand", sqliteRuntime: runtime });
  registerEntityMounts(api, {
    alias_rows: {
      table: "alias_rows",
      columns: [{ name: "statut", enum: ["brouillon", "envoyee"] }],
    },
  });
  try {
    const created = await api.handle({
      method: "POST",
      path: "/api/v1/modules/alias_rows",
      body: { statut: "brouillon" },
    });
    assert.equal(created.status, 201);
    assert.ok(created.body.cree_le);
    assert.equal(created.body.cree_le, created.body.created_at);

    const patched = await api.handle({
      method: "PATCH",
      path: `/api/v1/modules/alias_rows/${created.body.id}`,
      body: { statut: "envoyee" },
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal(patched.body.statut, "envoyee");
    assert.equal(patched.body.cree_le, created.body.created_at);
    assert.equal(patched.body.modifie_le, patched.body.updated_at);
  } finally {
    runtime.close();
  }
});

test("entity-mount DELETE dur quand pas soft-delete only", async () => {
  const h = makeHarness({
    specs: {
      readings: {
        table: "readings",
        columns: [{ name: "valeur", type: "number" }, { name: "widget_id" }],
      },
    },
  });
  try {
    const created = await h.call("POST", "readings", { body: { valeur: 42 } });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const del = await h.call("DELETE", `readings/${id}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.id, id); // renvoie la row supprimée

    const after = await h.call("GET", `readings/${id}`);
    assert.equal(after.status, 404);

    const delMissing = await h.call("DELETE", "readings/nope");
    assert.equal(delMissing.status, 404);

    // Table non archivable : archive → 400 not_archivable
    const arch = await h.call("POST", `readings/${id}/archive`);
    assert.equal(arch.status, 400);
    assert.equal(arch.body.error, "not_archivable");
  } finally {
    h.close();
  }
});

test("entity-mount archive + filtre ?archived", async () => {
  const h = makeHarness();
  try {
    const a = (await h.call("POST", "widgets", { body: { nom: "Garde" } })).body;
    const b = (await h.call("POST", "widgets", { body: { nom: "Archive" } }))
      .body;

    const archived = await h.call("POST", `widgets/${b.id}/archive`);
    assert.equal(archived.status, 200);
    assert.ok(archived.body.archived_at);

    const archMissing = await h.call("POST", "widgets/nope/archive");
    assert.equal(archMissing.status, 404);

    const activeList = await h.call("GET", "widgets");
    assert.deepEqual(
      activeList.body.items.map((r) => r.id),
      [a.id],
    );
    assert.equal(activeList.body.total, 1);

    const archivedList = await h.call("GET", "widgets", {
      query: { archived: "1" },
    });
    assert.deepEqual(
      archivedList.body.items.map((r) => r.id),
      [b.id],
    );

    const allList = await h.call("GET", "widgets", {
      query: { archived: "all" },
    });
    assert.equal(allList.body.total, 2);
  } finally {
    h.close();
  }
});

test("entity-mount validations required + enum", async () => {
  const h = makeHarness();
  try {
    const noNom = await h.call("POST", "widgets", { body: { label: "x" } });
    assert.equal(noNom.status, 400);
    assert.equal(noNom.body.error, "nom_required");

    const blankNom = await h.call("POST", "widgets", { body: { nom: "   " } });
    assert.equal(blankNom.status, 400);
    assert.equal(blankNom.body.error, "nom_required");

    const badEnum = await h.call("POST", "widgets", {
      body: { nom: "X", statut: "zombie" },
    });
    assert.equal(badEnum.status, 400);
    assert.equal(badEnum.body.error, "statut_invalide");

    const ok = await h.call("POST", "widgets", {
      body: { nom: "X", statut: "actif" },
    });
    assert.equal(ok.status, 201);

    const badPatch = await h.call("PATCH", `widgets/${ok.body.id}`, {
      body: { statut: "zombie" },
    });
    assert.equal(badPatch.status, 400);
    assert.equal(badPatch.body.error, "statut_invalide");

    // Parité historique : enum validée avant le check d'existence.
    const badPatchMissing = await h.call("PATCH", "widgets/nope", {
      body: { statut: "zombie" },
    });
    assert.equal(badPatchMissing.status, 400);
    assert.equal(badPatchMissing.body.error, "statut_invalide");
  } finally {
    h.close();
  }
});

test("entity-mount pagination SQL : limit/offset + total COUNT(*)", async () => {
  const h = makeHarness({
    specs: {
      widgets: { ...WIDGET_SPEC, defaultLimit: 3, orderBy: "nom" },
    },
  });
  try {
    for (let i = 0; i < 10; i++) {
      await h.call("POST", "widgets", {
        body: { nom: `Widget-${String(i).padStart(2, "0")}` },
      });
    }

    const capped = await h.call("GET", "widgets");
    assert.equal(capped.body.items.length, 3); // defaultLimit
    assert.equal(capped.body.total, 10); // COUNT(*) complet

    const limited = await h.call("GET", "widgets", { query: { limit: "5" } });
    assert.equal(limited.body.items.length, 5);
    assert.equal(limited.body.total, 10);

    const page2 = await h.call("GET", "widgets", {
      query: { limit: "4", offset: "8" },
    });
    assert.equal(page2.body.items.length, 2);
    assert.equal(page2.body.total, 10);
    assert.deepEqual(
      page2.body.items.map((r) => r.nom),
      ["Widget-08", "Widget-09"],
    );
  } finally {
    h.close();
  }
});

test("entity-mount filtre q en SQL : casse, accents, échappement LIKE", async () => {
  const h = makeHarness();
  try {
    await h.call("POST", "widgets", { body: { nom: "Épicerie Fine" } });
    await h.call("POST", "widgets", {
      body: { nom: "Quincaillerie", label: "100% métal" },
    });

    const accent = await h.call("GET", "widgets", { query: { q: "épicerie" } });
    assert.equal(accent.body.total, 1);
    assert.equal(accent.body.items[0].nom, "Épicerie Fine");

    const caseFold = await h.call("GET", "widgets", { query: { q: "QUINCA" } });
    assert.equal(caseFold.body.total, 1);

    // `%` traité littéralement (échappement LIKE), pas comme joker.
    const literal = await h.call("GET", "widgets", { query: { q: "100%" } });
    assert.equal(literal.body.total, 1);
    assert.equal(literal.body.items[0].nom, "Quincaillerie");

    const wildcardAbuse = await h.call("GET", "widgets", {
      query: { q: "1%l" },
    });
    assert.equal(wildcardAbuse.body.total, 0);

    const none = await h.call("GET", "widgets", { query: { q: "introuvable" } });
    assert.equal(none.body.total, 0);
  } finally {
    h.close();
  }
});

test("entity-mount filtres égalité + booléen", async () => {
  const h = makeHarness();
  try {
    await h.call("POST", "widgets", {
      body: { nom: "A", group_id: "g1", actif: 1 },
    });
    await h.call("POST", "widgets", {
      body: { nom: "B", group_id: "g2", actif: 0 },
    });

    const byGroup = await h.call("GET", "widgets", {
      query: { group_id: "g1" },
    });
    assert.equal(byGroup.body.total, 1);
    assert.equal(byGroup.body.items[0].nom, "A");

    const actifs = await h.call("GET", "widgets", { query: { actif: "1" } });
    assert.equal(actifs.body.total, 1);
    assert.equal(actifs.body.items[0].nom, "A");

    // Colonne non filterable ignorée (statut n'est pas filterable)
    const ignored = await h.call("GET", "widgets", {
      query: { statut: "actif" },
    });
    assert.equal(ignored.body.total, 2);
  } finally {
    h.close();
  }
});

test("entity-mount hooks : beforeCreate (mute + rejette), beforeUpdate, afterRead, afterList", async () => {
  const h = makeHarness({
    specs: {
      widgets: {
        ...WIDGET_SPEC,
        hooks: {
          beforeCreate(row, ctx) {
            if (row.nom === "interdit") {
              return { status: 400, body: { error: "nom_interdit" } };
            }
            row.derived = `d:${row.nom}`;
            // Écriture annexe sur la même couche brand via ctx.db
            ctx.db
              .prepare(
                `INSERT INTO readings (id, created_at, updated_at, valeur, widget_id)
                 VALUES (?, ?, ?, ?, ?)`,
              )
              .run(`r-${row.id}`, row.created_at, row.updated_at, 1, row.id);
          },
          beforeUpdate(patch, existing) {
            if (patch.label === "verrouillé") {
              return { status: 409, body: { error: "label_verrouille" } };
            }
            patch.derived = `d2:${existing.nom}`;
          },
          afterRead(row, ctx) {
            const readings = ctx.db
              .prepare(`SELECT * FROM readings WHERE widget_id = ?`)
              .all(row.id);
            return { ...row, readings, nb_readings: readings.length };
          },
          afterList(rows) {
            return {
              items: rows,
              somme_derived: rows.filter((r) => r.derived).length,
            };
          },
        },
      },
    },
  });
  try {
    const rejected = await h.call("POST", "widgets", {
      body: { nom: "interdit" },
    });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, "nom_interdit");

    const created = await h.call("POST", "widgets", { body: { nom: "Hooké" } });
    assert.equal(created.status, 201);
    assert.equal(created.body.derived, "d:Hooké"); // mutation persistée

    const read = await h.call("GET", `widgets/${created.body.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.nb_readings, 1); // enrichissement afterRead
    assert.equal(read.body.readings[0].widget_id, created.body.id);

    const patchRejected = await h.call("PATCH", `widgets/${created.body.id}`, {
      body: { label: "verrouillé" },
    });
    assert.equal(patchRejected.status, 409);

    const patched = await h.call("PATCH", `widgets/${created.body.id}`, {
      body: { label: "ok" },
    });
    assert.equal(patched.body.derived, "d2:Hooké"); // mutation beforeUpdate

    const list = await h.call("GET", "widgets");
    assert.deepEqual(Object.keys(list.body).sort(), [
      "items",
      "somme_derived",
    ]); // afterList remplace le payload
    assert.equal(list.body.somme_derived, 1);
  } finally {
    h.close();
  }
});

test("entity-mount extraRoutes : fallback métier + 404 par défaut", async () => {
  const h = makeHarness({
    specs: {
      widgets: {
        ...WIDGET_SPEC,
        extraRoutes: async ({ req, subPath }) => {
          if (subPath === "custom-op" && req.method === "POST") {
            return { status: 201, body: { ok: true, op: "custom" } };
          }
          return { status: 404, body: { error: "not_found", subPath } };
        },
      },
      readings: {
        table: "readings",
        columns: [{ name: "valeur", type: "number" }],
      },
    },
  });
  try {
    const custom = await h.call("POST", "widgets/custom-op", { body: {} });
    assert.equal(custom.status, 201);
    assert.equal(custom.body.op, "custom");

    const unknownWithExtra = await h.call("POST", "widgets/autre-op");
    assert.equal(unknownWithExtra.status, 404);
    assert.equal(unknownWithExtra.body.subPath, "autre-op");

    // Sans extraRoutes : 404 standard avec subPath
    const unknown = await h.call("POST", "readings/custom-op");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, "not_found");
    assert.equal(unknown.body.subPath, "custom-op");
  } finally {
    h.close();
  }
});

test("entity-mount registerEntityMounts + dbLayer brand + 503 sans runtime", async () => {
  const h = makeHarness({
    specs: {
      widgets: WIDGET_SPEC,
      readings: { table: "readings", columns: [{ name: "valeur" }] },
    },
  });
  try {
    const mounts = h.api.listMounts();
    const ids = mounts.filter((m) => m.space === "module").map((m) => m.id);
    assert.ok(ids.includes("widgets"));
    assert.ok(ids.includes("readings"));
    for (const m of mounts) assert.equal(m.dbLayer, "brand");
  } finally {
    h.close();
  }

  const noDb = makeHarness({ runtime: false });
  const res = await noDb.call("GET", "widgets");
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "db_unavailable");
});

test("entity-mount deny cross-write H2 inchangé", async () => {
  const h = makeHarness({
    specs: {
      widgets: {
        ...WIDGET_SPEC,
        hooks: {
          beforeCreate(_row, ctx) {
            // Tentative d'écriture cross-layer depuis un hook brand
            ctx.db.access({ kind: "core" }, "write");
          },
        },
      },
    },
  });
  try {
    const deniedPath = await h.call("POST", "widgets/__cross/core", {
      body: {},
    });
    assert.equal(deniedPath.status, 403);
    assert.equal(deniedPath.body.error, "cross_write_denied");

    const deniedHook = await h.call("POST", "widgets", {
      body: { nom: "attaque" },
    });
    assert.equal(deniedHook.status, 403);
    assert.equal(deniedHook.body.error, "cross_layer_write_denied");
  } finally {
    h.close();
  }
});

test("entity-mount liste Meili : q vide + 0 hit + Meili KO fail-closed 503", async () => {
  resetEntityMeiliForTests();
  const h = makeHarness();
  try {
    const created = await h.call("POST", "widgets", {
      body: { nom: "Alpha", group_id: "g1" },
    });
    assert.equal(created.status, 201);
    const id = String(created.body.id);

    configureEntityMeili({
      host: "http://127.0.0.1:9",
      indexes: {
        widgets: {
          indexUid: "catalog_widgets",
          filterable: ["group_id"],
        },
      },
      browse: async (req) => {
        if (req.filters?.some((f) => f.includes("unknown"))) return null;
        if (req.query === "nomatch") return { hits: [], total: 0 };
        return { hits: [{ id }], total: 1 };
      },
    });

    const emptyQ = await h.call("GET", "widgets", { query: { group_id: "g1" } });
    assert.equal(emptyQ.status, 200);
    assert.equal(emptyQ.body.engine, "meili", "browse sans q → Meili");
    assert.equal(emptyQ.body.items.length, 1);
    assert.equal(emptyQ.body.items[0].id, id);

    const zero = await h.call("GET", "widgets", { query: { q: "nomatch" } });
    assert.equal(zero.status, 200);
    assert.equal(zero.body.engine, "meili", "0 hit reste meili");
    assert.equal(zero.body.items.length, 0);
    assert.equal(zero.body.total, 0);

    // Meili KO (override → null) sur une entité indexée = FAIL-CLOSED :
    // 503 meili_unavailable, jamais de LIKE SQL de secours (Meili = core).
    const prevAllow = process.env.CREEZIO_ALLOW_NO_MEILI;
    delete process.env.CREEZIO_ALLOW_NO_MEILI;
    try {
      const down = await h.call("GET", "widgets", {
        query: { group_id: "unknown" },
      });
      assert.equal(down.status, 503, "Meili KO → 503 (pas de SQL de secours)");
      assert.equal(down.body.error, "meili_unavailable");

      // Échappatoire dev/tests hors-browse : CREEZIO_ALLOW_NO_MEILI=1 →
      // SQL VISIBLE (fallback marqué), jamais silencieux.
      process.env.CREEZIO_ALLOW_NO_MEILI = "1";
      const allowed = await h.call("GET", "widgets", {
        query: { group_id: "unknown" },
      });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.body.engine, "sql");
      assert.equal(allowed.body.fallback, "meili_unavailable");
    } finally {
      if (prevAllow === undefined) delete process.env.CREEZIO_ALLOW_NO_MEILI;
      else process.env.CREEZIO_ALLOW_NO_MEILI = prevAllow;
    }

    const byIds = await h.call("GET", "widgets", { query: { ids: id } });
    assert.equal(byIds.status, 200);
    assert.equal(byIds.body.items.length, 1);
    assert.equal(byIds.body.items[0].nom, "Alpha");
  } finally {
    resetEntityMeiliForTests();
    h.close();
  }
});
