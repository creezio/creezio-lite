#!/usr/bin/env node
/**
 * @creezio/observability fleet-collector — cockpit flotte ops (SoT kit, D-P25).
 *
 * Loopback HTTP + store JSON. Auth :
 *   - Ingest clients : path /i-<INGEST_TOKEN>/… (pas de login)
 *   - Ops UI/API     : HTTP Basic (user/password) — prompt navigateur
 *                      (Bearer OPS_TOKEN encore accepté pour scripts)
 *
 * Env (neutre + dual-read legacy TF2_* / CERTIVAN_*) — voir env.mjs :
 *   CREEZIO_FLEET_PORT | FLEET_PORT | TF2_FLEET_PORT | CERTIVAN_FLEET_PORT
 *   CREEZIO_FLEET_INGEST_TOKEN | FLEET_INGEST_TOKEN | …
 *   CREEZIO_FLEET_OPS_USER / _PASS / _TOKEN | FLEET_* | TF2_* | CERTIVAN_*
 *   CREEZIO_FLEET_DIR | FLEET_DIR | …
 *   FLEET_PUBLIC_DOMAIN | CREEZIO_FLEET_DOMAIN
 *   CREEZIO_FLEET_TUNNEL_SUFFIX | FLEET_TUNNEL_SUFFIX
 *   CREEZIO_FLEET_UI_TITLE | FLEET_UI_TITLE (+ MARK / HOME_TITLE / REALM / EXTRAS_TITLE)
 *
 * 0 domaine marque hardcodé — injection env uniquement.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildFleetOverview,
  buildServerDetail,
  buildUserDetail,
} from "./ops-api.mjs";
import { resolveFleetCollectorEnv } from "./env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

const cfg = resolveFleetCollectorEnv();
const PORT = cfg.port;
const INGEST = cfg.ingestToken;
const OPS_TOKEN = cfg.opsToken;
const OPS_USER = cfg.opsUser;
const OPS_PASS = cfg.opsPass;
const TUNNEL_SUFFIX = cfg.tunnelSuffix;
const UI = cfg.ui;
const DATA_DIR =
  cfg.dataDir || path.join(process.cwd(), "fleet-data");
const MAX_BODY = 4 * 1024 * 1024;

if (!INGEST) {
  console.error(
    "[fleet] CREEZIO_FLEET_INGEST_TOKEN (ou FLEET_/TF2_/CERTIVAN_*) requis",
  );
  process.exit(1);
}

function safeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) {
    crypto.timingSafeEqual(aa, aa);
    return false;
  }
  return crypto.timingSafeEqual(aa, bb);
}

const ALLOWED_REMOTE = new Set([
  "force-update-check",
  "restart-n8n",
  "restart-hermes",
  "sync-now",
  "upload-diagnostics",
]);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "crashes"), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "bundles"), { recursive: true });

const INSTALLS_FILE = path.join(DATA_DIR, "installs.json");
const COMMANDS_FILE = path.join(DATA_DIR, "commands.json");
const AUDIT_FILE = path.join(DATA_DIR, "audit.log");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function sanitize(s, fallback = "x") {
  const v = String(s || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return v || fallback;
}

function audit(line) {
  const row = `${new Date().toISOString()} ${line}\n`;
  try {
    fs.appendFileSync(AUDIT_FILE, row);
  } catch {
    /* ignore */
  }
  console.log(`[fleet] ${line}`);
}

function loadInstalls() {
  const raw = readJson(INSTALLS_FILE, {});
  return raw && typeof raw === "object" ? raw : {};
}

function saveInstalls(map) {
  writeJson(INSTALLS_FILE, map);
}

