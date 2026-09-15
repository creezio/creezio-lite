#!/usr/bin/env node
/**
 * Smoke ops générique : contrat Cloudflare Tunnel (auto-provisioning
 * instance, API CF directe — lecture seule) + HEAD catalogue distant
 * (optionnel).
 *
 *   node …/smoke-tunnel-catalog.mjs
 *   node …/smoke-tunnel-catalog.mjs --download   # marque doit brancher ensure
 *
 * Secrets : `<app>/.env` gitignoré — CREEZIO_CF_API_TOKEN /
 * CREEZIO_CF_ACCOUNT_ID / CREEZIO_CF_ZONE_ID (+ variantes {ENV_PREFIX}_CF_*).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./load-local-env.mjs";

const root = path.resolve(process.env.CREEZIO_APP_ROOT || process.cwd());
const doDownload = process.argv.includes("--download");
const envInfo = loadLocalEnv(root);

function readEnvPrefix() {
  try {
    const m = JSON.parse(
      fs.readFileSync(
        path.join(root, "src/electron/app-manifest.json"),
        "utf8",
      ),
    );
    return String(m.envPrefix || "").toUpperCase();
  } catch {
    return "";
  }
}

const prefix = readEnvPrefix();
const pick = (key, legacy = []) =>
  (prefix && process.env[`${prefix}_${key}`]) ||
  process.env[`CREEZIO_${key}`] ||
  legacy.map((k) => process.env[k]).find(Boolean) ||
  "";

const cfToken = pick("CF_API_TOKEN", ["TEMPOFLOW3_CF_API_TOKEN"]);
const cfAccount = pick("CF_ACCOUNT_ID", ["TEMPOFLOW3_CF_ACCOUNT_ID"]);
const cfZone = pick("CF_ZONE_ID", ["TEMPOFLOW3_CF_ZONE_ID"]);
const catalogUrl =
  (prefix && process.env[`${prefix}_CATALOG_URL`]) ||
  process.env.CREEZIO_CATALOG_URL ||
  process.env.TF3_CATALOG_URL ||
  process.env.TF2_CATALOG_URL ||
  "";

console.log(
  JSON.stringify(
    {
      envLoaded: envInfo.loaded,
      envKeys: envInfo.keys,
      cfTokenSet: Boolean(cfToken),
      cfAccountSet: Boolean(cfAccount),
      cfZoneSet: Boolean(cfZone),
      catalogUrlSet: Boolean(catalogUrl),
    },
    null,
    2,
  ),
);

assert.ok(cfToken, "CF_API_TOKEN manquant (.env)");
assert.ok(cfAccount, "CF_ACCOUNT_ID manquant (.env)");
assert.ok(cfZone, "CF_ZONE_ID manquant (.env)");

const CF = "https://api.cloudflare.com/client/v4";
const headers = { Authorization: `Bearer ${cfToken}` };

// Token : account d'abord, user ensuite (les deux sont supportés).
let kind = "account";
let verify = await fetch(`${CF}/accounts/${cfAccount}/tokens/verify`, {
  headers,
});
if (verify.status !== 200) {
  kind = "user";
  verify = await fetch(`${CF}/user/tokens/verify`, { headers });
}
assert.equal(verify.status, 200, `token CF verify HTTP ${verify.status}`);
const verifyJson = await verify.json();
assert.equal(verifyJson.success, true, "token CF invalide");

// Zone lisible → nom résolu (base des hostnames {slug}.{zone}).
const zone = await fetch(`${CF}/zones/${cfZone}`, { headers });
assert.equal(zone.status, 200, `zone CF HTTP ${zone.status}`);
const zoneJson = await zone.json();
assert.equal(zoneJson.success, true, "zone CF illisible");
const zoneName = String(zoneJson.result?.name || "");
assert.ok(zoneName.includes("."), "nom de zone inattendu");

// Disponibilité DNS d'un slug jetable (read-only — aucune création).
const slug = `creezio-smoke-${Date.now().toString(36).slice(-6)}`;
const hostname = `${slug}.${zoneName}`;
const dns = await fetch(
  `${CF}/zones/${cfZone}/dns_records?name=${encodeURIComponent(hostname)}`,
  { headers },
);
assert.equal(dns.status, 200, `dns_records HTTP ${dns.status}`);
const dnsJson = await dns.json();
assert.equal(dnsJson.success, true);
const available = (dnsJson.result || []).length === 0;

console.log(
  "OK cloudflare",
  JSON.stringify({
    tokenKind: kind,
    zone: zoneName,
    checkSlug: slug,
    hostname,
    available,
  }),
);
assert.ok(available, `hostname ${hostname} déjà pris (DNS existant)`);

if (!catalogUrl) {
  console.log("SKIP catalog (*_CATALOG_URL / CREEZIO_CATALOG_URL absent)");
  process.exit(0);
}

const head = await fetch(catalogUrl, { method: "HEAD" });
assert.equal(head.status, 200, `catalog HEAD HTTP ${head.status}`);
const len = Number(head.headers.get("content-length") || 0);
assert.ok(len > 1_000_000, `catalog trop petit (${len})`);
console.log(
  "OK catalog HEAD",
  JSON.stringify({
    bytes: len,
    type: head.headers.get("content-type"),
    urlHost: new URL(catalogUrl).host,
  }),
);

if (!doDownload) {
  const partial = await fetch(catalogUrl, {
    headers: { Range: "bytes=0-1" },
  });
  assert.ok([200, 206].includes(partial.status), `Range HTTP ${partial.status}`);
  const buf = Buffer.from(await partial.arrayBuffer());
  assert.equal(buf[0], 0x1f);
  assert.equal(buf[1], 0x8b);
  console.log("OK catalog gzip magic — relancer avec --download si besoin");
  process.exit(0);
}

// Délègue à un hook marque s’il existe
const brandHook = path.join(root, "scripts/smoke-tunnel-catalog.mjs");
const self = fileURLToPath(import.meta.url);
if (path.resolve(brandHook) !== path.resolve(self) && fs.existsSync(brandHook)) {
  const r = spawnSync(process.execPath, [brandHook, "--download"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  process.exit(r.status ?? 1);
}

console.log("SKIP --download : brancher ensureCatalogue côté marque si requis");
process.exit(0);
