#!/usr/bin/env node
/**
 * Smoke générique contrat Cloudflare Tunnel (toutes marques, 0.10.0).
 *
 * L'instance Docker auto-provisionne son tunnel via l'API Cloudflare
 * (fin du provisioner VPS). Ce smoke valide le contrat SANS créer aucune
 * ressource (lecture seule) :
 *   1. token CF : account token via GET /accounts/{id}/tokens/verify,
 *      fallback user token via GET /user/tokens/verify ;
 *   2. zone lisible (GET /zones/{zone_id}) → nom de zone résolu ;
 *   3. scope Tunnel : GET /accounts/{id}/cfd_tunnel (liste, per_page=5) ;
 *   4. disponibilité DNS d'un slug jetable (GET dns_records?name=…).
 *
 * Env (dans l’ordre) :
 *   {ENV_PREFIX}_CF_API_TOKEN / _CF_ACCOUNT_ID / _CF_ZONE_ID
 *   CREEZIO_CF_API_TOKEN / CREEZIO_CF_ACCOUNT_ID / CREEZIO_CF_ZONE_ID
 *   (TEMPOFLOW3_CF_* legacy TF3)
 *
 * Usage :
 *   node …/smoke-tunnel.mjs
 *   CREEZIO_APP_ROOT=/path/to/brand node …/smoke-tunnel.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadLocalEnv } from "./load-local-env.mjs";

const root = path.resolve(process.env.CREEZIO_APP_ROOT || process.cwd());
loadLocalEnv(root);

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
const pick = (key) =>
  (prefix && process.env[`${prefix}_${key}`]) ||
  process.env[`CREEZIO_${key}`] ||
  process.env[`TEMPOFLOW3_${key}`] ||
  "";

const cfToken = pick("CF_API_TOKEN");
const cfAccount = pick("CF_ACCOUNT_ID");
const cfZone = pick("CF_ZONE_ID");

assert.ok(cfToken, "CF_API_TOKEN manquant (.env)");
assert.ok(cfAccount, "CF_ACCOUNT_ID manquant (.env)");
assert.ok(cfZone, "CF_ZONE_ID manquant (.env)");

const CF = "https://api.cloudflare.com/client/v4";
const headers = { Authorization: `Bearer ${cfToken}` };

// 1) Token : account d'abord, user ensuite (les deux sont supportés).
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

// 2) Zone lisible → nom résolu (base des hostnames {slug}.{zone}).
const zone = await fetch(`${CF}/zones/${cfZone}`, { headers });
assert.equal(zone.status, 200, `zone CF HTTP ${zone.status}`);
const zoneJson = await zone.json();
assert.equal(zoneJson.success, true, "zone CF illisible");
const zoneName = String(zoneJson.result?.name || "");
assert.ok(zoneName.includes("."), "nom de zone inattendu");

// 3) Scope Tunnel (lecture) — l'instance crée/configure au boot.
const tunnels = await fetch(
  `${CF}/accounts/${cfAccount}/cfd_tunnel?per_page=5`,
  { headers },
);
assert.equal(tunnels.status, 200, `cfd_tunnel list HTTP ${tunnels.status}`);
const tunnelsJson = await tunnels.json();
assert.equal(tunnelsJson.success, true, "scope Tunnel illisible");

// 4) Disponibilité DNS d'un slug jetable (équivalent read-only de /check).
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
    tunnelsVisible: (tunnelsJson.result || []).length,
    checkSlug: slug,
    hostname,
    available,
  }),
);
assert.ok(available, `hostname ${hostname} déjà pris (DNS existant)`);