function loadCommands() {
  const raw = readJson(COMMANDS_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function saveCommands(list) {
  writeJson(COMMANDS_FILE, list);
}

function upsertInstall(installId, patch) {
  const id = sanitize(installId, "anon");
  const map = loadInstalls();
  const prev = map[id] || { installId: id, firstSeen: new Date().toISOString() };
  map[id] = {
    ...prev,
    ...patch,
    installId: id,
    lastSeen: new Date().toISOString(),
  };
  saveInstalls(map);
  return map[id];
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, code, body, headers = {}) {
  const payload =
    body === undefined || body === null
      ? ""
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const h = {
    "Content-Type":
      typeof body === "string" && body.trimStart().startsWith("<")
        ? "text/html; charset=utf-8"
        : "application/json; charset=utf-8",
    ...headers,
  };
  if (!payload) delete h["Content-Type"];
  res.writeHead(code, h);
  res.end(payload);
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

function opsAuthorized(req, url) {
  const auth = req.headers.authorization || "";
  if (OPS_TOKEN && auth === `Bearer ${OPS_TOKEN}`) return true;
  if (OPS_TOKEN && url.searchParams.get("token") === OPS_TOKEN) return true;
  const basic = parseBasicAuth(auth);
  if (
    basic &&
    safeEqualStr(basic.user, OPS_USER) &&
    safeEqualStr(basic.pass, OPS_PASS)
  ) {
    return true;
  }
  return false;
}

function sendUnauthorized(res) {
  send(
    res,
    401,
    { ok: false, error: "unauthorized" },
    {
      "WWW-Authenticate": `Basic realm="${UI.realm.replace(/"/g, "")}", charset="UTF-8"`,
    },
  );
}

function parseIngestPath(pathname) {
  const prefix = `/i-${INGEST}`;
  if (!pathname.startsWith(prefix)) return null;
  return pathname.slice(prefix.length) || "/";
}

function renderOpsHtml() {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");
  const brand = {
    title: UI.title,
    mark: UI.mark,
    homeTitle: UI.homeTitle,
    extrasTitle: UI.extrasTitle,
    etatLabels: UI.etatLabels,
  };
  const inject = `<script>window.__FLEET_BRAND__=${JSON.stringify(brand)};</script>`;
  let html = raw;
  if (html.includes("</head>")) {
    html = html.replace("</head>", `${inject}</head>`);
  } else {
    html = inject + html;
  }
  html = html
    .replace(/__FLEET_UI_TITLE__/g, UI.title)
    .replace(/__FLEET_UI_MARK__/g, UI.mark);
  return html;
}

async function handleIngest(req, res, subPath, url) {
  if (req.method === "POST" && subPath === "/heartbeat") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false, error: "json" });
    }
    const installId = sanitize(body.installId, "anon");
    upsertInstall(installId, {
      appVersion: sanitize(body.appVersion, "?"),
      platform: sanitize(body.platform),
      arch: sanitize(body.arch),
      osRelease: String(body.osRelease || "").slice(0, 40),
      hostname: String(body.hostname || "").slice(0, 80),
      tunnelSlug: body.tunnelSlug ? sanitize(body.tunnelSlug) : null,
      tunnelHostname: body.tunnelHostname
        ? String(body.tunnelHostname).slice(0, 120)
        : null,
      consent: body.consent || null,
      health: body.health || null,
      plugins: Array.isArray(body.plugins) ? body.plugins.slice(0, 50) : undefined,
      users: Array.isArray(body.users) ? body.users.slice(0, 100) : undefined,
      sessions: Array.isArray(body.sessions)
        ? body.sessions.slice(0, 100)
        : undefined,
      hermesStats: body.hermesStats || undefined,
      // Extras marque (ex. dossierStats CV via getHeartbeatExtras) — opaque.
      dossierStats:
        body.dossierStats && typeof body.dossierStats === "object"
          ? body.dossierStats
          : undefined,
      // Boîte noire : résumé du dernier boot (décisions + durées + compteurs).
      lastBootSummary:
        body.lastBootSummary && typeof body.lastBootSummary === "object"
          ? body.lastBootSummary
          : undefined,
      lastHeartbeat: new Date().toISOString(),
    });
    audit(`heartbeat install=${installId} v=${sanitize(body.appVersion)}`);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && subPath === "/crash") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false });
    }
    const installId = sanitize(body.installId, "anon");
    const kind = sanitize(body.kind, "unknown");
    const ts = new Date().toISOString();
    const name = `${ts.replace(/[:.]/g, "-")}_${kind}_${installId.slice(0, 8)}.json`;
    fs.writeFileSync(
      path.join(DATA_DIR, "crashes", name),
      JSON.stringify(body, null, 2),
    );
    const map = loadInstalls();
    const prev = map[installId] || { installId, firstSeen: ts };
    prev.crashCount = (prev.crashCount || 0) + 1;
    prev.lastCrashAt = ts;
    prev.lastCrashKind = kind;
    prev.lastSeen = ts;
    map[installId] = prev;
    saveInstalls(map);
    audit(`crash install=${installId} kind=${kind}`);
    return send(res, 204);
  }

  if (req.method === "POST" && subPath === "/bundle") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false });
    }
    const installId = sanitize(body.installId, "anon");
    const kind = sanitize(body.kind, "bundle");
    const ts = new Date().toISOString();
    const name = `${ts.replace(/[:.]/g, "-")}_${kind}_${installId.slice(0, 8)}.json`;
    fs.writeFileSync(
      path.join(DATA_DIR, "bundles", name),
      JSON.stringify(body, null, 2),
    );
    upsertInstall(installId, {
      [`lastBundle_${kind}`]: ts,
    });
    audit(`bundle install=${installId} kind=${kind}`);
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && subPath === "/commands") {
    const installId = sanitize(url.searchParams.get("installId"), "");
    if (!installId) return send(res, 400, { ok: false });
    const pending = loadCommands().filter(
      (c) =>
        c.installId === installId &&
        c.status === "pending" &&
        ALLOWED_REMOTE.has(c.command),
    );
    return send(res, 200, { ok: true, commands: pending.slice(0, 10) });
  }

  if (req.method === "POST" && subPath === "/commands/ack") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false });
    }
    const list = loadCommands();
    const idx = list.findIndex((c) => c.id === body.commandId);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        status: body.ok ? "done" : "failed",
        resultDetail: String(body.detail || "").slice(0, 500),
        ackedAt: new Date().toISOString(),
      };
      saveCommands(list);
      audit(
        `cmd-ack id=${body.commandId} ok=${body.ok} install=${sanitize(body.installId)}`,
      );
    }
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { ok: false });
}

