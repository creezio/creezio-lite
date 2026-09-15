/**
 * Control-plane plugins — boot kit + extras verticaux (N1).
 * Port TF gold plugin-control-extras.ts avec injection marque.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  issuePluginExecutionGrant,
  verifyPluginExecutionGrant,
} from "@creezio/platform-core";
import { productHubTokensFromManifest } from "@creezio/product-hub";
import { startHostPluginControlPlane } from "./control-plane.js";
import { ensurePluginControlToken } from "./control-token.js";
import {
  assignPluginEnv,
  getPluginHostBindings,
  resolveFindFreePort,
} from "./brand-bindings.js";
import { runPluginAcceptCheck } from "./accept-check.js";
import {
  enablePlugin,
  getPluginLogs,
  getPluginVersions,
  pluginsStatusPayload,
  proxyPluginHealth,
  restorePluginToVersion,
} from "./launcher.js";
import { pluginsRootDir } from "./runtime.js";
import { runPluginTests } from "./test-runner.js";

export const PLUGIN_CONTROL_PREFERRED_PORT = 18791;

export type PluginControlApiState = {
  port: number;
  url: string;
  token: string;
  pluginsDir: string;
  close: () => Promise<void>;
};

let running: PluginControlApiState | null = null;

export function getPluginControlApi(): PluginControlApiState | null {
  return running;
}

/**
 * Env bridge plugins : `${envPrefix}_PLUGINS_*` dérivé du manifest.
 */
export function getPluginControlBridgeEnv(): Record<string, string> {
  if (!running) return {};
  const bindings = getPluginHostBindings();
  const out: Record<string, string | undefined> = {};
  assignPluginEnv(out, bindings, "PLUGINS_API_URL", running.url);
  assignPluginEnv(out, bindings, "PLUGINS_API_TOKEN", running.token);
  assignPluginEnv(out, bindings, "PLUGINS_DIR", running.pluginsDir);
  return out as Record<string, string>;
}

function json(res: http.ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("body trop gros"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function authOk(req: http.IncomingMessage, token: string): boolean {
  const h = String(req.headers.authorization || "");
  if (h === `Bearer ${token}`) return true;
  return String(req.headers["x-api-key"] || "") === token;
}

export function migratePluginData(id: string): Promise<Record<string, unknown>> {
  const bindings = getPluginHostBindings();
  const pluginDir = path.join(pluginsRootDir(), id);
  return new Promise((resolve, reject) => {
    const child = spawn(
      bindings.nodeBinary(),
      [bindings.nodeScript("plugin-data.js"), "migrate", pluginDir],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString("utf8")).slice(-256_000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-256_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr || `migration data exit ${code}`));
      }
      try {
        resolve(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error("rapport migration data invalide"));
      }
    });
  });
}

