#!/usr/bin/env node
/**
 * Gate contrat fondateur 0.10.6 — une op dans le module = HTTP + /admin/api + MCP.
 *
 * Couvre : CRUD EntitySpec auto, listTools `module.test.from-panier` (handler =
 * req synthétique → handle()), seed mcp_tool_policies, catalogue kernel,
 * doctor MODULE_OP_MISSING / UNCATALOGUED / MCP_OVERLAP /
 * MODULE_MCP_TOOLS_DEPRECATED (error).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectKernelOperationRoutes,
  collectListedOperationRoutes,
  createApiKernel,
  createEntityApiMount,
  entityOperationsFromSpec,
  matchModuleOperation,
  operationsFromEntitySpec,
  resolveOperationHttpPath,
} from "../packages/api-kernel/dist/index.js";
import {
  configureMcpAdmin,
  createMcpFacade,
  discoverModuleToolsFromBrandModules,
  generateModuleToolsFromListedOps,
  generateModuleToolsFromMountedOps,
  generateModuleToolsFromOperations,
  resetMcpAdminAdaptersForTests,
  seedMcpToolPolicies,
  getStoredMcpToolPolicy,
} from "../packages/mcp-facade/dist/index.js";
import { DatabaseSync } from "node:sqlite";
import { buildApiEndpointsRegistry } from "../packages/observability/dist/index.js";
import {
  doctorBrandSpec,
  formatDoctorReport,
  initBrandSpec,
} from "../packages/brand-spec/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MO0 listOperations + registry : 1 op de mount apparaît", () => {
  const api = createApiKernel({ brandId: "demobrand" });
  api.registerModuleApi("notes", {
    dbLayer: "brand",
    operations: [
      {
        id: "ping",
        method: "GET",
        path: "/ping",
        description: "Sonde notes",
      },
    ],
    handle: async () => ({ status: 200, body: { ok: true } }),
  });
  const listed = api.listOperations();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].mountId, "notes");
  assert.equal(listed[0].op.id, "ping");
  assert.equal(listed[0].space, "module");
  const mount = api.listMounts().find((m) => m.id === "notes");
  assert.ok(mount?.operations?.some((o) => o.id === "ping"));
  const registry = buildApiEndpointsRegistry({
    routes: [
      { method: "GET", path: "/api/v1/admin/endpoints" },
      ...collectListedOperationRoutes(listed),
    ],
    source: "test-module-ops-catalogue",
  });
  assert.ok(
    registry.endpoints.some(
      (e) => e.method === "GET" && e.path === "/api/v1/modules/notes/ping",
    ),
    "catalogue contient l'op métier /api/v1/modules/<mount><path>",
  );
  assert.ok(
    registry.endpoints.some((e) => e.path === "/api/v1/admin/endpoints"),
    "surface admin Hono conservée",
  );
});

test("MO1 EntitySpec → ops CRUD auto + extra operations", () => {
  const spec = {
    table: "notes",
    columns: [{ name: "titre" }],
    archivable: true,
    operations: [
      {
        id: "pin",
        method: "POST",
        path: "/:id/pin",
        description: "Épingler une note",
      },
    ],
  };
  assert.equal(entityOperationsFromSpec, operationsFromEntitySpec);
  const ops = operationsFromEntitySpec(spec);
  assert.deepEqual(
    ops.map((o) => o.id),
    ["list", "create", "get", "update", "delete", "archive", "pin"],
  );
  const mount = createEntityApiMount({
    table: "notes",
    columns: [{ name: "titre" }],
  });
  assert.ok(mount.operations?.some((o) => o.id === "list"));
});

test("MO2 listTools module.test.from-panier passe par handle()", async () => {
  let handled = 0;
  let lastReq = null;
  const api = createApiKernel({ brandId: "demobrand" });
  api.registerModuleApi("test", {
    dbLayer: "brand",
    operations: [
      {
        id: "from-panier",
        method: "POST",
        path: "/from-panier",
        description: "Créer depuis le panier",
      },
    ],
    handle: async ({ req }) => {
      handled += 1;
      lastReq = req;
      return { status: 200, body: { ok: true, via: "handle", path: req.path } };
    },
  });

  const generated = generateModuleToolsFromListedOps(api);
  assert.equal(generated.length, 1);
  assert.equal(generated[0].name, "module.test.from-panier");
  assert.equal(generated[0].space, "module");
  assert.equal(generated[0].ownerId, "test");
  assert.equal(generated[0].mcpPublishDefault, false);

  const mcp = createMcpFacade({
    brandId: "demobrand",
    allowUnauthenticated: true,
    publicSurface: "canonical",
    listApiMounts: () => api.listMounts(),
    discoverToolsBySpace: async () => ({
      module: generateModuleToolsFromListedOps(api),
    }),
  });
  const listed = await mcp.listTools({ space: "module" });
  assert.ok(
    listed.tools.some((t) => t.name === "module.test.from-panier"),
    `listTools doit contenir module.test.from-panier, obtenu: ${listed.tools.map((t) => t.name).join(",")}`,
  );

  const result = await mcp.callTool("module.test.from-panier", {
    fournisseur_id: "f1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.content.via, "handle");
  assert.equal(handled, 1);
  assert.equal(lastReq.method, "POST");
  assert.equal(lastReq.path, "/api/v1/modules/test/from-panier");
  assert.equal(lastReq.body.fournisseur_id, "f1");

  const fromMounts = generateModuleToolsFromMountedOps(api);
  assert.ok(fromMounts.some((t) => t.name === "module.test.from-panier"));
  const viaOps = generateModuleToolsFromOperations(
    "test",
    api.listOperations().map((x) => x.op),
    (req) => api.handle(req),
    { mountId: "test" },
  );
  assert.equal(viaOps[0].name, "module.test.from-panier");
});

test("MO2-session callTool propage Bearer/cookie sur la req synthétique", async () => {
  /** @type {{ headers?: Record<string, string | string[] | undefined> } | null} */
  let lastReq = null;
  const api = createApiKernel({ brandId: "demobrand" });
  api.registerModuleApi("strategie", {
    dbLayer: "brand",
    operations: [
      {
        id: "update",
        method: "POST",
        path: "/update",
        description: "Mettre à jour",
        mcpPublishDefault: true,
      },
    ],
    handle: async ({ req }) => {
      lastReq = req;
      const auth = req.headers?.authorization || req.headers?.Authorization;
      if (!auth) return { status: 401, body: { error: "session_requise" } };
      return { status: 200, body: { ok: true } };
    },
  });
  const mcp = createMcpFacade({
    brandId: "demobrand",
    allowUnauthenticated: true,
    publicSurface: "canonical",
    discoverToolsBySpace: async () => ({
      module: generateModuleToolsFromListedOps(api),
    }),
  });
  const denied = await mcp.callTool("module.strategie.update", { zone: "x" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "session_requise");

  const jwt = "aaa.bbb.ccc";
  const ok = await mcp.callTool(
    "module.strategie.update",
    { zone: "Normandie" },
    {
      bearerToken: jwt,
      headers: { cookie: `creezio_session=${jwt}` },
    },
  );
  assert.equal(ok.ok, true);
  assert.ok(lastReq?.headers);
  assert.equal(lastReq.headers.authorization, `Bearer ${jwt}`);
  assert.equal(lastReq.headers.cookie, `creezio_session=${jwt}`);
});