function listCrashes(limit = 50) {
  const dir = path.join(DATA_DIR, "crashes");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return {
          file: f,
          kind: j.kind,
          installId: j.installId,
          appVersion: j.appVersion,
          timestamp: j.timestamp,
          bootStage: j.bootStage,
          message: String(j?.detail?.message || "").slice(0, 200),
        };
      } catch {
        return { file: f };
      }
    });
}

function listBundles(limit = 40) {
  const dir = path.join(DATA_DIR, "bundles");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        return {
          file: f,
          kind: j.kind,
          installId: j.installId,
          timestamp: j.timestamp,
          count: Array.isArray(j.items) ? j.items.length : 0,
        };
      } catch {
        return { file: f };
      }
    });
}

const opsOpts = () => ({ tunnelSuffix: TUNNEL_SUFFIX });

async function handleOps(req, res, url) {
  const p = url.pathname;

  if (!opsAuthorized(req, url)) {
    return sendUnauthorized(res);
  }

  if (req.method === "GET" && (p === "/" || p === "/ops" || p === "/ops/")) {
    return send(res, 200, renderOpsHtml());
  }

  if (req.method === "GET" && p === "/ops/api/fleet") {
    return send(res, 200, buildFleetOverview(DATA_DIR, opsOpts()));
  }

  if (req.method === "GET" && p.startsWith("/ops/api/server/") && p.includes("/user/")) {
    const rest = p.slice("/ops/api/server/".length);
    const [slugEnc, , userEnc] = rest.split("/");
    const detail = buildUserDetail(
      DATA_DIR,
      decodeURIComponent(slugEnc || ""),
      decodeURIComponent(userEnc || ""),
      opsOpts(),
    );
    return send(res, detail.ok ? 200 : 404, detail);
  }

  if (req.method === "GET" && p.startsWith("/ops/api/server/")) {
    const slug = decodeURIComponent(p.slice("/ops/api/server/".length));
    const detail = buildServerDetail(DATA_DIR, slug, opsOpts());
    return send(res, detail.ok ? 200 : 404, detail);
  }

  if (req.method === "GET" && p === "/ops/api/installs") {
    const map = loadInstalls();
    const list = Object.values(map).sort((a, b) =>
      String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")),
    );
    return send(res, 200, { ok: true, installs: list });
  }

  if (req.method === "GET" && p === "/ops/api/crashes") {
    return send(res, 200, { ok: true, crashes: listCrashes(80) });
  }

  if (req.method === "GET" && p === "/ops/api/bundles") {
    return send(res, 200, { ok: true, bundles: listBundles(60) });
  }

  if (req.method === "GET" && p.startsWith("/ops/api/bundle/")) {
    const file = sanitize(p.slice("/ops/api/bundle/".length), "");
    const full = path.join(DATA_DIR, "bundles", file);
    if (!file.endsWith(".json") || !fs.existsSync(full)) {
      return send(res, 404, { ok: false });
    }
    return send(res, 200, readJson(full, {}));
  }

  if (req.method === "GET" && p.startsWith("/ops/api/crash/")) {
    const file = sanitize(p.slice("/ops/api/crash/".length), "");
    const full = path.join(DATA_DIR, "crashes", file);
    if (!file.endsWith(".json") || !fs.existsSync(full)) {
      return send(res, 404, { ok: false });
    }
    return send(res, 200, readJson(full, {}));
  }

  if (req.method === "GET" && p === "/ops/api/commands") {
    return send(res, 200, { ok: true, commands: loadCommands().slice(-100) });
  }

  if (req.method === "POST" && p === "/ops/api/commands") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false });
    }
    const installId = sanitize(body.installId, "");
    const command = String(body.command || "");
    if (!installId || !ALLOWED_REMOTE.has(command)) {
      return send(res, 400, { ok: false, error: "invalid command or install" });
    }
    const cmd = {
      id: crypto.randomUUID(),
      installId,
      command,
      args: body.args && typeof body.args === "object" ? body.args : {},
      status: "pending",
      createdAt: new Date().toISOString(),
      createdBy: "ops",
    };
    const list = loadCommands();
    list.push(cmd);
    saveCommands(list);
    audit(`cmd-enqueue id=${cmd.id} cmd=${command} install=${installId}`);
    return send(res, 200, { ok: true, command: cmd });
  }

  if (req.method === "GET" && p === "/ops/api/health") {
    return send(res, 200, {
      ok: true,
      service: "fleet-collector",
      installs: Object.keys(loadInstalls()).length,
      crashes: listCrashes(1000).length,
    });
  }

  return send(res, 404, { ok: false });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const ingestSub = parseIngestPath(url.pathname);
    if (ingestSub !== null) {
      return await handleIngest(req, res, ingestSub, url);
    }
    if (
      url.pathname === "/" ||
      url.pathname.startsWith("/ops")
    ) {
      return await handleOps(req, res, url);
    }
    return send(res, 404, { ok: false });
  } catch (e) {
    console.error("[fleet] error", e);
    if (!res.writableEnded) send(res, 500, { ok: false });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[fleet] écoute 127.0.0.1:${PORT} data=${DATA_DIR} title=${UI.title} ingest=/i-${INGEST.slice(0, 8)}…`,
  );
});
