/**
 * Gate : @creezio/onboarding conforme au patron « module natif hybride »
 * (docs/adr/ADR-module-natif-hybride.md).
 *
 * Verrouille : exports contenu hybride (migrations + merge + mount),
 * schéma onboarding_content / onboarding_preferences, merge pur
 * défauts/override, mount 503 sans db, GET/PUT content + PUT preferences
 * sur une vraie DB (node:sqlite si dispo, sinon stub mémoire).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "packages/onboarding/dist/index.js");

async function loadDist() {
  assert.ok(
    fs.existsSync(DIST),
    "dist @creezio/onboarding manquant — lancer npm run build -w @creezio/onboarding",
  );
  return import(pathToFileURL(DIST).href);
}

/** DB réelle (node:sqlite) ou stub mémoire prepare/run/get/all. */
async function createDb(migrations) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(":memory:");
    for (const m of migrations) db.exec(m.sql);
    return db;
  } catch {
    return createStubDb();
  }
}

function createStubDb() {
  const content = new Map();
  const prefs = new Map();
  return {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      return {
        run: (...a) => {
          if (s.startsWith("INSERT INTO onboarding_content")) {
            content.set(a[0], { value_json: a[1], updated_at: a[2] });
            return { changes: 1 };
          }
          if (s.startsWith("DELETE FROM onboarding_content")) {
            return { changes: content.delete(a[0]) ? 1 : 0 };
          }
          if (s.startsWith("INSERT INTO onboarding_preferences")) {
            const [id, user, key, vj, ts] = a;
            const k = `${user}\u0000${key}`;
            const prev = prefs.get(k);
            prefs.set(k, {
              id: prev?.id ?? id,
              user_key: user,
              key,
              value_json: vj,
              updated_at: ts,
            });
            return { changes: 1 };
          }
          throw new Error(`stub run inattendu: ${s}`);
        },
        get: (...a) => {
          if (s.startsWith("SELECT value_json FROM onboarding_content")) {
            const row = content.get(a[0]);
            return row ? { value_json: row.value_json } : undefined;
          }
          throw new Error(`stub get inattendu: ${s}`);
        },
        all: (...a) => {
          if (s.startsWith("SELECT key, value_json FROM onboarding_preferences")) {
            return [...prefs.values()]
              .filter((r) => r.user_key === a[0])
              .sort((x, y) => (x.key < y.key ? -1 : 1))
              .map((r) => ({ key: r.key, value_json: r.value_json }));
          }
          throw new Error(`stub all inattendu: ${s}`);
        },
      };
    },
  };
}

const DEFAULTS = {
  steps: [
    { id: "a", label: "Alpha", interstitialTitle: "Titre A", texts: { hint: "h1" } },
    { id: "b", label: "Beta", interstitialTagline: "Tag B" },
  ],
  mascot: { poses: { pointing: "/m/pointing.png", thumbs: "/m/thumbs.png" } },
  texts: { welcome: "Bienvenue" },
};

function call(mount, { method, subPath, body, query, db }) {
  return mount.handle({
    req: { method, path: `/api/v1/modules/onboarding/${subPath}`, body, query },
    space: "module",
    mountId: "onboarding",
    subPath,
    db,
  });
}

test("onboarding hybride : exports kit + migrations", async () => {
  const mod = await loadDist();
  assert.equal(typeof mod.onboardingContentMigrations, "function");
  assert.equal(typeof mod.createOnboardingContentMount, "function");
  assert.equal(typeof mod.mergeOnboardingContent, "function");

  const migs = mod.onboardingContentMigrations();
  assert.equal(migs.length, 1);
  assert.equal(migs[0].id, "onboarding_001_content_prefs");
  assert.match(migs[0].sql, /onboarding_content/);
  assert.match(migs[0].sql, /onboarding_preferences/);
  assert.match(migs[0].sql, /UNIQUE\(user_key, key\)/);
});