test("MO2b seed mcp_tool_policies depuis tools générés (mcpPublishDefault → enabled)", () => {
  const db = new DatabaseSync(":memory:");
  resetMcpAdminAdaptersForTests();
  configureMcpAdmin({
    getDb: () => db,
    getWriteDb: () => db,
    tableExists: (name) =>
      Boolean(
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(name),
      ),
    listTools: () => [],
    mcpOauthReady: () => false,
    resolveMcpPublicUrl: () => null,
  });
  const api = createApiKernel({ brandId: "demobrand" });
  api.registerModuleApi("test", {
    dbLayer: "brand",
    operations: [
      {
        id: "from-panier",
        method: "POST",
        path: "/from-panier",
        description: "Créer depuis le panier",
      },
      {
        id: "publish-me",
        method: "GET",
        path: "/publish-me",
        description: "Publié par défaut",
        mcpPublishDefault: true,
      },
    ],
    handle: async () => ({ status: 200, body: { ok: true } }),
  });
  const tools = generateModuleToolsFromListedOps(api);
  seedMcpToolPolicies(
    tools.map((t) => ({
      name: t.name,
      defaultRoles: t.defaultRoles,
      requiredScope: t.requiredScope,
      mcpPublishDefault: t.mcpPublishDefault,
    })),
  );
  const unpublished = getStoredMcpToolPolicy("module.test.from-panier");
  const published = getStoredMcpToolPolicy("module.test.publish-me");
  assert.ok(unpublished, "policy seedée pour from-panier");
  assert.equal(unpublished.enabled, false, "mcpPublishDefault false → enabled 0");
  assert.ok(published, "policy seedée pour publish-me");
  assert.equal(published.enabled, true, "mcpPublishDefault true → enabled 1");
  resetMcpAdminAdaptersForTests();
});

