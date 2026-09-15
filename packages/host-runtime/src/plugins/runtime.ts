/**
 * Runtime plugins kit — scaffold UI + wrappers discover (N1).
 *
 * Types / parse / discover purs → `@creezio/platform-core`.
 * Scaffold (CSS kit + index.js proxy CRM) porté depuis TF gold plugin-runtime.ts
 * avec injection `envPrefix` / `productName` via brand-bindings.
 */

import fs from "node:fs";
import path from "node:path";
import {
  PLUGIN_MANIFEST_FILE,
  discoverPlugins as discoverPluginsCore,
  hasPluginPermission,
  isValidPluginId,
  parsePluginManifest,
  pluginEnabledFlagPath,
  pluginSiteId,
  pluginsRootDir as pluginsRootDirCore,
  setPluginEnabled,
  type DiscoveredPlugin,
  type PluginAcceptance,
  type PluginAcceptanceSmoke,
  type PluginManifest,
  type PluginPanelConfig,
  type PluginPermission,
} from "@creezio/platform-core";
import {
  getPluginHostBindings,
  tryGetPluginHostBindings,
} from "./brand-bindings.js";

export {
  PLUGIN_MANIFEST_FILE,
  hasPluginPermission,
  isValidPluginId,
  parsePluginManifest,
  pluginEnabledFlagPath,
  pluginSiteId,
  setPluginEnabled,
};
export type {
  DiscoveredPlugin,
  PluginAcceptance,
  PluginAcceptanceSmoke,
  PluginManifest,
  PluginPanelConfig,
  PluginPermission,
};

export function pluginsRootDir(userDataDir?: string): string {
  if (userDataDir) return pluginsRootDirCore(userDataDir);
  const b = tryGetPluginHostBindings();
  if (b) return pluginsRootDirCore(b.userDataDir());
  throw new Error(
    "pluginsRootDir: passer userDataDir ou appeler configurePluginHost()",
  );
}

export function discoverPlugins(root?: string): DiscoveredPlugin[] {
  return discoverPluginsCore(root || pluginsRootDir());
}

/**
 * CSS kit plugin (classes tf- — contrat G5 accept-check, inchangé TF gold).
 * Écrit uniquement au scaffold.
 */
