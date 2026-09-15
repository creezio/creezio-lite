/**
 * Tests Phase H4 — proxy MCP unifié (registry, namespaces, aliases, policies).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ARCHITECTURE_VERSION } from "@creezio/platform-core";
import {
  assertNamespacedToolName,
  createMcpFacade,
  denyCrossLayerToolCall,
  isLegacyAliasName,
  parseNamespacedToolName,
  signMcpJwt,
} from "../packages/mcp-facade/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("H4.0 ARCHITECTURE_VERSION >= H4", () => {
  assert.match(ARCHITECTURE_VERSION, /^H([4-9]|\d{2,})$/);
});

test("H4 docs BACKLOG + PHASE présents", () => {
  for (const f of ["docs/archive/BACKLOG-H4.md", "docs/archive/PHASE-H4.md"]) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
});

test("H4.1 namespace parse + assert", () => {
  assert.equal(parseNamespacedToolName("creezio.health")?.space, "core");
  assert.equal(parseNamespacedToolName("module.panier.get")?.ownerId, "panier");
  assert.equal(parseNamespacedToolName("plugin.meteo.kv")?.ownerId, "meteo");
  assert.equal(parseNamespacedToolName("get_panier"), null);
  assert.equal(isLegacyAliasName("get_panier"), true);
  assert.doesNotThrow(() =>
    assertNamespacedToolName("module", "module.panier.get", "panier"),
  );
  assert.throws(() =>
    assertNamespacedToolName("module", "get_panier", "panier"),
  );
  assert.throws(() =>
    assertNamespacedToolName("module", "module.other.get", "panier"),
  );
});

test("H4.2 aliases + publicSurface legacy-preferred (pas de double panier)", async () => {
  const secret = "h4-secret";
  const mcp = createMcpFacade({
    jwtSecret: secret,
    brandId: "demobrand",
    publicSurface: "legacy-preferred",
    aliases: {
      get_panier: "module.panier.get",
      add_to_panier: "module.panier.add_ligne",
    },
    discoverToolsBySpace: async () => ({
      module: [
        {
          name: "module.panier.get",
          description: "État panier",
          space: "module",
          ownerId: "panier",
          handler: async () => ({ ok: true, content: { lignes: 2 } }),
        },
        {
          name: "module.panier.add_ligne",
          description: "Ajoute ligne",
          space: "module",
          ownerId: "panier",
          handler: async (args) => ({
            ok: true,
            content: { added: args.produit_id },
          }),
        },
        {
          name: "module.dispatch.status",
          description: "Dispatch status",
          space: "module",
          ownerId: "dispatch",
          handler: async () => ({ ok: true, content: { n: 0 } }),
        },
      ],
      plugin: [],
    }),
  });

  const jwt = signMcpJwt(secret, {
    sub: "h4",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  const listed = await mcp.listTools({ bearerToken: jwt });
  const names = listed.tools.map((t) => t.name);
  assert.ok(names.includes("get_panier"), "alias legacy exposé");
  assert.ok(!names.includes("module.panier.get"), "canonique masqué");
  assert.ok(names.includes("module.dispatch.status"), "sans alias → canonique");
  assert.ok(names.includes("creezio.admin.list_aliases"));

  const bySpace = await mcp.listToolsBySpace({ bearerToken: jwt });
  assert.ok(bySpace.module.some((t) => t.name === "get_panier"));
  assert.ok(!bySpace.module.some((t) => t.name === "module.panier.get"));

  const viaAlias = await mcp.callTool("get_panier", {}, { bearerToken: jwt });
  assert.equal(viaAlias.ok, true);
  assert.equal(viaAlias.content.lignes, 2);

  const viaCanon = await mcp.callTool(
    "module.panier.get",
    {},
    { bearerToken: jwt },
  );
  assert.equal(viaCanon.ok, true);

  const aliasList = await mcp.callTool(
    "creezio.admin.list_aliases",
    {},
    { bearerToken: jwt },
  );
  assert.equal(aliasList.ok, true);
  assert.equal(aliasList.content.aliases.get_panier, "module.panier.get");
});

test("H4.3 publicSurface canonical vs both", async () => {
  const mcp = createMcpFacade({
    allowUnauthenticated: true,
    aliases: { get_panier: "module.panier.get" },
    discoverToolsBySpace: async () => ({
      module: [
        {
          name: "module.panier.get",
          description: "panier",
          space: "module",
          ownerId: "panier",
          handler: async () => ({ ok: true }),
        },
      ],
    }),
  });

  const canon = await mcp.listTools({ publicSurface: "canonical" });
  assert.ok(canon.tools.some((t) => t.name === "module.panier.get"));
  assert.ok(!canon.tools.some((t) => t.name === "get_panier"));

  const both = await mcp.listTools({ publicSurface: "both" });
  assert.ok(both.tools.some((t) => t.name === "module.panier.get"));
  assert.ok(both.tools.some((t) => t.name === "get_panier"));
});

test("H4.4 policy deny cross-layer", async () => {
  const mcp = createMcpFacade({
    allowUnauthenticated: true,
    discoverToolsBySpace: async () => ({
      module: [
        {
          name: "module.panier.get",
          description: "panier",
          space: "module",
          ownerId: "panier",
          handler: async () => ({ ok: true, content: {} }),
        },
      ],
    }),
  });

  const denied = await mcp.callTool("module.panier.get", {
    path: "__cross/core/users",
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "cross_layer_denied");

  const spoof = await mcp.callTool("module.panier.get", {
    targetSpace: "core",
  });
  assert.equal(spoof.ok, false);
  assert.equal(spoof.error, "cross_layer_space_spoof");

  const direct = denyCrossLayerToolCall({
    name: "module.x",
    canonicalName: "module.x.get",
    space: "module",
    args: { q: "ok" },
    isAlias: false,
  });
  assert.equal(direct.allow, true);
});

test("H4.5 registerTool dynamique + refuse core", async () => {
  const mcp = createMcpFacade({ allowUnauthenticated: true });
  mcp.registerTool({
    name: "plugin.meteo.forecast",
    description: "prévision",
    space: "plugin",
    ownerId: "meteo",
    handler: async () => ({ ok: true, content: { c: 18 } }),
  });
  mcp.registerAlias("meteo_forecast", "plugin.meteo.forecast");

  const listed = await mcp.listTools();
  assert.ok(listed.tools.some((t) => t.name === "meteo_forecast"));
  assert.ok(!listed.tools.some((t) => t.name === "plugin.meteo.forecast"));

  const call = await mcp.callTool("meteo_forecast", {});
  assert.equal(call.ok, true);
  assert.equal(call.content.c, 18);

  assert.throws(() =>
    mcp.registerTool({
      name: "creezio.evil",
      description: "nope",
      space: "core",
      handler: async () => ({ ok: true }),
    }),
  );

  assert.equal(mcp.resolveToolName("meteo_forecast"), "plugin.meteo.forecast");
  assert.equal(mcp.unregisterTool("plugin.meteo.forecast"), true);
});

test("H4.6 discoverer non namespacé ignoré si enforce", async () => {
  const mcp = createMcpFacade({
    allowUnauthenticated: true,
    enforceNamespaces: true,
    discoverTools: async () => [
      {
        name: "raw_legacy_tool",
        description: "sans namespace",
        space: "module",
        ownerId: "x",
        handler: async () => ({ ok: true }),
      },
    ],
  });
  const listed = await mcp.listTools();
  assert.ok(!listed.tools.some((t) => t.name === "raw_legacy_tool"));
});