test("MO2c mcpTools() manuscrit ignoré — SoT = operations[]", () => {
  const api = createApiKernel({ brandId: "demobrand" });
  api.registerModuleApi("notes", {
    dbLayer: "brand",
    operations: [
      {
        id: "list",
        method: "GET",
        path: "/",
        description: "Lister",
      },
    ],
    handle: async () => ({ status: 200, body: { ok: true } }),
  });
  const tools = discoverModuleToolsFromBrandModules(
    [
      {
        id: "notes",
      },
    ],
    api,
  );
  assert.ok(tools.some((t) => t.name === "module.notes.list"));
  assert.ok(
    !tools.some((t) => t.name === "module.notes.custom"),
    "mcpTools n'existe plus — aucun tool manuscrit fusionné",
  );
});

test("MO3 catalogue = ops kernel (mount démo) + Hono admin", () => {
  const api = createApiKernel({ brandId: "demobrand" });
  api.registerModuleApi("notes", {
    dbLayer: "brand",
    operations: [
      {
        id: "list",
        method: "GET",
        path: "/",
        description: "Lister les notes démo",
      },
      {
        id: "from-inbox",
        method: "POST",
        path: "/from-inbox",
        description: "Créer une note depuis l'inbox",
      },
    ],
    handle: async () => ({ status: 200, body: { ok: true } }),
  });
  const kernelRoutes = collectKernelOperationRoutes(api.listMounts());
  assert.ok(
    kernelRoutes.some(
      (r) => r.method === "GET" && r.path === "/api/v1/modules/notes",
    ),
    "catalogue contient le mount de démo",
  );
  assert.ok(
    kernelRoutes.some(
      (r) =>
        r.method === "POST" && r.path === "/api/v1/modules/notes/from-inbox",
    ),
  );
  const registry = buildApiEndpointsRegistry({
    routes: [
      { method: "GET", path: "/api/v1/admin/endpoints" },
      ...kernelRoutes,
    ],
    source: "test-module-ops",
  });
  assert.ok(
    registry.endpoints.some((e) => e.path === "/api/v1/modules/notes"),
    "Admin API liste un endpoint métier, pas seulement admin",
  );
  assert.ok(
    registry.endpoints.some((e) => e.path === "/api/v1/admin/endpoints"),
  );
  assert.equal(
    resolveOperationHttpPath("module", "notes", "/:id"),
    "/api/v1/modules/notes/:id",
  );
  const matched = matchModuleOperation(
    api.listMounts()[0].operations,
    "POST",
    "from-inbox",
  );
  assert.equal(matched?.id, "from-inbox");
});

function makeLivrableSpec(specDir, brandName) {
  fs.writeFileSync(
    path.join(specDir, "product.md"),
    `# ${brandName}

Gestion d'articles.

## Entités

### Articles
- nom (texte)
`,
    "utf8",
  );
  const modDir = path.join(specDir, "modules", "articles");
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(
    path.join(modDir, "prd.md"),
    `# Module articles — Articles\n\nVision remplie pour le livrable de test.\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(modDir, "interview.md"),
    `# Interview articles\n\nDécisions remplies.\n`,
    "utf8",
  );
}

function writeDemoModule(modulesDir, body) {
  fs.mkdirSync(modulesDir, { recursive: true });
  fs.writeFileSync(
    path.join(modulesDir, "articles.ts"),
    `import { genericOsTourScenario } from "@creezio/interactive-demo";
${body}
`,
    "utf8",
  );
}

const DEMO_BLOCK = `  demo: { scenarios: [genericOsTourScenario({ productName: "Ops Doc" })] },`;

