#!/usr/bin/env node
/**
 * Gate — CRUD roadmap admin (ROAD-4) + validation titre (ROAD-3).
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

test("roadmap CRUD + tri position + titre requis", async () => {
  const db = makeDb();
  const mount = createAdminCrudMount("roadmap");
  const call = (method, subPath, body) =>
    mount.handle({
      req: { method, body, query: {}, headers: {} },
      subPath,
      db,
    });

  const bad = await call("POST", "", { description: "x" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "titre_required");

  const a = await call("POST", "", {
    titre: "V1",
    statut: "todo",
    position: 10,
  });
  assert.equal(a.status, 201);
  const b = await call("POST", "", {
    titre: "V0",
    statut: "todo",
    position: 1,
  });
  assert.equal(b.status, 201);

  const list = await call("GET", "");
  assert.equal(list.body.items.length, 2);
  assert.deepEqual(
    list.body.items.map((i) => i.titre),
    ["V0", "V1"],
  );

  const patched = await call("PATCH", a.body.item.id, { statut: "done" });
  assert.equal(patched.body.item.statut, "done");

  const del = await call("DELETE", b.body.item.id);
  assert.equal(del.status, 200);
  assert.equal((await call("GET", "")).body.items.length, 1);
});