test("onboarding hybride : mergeOnboardingContent pur", async () => {
  const { mergeOnboardingContent } = await loadDist();

  // Sans override : copie des défauts.
  const noOv = mergeOnboardingContent(DEFAULTS, null);
  assert.deepEqual(
    noOv.steps.map((s) => s.label),
    ["Alpha", "Beta"],
  );

  const merged = mergeOnboardingContent(DEFAULTS, {
    steps: [{ id: "a", label: "Alpha (édité)", texts: { extra: "x" } }],
    mascot: { poses: { pointing: "/override/pointing.png" } },
  });
  const a = merged.steps.find((s) => s.id === "a");
  const b = merged.steps.find((s) => s.id === "b");
  assert.equal(a.label, "Alpha (édité)", "label overridé");
  assert.equal(a.interstitialTitle, "Titre A", "interstitiel défaut conservé");
  assert.deepEqual(a.texts, { hint: "h1", extra: "x" }, "texts step fusionnés");
  assert.equal(b.label, "Beta", "step non listé conservé");
  assert.equal(
    merged.mascot.poses.pointing,
    "/override/pointing.png",
    "pose mascotte overridée",
  );
  assert.equal(
    merged.mascot.poses.thumbs,
    "/m/thumbs.png",
    "autres poses conservées",
  );
  assert.equal(merged.texts.welcome, "Bienvenue");
  // Pureté : les défauts ne sont pas mutés par le merge.
  assert.equal(DEFAULTS.steps[0].label, "Alpha");
  assert.equal(DEFAULTS.mascot.poses.pointing, "/m/pointing.png");
});

test("onboarding hybride : mount 503 sans db", async () => {
  const { createOnboardingContentMount } = await loadDist();
  const mount = createOnboardingContentMount({ defaults: DEFAULTS });
  assert.equal(mount.dbLayer, "brand");
  const res = await call(mount, { method: "GET", subPath: "content" });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "db_unavailable");
});

test("onboarding hybride : content GET défauts → PUT override → GET mergé", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.onboardingContentMigrations());
  const mount = mod.createOnboardingContentMount({ defaults: DEFAULTS });

  const g1 = await call(mount, { method: "GET", subPath: "content", db });
  assert.equal(g1.status, 200);
  assert.equal(g1.body.ok, true);
  assert.equal(g1.body.hasOverride, false);
  assert.equal(g1.body.content.steps[0].label, "Alpha");

  const put = await call(mount, {
    method: "PUT",
    subPath: "content",
    db,
    body: {
      steps: [{ id: "b", label: "Beta (édité)" }],
      mascot: { poses: { hello: "/m/hello.png" } },
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.hasOverride, true);

  const g2 = await call(mount, { method: "GET", subPath: "content", db });
  assert.equal(g2.body.hasOverride, true);
  assert.equal(g2.body.content.steps[0].label, "Alpha", "step non listé intact");
  assert.equal(g2.body.content.steps[1].label, "Beta (édité)");
  assert.equal(g2.body.content.mascot.poses.hello, "/m/hello.png");
  assert.equal(g2.body.content.mascot.poses.pointing, "/m/pointing.png");

  // Body invalide → 400, jamais de throw.
  const bad = await call(mount, {
    method: "PUT",
    subPath: "content",
    db,
    body: "pas un objet",
  });
  assert.equal(bad.status, 400);

  const del = await call(mount, { method: "DELETE", subPath: "content", db });
  assert.equal(del.status, 200);
  assert.equal(del.body.hasOverride, false);
  const g3 = await call(mount, { method: "GET", subPath: "content", db });
  assert.equal(g3.body.hasOverride, false);
  assert.equal(g3.body.content.steps[1].label, "Beta");
});

test("onboarding hybride : preferences PUT upsert + GET par user", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.onboardingContentMigrations());
  const mount = mod.createOnboardingContentMount({ defaults: DEFAULTS });

  const p1 = await call(mount, {
    method: "PUT",
    subPath: "preferences",
    db,
    body: { user: "owner", answers: { mode: "copilote", seuil: 5 } },
  });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.saved, 2);

  // Upsert : même clé, nouvelle valeur — pas de doublon.
  const p2 = await call(mount, {
    method: "PUT",
    subPath: "preferences",
    db,
    body: { user: "owner", answers: { mode: "autonome" } },
  });
  assert.equal(p2.status, 200);

  const get = await call(mount, {
    method: "GET",
    subPath: "preferences",
    db,
    query: { user: "owner" },
  });
  assert.equal(get.status, 200);
  assert.equal(get.body.user, "owner");
  assert.deepEqual(get.body.answers, { mode: "autonome", seuil: 5 });

  // user requis / body invalide → 400.
  const noUser = await call(mount, { method: "GET", subPath: "preferences", db });
  assert.equal(noUser.status, 400);
  const bad = await call(mount, {
    method: "PUT",
    subPath: "preferences",
    db,
    body: { answers: { a: 1 } },
  });
  assert.equal(bad.status, 400);

  // Autre user : isolé.
  const other = await call(mount, {
    method: "GET",
    subPath: "preferences",
    db,
    query: { user: "autre" },
  });
  assert.deepEqual(other.body.answers, {});
});