test("MO4 doctor MODULE_OP_MISSING fail-closed (pin ≥ 0.10.6)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-ops-missing-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "opsmiss",
    brandName: "Ops Miss",
    domain: "opsmiss.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Ops");
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      dependencies: { "@creezio/platform-core": "^0.10.6" },
    }),
  );
  writeDemoModule(
    path.join(work, "server/src/electron/modules"),
    `export const articlesModule = {
  id: "articles",
  apiMounts: { notes: { dbLayer: "brand", handle: async () => ({ status: 200 }) } },
  ${DEMO_BLOCK}
};
`,
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "MODULE_OP_MISSING" && i.level === "error"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MO4b doctor EntitySpec sans ops extras : pas MODULE_OP_MISSING", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-ops-entity-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "opsent",
    brandName: "Ops Entity",
    domain: "opsent.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Ops");
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      dependencies: { "@creezio/platform-core": "^0.10.6" },
    }),
  );
  writeDemoModule(
    path.join(work, "server/src/electron/modules"),
    `export const articlesModule = {
  id: "articles",
  entitySpecs: { notes: { table: "notes", columns: [{ name: "titre" }] } },
  // horsIndexJustification : fixture gate MO4b — le sujet testé est
  // MODULE_OP_MISSING, pas le contrat Meili (et le pin 0.10.6 daté passe
  // en error sous la politique N-2, P3.a).
  horsIndexJustification: "fixture gate",
  ${DEMO_BLOCK}
};
`,
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  assert.ok(
    !doctor.issues.some((i) => i.code === "MODULE_OP_MISSING"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MO4c doctor operations: [] = MODULE_OP_MISSING", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-ops-empty-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "opsempty",
    brandName: "Ops Empty",
    domain: "opsempty.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Ops");
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      dependencies: { "@creezio/platform-core": "^0.10.6" },
    }),
  );
  writeDemoModule(
    path.join(work, "server/src/electron/modules"),
    `export const articlesModule = {
  id: "articles",
  apiMounts: { notes: { dbLayer: "brand", operations: [], handle: async () => ({ status: 200 }) } },
  ${DEMO_BLOCK}
};
`,
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "MODULE_OP_MISSING" && i.level === "error"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MO4d doctor MODULE_MCP_TOOLS_DEPRECATED (error, fail-closed)", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-ops-mcpdep-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "opsmcp",
    brandName: "Ops Mcp",
    domain: "opsmcp.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Ops");
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      dependencies: { "@creezio/platform-core": "^0.10.6" },
    }),
  );
  writeDemoModule(
    path.join(work, "server/src/electron/modules"),
    `export const articlesModule = {
  id: "articles",
  entitySpecs: { notes: { table: "notes", columns: [{ name: "titre" }] } },
  mcpTools: () => [{ name: "module.notes.custom", space: "module", ownerId: "notes", handler: async () => ({ ok: true }) }],
  ${DEMO_BLOCK}
};
`,
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some(
      (i) => i.code === "MODULE_MCP_TOOLS_DEPRECATED" && i.level === "error",
    ),
    formatDoctorReport(doctor),
  );
  assert.ok(
    !doctor.issues.some((i) => i.code === "MODULE_OP_MCP_OVERLAP"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MO4e doctor : apiMounts commenté (stub factory) n'est pas MODULE_OP_MISSING", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-ops-comment-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "opscom",
    brandName: "Ops Com",
    domain: "opscom.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Ops");
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      dependencies: { "@creezio/platform-core": "^0.10.6" },
    }),
  );
  writeDemoModule(
    path.join(work, "server/src/electron/modules"),
    `export const articlesModule = {
  id: "articles",
  // apiMounts: { notes: { dbLayer: "brand", operations: [/* 1 op = 1 capacité */], handle } },
  ${DEMO_BLOCK}
};
`,
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, true, formatDoctorReport(doctor));
  assert.ok(
    !doctor.issues.some((i) => i.code === "MODULE_OP_MISSING"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MO5 doctor MODULE_OP_UNCATALOGUED + MCP overlap", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "brand-spec-ops-uncat-"));
  const result = initBrandSpec({
    outDir: path.join(work, "brand-spec"),
    brandId: "opsuncat",
    brandName: "Ops Uncat",
    domain: "opsuncat.local",
    vertical: "generic",
    force: true,
  });
  makeLivrableSpec(result.outDir, "Ops");
  fs.mkdirSync(path.join(work, "server"), { recursive: true });
  fs.writeFileSync(
    path.join(work, "server/package.json"),
    JSON.stringify({
      dependencies: { "@creezio/platform-core": "^0.10.6" },
    }),
  );
  writeDemoModule(
    path.join(work, "server/src/electron/modules"),
    `export const articlesModule = {
  id: "articles",
  entitySpecs: { notes: { table: "notes", columns: [], extraRoutes: async () => ({ status: 404 }) } },
  mcpTools: () => [{ name: "module.notes.list", space: "module", ownerId: "notes", handler: async () => ({ ok: true }) }],
  ${DEMO_BLOCK}
};
`,
  );
  const doctor = doctorBrandSpec(result.outDir);
  assert.equal(doctor.ok, false, formatDoctorReport(doctor));
  assert.ok(
    doctor.issues.some((i) => i.code === "MODULE_OP_UNCATALOGUED"),
    formatDoctorReport(doctor),
  );
  assert.ok(
    doctor.issues.some((i) => i.code === "MODULE_OP_MCP_OVERLAP"),
    formatDoctorReport(doctor),
  );
  fs.rmSync(work, { recursive: true, force: true });
});

test("MO6 create-module docs : une op, pas mcpTools parallèle", () => {
  const create = fs.readFileSync(
    path.join(ROOT, "docs/agents/CREATE-MODULE.md"),
    "utf8",
  );
  assert.match(create, /operations\[\]/);
  assert.match(create, /generateModuleToolsFromOperations/);
  assert.doesNotMatch(
    create,
    /\| Tools MCP métier \| `mcpTools\(api\)` \|/,
  );
  const standard = fs.readFileSync(
    path.join(ROOT, "docs/DOC-STANDARD-MODULE.md"),
    "utf8",
  );
  assert.match(standard, /tools générés/);
});