export function scaffoldPluginUiCss(): string {
  return `/* Creezio / TempoFlow plugin UI kit — thème clair (classes tf-) */
:root {
  --tf-bg: #faf7f1;
  --tf-surface: #ffffff;
  --tf-border: #e2e8f0;
  --tf-text: #14182f;
  --tf-muted: #64748b;
  --tf-primary: #0f172a;
  --tf-primary-hover: #1e293b;
  --tf-primary-fg: #ffffff;
  --tf-danger: #dc2626;
  --tf-danger-bg: #fef2f2;
  --tf-success: #047857;
  --tf-success-bg: #ecfdf5;
  --tf-radius: 8px;
  --tf-radius-sm: 6px;
  --tf-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --tf-font: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--tf-font);
  background: var(--tf-bg);
  color: var(--tf-text);
  padding: 24px;
  line-height: 1.5;
  font-size: 14px;
}
h1 { font-size: 1.25rem; margin: 0 0 4px; font-weight: 600; letter-spacing: -0.01em; }
h2 { font-size: 1rem; margin: 16px 0 8px; font-weight: 600; }
code { font-size: 0.85em; background: #f1f5f9; border-radius: 4px; padding: 1px 4px; }

.tf-muted { color: var(--tf-muted); font-size: 0.875rem; }
.tf-err { color: var(--tf-danger); font-size: 0.875rem; }

.tf-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; align-items: center; }

.tf-btn, button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--tf-surface);
  color: var(--tf-text);
  border: 1px solid var(--tf-border);
  border-radius: var(--tf-radius-sm);
  padding: 7px 14px;
  font: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  box-shadow: var(--tf-shadow);
}
.tf-btn:hover, button:hover { background: #f8fafc; }
.tf-btn-primary, button.tf-btn-primary {
  background: var(--tf-primary);
  color: var(--tf-primary-fg);
  border-color: var(--tf-primary);
}
.tf-btn-primary:hover, button.tf-btn-primary:hover { background: var(--tf-primary-hover); }
.tf-btn-danger, button.tf-btn-danger {
  background: var(--tf-danger);
  color: #ffffff;
  border-color: var(--tf-danger);
}
.tf-btn:disabled, button:disabled { opacity: 0.5; cursor: not-allowed; }

.tf-card {
  background: var(--tf-surface);
  border: 1px solid var(--tf-border);
  border-radius: var(--tf-radius);
  padding: 14px 16px;
  margin-top: 8px;
  box-shadow: var(--tf-shadow);
}
.tf-card-title { font-size: 0.9rem; font-weight: 600; margin: 0 0 8px; }

.tf-badge {
  display: inline-block;
  border-radius: 9999px;
  padding: 2px 10px;
  font-size: 0.75rem;
  font-weight: 500;
  background: #f1f5f9;
  color: #334155;
}
.tf-badge-success { background: var(--tf-success-bg); color: var(--tf-success); }
.tf-badge-danger { background: var(--tf-danger-bg); color: var(--tf-danger); }

.tf-input, .tf-select, .tf-textarea,
input[type="text"], input[type="number"], input[type="date"], select, textarea {
  width: 100%;
  max-width: 420px;
  background: var(--tf-surface);
  color: var(--tf-text);
  border: 1px solid var(--tf-border);
  border-radius: var(--tf-radius-sm);
  padding: 7px 10px;
  font: inherit;
  font-size: 0.875rem;
}
.tf-input:focus, .tf-select:focus, .tf-textarea:focus,
input:focus, select:focus, textarea:focus {
  outline: 2px solid #94a3b8;
  outline-offset: 1px;
}
label { font-size: 0.8rem; font-weight: 500; color: #334155; display: block; margin-bottom: 4px; }

.tf-table { width: 100%; border-collapse: collapse; background: var(--tf-surface); border: 1px solid var(--tf-border); border-radius: var(--tf-radius); overflow: hidden; }
.tf-table th {
  text-align: left;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--tf-muted);
  background: #f8fafc;
  padding: 8px 12px;
  border-bottom: 1px solid var(--tf-border);
}
.tf-table td { padding: 8px 12px; border-bottom: 1px solid var(--tf-border); font-size: 0.875rem; }
.tf-table tr:last-child td { border-bottom: 0; }

.tf-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--tf-border); margin: 16px 0 12px; }
.tf-tab {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  box-shadow: none;
  padding: 8px 12px;
  font-size: 0.875rem;
  color: var(--tf-muted);
  cursor: pointer;
}
.tf-tab:hover { background: transparent; color: var(--tf-text); }
.tf-tab.active { color: var(--tf-text); font-weight: 600; border-bottom-color: var(--tf-primary); }

.tf-list { list-style: none; padding: 0; margin: 0; }
.tf-list li { border-bottom: 1px solid var(--tf-border); padding: 8px 0; font-size: 0.875rem; }
.tf-list li:last-child { border-bottom: 0; }
.tf-empty {
  border: 1px dashed var(--tf-border);
  border-radius: var(--tf-radius);
  padding: 20px;
  text-align: center;
  color: var(--tf-muted);
  font-size: 0.875rem;
  background: var(--tf-surface);
}

.muted { color: var(--tf-muted); font-size: 0.875rem; }
.err { color: var(--tf-danger); }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
.card {
  background: var(--tf-surface);
  border: 1px solid var(--tf-border);
  border-radius: var(--tf-radius);
  padding: 12px 14px;
  margin-top: 8px;
}
ul.list { list-style: none; padding: 0; margin: 0; }
ul.list li { border-bottom: 1px solid var(--tf-border); padding: 8px 0; font-size: 0.9rem; }
ul.list li:last-child { border-bottom: 0; }
`;
}

