#!/usr/bin/env node
/**
 * Gate — CRUD prospects admin (PROSP-5) + validation nom (PROSP-3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminMigrations,
  createAdminCrudMount,
} from "../packages/admin/dist/index.js";
const { default: Database } = await import("better-sqlite3");

function makeDb() {
  const db = new Database(":memory:");
  for (const m of adminMigrations()) db.exec(m.sql);
  return db;
}

test("prospects CRUD + tri kanban + nom requis", async () => {
  const db = makeDb();
  const mount = createAdminCrudMount("prospects");
  const call = (method, subPath, body) =>
    mount.handle({
      req: { method, body, query: {}, headers: {} },
      subPath,
      db,
    });

  const bad = await call("POST", "", { contact: "x" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "nom_required");

  const a = await call("POST", "", { nom: "Alpha", colonne: "lead", position: 2 });
  assert.equal(a.status, 201);
  const b = await call("POST", "", { nom: "Beta", colonne: "lead", position: 1 });
  assert.equal(b.status, 201);

  const list = await call("GET", "");
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 2);
  assert.deepEqual(
    list.body.items.map((i) => i.nom),
    ["Beta", "Alpha"],
    "tri position ASC, created_at DESC",
  );

  const got = await call("GET", a.body.item.id);
  assert.equal(got.body.item.nom, "Alpha");

  const patched = await call("PATCH", a.body.item.id, { ville: "Marseille" });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.item.ville, "Marseille");

  const del = await call("DELETE", b.body.item.id);
  assert.equal(del.status, 200);
  const after = await call("GET", "");
  assert.equal(after.body.items.length, 1);
});
