/**
 * Phase R1 — @creezio/database (port TempoFlow Admin Database).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DATABASE_CORE_SQL,
  browseTable,
  canAutomateTable,
  canCrudTable,
  configureDatabaseEngine,
  configureDatabasePolicy,
  createAutomation,
  evaluateConditions,
  getCrudAllowlist,
  insertRow,
  listCatalog,
  processPendingEvents,
  updateRow,
  openNodeSqliteDatabase,
} from "../packages/database/dist/index.js";

/** Allowlist d’exemple pour les tests kit (pas de domaine marque dans le package). */
const EXAMPLE_CRUD_ALLOWLIST = ["fournisseurs", "produits", "skus"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("R1.1 package + docs PHASE-R1", () => {
  assert.ok(
    fs.existsSync(path.join(root, "packages/database/package.json")),
  );
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "packages/database/package.json"), "utf8"),
  );
  assert.equal(pkg.name, "@creezio/database");
  const doc = fs.readFileSync(path.join(root, "docs/archive/PHASE-R1.md"), "utf8");
  assert.match(doc, /@creezio\/database/);
  assert.match(doc, /TempoFlow|row-level/);
});

test("R1.2 schema + policy fail-closed + conditions", () => {
  assert.match(DATABASE_CORE_SQL, /db_automations/);
  assert.match(DATABASE_CORE_SQL, /db_automation_events/);
  // Fail-closed : sans configureDatabasePolicy, aucune table métier CRUD-able.
  assert.equal(getCrudAllowlist().size, 0);
  assert.equal(canCrudTable("fournisseurs"), false);
  assert.equal(canCrudTable("users"), false);
  configureDatabasePolicy({
    crudAllowlist: EXAMPLE_CRUD_ALLOWLIST,
  });
  assert.equal(canCrudTable("fournisseurs"), true);
  assert.equal(canCrudTable("users"), false);
  assert.equal(canAutomateTable("db_automations"), false);
  assert.equal(
    evaluateConditions(
      {
        op: "and",
        rules: [{ field: "statut", cmp: "changed_to", value: "ok" }],
      },
      { before: { statut: "draft" }, after: { statut: "ok" } },
    ),
    true,
  );
});

test("R1.3 catalogue / CRUD / automation webhook outbox", async () => {
  // Policy marque (ou test) obligatoire — le kit reste fail-closed par défaut.
  configureDatabasePolicy({ crudAllowlist: EXAMPLE_CRUD_ALLOWLIST });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-db-"));
  const dbPath = path.join(tmp, "t.db");
  const db = openNodeSqliteDatabase(dbPath);
  db.exec(DATABASE_CORE_SQL);
  db.exec(`
    CREATE TABLE fournisseurs (
      id INTEGER PRIMARY KEY,
      nom TEXT NOT NULL,
      slug TEXT,
      statut TEXT,
      actif INTEGER
    );
  `);
  db.prepare(
    `INSERT INTO fournisseurs (id, nom, slug, statut, actif) VALUES (1, 'Agidra', 'agidra', 'normal', 1)`,
  ).run();

  const catalog = listCatalog(db, { includeSystem: false });
  assert.ok(catalog.some((t) => t.name === "fournisseurs"));
  assert.ok(!catalog.some((t) => t.name === "db_automations"));

  const browsed = browseTable(db, "fournisseurs", { q: "Agi" });
  assert.equal(browsed.rows.length, 1);

  const events = [];
  configureDatabaseEngine({
    emitPluginEvent: (ev, payload) => events.push({ ev, payload }),
  });

  let webhookHits = 0;
  const server = await new Promise((resolve) => {
    import("node:http").then(({ createServer }) => {
      const s = createServer((req, res) => {
        webhookHits++;
        res.writeHead(200);
        res.end("ok");
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
  });
  const { port } = server.address();
  process.env.CREEZIO_WEBHOOK_ALLOW_LOOPBACK = "1";
  process.env.CREEZIO_WEBHOOK_ALLOW_PRIVATE = "1";

  createAutomation(db, {
    tableName: "fournisseurs",
    name: "on-update",
    triggerType: "row_updated",
    actions: [
      {
        type: "webhook",
        url: `http://127.0.0.1:${port}/hook`,
        bodyTemplate: "row_after",
      },
    ],
  });

  updateRow(db, "fournisseurs", 1, { statut: "masque" });
  const pending = db
    .prepare(`SELECT COUNT(*) AS c FROM db_automation_events WHERE status='pending'`)
    .get();
  assert.ok(pending.c >= 1);

  const result = await processPendingEvents(db, 10);
  assert.ok(result.processed >= 1);
  assert.ok(result.matched >= 1);
  assert.ok(webhookHits >= 1);

  insertRow(db, "fournisseurs", {
    id: 2,
    nom: "Metro",
    slug: "metro",
    statut: "normal",
    actif: 1,
  });

  server.close();
  db.close?.();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("R1.4 matrice Database = natif", () => {
  const doc = fs.readFileSync(
    path.join(root, "docs/archive/MATRICE-NATIVE-METIER-PLUGIN.md"),
    "utf8",
  );
  assert.match(doc, /Database admin \+ automations row-level/);
  assert.match(doc, /@creezio\/database[\s\S]*?✅/);
});
