#!/usr/bin/env node
/**
 * Gate — @creezio/access-control (visibilité modules/sidebar par rôle).
 *
 * Prouve, sur un core.db temporaire :
 *  1. résolution dynamique : défauts déclaratifs du rôle + overrides DB
 *     (deny l'emporte, allow ajoute), cache 30 s invalidé aux écritures ;
 *  2. rôle d'un compte : SoT métier (adaptateurs) > table interne
 *     access_user_roles > brandRole > defaultRole ;
 *  3. API /api/v1/access/* : garde platform.access.manage (owner OK,
 *     impersonation interdite, collaborateur sans la permission → 403,
 *     anonyme → 401) ;
 *  4. GET /matrix expose rôles (owner verrouillé), groupes (Plateforme natif
 *     + catalogue marque), défauts, effectifs et overrides ;
 *  5. PUT /matrix applique allow/deny/inherit, audit écrit, owner figé → 400,
 *     rôle/permission inconnus → 400 ;
 *  6. GET /users + PUT /users/:id/role (table interne ET adaptateurs métier),
 *     owner figé → 400, compte inconnu → 404 ;
 *  7. GET /audit paginé, plus récent d'abord ;
 *  8. module non configuré → 404 propre ;
 * P4 permissions par module (mode admin) :
 *  10. overrides PAR COMPTE (access_user_overrides) : allow ajoute, deny
 *      retire, priorité sur le rôle ET ses overrides ;
 *  11. PUT /users/:id/permissions : set/clear + audit user.override.*,
 *      owner figé → 400, permission inconnue → 400 ; GET /users expose
 *      roleBaseline + overrides ;
 *  12. @creezio/admin : mounts gardés (permission par module), routes
 *      machine préservées (webhook Stripe, register/heartbeat, agent
 *      releases), preset adminAccessControlPreset = migration sans lockout
 *      (collaborateur → tous les modules par défaut).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

process.env.AUTH_SECRET = "gate-access-control-secret";

const { openNodeSqliteDatabase } = await import(
  "../packages/database/dist/index.js"
);
const {
  configureAccessControl,
  resetAccessControlForTests,
  createSqliteAccessStore,
  registerAccessControlStore,
  resetAccessControlStoreForTests,
  getAccessControlStore,
  resolvePermissions,
  resolveRoleEffectivePermissions,
  resolveUserRole,
  invalidateAccessControlCaches,
  createAccessControlRoutes,
  ACCESS_MANAGE_PERMISSION,
} = await import("../packages/access-control/dist/index.js");

const ROLE_DEFAULTS = {
  manager: ["nav.crm", "nav.catalogue", "nav.panier", ACCESS_MANAGE_PERMISSION],
  backoffice: ["nav.crm", "nav.catalogue", "nav.panier"],
  vitrine: [],
};
const OWNER_PERMS = [
  "nav.crm",
  "nav.catalogue",
  "nav.panier",
  ACCESS_MANAGE_PERMISSION,
  "platform.users.manage",
];

function setup({ adapters } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creezio-acl-gate-"));
  const db = openNodeSqliteDatabase(path.join(dir, "core.db"));
  const store = createSqliteAccessStore({ db });
  registerAccessControlStore(store);
  configureAccessControl({
    roles: [
      { id: "manager", label: "Manager", defaultPermissions: ROLE_DEFAULTS.manager },
      { id: "backoffice", label: "Backoffice", defaultPermissions: ROLE_DEFAULTS.backoffice },
      { id: "vitrine", label: "Vitrine", defaultPermissions: [] },
    ],
    defaultRole: "vitrine",
    permissionGroups: [
      {
        id: "catalogue",
        label: "Catalogue",
        permissions: [
          { id: "nav.crm", label: "CRM" },
          { id: "nav.catalogue", label: "Catalogue" },
          { id: "nav.panier", label: "Panier" },
        ],
      },
    ],
    ...(adapters ?? {}),
  });
  invalidateAccessControlCaches();
  return {
    db,
    store,
    cleanup: () => {
      resetAccessControlForTests();
      resetAccessControlStoreForTests();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ownerSession = {
  sub: "u-owner",
  email: "patron@gate.local",
  role: "owner",
  permissions: OWNER_PERMS,
};
const collabSession = {
  sub: "u-collab",
  email: "vendeur@gate.local",
  role: "collaborator",
  permissions: [],
};
const impersonatedOwner = {
  ...ownerSession,
  sub: "u-collab",
  role: "collaborator",
  actorSub: "u-owner",
  actorRole: "owner",
};

const USERS = [
  { id: "u-owner", username: "patron", role: "owner", kind: "human", active: true },
  { id: "u-collab", username: "vendeur", role: "collaborator", kind: "human", active: true },
];

function routeDeps(session) {
  return {
    getSession: async () => session,
    listUsers: () => USERS,
    getUserById: (id) => USERS.find((u) => u.id === id) ?? null,
    ownerPermissions: () => OWNER_PERMS,
    userAdminPermission: () => "platform.users.manage",
  };
}

async function call(app, routePath, init) {
  const res = await app.request(`http://localhost${routePath}`, init);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test("1. résolution : défauts du rôle, deny l'emporte, allow ajoute", async () => {
  const { store, cleanup } = setup();
  try {
    assert.deepEqual(await resolvePermissions("u-a", "backoffice"), ROLE_DEFAULTS.backoffice);
    assert.deepEqual(await resolvePermissions("u-a", "vitrine"), []);
    assert.deepEqual(await resolvePermissions("u-a", null), []); // defaultRole vitrine

    store.setOverride("backoffice", "nav.panier", "deny", "patron");
    store.setOverride("vitrine", "nav.crm", "allow", "patron");
    invalidateAccessControlCaches();
    assert.deepEqual(await resolvePermissions("u-b1", "backoffice"), ["nav.crm", "nav.catalogue"]);
    assert.deepEqual(await resolvePermissions("u-b2", "vitrine"), ["nav.crm"]);
    assert.deepEqual(resolveRoleEffectivePermissions("backoffice"), ["nav.crm", "nav.catalogue"]);
  } finally {
    cleanup();
  }
});

test("2. cache 30 s : override invisible tant que non invalidé", async () => {
  const { store, cleanup } = setup();
  try {
    assert.equal((await resolvePermissions("u-cache", "backoffice")).includes("nav.panier"), true);
    store.setOverride("backoffice", "nav.panier", "deny", "patron");
    assert.equal((await resolvePermissions("u-cache", "backoffice")).includes("nav.panier"), true);
    invalidateAccessControlCaches("u-cache");
    assert.equal((await resolvePermissions("u-cache", "backoffice")).includes("nav.panier"), false);
  } finally {
    cleanup();
  }
});

test("3. rôle compte : table interne > brandRole > defaultRole ; adaptateurs métier", async () => {
  const { store, cleanup } = setup();
  try {
    assert.equal(await resolveUserRole("u-x", null), "vitrine"); // defaultRole
    assert.equal(await resolveUserRole("u-x", "staff-legacy"), "staff-legacy"); // brandRole
    store.setUserRole("u-x", "manager", "patron");
    assert.equal(await resolveUserRole("u-x", "staff-legacy"), "manager"); // table gagne
    store.setUserRole("u-x", null, "patron");
    assert.equal(await resolveUserRole("u-x", null), "vitrine");
  } finally {
    cleanup();
  }

  const external = new Map([["u-y", "backoffice"]]);
  const calls = [];
  const { cleanup: cleanup2 } = setup({
    adapters: {
      getUserRole: (userId) => external.get(userId) ?? null,
      setUserRole: ({ userId, role, actor }) => {
        calls.push({ userId, role, actor });
        if (role === null) external.delete(userId);
        else external.set(userId, role);
      },
    },
  });
  try {
    assert.equal(await resolveUserRole("u-y", null), "backoffice"); // SoT métier
    assert.equal(await resolveUserRole("u-z", null), "vitrine"); // fallback défaut
    assert.equal(getAccessControlStore()?.getUserRole("u-y"), null); // pas de doublon interne
    void calls;
  } finally {
    cleanup2();
  }
});

test("4. garde API : owner OK, impersonation 403, collaborateur sans permission 403, anonyme 401", async () => {
  const { cleanup } = setup();
  try {
    const asOwner = createAccessControlRoutes(routeDeps(ownerSession));
    assert.equal((await call(asOwner, "/matrix")).status, 200);

    const asImpersonated = createAccessControlRoutes(routeDeps(impersonatedOwner));
    assert.equal((await call(asImpersonated, "/matrix")).status, 403);

    const asCollab = createAccessControlRoutes(routeDeps(collabSession));
    assert.equal((await call(asCollab, "/matrix")).status, 403);

    const anonymous = createAccessControlRoutes(routeDeps(null));
    assert.equal((await call(anonymous, "/matrix")).status, 401);
  } finally {
    cleanup();
  }
});

test("4b. collaborateur AVEC platform.access.manage (rôle manager) → 200", async () => {
  const { store, cleanup } = setup();
  try {
    store.setUserRole("u-collab", "manager", "patron");
    const asManager = createAccessControlRoutes(routeDeps(collabSession));
    assert.equal((await call(asManager, "/matrix")).status, 200);
  } finally {
    cleanup();
  }
});

test("5. GET /matrix : rôles (owner figé), groupes (Plateforme natif), défauts/effectifs/overrides", async () => {
  const { store, cleanup } = setup();
  try {
    store.setOverride("backoffice", "nav.panier", "deny", "patron");
    const app = createAccessControlRoutes(routeDeps(ownerSession));
    const { status, body } = await call(app, "/matrix");
    assert.equal(status, 200);
    assert.equal(body.managePermission, ACCESS_MANAGE_PERMISSION);

    const owner = body.roles.find((r) => r.id === "owner");
    assert.equal(owner.locked, true);
    assert.deepEqual(owner.defaults, OWNER_PERMS);

    const backoffice = body.roles.find((r) => r.id === "backoffice");
    assert.equal(backoffice.locked, false);
    assert.deepEqual(backoffice.defaults, ROLE_DEFAULTS.backoffice);
    assert.deepEqual(backoffice.effective, ["nav.crm", "nav.catalogue"]);

    const platformGroup = body.groups.find((g) => g.id === "platform");
    const platformIds = platformGroup.permissions.map((p) => p.id);
    assert.ok(platformIds.includes(ACCESS_MANAGE_PERMISSION));
    assert.ok(platformIds.includes("platform.users.manage"));
    const catalogue = body.groups.find((g) => g.id === "catalogue");
    assert.deepEqual(catalogue.permissions.map((p) => p.id), ["nav.crm", "nav.catalogue", "nav.panier"]);

    assert.equal(body.overrides.length, 1);
    assert.deepEqual(
      { role: body.overrides[0].role, permission: body.overrides[0].permission, effect: body.overrides[0].effect },
      { role: "backoffice", permission: "nav.panier", effect: "deny" },
    );
  } finally {
    cleanup();
  }
});

test("6. PUT /matrix : allow/deny/inherit + audit + validations", async () => {
  const { store, cleanup } = setup();
  try {
    const app = createAccessControlRoutes(routeDeps(ownerSession));
    const put = await call(app, "/matrix", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          { role: "backoffice", permission: "nav.panier", effect: "deny" },
          { role: "vitrine", permission: "nav.crm", effect: "allow" },
        ],
      }),
    });
    assert.equal(put.status, 200);
    assert.equal(put.body.ok, true);
    assert.equal(put.body.overrides.length, 2);
    // La route invalide le cache : résolution immédiate.
    assert.deepEqual(await resolvePermissions("u-c1", "backoffice"), ["nav.crm", "nav.catalogue"]);
    assert.deepEqual(await resolvePermissions("u-c2", "vitrine"), ["nav.crm"]);

    // inherit retire l'override (retour au défaut).
    const back = await call(app, "/matrix", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [{ role: "vitrine", permission: "nav.crm", effect: "inherit" }] }),
    });
    assert.equal(back.status, 200);
    assert.deepEqual(await resolvePermissions("u-c2", "vitrine"), []);

    const audit = store.listAudit(50);
    assert.deepEqual(audit.map((a) => a.action), ["override.clear", "override.set", "override.set"]);
    assert.ok(audit.every((a) => a.actor === "patron@gate.local"));
    assert.equal(audit[1].effect, "allow");

    // Validations.
    for (const [changes, expected] of [
      [[{ role: "owner", permission: "nav.crm", effect: "deny" }], 400],
      [[{ role: "nope", permission: "nav.crm", effect: "deny" }], 400],
      [[{ role: "backoffice", permission: "nav.nope", effect: "deny" }], 400],
      [[{ role: "backoffice", permission: "nav.crm", effect: "maybe" }], 400],
    ]) {
      const res = await call(app, "/matrix", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      assert.equal(res.status, expected, JSON.stringify(changes));
    }
  } finally {
    cleanup();
  }
});

test("7. GET /users + PUT /users/:id/role (table interne puis adaptateurs métier)", async () => {
  const { cleanup } = setup();
  try {
    const app = createAccessControlRoutes(routeDeps(ownerSession));
    const list = await call(app, "/users");
    assert.equal(list.status, 200);
    const vendeur = list.body.users.find((u) => u.username === "vendeur");
    assert.equal(vendeur.kitRole, "collaborator");
    assert.equal(vendeur.role, "vitrine"); // defaultRole
    assert.deepEqual(vendeur.permissions, []);
    const patron = list.body.users.find((u) => u.username === "patron");
    assert.equal(patron.role, "owner");
    assert.deepEqual(patron.permissions, OWNER_PERMS);
    assert.deepEqual(list.body.roles.map((r) => r.id), ["manager", "backoffice", "vitrine"]);
    assert.equal(list.body.defaultRole, "vitrine");

    const promote = await call(app, "/users/u-collab/role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "backoffice" }),
    });
    assert.equal(promote.status, 200);
    assert.deepEqual(promote.body.user.permissions, ROLE_DEFAULTS.backoffice);

    const list2 = await call(app, "/users");
    assert.equal(list2.body.users.find((u) => u.id === "u-collab").role, "backoffice");

    // null → retour au rôle par défaut.
    const demote = await call(app, "/users/u-collab/role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: null }),
    });
    assert.equal(demote.status, 200);
    assert.equal((await call(app, "/users")).body.users.find((u) => u.id === "u-collab").role, "vitrine");

    // Validations.
    assert.equal(
      (await call(app, "/users/u-collab/role", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "nope" }),
      })).status,
      400,
    );
    assert.equal(
      (await call(app, "/users/u-owner/role", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "vitrine" }),
      })).status,
      400,
    );
    assert.equal(
      (await call(app, "/users/u-ghost/role", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "vitrine" }),
      })).status,
      404,
    );

    const audit = (await call(app, "/audit?limit=10")).body.entries;
    assert.equal(audit.filter((a) => a.action === "user.role").length, 2);
    const last = audit[0];
    assert.equal(last.action, "user.role");
    assert.equal(last.targetUserId, "u-collab");
    assert.equal(last.detail.username, "vendeur");
  } finally {
    cleanup();
  }
});

test("7b. PUT /users/:id/role délègue au SoT métier quand adaptateurs déclarés", async () => {
  const external = new Map();
  const writes = [];
  const { cleanup } = setup({
    adapters: {
      getUserRole: (userId) => external.get(userId) ?? null,
      setUserRole: ({ userId, role, actor }) => {
        writes.push({ userId, role, actor });
        if (role === null) external.delete(userId);
        else external.set(userId, role);
      },
    },
  });
  try {
    const app = createAccessControlRoutes(routeDeps(ownerSession));
    const res = await call(app, "/users/u-collab/role", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "manager" }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(writes, [{ userId: "u-collab", role: "manager", actor: "patron@gate.local" }]);
    assert.equal(external.get("u-collab"), "manager");
    assert.equal(getAccessControlStore().getUserRole("u-collab"), null); // pas de doublon interne
  } finally {
    cleanup();
  }
});

test("8. GET /audit : limite et ordre desc", async () => {
  const { store, cleanup } = setup();
  try {
    for (let i = 0; i < 5; i += 1) {
      store.setOverride("backoffice", `nav.crm`, "deny", "patron");
      store.clearOverride("backoffice", "nav.crm");
      store.logAudit({ actor: "patron", action: "probe", permission: `nav.p${i}` });
    }
    const app = createAccessControlRoutes(routeDeps(ownerSession));
    const { status, body } = await call(app, "/audit?limit=3");
    assert.equal(status, 200);
    assert.equal(body.entries.length, 3);
    assert.equal(body.entries[0].permission, "nav.p4");
    const all = await call(app, "/audit");
    assert.equal(all.body.entries.length, 5);
  } finally {
    cleanup();
  }
});

test("9. module non configuré → 404 propre ; validations de config", async () => {
  resetAccessControlForTests();
  resetAccessControlStoreForTests();
  const app = createAccessControlRoutes(routeDeps(ownerSession));
  const res = await call(app, "/matrix");
  assert.equal(res.status, 404);
  assert.match(res.body.error, /non configuré/);

  assert.throws(() =>
    configureAccessControl({
      roles: [
        { id: "a", label: "A", defaultPermissions: [] },
        { id: "a", label: "B", defaultPermissions: [] },
      ],
    }),
  );
  assert.throws(() =>
    configureAccessControl({
      roles: [{ id: "a", label: "A", defaultPermissions: [] }],
      defaultRole: "missing",
    }),
  );
  assert.throws(() =>
    configureAccessControl({
      roles: [{ id: "a", label: "A", defaultPermissions: [] }],
      getUserRole: () => null,
    }),
  );
  resetAccessControlForTests();
});

// ---------------------------------------------------------------------------
// P4 — permissions par module (mode admin) : overrides par compte
// ---------------------------------------------------------------------------

test("10. overrides PAR COMPTE : allow ajoute, deny retire, priorité sur le rôle", async () => {
  const { store, cleanup } = setup();
  try {
    // Baseline backoffice : crm + catalogue + panier.
    assert.deepEqual(await resolvePermissions("u-solo", "backoffice"), ROLE_DEFAULTS.backoffice);

    // deny compte : retire une permission du rôle — les autres comptes gardent tout.
    store.setUserOverride("u-solo", "nav.panier", "deny", "patron");
    invalidateAccessControlCaches("u-solo");
    assert.deepEqual(await resolvePermissions("u-solo", "backoffice"), ["nav.crm", "nav.catalogue"]);
    assert.deepEqual(await resolvePermissions("u-autre", "backoffice"), ROLE_DEFAULTS.backoffice);

    // allow compte : ajoute une permission absente du rôle (vitrine = []).
    store.setUserOverride("u-solo2", "nav.crm", "allow", "patron");
    invalidateAccessControlCaches("u-solo2");
    assert.deepEqual(await resolvePermissions("u-solo2", "vitrine"), ["nav.crm"]);

    // priorité : allow compte l'emporte sur un deny du RÔLE.
    store.setOverride("backoffice", "nav.catalogue", "deny", "patron");
    store.setUserOverride("u-solo3", "nav.catalogue", "allow", "patron");
    invalidateAccessControlCaches();
    assert.equal((await resolvePermissions("u-solo3", "backoffice")).includes("nav.catalogue"), true);
    assert.equal((await resolvePermissions("u-autre", "backoffice")).includes("nav.catalogue"), false);

    // clear : retour au rôle.
    store.clearUserOverride("u-solo", "nav.panier");
    invalidateAccessControlCaches("u-solo");
    assert.equal((await resolvePermissions("u-solo", "backoffice")).includes("nav.panier"), true);
  } finally {
    cleanup();
  }
});

test("11. PUT /users/:id/permissions : set/clear + audit ; GET /users expose roleBaseline/overrides", async () => {
  const { store, cleanup } = setup();
  try {
    const app = createAccessControlRoutes(routeDeps(ownerSession));

    const put = await call(app, "/users/u-collab/permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: [
          { permission: "nav.crm", effect: "allow" },
          { permission: "nav.panier", effect: "deny" },
        ],
      }),
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.user.permissions, ["nav.crm"]); // vitrine=[] + allow crm (deny panier sans effet visible)
    assert.deepEqual(
      put.body.user.overrides,
      [
        { permission: "nav.crm", effect: "allow" },
        { permission: "nav.panier", effect: "deny" },
      ],
    );

    const list = await call(app, "/users");
    const vendeur = list.body.users.find((u) => u.id === "u-collab");
    assert.deepEqual(vendeur.permissions, ["nav.crm"]);
    assert.deepEqual(vendeur.roleBaseline, []); // défauts du rôle vitrine
    assert.equal(vendeur.overrides.length, 2);

    // inherit : retour au rôle + audit clear.
    const back = await call(app, "/users/u-collab/permissions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: [{ permission: "nav.crm", effect: "inherit" }] }),
    });
    assert.equal(back.status, 200);
    assert.deepEqual(back.body.user.permissions, []);

    const actions = store.listAudit(10).map((a) => a.action);
    assert.deepEqual(actions, ["user.override.clear", "user.override.set", "user.override.set"]);

    // Validations : owner figé, permission inconnue, compte inconnu, anonyme.
    assert.equal(
      (await call(app, "/users/u-owner/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [{ permission: "nav.crm", effect: "allow" }] }),
      })).status,
      400,
    );
    assert.equal(
      (await call(app, "/users/u-collab/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [{ permission: "nav.nope", effect: "allow" }] }),
      })).status,
      400,
    );
    assert.equal(
      (await call(app, "/users/u-ghost/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [] }),
      })).status,
      404,
    );
    const anonymous = createAccessControlRoutes(routeDeps(null));
    assert.equal(
      (await call(anonymous, "/users/u-collab/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [] }),
      })).status,
      401,
    );
  } finally {
    cleanup();
  }
});

test("12. @creezio/admin : mounts gardés par module, routes machine préservées, preset sans lockout", async () => {
  const {
    ADMIN_MODULE_PERMISSIONS,
    adminAccessControlPreset,
    createFleetAdminMount,
    createSupportAdminMount,
    createBillingAdminMount,
    createBillingWebhookMount,
    createAdminCrudMount,
    createFleetRegistryMount,
    createFleetReleasesMount,
  } = await import("../packages/admin/dist/index.js");

  // Mounts session : permission par module déclarée (garde authorizeModuleAccess).
  assert.equal(createFleetAdminMount().permission, ADMIN_MODULE_PERMISSIONS.fleet);
  assert.equal(createSupportAdminMount().permission, ADMIN_MODULE_PERMISSIONS.support);
  assert.equal(createBillingAdminMount().permission, ADMIN_MODULE_PERMISSIONS.billing);
  // billing-* = projections Stripe du module billing (nav.clients est la
  // permission du module `clients` scaffoldé côté app admin, pas ce mount).
  assert.equal(
    createAdminCrudMount("billing-customers").permission,
    ADMIN_MODULE_PERMISSIONS.billing,
  );
  assert.equal(
    createAdminCrudMount("billing-subscriptions").permission,
    ADMIN_MODULE_PERMISSIONS.billing,
  );
  assert.equal(
    createAdminCrudMount("prospects").permission,
    ADMIN_MODULE_PERMISSIONS.prospects,
  );
  assert.equal(
    createAdminCrudMount("roadmap").permission,
    ADMIN_MODULE_PERMISSIONS.roadmap,
  );

  // Webhook Stripe : PAS de permission session (signature = auth) — justifié.
  const webhook = createBillingWebhookMount();
  assert.equal(webhook.permission, undefined);
  assert.ok(String(webhook.accessJustification || "").length > 10);

  // Registry/releases : ops session gardées, routes machine (host-agent v1)
  // SANS permission — register/heartbeat/next/slots/report/maintenance
  // gardent leur propre auth (Bearer/HMAC), alignées PUBLIC_MODULE_PATHS.
  const registry = createFleetRegistryMount();
  const regOps = new Map(registry.operations.map((o) => [o.id, o]));
  assert.equal(regOps.get("list-servers").permission, ADMIN_MODULE_PERMISSIONS.fleet);
  assert.equal(regOps.get("register").permission, undefined);
  assert.equal(regOps.get("heartbeat").permission, undefined);

  const releases = createFleetReleasesMount();
  const relOps = new Map(releases.operations.map((o) => [o.id, o]));
  assert.equal(relOps.get("list-releases").permission, ADMIN_MODULE_PERMISSIONS.fleet);
  for (const machineOp of ["next", "create-slot", "delete-slot", "report", "maintenance"]) {
    assert.equal(relOps.get(machineOp).permission, undefined, machineOp);
  }

  // Preset : migration sans lockout — collaborateur = TOUS les modules par
  // défaut ; l'owner restreint ensuite par compte (overrides) ou par rôle.
  const preset = adminAccessControlPreset();
  const collab = preset.roles.find((r) => r.id === "collaborator");
  assert.ok(collab, "rôle collaborator présent");
  assert.equal(preset.defaultRole, "collaborator");
  for (const perm of Object.values(ADMIN_MODULE_PERMISSIONS)) {
    assert.ok(
      collab.defaultPermissions.includes(perm),
      `défaut collaborateur inclut ${perm}`,
    );
  }
  const groupPerms = preset.permissionGroups.flatMap((g) =>
    g.permissions.map((p) => p.id),
  );
  for (const perm of Object.values(ADMIN_MODULE_PERMISSIONS)) {
    assert.ok(groupPerms.includes(perm), `catalogue expose ${perm}`);
  }

  // Extension marque : groupes + permissions additionnels fusionnés.
  const extended = adminAccessControlPreset({
    extraGroups: [
      { id: "metier", label: "Métier", permissions: [{ id: "nav.metier", label: "Métier" }] },
    ],
    extraCollaboratorPermissions: ["nav.metier"],
  });
  assert.ok(
    extended.roles.find((r) => r.id === "collaborator").defaultPermissions.includes("nav.metier"),
  );
  assert.ok(extended.permissionGroups.some((g) => g.id === "metier"));
});

test("13. factory admin bindings : extraGroups collectPermissionGroups + applyBrandModuleAuth", () => {
  const src = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../packages/factory/src/admin-repo.ts",
    ),
    "utf8",
  );
  assert.match(src, /extraGroups:\s*collectPermissionGroups\(\)/);
  assert.match(src, /applyBrandModuleAuth/);
  assert.match(src, /ownerPermissions:\s*collectNavPermissions\(\)/);
  assert.doesNotMatch(
    src,
    /configureAccessControl\(adminAccessControlPreset\(\)\)/,
  );
});