function scaffoldIndexJs(
  manifest: PluginManifest,
  envPrefix: string,
  productName: string,
): string {
  const idJson = JSON.stringify(manifest.id);
  const nameJson = JSON.stringify(manifest.name);
  const siteId = pluginSiteId(manifest.id);
  const prefixJson = JSON.stringify(envPrefix);
  const productJson = JSON.stringify(productName);
  return `#!/usr/bin/env node
"use strict";
// Plugin ${manifest.id} — scaffold Creezio (proxy CRM + UI kit)
const http = require("http");
const fs = require("fs");
const path = require("path");
const ENV_PREFIX = ${prefixJson};
const PRODUCT_NAME = ${productJson};
const port = Number(process.env[ENV_PREFIX + "_PLUGIN_PORT"] || 0) || 0;
const pluginId = process.env[ENV_PREFIX + "_PLUGIN_ID"] || ${idJson};
const crmBase = (process.env[ENV_PREFIX + "_API_URL"] || "").replace(/\\/+$/, "");
const crmKey = process.env[ENV_PREFIX + "_API_KEY"] || "";

function send(res, code, body, type) {
  const t = type || "application/json";
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(code, { "Content-Type": t + (t.includes("charset") ? "" : "; charset=utf-8") });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
async function proxyCrm(reqPath, req) {
  if (!crmBase || !crmKey) {
    return { status: 503, body: { ok: false, error: ENV_PREFIX + "_API_* absent (permission crm:read ?)" } };
  }
  const suffix = reqPath.replace(/^\\/api\\/crm\\/?/, "");
  const target = crmBase + "/api/v1/" + suffix + (req.url && req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
  const headers = {
    Authorization: "Bearer " + crmKey,
    Accept: "application/json",
  };
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await readBody(req);
    headers["Content-Type"] = req.headers["content-type"] || "application/json";
  }
  const res = await fetch(target, {
    method: req.method || "GET",
    headers,
    body,
    signal: AbortSignal.timeout(12000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 2000) }; }
  return { status: res.status, body: parsed };
}
async function proxyLlm(req) {
  const raw = await readBody(req);
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch {
    return { status: 400, body: { ok: false, error: "JSON invalide" } };
  }
  const provider = String(payload.provider || "openai");
  const model = String(payload.model || (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini"));
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) {
    return { status: 400, body: { ok: false, error: "messages requis" } };
  }
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY || "";
    if (!key) return { status: 503, body: { ok: false, error: "ANTHROPIC_API_KEY absent (permission llm:use + BYOK)" } };
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\\n");
    const userMsgs = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }));
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: Number(payload.max_tokens) || 1024,
        system: system || undefined,
        messages: userMsgs,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, body: { ok: res.ok, provider, model, data } };
  }
  const key = process.env.OPENAI_API_KEY || "";
  if (!key) return { status: 503, body: { ok: false, error: "OPENAI_API_KEY absent (permission llm:use + BYOK)" } };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: String(m.content || "") })),
      temperature: payload.temperature,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, body: { ok: res.ok, provider, model, data } };
}
function panelHtml() {
  return "<!doctype html><html lang=\\"fr\\"><head><meta charset=utf-8><title>" + ${nameJson} +
    "</title><link rel=\\"stylesheet\\" href=\\"/plugin-ui.css\\"></head><body>" +
    "<h1>" + ${nameJson} + "</h1>" +
    "<p class=\\"tf-muted\\">Module <code>" + pluginId + "</code> · Mes produits = stack via proxy Node</p>" +
    "<div class=\\"tf-row\\"><button id=\\"load\\" type=\\"button\\" class=\\"tf-btn tf-btn-primary\\">Charger mes produits</button>" +
    "<span id=\\"status\\" class=\\"tf-muted\\">Prêt.</span></div>" +
    "<div id=\\"out\\"></div>" +
    "<script>(function(){" +
    "var btn=document.getElementById('load');" +
    "var st=document.getElementById('status');" +
    "var out=document.getElementById('out');" +
    "btn.onclick=async function(){" +
    "btn.disabled=true;st.textContent='Chargement…';st.className='tf-muted';out.innerHTML='';" +
    "try{" +
    "var r=await fetch('/api/crm/stack/items');" +
    "var j=await r.json();" +
    "if(!r.ok){throw new Error((j&&j.error)||('HTTP '+r.status));}" +
    "var items=j.items||j||[];" +
    "if(!Array.isArray(items))items=[];" +
    "st.textContent=items.length? (items.length+' produit(s)') : 'Aucun produit dans Mes produits (stack vide)';" +
    "if(!items.length){out.innerHTML='<div class=\\"tf-empty\\">Stack vide — ajoute des produits dans ' + PRODUCT_NAME + ' → Mes produits.</div>';}" +
    "else{out.innerHTML='<div class=\\"tf-card\\"><table class=\\"tf-table\\"><thead><tr><th>Produit</th><th>Réf.</th></tr></thead><tbody>'+items.map(function(it){" +
    "return '<tr><td><strong>'+ (it.nom||it.sku||('#'+it.sku_id)) +'</strong></td><td><span class=\\"tf-badge\\">'+(it.sku||'—')+'</span></td></tr>';" +
    "}).join('')+'</tbody></table></div>';}" +
    "}catch(e){st.className='tf-err';st.textContent=String(e.message||e);}" +
    "finally{btn.disabled=false;}" +
    "};" +
    "})();</script></body></html>";
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const p = url.pathname;
  try {
    if (req.method === "GET" && (p === "/" || p === "/panel")) {
      send(res, 200, panelHtml(), "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && p === "/plugin-ui.css") {
      let css = "";
      try { css = fs.readFileSync(path.join(__dirname, "plugin-ui.css"), "utf8"); } catch { css = "body{font-family:Inter,system-ui;padding:24px;background:#faf7f1;color:#14182f}"; }
      send(res, 200, css, "text/css; charset=utf-8");
      return;
    }
    if (req.method === "GET" && p === "/health") {
      send(res, 200, {
        ok: true,
        plugin: pluginId,
        crm: Boolean(crmBase && crmKey),
        llm: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
      });
      return;
    }
    if (p.startsWith("/api/crm/")) {
      const r = await proxyCrm(p, req);
      send(res, r.status, r.body);
      return;
    }
    if (req.method === "POST" && p === "/api/llm/chat") {
      const r = await proxyLlm(req);
      send(res, r.status, r.body);
      return;
    }
    if (req.method === "POST" && p.startsWith("/hooks/")) {
      const event = decodeURIComponent(p.slice("/hooks/".length));
      const body = await readBody(req);
      console.log(JSON.stringify({ event: "hook", name: event, body: body.slice(0, 2000) }));
      send(res, 200, { ok: true, plugin: pluginId, hook: event });
      return;
    }
    if (req.method === "POST" && p === "/webhooks/n8n") {
      const body = await readBody(req);
      console.log(JSON.stringify({ event: "n8n-webhook", body: body.slice(0, 2000) }));
      send(res, 200, { ok: true, plugin: pluginId, source: "n8n" });
      return;
    }
    send(res, 404, { ok: false, error: "not found", path: p });
  } catch (e) {
    send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
server.listen(port || 0, "127.0.0.1", () => {
  const addr = server.address();
  const p = typeof addr === "object" && addr ? addr.port : port;
  console.log(JSON.stringify({ event: "ready", plugin: pluginId, port: p, siteId: ${siteId} }));
});
`;
}

