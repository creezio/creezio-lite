#!/usr/bin/env node
/**
 * Gate P4 plugins natifs — plugin démo kit « insights-assistant ».
 *
 * - PI1 : template factory installé (installKitPluginTemplate) ⇒ sidecar
 *         boot, /health proxifié via le mount API kernel.
 * - PI2 : tool MCP plugin.insights-assistant.synthesize visible et appelable
 *         par l'owner — synthèse via mock OpenAI local (OPENAI_API_BASE),
 *         prompt générique construit depuis /api/v1/core/architecture +
 *         échantillon réel du module de test.
 * - PI3 : synthèse persistée dans la DB plugin (data/plugin.sqlite, table
 *         syntheses) ; dry=true n'appelle PAS le LLM mais persiste.
 *
 * Hermétique : mock OpenAI loopback (patron STRIPE_API_BASE des gates
 * billing), zéro réseau externe, zéro métier marque.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAppManifest } from "../packages/brand-config/dist/index.js";
import { startBrandKernelHarness } from "../packages/app-runtime/dist/index.js";
import { signMcpJwt } from "../packages/mcp-facade/dist/index.js";
import { installKitPluginTemplate } from "../packages/factory/dist/index.js";
import { openNodeSqliteDatabase } from "../packages/platform-core/dist/index.js";

const ENV_KEYS = [
  "CREEZIO_PLUGINS",
  "CREEZIO_NATIVE_WARM",
  "CREEZIO_SKIP_KIT_BINARIES",
  "MCP_JWT_SECRET",
  "AUTH_SECRET",
  "OPENAI_API_KEY",
  "OPENAI_API_BASE",
  "OPENAI_MODEL",
];
const saveEnv = () =>
  Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = (saved) => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

const MOCK_SYNTHESIS =
  "SYNTHÈSE MOCKÉE — l'application contient des notes de démonstration.";

/** Mock OpenAI local — enregistre les prompts reçus (aucun réseau externe). */
function startMockOpenAi() {
  const calls = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/v1/chat/completions" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let body = {};
        try {
          body = JSON.parse(raw || "{}");
        } catch {}
        calls.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock",
            choices: [
              { index: 0, message: { role: "assistant", content: MOCK_SYNTHESIS } },
            ],
          }),
        );
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "mock_not_found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        calls,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

const DEMO_NOTES = [
  { id: "n1", title: "Note un", body: "Premier contenu de démonstration" },
  { id: "n2", title: "Note deux", body: "Deuxième contenu" },
];

function demoNotesMount() {
  return {
    handle: async ({ req, subPath }) => {
      if (req.method.toUpperCase() === "GET" && (subPath === "" || subPath === "/")) {
        return {
          status: 200,
          body: { ok: true, items: DEMO_NOTES, total: DEMO_NOTES.length },
        };
      }
      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}

async function mcpList(baseUrl, bearer) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ method: "tools/list" }),
  });
  return res.json();
}

async function mcpCall(baseUrl, name, args, bearer) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ method: "tools/call", params: { name, arguments: args } }),
  });
  return res.json();
}

