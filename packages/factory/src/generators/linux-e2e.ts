/**
 * Artefacts pack Linux / E2E / env pour --from-prd.
 * SoT exécutable = @creezio/desktop-tooling/scripts/* ;
 * ici on génère wrappers minces + metier-base + .env.example.
 */
import type { ProductModel } from "../product-model.js";

function renderToolingWrapper(
  scriptName: string,
  opts?: { passAppRootArg?: boolean },
): string {
  const passRoot = opts?.passAppRootArg
    ? "const args = [script, root, ...process.argv.slice(2)];"
    : "const args = [script, ...process.argv.slice(2)];";
  return `#!/usr/bin/env node
/** Thin → @creezio/desktop-tooling/scripts/${scriptName} (SoT kit). */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cands = [
  path.join(root, "node_modules/@creezio/desktop-tooling/scripts/${scriptName}"),
];
const script = cands.find((p) => fs.existsSync(p));
if (!script) {
  throw new Error("${scriptName} introuvable — npm ci requis (package @creezio/desktop-tooling)");
}
${passRoot}
const r = spawnSync(process.execPath, args, {
  cwd: root,
  env: { ...process.env, CREEZIO_APP_ROOT: root },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
`;
}

/** Base URL API métier — same-origin navigateur + rewrite Next. */
export function renderMetierBaseTs(): string {
  return `/**
 * Base URL de l’API métier (kernel harness / desktop).
 * - Navigateur : same-origin \`""\` → rewrite Next \`/api/v1/*\` → kernel
 * - NEXT_PUBLIC_* : bake Next (desktop Electron ou override explicite)
 * - METIER_BASE_URL : runtime injecté par startBrandUiPlane (SSR)
 * - défaut SSR/node : harness local 18791
 */
export function metierBase(): string {
  if (typeof window !== "undefined") {
    const baked = process.env.NEXT_PUBLIC_METIER_BASE_URL;
    if (baked && !/127\\.0\\.0\\.1:18791|localhost:18791/.test(baked)) {
      return baked;
    }
    return "";
  }
  if (typeof process !== "undefined") {
    if (process.env.NEXT_PUBLIC_METIER_BASE_URL) {
      return process.env.NEXT_PUBLIC_METIER_BASE_URL;
    }
    if (process.env.METIER_BASE_URL) {
      return process.env.METIER_BASE_URL;
    }
  }
  return "http://127.0.0.1:18791";
}
`;
}

export function renderEnsureLinuxIconsMjs(): string {
  return renderToolingWrapper("ensure-linux-icons.mjs", {
    passAppRootArg: true,
  });
}

export function renderE2eBrowserParcoursMjs(_model: ProductModel): string {
  return renderToolingWrapper("e2e-browser-parcours.mjs");
}

/** Copie locale importable (smokes marque : \`import { loadLocalEnv } from …\`). */
export function renderLoadLocalEnvMjs(): string {
  return `/**
 * Charge \`<app>/.env\` (gitignoré) dans process.env.
 * Miroir de @creezio/desktop-tooling/scripts/load-local-env.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * @param {string} [root]
 * @returns {{ loaded: boolean, path: string, keys: string[] }}
 */
export function loadLocalEnv(root = DEFAULT_ROOT) {
  const envPath = path.join(root, ".env");
  const keys = [];
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath, keys };
  }
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\\r?\\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = val;
      keys.push(key);
    }
  }
  return { loaded: true, path: envPath, keys };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const r = loadLocalEnv(
    process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_ROOT,
  );
  console.log(
    JSON.stringify(
      { loaded: r.loaded, path: r.path, keyCount: r.keys.length, keys: r.keys },
      null,
      2,
    ),
  );
}
`;
}

/**
 * Smoke tunnel + HEAD catalogue (générique).
 * Download massif reste opt-in / vertical marque.
 */
