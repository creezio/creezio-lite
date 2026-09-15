/**
 * Clé API CRM dédiée par plugin — port TF gold plugin-crm-key.ts (N1).
 * Injection : apiKeyPrefix, crmKeyFileName, dbPath, nodeBinary, nodeScript.
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  getPluginHostBindings,
  pluginCrmKeyFileName,
} from "./brand-bindings.js";
import { envForNodeScriptSpawn } from "../node-runtime.js";

export type PluginCrmKeyStored = {
  apiKey: string;
  prefix: string;
  scopes: string;
  createdAt: string;
};

function scopesFromPerms(permissions: string[]): string | null {
  const perms = new Set(permissions.map(String));
  if (perms.has("crm:write")) return "crm:read,crm:write";
  if (perms.has("crm:read")) return "crm:read";
  return null;
}

/** @deprecated nom fichier déjà déployé — dual-read H13, retrait H14. */
export const PLUGIN_CRM_KEY_FILE = ".tempoflow-plugin-api-key.json";

export function pluginCrmKeyPath(pluginDir: string): string {
  const preferred = path.join(
    pluginDir,
    pluginCrmKeyFileName(getPluginHostBindings()),
  );
  if (fs.existsSync(preferred)) return preferred;
  // H13 dual-read du nom déjà déployé — retrait H14 (ADR-h13-allowlist-residue).
  const legacy = path.join(pluginDir, PLUGIN_CRM_KEY_FILE);
  if (fs.existsSync(legacy)) return legacy;
  return preferred;
}

export function readPluginCrmApiKey(
  pluginDir: string,
): PluginCrmKeyStored | null {
  const bindings = getPluginHostBindings();
  const prefix = bindings.apiKeyPrefix;
  try {
    const raw = JSON.parse(
      fs.readFileSync(pluginCrmKeyPath(pluginDir), "utf8"),
    ) as PluginCrmKeyStored;
    if (
      raw &&
      typeof raw.apiKey === "string" &&
      raw.apiKey.startsWith(prefix) &&
      typeof raw.scopes === "string"
    ) {
      return raw;
    }
  } catch {
    /* absent */
  }
  return null;
}

function writePluginCrmApiKey(
  pluginDir: string,
  data: PluginCrmKeyStored,
): void {
  fs.writeFileSync(
    pluginCrmKeyPath(pluginDir),
    `${JSON.stringify(data, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function generateKey(scopes: string): PluginCrmKeyStored {
  const bindings = getPluginHostBindings();
  const prefix = bindings.apiKeyPrefix;
  const secret = crypto.randomBytes(24).toString("base64url");
  const apiKey = `${prefix}${secret}`;
  return {
    apiKey,
    prefix: apiKey.slice(0, prefix.length + 6),
    scopes,
    createdAt: new Date().toISOString(),
  };
}

function upsertDb(
  apiKey: string,
  name: string,
  scopes: string,
): Promise<{ ok: boolean; detail: string }> {
  const bindings = getPluginHostBindings();
  const scriptName =
    bindings.crmKeyDbScriptName || "ensure-hermes-crm-key-db.js";
  const script = bindings.nodeScript(scriptName);
  if (!fs.existsSync(script)) {
    return Promise.resolve({
      ok: false,
      detail: `script DB absent: ${script}`,
    });
  }
  return new Promise((resolve) => {
    const bin = bindings.nodeBinary();
    const env: NodeJS.ProcessEnv = {
      ...envForNodeScriptSpawn(bin),
      DB_PATH: bindings.dbPath(),
    };
    delete env.ELECTRON_BINARY;
    const nm = bindings.nodeModulesPathForScripts?.();
    if (nm) env.NODE_PATH = nm;
    const child = spawn(
      bin,
      [script, bindings.dbPath(), apiKey, name, scopes],
      { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => resolve({ ok: false, detail: e.message }));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true, detail: out.trim() || "ok" });
      } else {
        resolve({ ok: false, detail: err.trim() || `exit ${code}` });
      }
    });
  });
}

/**
 * Garantit une clé plugin avec scopes dérivés des permissions.
 * Retourne null si le plugin n’a pas `crm:read` / `crm:write`.
 */
export async function ensurePluginCrmApiKey(opts: {
  pluginId: string;
  pluginDir: string;
  permissions: string[];
  log?: (line: string) => void;
}): Promise<PluginCrmKeyStored | null> {
  const bindings = getPluginHostBindings();
  const log = opts.log || (() => {});
  const scopes = scopesFromPerms(opts.permissions);
  if (!scopes) {
    log(`plugin-key ${opts.pluginId}: pas de permission crm:*`);
    return null;
  }

  let stored = readPluginCrmApiKey(opts.pluginDir);
  if (!stored || stored.scopes !== scopes) {
    stored = generateKey(scopes);
    writePluginCrmApiKey(opts.pluginDir, stored);
    log(`plugin-key ${opts.pluginId}: générée (${scopes})`);
  }

  const name = bindings.crmKeyDisplayName
    ? bindings.crmKeyDisplayName(opts.pluginId)
    : `${bindings.productName} Plugin ${opts.pluginId}`;
  const db = await upsertDb(stored.apiKey, name, scopes);
  if (!db.ok) {
    log(`plugin-key ${opts.pluginId}: DB ${db.detail}`);
  } else {
    log(`plugin-key ${opts.pluginId}: DB OK (${db.detail})`);
  }
  return stored;
}
