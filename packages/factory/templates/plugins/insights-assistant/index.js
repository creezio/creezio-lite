/**
 * insights-assistant — sidecar Node sans dépendance npm (kit, générique).
 *
 * Découvre les modules de l'application via GET /api/v1/core/architecture,
 * échantillonne les listings (plafonné), construit un prompt de synthèse
 * générique et appelle OpenAI (`OPENAI_API_KEY` injectée par la permission
 * `llm:use` ; `OPENAI_API_BASE` supporté pour les mocks de gate).
 *
 * Env fournis par le host plugins :
 * - PORT           port loopback alloué (annoncé aussi en {event:"ready"})
 * - PLUGIN_DIR     dossier du plugin (DB cache: data/plugin.sqlite)
 * - API_URL        base loopback de l'API applicative (permission crm:read)
 * - API_KEY        clé API scopée du plugin
 * - OPENAI_API_KEY / OPENAI_API_BASE / OPENAI_MODEL (permission llm:use)
 *
 * Zéro métier marque : uniquement les conventions du kit
 * (/api/v1/core/architecture, mounts modules `{ items, total }`).
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PLUGIN_ID = process.env.PLUGIN_ID || "insights-assistant";
const PLUGIN_DIR = process.env.PLUGIN_DIR || __dirname;
const PORT = Number(process.env.PORT || 0);
const API_URL = (process.env.API_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE = (
  process.env.OPENAI_API_BASE || "https://api.openai.com"
).replace(/\/+$/, "");
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const MAX_ROWS_PER_MODULE = 50;
const MAX_CHARS_PER_MODULE = 6000;

/* ── DB plugin (cache des synthèses) — convention data/plugin.sqlite ────── */

function openDb() {
  const dataDir = path.join(PLUGIN_DIR, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "plugin.sqlite"));
  db.exec("PRAGMA busy_timeout=5000");
  db.exec(
    `CREATE TABLE IF NOT EXISTS _plugin_migrations (
      name TEXT PRIMARY KEY, sha256 TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  );
  const migrationsDir = path.join(PLUGIN_DIR, "migrations");
  const files = fs.existsSync(migrationsDir)
    ? fs
        .readdirSync(migrationsDir)
        .filter((n) => /^\d{3,}_[A-Za-z0-9_.-]+\.sql$/.test(n))
        .sort()
    : [];
  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, name), "utf8");
    const sha256 = crypto.createHash("sha256").update(sql).digest("hex");
    const prev = db
      .prepare("SELECT sha256 FROM _plugin_migrations WHERE name=?")
      .get(name);
    if (prev) continue;
    db.exec(sql);
    db.prepare("INSERT INTO _plugin_migrations(name, sha256) VALUES (?, ?)").run(
      name,
      sha256,
    );
  }
  return db;
}

const db = openDb();

/* ── Collecte générique des données de l'application ────────────────────── */

async function fetchJson(url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
      ...((init && init.headers) || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function collectAppData() {
  if (!API_URL) {
    return { modules: [], sampleRows: 0, error: "api_url_missing" };
  }
  const arch = await fetchJson(`${API_URL}/api/v1/core/architecture`);
  if (arch.status !== 200 || !arch.body || arch.body.ok !== true) {
    return {
      modules: [],
      sampleRows: 0,
      error: `architecture_unavailable_${arch.status}`,
    };
  }
  const moduleIds = Array.isArray(arch.body.mounts && arch.body.mounts.modules)
    ? arch.body.mounts.modules
    : [];
  const modules = [];
  let sampleRows = 0;
  for (const id of moduleIds) {
    try {
      const r = await fetchJson(
        `${API_URL}/api/v1/modules/${encodeURIComponent(id)}?limit=${MAX_ROWS_PER_MODULE}`,
      );
      if (r.status !== 200 || !r.body) continue;
      const items = Array.isArray(r.body)
        ? r.body
        : Array.isArray(r.body.items)
          ? r.body.items
          : null;
      if (!items) continue;
      const rows = items.slice(0, MAX_ROWS_PER_MODULE);
      sampleRows += rows.length;
      let sample = JSON.stringify(rows);
      if (sample.length > MAX_CHARS_PER_MODULE) {
        sample = `${sample.slice(0, MAX_CHARS_PER_MODULE)}…(tronqué)`;
      }
      modules.push({ id, rows: rows.length, sample });
    } catch {
      /* module non listable — best-effort générique */
    }
  }
  return { modules, sampleRows, error: null };
}

function buildPrompt(collected) {
  const lines = [
    "Analyse toutes les données de cette application et fais-moi une synthèse.",
    "Réponds en français, de façon structurée (tendances, volumes, points notables).",
    "",
    `Modules découverts : ${collected.modules.map((m) => m.id).join(", ") || "(aucun)"}`,
    "",
  ];
  for (const m of collected.modules) {
    lines.push(`## Module ${m.id} (${m.rows} lignes échantillonnées)`);
    lines.push(m.sample);
    lines.push("");
  }
  return lines.join("\n");
}

