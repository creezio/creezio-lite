/**
 * Clé API CRM dédiée à Hermes — fichier local + upsert SQLite via sous-process.
 * Gold première marque paramétré (prefix / file / env keys / paths injectés,
 * dérivés du manifest par compose-brand-os : `{PREFIX}_API_KEY` / `{PREFIX}_API_URL`).
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { N8nApiKeyBrand } from "../n8n/api-key.js";
import { getN8nBridgeEnv } from "../n8n/api-key.js";
import { getPluginControlBridgeEnv } from "../plugins/control-extras.js";
import { envForNodeScriptSpawn } from "../node-runtime.js";

export type HermesCrmKeyBrand = {
  apiKeyPrefix: string;
  fileName: string;
  keyName: string;
  /** Env CRM key, dérivée du manifest : `{envPrefix}_API_KEY`. */
  apiKeyEnv: string;
  /** Env CRM URL, dérivée du manifest : `{envPrefix}_API_URL`. */
  apiUrlEnv: string;
};

export type HermesCrmKeyStored = {
  apiKey: string;
  prefix: string;
  createdAt: string;
};

export type HermesCrmKeyPaths = {
  userDataDir: string;
  dbPath: string;
  n8nHomeDir: string;
  nodeBinary: string;
  /** Chemin absolu script ensure-crm-key-db compilé. */
  ensureDbScriptPath: string;
  nodeModulesPathForScripts?: string | null;
};

export function hermesCrmKeyPath(
  brand: HermesCrmKeyBrand,
  paths: Pick<HermesCrmKeyPaths, "userDataDir">,
): string {
  return path.join(paths.userDataDir, brand.fileName);
}

export function readHermesCrmApiKey(
  brand: HermesCrmKeyBrand,
  paths: Pick<HermesCrmKeyPaths, "userDataDir">,
): HermesCrmKeyStored | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(hermesCrmKeyPath(brand, paths), "utf8"),
    ) as HermesCrmKeyStored;
    if (
      raw &&
      typeof raw.apiKey === "string" &&
      raw.apiKey.startsWith(brand.apiKeyPrefix) &&
      raw.apiKey.length > brand.apiKeyPrefix.length + 8
    ) {
      return raw;
    }
  } catch {
    /* absent */
  }
  return null;
}

export function writeHermesCrmApiKey(
  brand: HermesCrmKeyBrand,
  paths: Pick<HermesCrmKeyPaths, "userDataDir">,
  data: HermesCrmKeyStored,
): void {
  fs.writeFileSync(
    hermesCrmKeyPath(brand, paths),
    `${JSON.stringify(data, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export function generateHermesCrmApiKey(
  brand: HermesCrmKeyBrand,
): HermesCrmKeyStored {
  const secret = crypto.randomBytes(24).toString("base64url");
  const apiKey = `${brand.apiKeyPrefix}${secret}`;
  return {
    apiKey,
    prefix: apiKey.slice(0, brand.apiKeyPrefix.length + 6),
    createdAt: new Date().toISOString(),
  };
}

export function getHermesFullBridgeEnv(opts: {
  brand: HermesCrmKeyBrand;
  n8nBrand: N8nApiKeyBrand;
  paths: Pick<HermesCrmKeyPaths, "userDataDir" | "n8nHomeDir">;
  n8nUiUrl: string;
  crmPort?: number | null;
}): Record<string, string> {
  const out = getN8nBridgeEnv({
    homeDir: opts.paths.n8nHomeDir,
    localUiUrl: opts.n8nUiUrl,
    brand: opts.n8nBrand,
  });
  const crm = readHermesCrmApiKey(opts.brand, opts.paths);
  if (crm?.apiKey) out[opts.brand.apiKeyEnv] = crm.apiKey;
  if (opts.crmPort && opts.crmPort > 0) {
    out[opts.brand.apiUrlEnv] = `http://127.0.0.1:${opts.crmPort}`;
  }
  try {
    Object.assign(out, getPluginControlBridgeEnv());
  } catch {
    /* control plane pas encore chargé */
  }
  return out;
}

export async function ensureHermesCrmApiKey(opts: {
  brand: HermesCrmKeyBrand;
  paths: HermesCrmKeyPaths;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; apiKey: string | null; detail: string }> {
  const log = opts.log || (() => {});
  let stored = readHermesCrmApiKey(opts.brand, opts.paths);
  if (!stored) {
    stored = generateHermesCrmApiKey(opts.brand);
    writeHermesCrmApiKey(opts.brand, opts.paths, stored);
    log("crm-key: générée pour Hermes");
  } else {
    log("crm-key: réutilise clé locale Hermes");
  }

  const script = opts.paths.ensureDbScriptPath;
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      apiKey: stored.apiKey,
      detail: `script DB absent: ${script}`,
    };
  }

  return new Promise((resolve) => {
    const bin = opts.paths.nodeBinary;
    const env: NodeJS.ProcessEnv = {
      ...envForNodeScriptSpawn(bin),
      DB_PATH: opts.paths.dbPath,
    };
    delete env.ELECTRON_BINARY;
    if (opts.paths.nodeModulesPathForScripts) {
      env.NODE_PATH = opts.paths.nodeModulesPathForScripts;
    }
    const child = spawn(
      bin,
      [script, opts.paths.dbPath, stored!.apiKey, opts.brand.keyName],
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
    child.on("error", (e) => {
      resolve({
        ok: false,
        apiKey: stored!.apiKey,
        detail: e.message,
      });
    });
    child.on("exit", (code) => {
      if (code === 0) {
        log(`crm-key: DB OK (${out.trim() || "upsert"})`);
        resolve({
          ok: true,
          apiKey: stored!.apiKey,
          detail: out.trim() || "ok",
        });
      } else {
        resolve({
          ok: false,
          apiKey: stored!.apiKey,
          detail: err.trim() || `exit ${code}`,
        });
      }
    });
  });
}