export function archivePluginRuntime(
  id: string,
): { ok: true; archivedPath: string } | { ok: false; error: string } {
  const pluginDir = path.join(pluginsRootDir(), id);
  if (!fs.existsSync(path.join(pluginDir, "manifest.json"))) {
    return { ok: false, error: "plugin inconnu" };
  }
  enablePlugin(id, false);
  const archiveRoot = path.join(
    path.dirname(pluginsRootDir()),
    "archived-plugins",
  );
  fs.mkdirSync(archiveRoot, { recursive: true });
  const archivedPath = path.join(
    archiveRoot,
    `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  fs.renameSync(pluginDir, archivedPath);
  return { ok: true, archivedPath };
}

function grantTokenPrefix(): string {
  const bindings = getPluginHostBindings();
  return productHubTokensFromManifest(bindings.manifest).grantTokenPrefix;
}

export function createPluginExecutionGrant(opts: {
  productId: string;
  prdRevisionId: string;
  pluginId: string;
  ttlSeconds?: number;
}): { token: string; expiresAt: string; grantId: string } {
  if (!running) throw new Error("control plane plugins non démarré");
  const issued = issuePluginExecutionGrant({
    ...opts,
    secret: running.token,
    tokenPrefix: grantTokenPrefix(),
  });
  return {
    token: issued.token,
    expiresAt: new Date(issued.payload.exp * 1000).toISOString(),
    grantId: issued.payload.grantId,
  };
}

export function validatePluginExecutionGrant(opts: {
  token: string;
  pluginId: string;
  action: "create" | "write";
}): { ok: true } | { ok: false; error: string } {
  if (!running) return { ok: false, error: "control plane plugins non démarré" };
  const result = verifyPluginExecutionGrant({
    token: opts.token,
    secret: running.token,
    pluginId: opts.pluginId,
    action: opts.action,
    tokenPrefix: grantTokenPrefix(),
  });
  return result.ok ? { ok: true } : result;
}

/** Boot : `startHostPluginControlPlane` + ACL L3 + extras marque. */
export async function startPluginControlApi(opts?: {
  preferredPort?: number;
  log?: (line: string) => void;
}): Promise<PluginControlApiState> {
  if (running) return running;
  const bindings = getPluginHostBindings();
  const log = opts?.log || (() => {});
  const ctx = bindings.hostRuntimeContext();
  const stored = ensurePluginControlToken(ctx);
  const preferred = opts?.preferredPort ?? PLUGIN_CONTROL_PREFERRED_PORT;
  const findPort = resolveFindFreePort(bindings);
  const port = await findPort(preferred, "127.0.0.1");
  fs.mkdirSync(pluginsRootDir(), { recursive: true });

  const extrasHandler =
    bindings.handleBrandExtras || handlePluginControlExtras;

  const plane = await startHostPluginControlPlane({
    ctx: {
      ...ctx,
      manifest: bindings.manifest || ctx.manifest,
    },
    acl: bindings.createControlPlaneAcl(),
    adapters: bindings.buildControlPlaneAdapters(),
    productHubStore: bindings.ensureProductHubStore(),
    controlToken: stored.token,
    preferredPort: preferred,
    port,
    preHandle: (req, res) => extrasHandler(req, res, stored.token),
  });
  running = {
    port: plane.port,
    url: plane.url,
    token: plane.token,
    pluginsDir: plane.pluginsDir,
    close: () => plane.close(),
  };
  log(
    `plugins-api: écoute ${running.url} (startHostPluginControlPlane ACL L3)`,
  );
  return running;
}

export function stopPluginControlApi(): void {
  if (!running) return;
  const cur = running;
  running = null;
  void cur.close().catch(() => {});
  try {
    getPluginHostBindings().closeProductHubStore();
  } catch {
    /* bindings absents en tests */
  }
}

/**
 * Routes extras hors kit générique (versions/git, accept-check, health, llm…).
 * Hook injectable via `bindings.handleBrandExtras` (handler métier marque).
 * @returns true si la requête a été traitée (y compris 401).
 */
export async function handlePluginControlExtras(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
): Promise<boolean> {
  const bindings = getPluginHostBindings();
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const method = (req.method || "GET").toUpperCase();
  const p = url.pathname.replace(/\/+$/, "") || "/";

  const isExtra =
    (method === "POST" && p === "/v1/llm/chat") ||
    /^\/v1\/plugins\/[a-z][a-z0-9-]{1,62}\/versions$/.test(p) ||
    /^\/v1\/plugins\/[a-z][a-z0-9-]{1,62}\/(health|logs|accept-check|tests|data-migrate|archive)$/.test(
      p,
    );
  if (!isExtra) return false;

  if (!authOk(req, token)) {
    json(res, 401, { ok: false, error: "unauthorized" });
    return true;
  }

  const versionsMatch = p.match(
    /^\/v1\/plugins\/([a-z][a-z0-9-]{1,62})\/versions$/,
  );
  if (versionsMatch) {
    const id = versionsMatch[1]!;
    if (method === "GET") {
      const v = await getPluginVersions(id);
      json(res, v.ok ? 200 : 404, v);
      return true;
    }
    if (method === "POST") {
      const raw = await readBody(req);
      let body: { ref?: string; action?: string } = {};
      try {
        body = raw ? (JSON.parse(raw) as typeof body) : {};
      } catch {
        json(res, 400, { ok: false, error: "JSON invalide" });
        return true;
      }
      const action = String(body.action || "restore");
      if (action !== "restore") {
        json(res, 400, { ok: false, error: "action inconnue (restore)" });
        return true;
      }
      const r = await restorePluginToVersion(id, String(body.ref || ""));
      if (!r.ok) {
        json(res, 400, { ok: false, error: r.error });
        return true;
      }
      json(res, 200, {
        ok: true,
        sha: r.sha,
        detail: r.detail,
        running: r.running,
        status: pluginsStatusPayload(),
      });
      return true;
    }
  }

  const actionMatch = p.match(
    /^\/v1\/plugins\/([a-z][a-z0-9-]{1,62})\/(health|logs|accept-check|tests|data-migrate|archive)$/,
  );
  if (actionMatch) {
    const id = actionMatch[1]!;
    const action = actionMatch[2]!;
    if (method === "POST" && action === "accept-check") {
      const result = await runPluginAcceptCheck(id);
      json(res, result.ok ? 200 : 422, result);
      return true;
    }
    if (method === "POST" && action === "tests") {
      const result = await runPluginTests(id);
      json(res, result.ok ? 200 : 422, result);
      return true;
    }
    if (method === "POST" && action === "data-migrate") {
      try {
        json(res, 200, { ok: true, ...(await migratePluginData(id)) });
      } catch (error) {
        json(res, 422, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    }
    if (method === "POST" && action === "archive") {
      const result = archivePluginRuntime(id);
      json(res, result.ok ? 200 : 404, result);
      return true;
    }
    if (method === "GET" && action === "health") {
      const h = await proxyPluginHealth(id);
      json(res, h.ok ? 200 : 502, h);
      return true;
    }
    if (method === "GET" && action === "logs") {
      json(res, 200, { ok: true, logs: getPluginLogs() });
      return true;
    }
  }

  if (method === "POST" && p === "/v1/llm/chat") {
    const raw = await readBody(req);
    let body: {
      provider?: string;
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      max_tokens?: number;
      temperature?: number;
    } = {};
    try {
      body = raw ? (JSON.parse(raw) as typeof body) : {};
    } catch {
      json(res, 400, { ok: false, error: "JSON invalide" });
      return true;
    }
    const keys = bindings.getLlmKeys();
    const provider = String(body.provider || "openai");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      json(res, 400, { ok: false, error: "messages requis" });
      return true;
    }
    try {
      if (provider === "anthropic") {
        if (!keys.anthropic) {
          json(res, 503, {
            ok: false,
            error: `ANTHROPIC_API_KEY absent — configure BYOK dans ${bindings.productName}`,
          });
          return true;
        }
        const model = body.model || "claude-sonnet-4-20250514";
        const system = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n");
        const userMsgs = messages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content || ""),
          }));
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": keys.anthropic,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: body.max_tokens || 1024,
            system: system || undefined,
            messages: userMsgs,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = await r.json().catch(() => ({}));
        json(res, r.ok ? 200 : r.status, { ok: r.ok, provider, model, data });
        return true;
      }
      if (!keys.openai) {
        json(res, 503, {
          ok: false,
          error: `OPENAI_API_KEY absent — configure BYOK dans ${bindings.productName}`,
        });
        return true;
      }
      const model = body.model || "gpt-4o-mini";
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keys.openai}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: body.temperature,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = await r.json().catch(() => ({}));
      json(res, r.ok ? 200 : r.status, { ok: r.ok, provider, model, data });
      return true;
    } catch (e) {
      json(res, 502, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return true;
    }
  }

  json(res, 404, { ok: false, error: "not found", path: p });
  return true;
}

/** Alias TF — hook métier injectable via bindings.handleBrandExtras. */
export const handleBrandExtras = handlePluginControlExtras;
