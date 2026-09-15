/**
 * Gate : @creezio/interactive-demo conforme au patron « module natif
 * hybride » (docs/adr/ADR-module-natif-hybride.md).
 *
 * Verrouille : exports kit (migrations + merge + mount + validation +
 * scénario générique + collecteur de contributions modules), schéma
 * interactive_demo_content / interactive_demo_preferences, merge pur
 * défauts/overrides (steps = remplacement, enabled:false, scénario
 * additionnel), mount 503 sans db, GET/PUT/DELETE scenarios + preferences
 * sur une vraie DB (node:sqlite si dispo, sinon stub mémoire), surface UI
 * (exports ./ui + CSS), et collectInteractiveDemoDefaults (validation
 * agrégée, dédup par id, ordre stable).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = path.join(ROOT, "packages/interactive-demo");
const DIST = path.join(PKG, "dist/index.js");

async function loadDist() {
  assert.ok(
    fs.existsSync(DIST),
    "dist @creezio/interactive-demo manquant — lancer npm run build -w @creezio/interactive-demo",
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
          if (s.startsWith("INSERT INTO interactive_demo_content")) {
            content.set(a[0], { value_json: a[1], updated_at: a[2] });
            return { changes: 1 };
          }
          if (s.startsWith("DELETE FROM interactive_demo_content")) {
            return { changes: content.delete(a[0]) ? 1 : 0 };
          }
          if (s.startsWith("INSERT INTO interactive_demo_preferences")) {
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
        get: () => {
          throw new Error(`stub get inattendu: ${s}`);
        },
        all: (...a) => {
          if (s.startsWith("SELECT key, value_json FROM interactive_demo_content")) {
            const like = String(a[0] ?? "").replace(/%$/, "");
            return [...content.entries()]
              .filter(([k]) => k.startsWith(like))
              .sort(([x], [y]) => (x < y ? -1 : 1))
              .map(([k, v]) => ({ key: k, value_json: v.value_json }));
          }
          if (
            s.startsWith("SELECT key, value_json FROM interactive_demo_preferences")
          ) {
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

const DEFAULTS = [
  {
    id: "tour",
    title: "Visite produit",
    description: "Découverte",
    enabled: true,
    autoStart: true,
    steps: [
      { id: "hello", kind: "say", title: "Bienvenue" },
      { id: "cat", kind: "click", target: { text: "Catalogue" } },
      { id: "search", kind: "type", target: "input", text: "bio" },
    ],
  },
  {
    id: "avance",
    title: "Fonctions avancées",
    steps: [{ id: "hl", kind: "highlight", target: { selector: "aside" }, title: "Nav" }],
  },
];

function call(mount, { method, subPath, body, query, db }) {
  return mount.handle({
    req: {
      method,
      path: `/api/v1/modules/interactive-demo/${subPath}`,
      body,
      query,
    },
    space: "module",
    mountId: "interactive-demo",
    subPath,
    db,
  });
}

test("interactive-demo : exports kit + migrations", async () => {
  const mod = await loadDist();
  assert.equal(typeof mod.interactiveDemoMigrations, "function");
  assert.equal(typeof mod.createInteractiveDemoMount, "function");
  assert.equal(typeof mod.mergeDemoScenarios, "function");
  assert.equal(typeof mod.validateDemoScenario, "function");
  assert.equal(typeof mod.genericOsTourScenario, "function");
  assert.equal(typeof mod.collectInteractiveDemoDefaults, "function");

  const migs = mod.interactiveDemoMigrations();
  assert.equal(migs.length, 1);
  assert.equal(migs[0].id, "interactive_demo_001_content_prefs");
  assert.match(migs[0].sql, /interactive_demo_content/);
  assert.match(migs[0].sql, /interactive_demo_preferences/);
  assert.match(migs[0].sql, /UNIQUE\(user_key, key\)/);
});

test("interactive-demo : validateDemoScenario", async () => {
  const { validateDemoScenario, genericOsTourScenario } = await loadDist();

  assert.deepEqual(validateDemoScenario(DEFAULTS[0]), []);
  assert.deepEqual(
    validateDemoScenario(genericOsTourScenario({ productName: "Demo" })),
    [],
    "le scénario générique OS est valide",
  );

  assert.ok(validateDemoScenario(null).includes("scenario_invalide"));
  assert.ok(validateDemoScenario({ id: "x", title: "X" }).includes("etapes_requises"));
  const bad = validateDemoScenario({
    id: "x",
    title: "X",
    steps: [
      { id: "a", kind: "say" },
      { id: "a", kind: "navigate", href: "http://exterieur" },
      { id: "c", kind: "click", target: {} },
      { id: "d", kind: "wait", ms: 0 },
      { id: "e", kind: "inconnu" },
    ],
  });
  assert.ok(bad.includes("etape_0_titre_requis"));
  assert.ok(bad.includes("etape_1_id_duplique"));
  assert.ok(bad.includes("etape_1_href_invalide"));
  assert.ok(bad.includes("etape_2_cible_invalide"));
  assert.ok(bad.includes("etape_3_ms_invalide"));
  assert.ok(bad.includes("etape_4_kind_invalide"));
});

test("interactive-demo : collectInteractiveDemoDefaults (validation, dédup, ordre stable)", async () => {
  const mod = await loadDist();
  const { collectInteractiveDemoDefaults, mergeDemoScenarios } = mod;
  assert.equal(typeof collectInteractiveDemoDefaults, "function");

  const scen = (id, title = id) => ({
    id,
    title,
    steps: [{ id: "s1", kind: "say", title: "Bonjour" }],
  });

  // Aucune contribution → liste vide (mount serviable tel quel).
  assert.deepEqual(collectInteractiveDemoDefaults([]), []);

  // Ordre stable : ordre des contributions puis de déclaration, jamais de tri.
  const ordered = collectInteractiveDemoDefaults([
    { moduleId: "zeta", scenarios: [scen("z-2"), scen("z-1")] },
    { moduleId: "alpha", scenarios: [scen("a-1")] },
  ]);
  assert.deepEqual(ordered.map((s) => s.id), ["z-2", "z-1", "a-1"]);

  // Dédup : même module contribuant deux fois le même id (registre listé
  // en double) → une seule copie, sans erreur.
  const deduped = collectInteractiveDemoDefaults([
    { moduleId: "promo", scenarios: [scen("tour")] },
    { moduleId: "promo", scenarios: [scen("tour")] },
  ]);
  assert.deepEqual(deduped.map((s) => s.id), ["tour"]);

  // Conflit : deux modules distincts, même id → erreur nommant les deux.
  assert.throws(
    () =>
      collectInteractiveDemoDefaults([
        { moduleId: "promo", scenarios: [scen("tour")] },
        { moduleId: "catalogue", scenarios: [scen("tour")] },
      ]),
    /scenario en double: tour \(modules promo et catalogue\)/,
  );

  // os-tour est partagé (genericOsTourScenario dans chaque stub module) :
  // premier gagne, pas de conflit.
  const sharedOs = collectInteractiveDemoDefaults([
    { moduleId: "os", scenarios: [scen("os-tour", "Découvrir A")] },
    { moduleId: "crm", scenarios: [scen("os-tour", "Découvrir B"), scen("crm-tour")] },
  ]);
  assert.deepEqual(sharedOs.map((s) => s.id), ["os-tour", "crm-tour"]);
  assert.equal(sharedOs[0].title, "Découvrir A");

  // Validation : UNE Error agrégée, préfixée module:scénario, codes de
  // validateDemoScenario repris.
  let err = null;
  try {
    collectInteractiveDemoDefaults([
      { moduleId: "promo", scenarios: [{ id: "casse", title: "X", steps: [] }] },
      {
        moduleId: "stats",
        scenarios: [{ title: "sans id", steps: [{ id: "s", kind: "say", title: "t" }] }],
      },
    ]);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "scénarios invalides → throw");
  assert.match(err.message, /promo:casse: etapes_requises/);
  assert.match(err.message, /stats:<sans_id>: id_requis/);

  // Contributions malformées → erreurs claires, jamais de crash muet.
  assert.throws(
    () => collectInteractiveDemoDefaults([{ moduleId: "x", scenarios: "nope" }]),
    /x: scenarios_requis/,
  );
  assert.throws(
    () => collectInteractiveDemoDefaults([null]),
    /contribution_invalide/,
  );

  // Sortie directement consommable par le mount (merge avec overrides DB).
  const merged = mergeDemoScenarios(ordered, null);
  assert.deepEqual(merged.map((s) => s.id), ["z-2", "z-1", "a-1"]);
});

test("interactive-demo : mergeDemoScenarios pur", async () => {
  const { mergeDemoScenarios } = await loadDist();

  // Sans override : copie des défauts.
  const noOv = mergeDemoScenarios(DEFAULTS, null);
  assert.deepEqual(
    noOv.map((s) => s.id),
    ["tour", "avance"],
  );

  const merged = mergeDemoScenarios(DEFAULTS, [
    {
      id: "tour",
      title: "Visite (éditée)",
      steps: [{ id: "solo", kind: "say", title: "Étape unique" }],
    },
    { id: "avance", enabled: false },
    {
      id: "extra",
      title: "Scénario admin",
      steps: [{ id: "s1", kind: "say", title: "Ajouté" }],
    },
    { id: "casse", steps: "pas un tableau" },
  ]);

  const tour = merged.find((s) => s.id === "tour");
  assert.equal(tour.title, "Visite (éditée)");
  assert.equal(tour.steps.length, 1, "steps override = remplacement complet");
  assert.equal(tour.steps[0].id, "solo");
  assert.equal(tour.autoStart, true, "champ non overridé conservé");

  assert.equal(merged.find((s) => s.id === "avance").enabled, false);
  assert.equal(merged.find((s) => s.id === "extra").steps.length, 1);
  assert.equal(
    merged.some((s) => s.id === "casse"),
    false,
    "override additionnel invalide ignoré",
  );

  // Pureté : les défauts ne sont pas mutés.
  assert.equal(DEFAULTS[0].title, "Visite produit");
  assert.equal(DEFAULTS[0].steps.length, 3);
});

test("interactive-demo : mount 503 sans db", async () => {
  const { createInteractiveDemoMount } = await loadDist();
  const mount = createInteractiveDemoMount({ defaults: DEFAULTS });
  assert.equal(mount.dbLayer, "brand");
  const res = await call(mount, { method: "GET", subPath: "scenarios" });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "db_unavailable");
});

test("interactive-demo : scenarios GET défauts → PUT override → DELETE", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.interactiveDemoMigrations());
  const mount = mod.createInteractiveDemoMount({ defaults: DEFAULTS });

  const g1 = await call(mount, { method: "GET", subPath: "scenarios", db });
  assert.equal(g1.status, 200);
  assert.equal(g1.body.ok, true);
  assert.deepEqual(g1.body.overrides, []);
  assert.equal(g1.body.scenarios.length, 2);

  const put = await call(mount, {
    method: "PUT",
    subPath: "scenarios/tour",
    db,
    body: { steps: [{ id: "solo", kind: "say", title: "Étape éditée" }] },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.hasOverride, true);
  assert.equal(put.body.scenario.steps.length, 1);

  const g2 = await call(mount, { method: "GET", subPath: "scenarios/tour", db });
  assert.equal(g2.status, 200);
  assert.equal(g2.body.scenario.steps[0].title, "Étape éditée");
  assert.equal(g2.body.scenario.title, "Visite produit", "défaut conservé");

  // Steps invalides → 400, jamais de throw.
  const bad = await call(mount, {
    method: "PUT",
    subPath: "scenarios/tour",
    db,
    body: { steps: [{ id: "x", kind: "wait", ms: -1 }] },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "scenario_invalide");

  // Scénario additionnel inconnu : exigé complet.
  const incomplete = await call(mount, {
    method: "PUT",
    subPath: "scenarios/nouveau",
    db,
    body: { title: "Sans étapes" },
  });
  assert.equal(incomplete.status, 400);
  const complete = await call(mount, {
    method: "PUT",
    subPath: "scenarios/nouveau",
    db,
    body: {
      title: "Nouveau scénario",
      steps: [{ id: "s1", kind: "say", title: "Créé par l'admin" }],
    },
  });
  assert.equal(complete.status, 200);

  const g3 = await call(mount, { method: "GET", subPath: "scenarios", db });
  assert.equal(g3.body.scenarios.length, 3);
  assert.deepEqual(g3.body.overrides.sort(), ["nouveau", "tour"]);

  const del = await call(mount, { method: "DELETE", subPath: "scenarios/tour", db });
  assert.equal(del.status, 200);
  assert.equal(del.body.hasOverride, false);
  assert.equal(del.body.scenario.steps.length, 3, "retour aux défauts");

  const missing = await call(mount, {
    method: "GET",
    subPath: "scenarios/inconnu",
    db,
  });
  assert.equal(missing.status, 404);
});

test("interactive-demo : preferences PUT upsert + GET par user", async () => {
  const mod = await loadDist();
  const db = await createDb(mod.interactiveDemoMigrations());
  const mount = mod.createInteractiveDemoMount({ defaults: DEFAULTS });

  const p1 = await call(mount, {
    method: "PUT",
    subPath: "preferences",
    db,
    body: { user: "owner", answers: { "seen:tour": "2026-08-07T10:00:00Z" } },
  });
  assert.equal(p1.status, 200);
  assert.equal(p1.body.saved, 1);

  // Upsert : même clé, nouvelle valeur — pas de doublon.
  await call(mount, {
    method: "PUT",
    subPath: "preferences",
    db,
    body: { user: "owner", answers: { "seen:tour": "2026-08-08T10:00:00Z" } },
  });

  const get = await call(mount, {
    method: "GET",
    subPath: "preferences",
    db,
    query: { user: "owner" },
  });
  assert.equal(get.status, 200);
  assert.deepEqual(get.body.answers, { "seen:tour": "2026-08-08T10:00:00Z" });

  const noUser = await call(mount, { method: "GET", subPath: "preferences", db });
  assert.equal(noUser.status, 400);
  const badBody = await call(mount, {
    method: "PUT",
    subPath: "preferences",
    db,
    body: { answers: { a: 1 } },
  });
  assert.equal(badBody.status, 400);

  const other = await call(mount, {
    method: "GET",
    subPath: "preferences",
    db,
    query: { user: "autre" },
  });
  assert.deepEqual(other.body.answers, {});
});

test("interactive-demo : kind waitFor (validation + mount PUT)", async () => {
  const mod = await loadDist();
  const { validateDemoScenario } = mod;

  const scenarioWith = (step) => ({ id: "w", title: "WaitFor", steps: [step] });

  // Valide : target seul, url seul, target+url+absent.
  assert.deepEqual(
    validateDemoScenario(
      scenarioWith({ id: "w1", kind: "waitFor", target: { selector: "main h1" } }),
    ),
    [],
  );
  assert.deepEqual(
    validateDemoScenario(scenarioWith({ id: "w2", kind: "waitFor", url: "/taches" })),
    [],
  );
  assert.deepEqual(
    validateDemoScenario(
      scenarioWith({
        id: "w3",
        kind: "waitFor",
        target: ".spinner",
        absent: true,
        url: "/mails",
        timeoutMs: 12000,
      }),
    ),
    [],
  );

  // Invalide : ni target ni url ; url ne commençant pas par « / » ; cible vide.
  assert.ok(
    validateDemoScenario(scenarioWith({ id: "w", kind: "waitFor" })).includes(
      "etape_0_cible_ou_url_requise",
    ),
  );
  assert.ok(
    validateDemoScenario(
      scenarioWith({ id: "w", kind: "waitFor", url: "taches" }),
    ).includes("etape_0_url_invalide"),
  );
  assert.ok(
    validateDemoScenario(
      scenarioWith({ id: "w", kind: "waitFor", target: {} }),
    ).includes("etape_0_cible_invalide"),
  );

  // Mount : PUT accepte un scénario avec waitFor, rejette waitFor vide (400).
  const db = await createDb(mod.interactiveDemoMigrations());
  const mount = mod.createInteractiveDemoMount({ defaults: DEFAULTS });

  const ok = await call(mount, {
    method: "PUT",
    subPath: "scenarios/tour",
    db,
    body: {
      steps: [
        { id: "intro", kind: "say", title: "Bienvenue" },
        { id: "attend", kind: "waitFor", target: { selector: "main h1" }, url: "/taches" },
      ],
    },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.scenario.steps[1].kind, "waitFor");

  const rejected = await call(mount, {
    method: "PUT",
    subPath: "scenarios/tour",
    db,
    body: { steps: [{ id: "attend", kind: "waitFor" }] },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "scenario_invalide");
  assert.ok(rejected.body.details.includes("etape_0_cible_ou_url_requise"));
});

test("interactive-demo : scénarios par rôle (validation + filtre + mount)", async () => {
  const mod = await loadDist();
  const { validateDemoScenario, scenarioMatchesRole, mergeDemoScenarios } = mod;
  assert.equal(typeof scenarioMatchesRole, "function");

  // Validation roles : tableau de strings non vides, sinon roles_invalide.
  assert.deepEqual(validateDemoScenario({ ...DEFAULTS[0], roles: ["admin"] }), []);
  assert.deepEqual(validateDemoScenario({ ...DEFAULTS[0], roles: [] }), []);
  assert.ok(
    validateDemoScenario({ ...DEFAULTS[0], roles: "admin" }).includes("roles_invalide"),
  );
  assert.ok(
    validateDemoScenario({ ...DEFAULTS[0], roles: ["admin", 1] }).includes(
      "roles_invalide",
    ),
  );

  // Logique de filtre (celle du lanceur/autoStart d'InteractiveDemoRoot).
  assert.equal(scenarioMatchesRole({}, null), true, "role null → pas de filtre");
  assert.equal(scenarioMatchesRole({ roles: ["admin"] }, null), true);
  assert.equal(scenarioMatchesRole({ roles: ["admin"] }, undefined), true);
  assert.equal(scenarioMatchesRole({}, "membre"), true, "sans roles → tous");
  assert.equal(scenarioMatchesRole({ roles: [] }, "membre"), true, "roles vide → tous");
  assert.equal(scenarioMatchesRole({ roles: ["admin"] }, "membre"), false);
  assert.equal(scenarioMatchesRole({ roles: ["admin", "membre"] }, "membre"), true);

  // Merge : roles des défauts conservés, override roles = remplacement.
  const merged = mergeDemoScenarios(
    [{ ...DEFAULTS[0], roles: ["admin"] }],
    [{ id: "tour", roles: ["membre"] }],
  );
  assert.deepEqual(merged[0].roles, ["membre"]);
  const kept = mergeDemoScenarios([{ ...DEFAULTS[0], roles: ["admin"] }], []);
  assert.deepEqual(kept[0].roles, ["admin"]);

  // Mount : PUT roles valide → 200 (mergé), roles invalide → 400.
  const db = await createDb(mod.interactiveDemoMigrations());
  const mount = mod.createInteractiveDemoMount({ defaults: DEFAULTS });
  const ok = await call(mount, {
    method: "PUT",
    subPath: "scenarios/tour",
    db,
    body: { roles: ["admin"] },
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.scenario.roles, ["admin"]);
  const bad = await call(mount, {
    method: "PUT",
    subPath: "scenarios/tour",
    db,
    body: { roles: "admin" },
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.includes("roles_invalide"));
});

test("interactive-demo : osFeatureChapters + genericOsTourScenario recomposé", async () => {
  const mod = await loadDist();
  const { osFeatureChapters, genericOsTourScenario, validateDemoScenario } = mod;
  assert.equal(typeof osFeatureChapters, "function");

  const base = osFeatureChapters();
  const baseExplicit = osFeatureChapters({ isAdmin: false });
  const admin = osFeatureChapters({ isAdmin: true });

  assert.equal(base.length, baseExplicit.length, "défaut = isAdmin:false");
  assert.ok(
    admin.length > base.length,
    "isAdmin:true ajoute les chapitres admin",
  );

  for (const step of admin) {
    assert.match(step.id, /^os-/, `id préfixé os- : ${step.id}`);
    if (step.kind !== "navigate") {
      assert.equal(step.optional, true, `cible optional : ${step.id}`);
    }
  }
  assert.equal(
    new Set(admin.map((s) => s.id)).size,
    admin.length,
    "ids de chapitres uniques",
  );

  // Chapitres attendus (tous rôles + admin).
  const ids = new Set(admin.map((s) => s.id));
  for (const expected of [
    "os-taches-nav",
    "os-taches-carte",
    "os-mails-nav",
    "os-assistant-carte",
    "os-parametres-nav",
    "os-collaborateurs-nav",
    "os-configuration-nav",
    "os-analytics-nav",
    "os-database-nav",
    "os-plugins-nav",
    "os-integrations-nav",
    "os-api-nav",
    "os-mcp-nav",
    "os-request-logs-nav",
  ]) {
    assert.ok(ids.has(expected), `chapitre attendu : ${expected}`);
  }
  // Sous-pages admin : navigate (le groupe Admin peut être replié).
  for (const s of admin) {
    if (/^os-(analytics|database|plugins|integrations|api|mcp|request-logs)-nav$/.test(s.id)) {
      assert.equal(s.kind, "navigate", `${s.id} doit être un navigate`);
      assert.match(s.href, /^\/admin\//);
    }
  }

  // Chapitres composables dans un scénario arbitraire : valides tels quels.
  assert.deepEqual(
    validateDemoScenario({ id: "x", title: "X", steps: admin }),
    [],
  );

  // Scénario générique recomposé : rétrocompatible et valide.
  const tour = genericOsTourScenario({ productName: "Demo" });
  assert.equal(tour.id, "os-tour", "id de scénario inchangé");
  assert.equal(tour.autoStart, false, "autoStart inchangé");
  assert.deepEqual(validateDemoScenario(tour), []);
  assert.equal(tour.steps[0].id, "welcome");
  assert.equal(tour.steps[1].id, "sidebar");
  assert.equal(tour.steps[tour.steps.length - 1].id, "end");
  const tourIds = tour.steps.map((s) => s.id);
  assert.ok(tourIds.includes("os-taches-nav"), "chapitres OS composés");
  assert.ok(
    !tourIds.some((id) => id.startsWith("os-analytics")),
    "pas de chapitre admin dans le tour générique",
  );
});

test("interactive-demo : surface UI (exports ./ui + CSS + composants)", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PKG, "package.json"), "utf8"),
  );
  assert.equal(pkg.exports["./ui"].import, "./ui/index.ts");
  assert.equal(
    pkg.exports["./ui/interactive-demo.css"],
    "./ui/interactive-demo.css",
  );
  for (const f of [
    "ui/index.ts",
    "ui/demo-root.tsx",
    "ui/demo-player.tsx",
    "ui/fake-cursor.ts",
    "ui/dom.ts",
    "ui/interactive-demo.css",
  ]) {
    assert.ok(fs.existsSync(path.join(PKG, f)), `fichier UI manquant: ${f}`);
  }
  const uiIndex = fs.readFileSync(path.join(PKG, "ui/index.ts"), "utf8");
  assert.match(uiIndex, /InteractiveDemoRoot/);
  assert.match(uiIndex, /DemoPlayer/);
  assert.match(uiIndex, /startInteractiveDemo/);
});