/** Scaffold minimal pour Hermes / import — proxy CRM + kit UI + smokes. */
export function scaffoldPlugin(opts: {
  id: string;
  name?: string;
  description?: string;
  source?: string;
}): { dir: string; manifest: PluginManifest } {
  const bindings = getPluginHostBindings();
  if (!isValidPluginId(opts.id)) {
    throw new Error(`id invalide: ${opts.id}`);
  }
  const dir = path.join(pluginsRootDir(), opts.id);
  if (fs.existsSync(dir)) {
    throw new Error(`plugin déjà présent: ${opts.id}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const name = opts.name || opts.id;
  const manifest: PluginManifest = {
    id: opts.id,
    name,
    version: "0.1.0",
    description: opts.description || `Plugin ${bindings.productName}`,
    main: "index.js",
    permissions: ["crm:read", "net:loopback", "ui:panel"],
    hooks: ["panier.updated", "panier.closed", "commande.created"],
    panel: { title: name, path: "/" },
    acceptance: {
      smoke: [
        { method: "GET", path: "/health", expectStatus: 200 },
        { method: "GET", path: "/api/crm/stack/items", expectStatus: 200 },
      ],
    },
    source: opts.source || "hermes",
  };
  fs.writeFileSync(
    path.join(dir, PLUGIN_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "plugin-ui.css"), scaffoldPluginUiCss(), "utf8");
  fs.writeFileSync(
    path.join(dir, "index.js"),
    scaffoldIndexJs(manifest, bindings.envPrefix, bindings.productName),
    "utf8",
  );
  setPluginEnabled(dir, true);
  return { dir, manifest };
}
