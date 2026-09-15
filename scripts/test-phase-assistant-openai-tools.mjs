/**
 * Plafond OpenAI 128 tools + pas de dump d'alias Hermes dans le payload chat.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  OPENAI_CHAT_MAX_TOOLS,
  mcpFacadeToAssistantConfig,
  openaiSafeToolName,
  selectOpenAiToolDefinitions,
} from "../packages/assistant/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function def(name) {
  return {
    type: "function",
    function: {
      name,
      description: name,
      parameters: { type: "object", properties: {} },
    },
  };
}

test("openaiSafeToolName : points → underscore", () => {
  assert.equal(openaiSafeToolName("module.panier.get"), "module_panier_get");
  assert.equal(openaiSafeToolName("list_tables"), "list_tables");
});

test("selectOpenAiToolDefinitions : dédup safe + premier gagnant", () => {
  const out = selectOpenAiToolDefinitions([
    [def("list_tables")],
    [def("module.panier.get"), def("module_panier_get")],
  ]);
  const names = out.map((t) => t.function.name);
  assert.deepEqual(names, ["list_tables", "module_panier_get"]);
  assert.equal(out.length, 2);
});

test("selectOpenAiToolDefinitions : plafond 128", () => {
  assert.equal(OPENAI_CHAT_MAX_TOOLS, 128);
  const many = Array.from({ length: 160 }, (_, i) => def(`tool_${i}`));
  const out = selectOpenAiToolDefinitions([many]);
  assert.equal(out.length, 128);
  assert.equal(out[0].function.name, "tool_0");
  assert.equal(out[127].function.name, "tool_127");
});

test("mcpFacadeToAssistantConfig : pas d'alias Hermes dans listTools", async () => {
  const called = [];
  const cfg = mcpFacadeToAssistantConfig({
    listAliases: () => ({
      add_to_panier: "module.panier.add_ligne",
      get_panier: "module.panier.get",
    }),
    async listTools(opts) {
      called.push(opts?.publicSurface);
      return {
        tools: [
          {
            name: "module.panier.get",
            description: "panier",
            space: "module",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "module.panier.add_ligne",
            description: "ajoute",
            space: "module",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "creezio.health",
            description: "core",
            space: "core",
          },
        ],
      };
    },
    async callTool(name) {
      return { ok: true, content: { name } };
    },
  });

  const tools = await cfg.listTools();
  const names = tools.map((t) => t.name);
  assert.deepEqual(called, ["canonical"]);
  assert.deepEqual(names, ["module.panier.get", "module.panier.add_ligne"]);
  assert.ok(!names.includes("add_to_panier"));
  assert.ok(!names.includes("get_panier"));
  assert.ok(!names.includes("creezio.health"));

  const result = await cfg.callTool("add_to_panier", {});
  assert.equal(result.ok, true);
  assert.equal(result.content.name, "add_to_panier");
});

test("source : getToolDefinitions passe par le plafond ; plus de dump alias", () => {
  const shim = fs.readFileSync(
    path.join(root, "packages/assistant/src/brand/prompts-shim.ts"),
    "utf8",
  );
  assert.match(shim, /selectOpenAiToolDefinitions/);
  assert.match(shim, /OPENAI_CHAT_MAX_TOOLS|selectOpenAiToolDefinitions/);

  const mcpTools = fs.readFileSync(
    path.join(root, "packages/assistant/src/runtime/mcp-tools.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    mcpTools,
    /out\.push\(\{[\s\S]*alias →/,
    "ne plus réinjecter les alias dans le payload chat",
  );
});