/* ── Appel LLM (OpenAI chat completions, base overridable) ──────────────── */

async function callLlm(prompt) {
  const res = await fetch(`${OPENAI_API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Tu es un assistant d'analyse de données applicatives. Synthèse claire, en français.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`llm_http_${res.status}`);
  }
  const content =
    body &&
    body.choices &&
    body.choices[0] &&
    body.choices[0].message &&
    body.choices[0].message.content;
  if (typeof content !== "string" || !content) {
    throw new Error("llm_empty_response");
  }
  return content;
}

/* ── Synthèse (collecte → prompt → LLM → cache DB) ──────────────────────── */

async function runSynthesis({ dry }) {
  const collected = await collectAppData();
  const prompt = buildPrompt(collected);
  let content = "";
  let model = null;
  if (!dry) {
    if (!OPENAI_API_KEY) {
      const err = new Error("llm_key_missing");
      err.statusCode = 400;
      throw err;
    }
    content = await callLlm(prompt);
    model = OPENAI_MODEL;
  }
  const info = db
    .prepare(
      `INSERT INTO syntheses (model, modules, sample_rows, prompt, content, dry)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      model,
      JSON.stringify(collected.modules.map((m) => ({ id: m.id, rows: m.rows }))),
      collected.sampleRows,
      prompt,
      content,
      dry ? 1 : 0,
    );
  const row = db
    .prepare("SELECT * FROM syntheses WHERE id=?")
    .get(Number(info.lastInsertRowid));
  return { row, collectError: collected.error };
}

function listSyntheses(limit = 20) {
  return db
    .prepare(
      `SELECT id, created_at, model, modules, sample_rows, dry,
              substr(content, 1, 4000) AS content
       FROM syntheses ORDER BY id DESC LIMIT ?`,
    )
    .all(limit);
}

/* ── Panel HTML (permission ui:panel) ───────────────────────────────────── */

const PANEL_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Synthèse IA</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #0f1420; color: #e7ecf5; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 16px; }
  button { background: #4f7cff; color: #fff; border: 0; border-radius: 8px;
           padding: 10px 18px; font-size: 14px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  .card { background: #1a2233; border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
  .meta { font-size: 12px; color: #8fa1c0; margin-bottom: 6px; }
  pre { white-space: pre-wrap; font-family: inherit; margin: 0; font-size: 14px; }
  .err { color: #ff7d7d; margin-top: 10px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Synthèse IA de l'application</h1>
  <button id="go">Générer la synthèse</button>
  <div id="error" class="err"></div>
  <div id="history"></div>
</div>
<script>
async function refresh() {
  const res = await fetch("/api/syntheses");
  const j = await res.json();
  const el = document.getElementById("history");
  el.innerHTML = "";
  for (const s of (j.syntheses || [])) {
    const d = document.createElement("div");
    d.className = "card";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = "#" + s.id + " — " + s.created_at +
      (s.dry ? " (dry)" : s.model ? " — " + s.model : "");
    const pre = document.createElement("pre");
    pre.textContent = s.content || "(collecte seule — dry run)";
    d.appendChild(meta); d.appendChild(pre); el.appendChild(d);
  }
}
document.getElementById("go").addEventListener("click", async () => {
  const btn = document.getElementById("go");
  const err = document.getElementById("error");
  btn.disabled = true; err.textContent = "";
  try {
    const res = await fetch("/api/synthesis", { method: "POST" });
    const j = await res.json();
    if (!res.ok || j.ok === false) err.textContent = j.error || ("HTTP " + res.status);
  } catch (e) { err.textContent = String(e); }
  btn.disabled = false;
  refresh();
});
refresh();
</script>
</body>
</html>
`;

/* ── Serveur HTTP loopback ──────────────────────────────────────────────── */

function send(res, code, body) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const method = (req.method || "GET").toUpperCase();

  if (url.pathname === "/health" && method === "GET") {
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM syntheses")
      .get();
    return send(res, 200, {
      ok: true,
      plugin: PLUGIN_ID,
      syntheses: Number(count.n || 0),
      llm: Boolean(OPENAI_API_KEY),
      api: Boolean(API_URL),
    });
  }

  if (url.pathname === "/api/syntheses" && method === "GET") {
    return send(res, 200, { ok: true, syntheses: listSyntheses() });
  }

  if (url.pathname === "/api/synthesis" && method === "POST") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* body optionnel */
      }
      const dry =
        url.searchParams.get("dry") === "1" ||
        body.dry === true ||
        body.dry === "1";
      runSynthesis({ dry })
        .then(({ row, collectError }) =>
          send(res, 201, { ok: true, synthesis: row, collectError }),
        )
        .catch((e) =>
          send(res, e.statusCode || 502, {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }),
        );
    });
    return;
  }

  if (url.pathname === "/" && method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PANEL_HTML);
    return;
  }

  send(res, 404, { ok: false, error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  const addr = server.address();
  console.log(
    JSON.stringify({ event: "ready", port: addr && addr.port ? addr.port : PORT }),
  );
});