async function waitFor(fn, { tries = 60, delayMs = 100 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

test("PI1..PI3 plugin démo insights-assistant (mock OpenAI)", async () => {
  const saved = saveEnv();
  let handle = null;
  let mock = null;
  let tmp = null;
  try {
    process.env.CREEZIO_SKIP_KIT_BINARIES = "1";
    process.env.CREEZIO_NATIVE_WARM = "0";
    delete process.env.CREEZIO_PLUGINS;
    delete process.env.MCP_JWT_SECRET;

    mock = await startMockOpenAi();
    process.env.OPENAI_API_KEY = "sk-mock-gate";
    process.env.OPENAI_API_BASE = mock.baseUrl;
    process.env.OPENAI_MODEL = "gpt-mock";

    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-insights-"));
    const dataDir = path.join(tmp, "data");
    const pluginsRoot = path.join(dataDir, "plugins");
    fs.mkdirSync(pluginsRoot, { recursive: true });

    // PI1 — installation via le template factory (chemin officiel kit).
    const installed = installKitPluginTemplate({
      templateId: "insights-assistant",
      pluginsDir: pluginsRoot,
    });
    assert.equal(installed.pluginId, "insights-assistant");
    assert.ok(installed.files.includes("manifest.json"), "manifest copié");
    assert.ok(installed.files.includes("index.js"), "sidecar copié");
    assert.ok(
      installed.files.includes("migrations/001_init.sql"),
      "migration copiée",
    );
    // Idempotent (2e install = no-op).
    const again = installKitPluginTemplate({
      templateId: "insights-assistant",
      pluginsDir: pluginsRoot,
    });
    assert.equal(again.created, false);

    const manifest = createAppManifest({
      brandId: "insightsprobe",
      productName: "Insights Probe",
      domain: "insightsprobe.local",
      sandbox: true,
    });
    handle = await startBrandKernelHarness({
      brandId: "insightsprobe",
      appRoot: tmp,
      dataDir,
      manifest,
      brandMigrations: [],
      registerModuleApi: (api) => {
        api.registerModuleApi("demo-notes", demoNotesMount());
      },
      skipIndex: true,
    });
    const { baseUrl } = handle;

    // PI1 — sidecar up, /health via le mount API kernel.
    const healthy = await waitFor(async () => {
      const r = await fetch(
        `${baseUrl}/api/v1/plugins/insights-assistant/health`,
      );
      if (r.status !== 200) return null;
      const j = await r.json();
      return j.ok === true ? j : null;
    });
    assert.ok(healthy, "mount /api/v1/plugins/insights-assistant/health OK");
    assert.equal(healthy.plugin, "insights-assistant");
    assert.equal(healthy.llm, true, "clé LLM injectée (permission llm:use)");
    assert.equal(healthy.api, true, "API_URL injectée (permission crm:read)");

    // PI2 — tool MCP visible par l'owner et appelable.
    const secret = (process.env.MCP_JWT_SECRET || "").trim();
    assert.ok(secret, "MCP_JWT_SECRET posé par composeBrandOs");
    const ownerJwt = signMcpJwt(secret, { sub: "owner-1", isOwner: true });
    const listed = await mcpList(baseUrl, ownerJwt);
    const names = (listed.tools || []).map((t) => t.name);
    assert.ok(
      names.includes("plugin.insights-assistant.synthesize"),
      `tool synthesize visible: ${JSON.stringify(names)}`,
    );

    const synth = await mcpCall(
      baseUrl,
      "plugin.insights-assistant.synthesize",
      {},
      ownerJwt,
    );
    assert.equal(synth.ok, true, JSON.stringify(synth));
    assert.equal(synth.content.status, 201);
    const row = synth.content.body.synthesis;
    assert.equal(row.content, MOCK_SYNTHESIS, "synthèse mockée retournée");
    assert.equal(row.dry, 0);
    assert.equal(row.model, "gpt-mock");

    // Prompt générique construit depuis l'architecture + données réelles.
    assert.equal(mock.calls.length, 1, "un appel LLM (mock)");
    const prompt = String(mock.calls[0].messages?.at(-1)?.content || "");
    assert.match(prompt, /analyse toutes les données/i, "prompt générique");
    assert.match(prompt, /demo-notes/, "module découvert via architecture");
    assert.match(prompt, /Note un/, "échantillon de données réel");

    // PI3 — dry run : pas d'appel LLM supplémentaire, mais persisté.
    const dryRes = await mcpCall(
      baseUrl,
      "plugin.insights-assistant.synthesize",
      { dry: true },
      ownerJwt,
    );
    assert.equal(dryRes.ok, true, JSON.stringify(dryRes));
    assert.equal(dryRes.content.body.synthesis.dry, 1);
    assert.equal(mock.calls.length, 1, "dry ⇒ aucun appel LLM");

    // PI3 — persistance dans la DB plugin (data/plugin.sqlite).
    const dbPath = path.join(
      pluginsRoot,
      "insights-assistant",
      "data",
      "plugin.sqlite",
    );
    assert.ok(fs.existsSync(dbPath), "DB plugin créée");
    const db = openNodeSqliteDatabase(dbPath);
    const rows = db
      .prepare("SELECT id, content, dry, model FROM syntheses ORDER BY id")
      .all();
    db.close?.();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.equal(rows[0].content, MOCK_SYNTHESIS, "synthèse mockée en DB");
    assert.equal(rows[0].dry, 0);
    assert.equal(rows[1].dry, 1);
  } finally {
    await handle?.close().catch(() => {});
    await mock?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    restoreEnv(saved);
  }
});