export function renderSmokeTunnelCatalogMjs(model: ProductModel): string {
  const brandUpper = model.brandId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `#!/usr/bin/env node
/**
 * Smoke ops : contrat Cloudflare Tunnel (auto-provisioning instance) +
 * HEAD catalogue (optionnel). Secrets : \`.env\` (voir \`.env.example\`).
 *
 * Vérifie le token CF (account token via /accounts/{id}/tokens/verify,
 * user token via /user/tokens/verify) et la résolution de la zone — sans
 * créer aucune ressource (lecture seule).
 */
import assert from "node:assert/strict";
import { loadLocalEnv } from "./load-local-env.mjs";

const root = process.cwd();
loadLocalEnv(root);

const cfToken =
  process.env.${brandUpper}_CF_API_TOKEN ||
  process.env.CREEZIO_CF_API_TOKEN ||
  "";
const cfAccount =
  process.env.${brandUpper}_CF_ACCOUNT_ID ||
  process.env.CREEZIO_CF_ACCOUNT_ID ||
  "";
const cfZone =
  process.env.${brandUpper}_CF_ZONE_ID ||
  process.env.CREEZIO_CF_ZONE_ID ||
  "";
const catalogUrl =
  process.env.${brandUpper}_CATALOG_URL ||
  process.env.CREEZIO_CATALOG_URL ||
  "";

assert.ok(cfToken, "CF_API_TOKEN manquant (.env)");
assert.ok(cfAccount, "CF_ACCOUNT_ID manquant (.env)");
assert.ok(cfZone, "CF_ZONE_ID manquant (.env)");

const CF = "https://api.cloudflare.com/client/v4";
const headers = { Authorization: \`Bearer \${cfToken}\` };

// Token : account d'abord, user ensuite (les deux sont supportés).
let kind = "account";
let verify = await fetch(\`\${CF}/accounts/\${cfAccount}/tokens/verify\`, {
  headers,
});
if (verify.status !== 200) {
  kind = "user";
  verify = await fetch(\`\${CF}/user/tokens/verify\`, { headers });
}
assert.equal(verify.status, 200, \`token CF verify HTTP \${verify.status}\`);
const verifyJson = await verify.json();
assert.equal(verifyJson.success, true, "token CF invalide");

const zone = await fetch(\`\${CF}/zones/\${cfZone}\`, { headers });
assert.equal(zone.status, 200, \`zone CF HTTP \${zone.status}\`);
const zoneJson = await zone.json();
assert.equal(zoneJson.success, true, "zone CF illisible");

console.log("OK cloudflare", JSON.stringify({
  tokenKind: kind,
  zone: zoneJson.result?.name,
}));

if (catalogUrl) {
  const head = await fetch(catalogUrl, { method: "HEAD" });
  assert.equal(head.status, 200, \`catalog HEAD HTTP \${head.status}\`);
  console.log("OK catalog HEAD", catalogUrl.split("/").pop());
} else {
  console.log("skip catalog (pas de CATALOG_URL)");
}
`;
}

export function renderEnvExample(model: ProductModel): string {
  const brandUpper = model.brandId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `# Copier vers \`.env\` (gitignoré). Secrets hors git.

# --- Tunnel Cloudflare (auto-provisioning par l'instance, API CF directe) ---
# Account token scopé compte+zone (Zero Trust → Tunnels + DNS de la zone).
CREEZIO_CF_API_TOKEN=<TOKEN>
CREEZIO_CF_ACCOUNT_ID=<account-id>
CREEZIO_CF_ZONE_ID=<zone-id>
# CREEZIO_CF_ZONE_NAME=example.fr   (optionnel — dérivé via GET /zones/{id})
# CREEZIO_CF_UNIVERSAL_SSL=1        (optionnel — hostnames nested
#                                    n8n.{slug}.{zone} ; défaut flat
#                                    n8n-{slug}.{zone})
# CREEZIO_TUNNEL_SLUG=<slug>        (optionnel — défaut nom d'instance/brandId)
# CREEZIO_DOMAIN=app.example.fr     (optionnel — hostname complet custom)
# Variantes marque possibles : ${brandUpper}_CF_API_TOKEN=… etc.

# --- Catalogue distant (optionnel) ---
# CREEZIO_CATALOG_URL=https://example.invalid/catalog.db.gz
# ${brandUpper}_CATALOG_URL=…
`;
}
