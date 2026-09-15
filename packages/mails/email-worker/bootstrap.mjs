#!/usr/bin/env node
/**
 * Bootstrap ops Email Routing générique (@creezio/mails).
 *
 * Env requis :
 *   CF_API_TOKEN
 *   CF_ZONE_ID
 *   MAIL_ROOT_DOMAIN          (ex. tempoflow.fr)
 *   WORKER_NAME               (ex. tf2-email-inbound)
 *   CF_ACCOUNT_ID             (optionnel)
 *   EMAIL_INBOUND_SECRET      (optionnel, généré si absent)
 *   MAIL_LAB_SLUG             (optionnel, pour MX lab)
 *   INBOUND_SECRET_ENV_NAME   (libellé console, défaut EMAIL_INBOUND_SECRET)
 *
 * Usage :
 *   MAIL_ROOT_DOMAIN=tempoflow.fr WORKER_NAME=tf2-email-inbound \
 *     node packages/mails/email-worker/bootstrap.mjs
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = (process.env.CF_API_TOKEN || "").trim();
const ZONE_ID = (process.env.CF_ZONE_ID || "").trim();
let ACCOUNT_ID = (process.env.CF_ACCOUNT_ID || "").trim();
const ZONE_NAME = (
  process.env.CF_ZONE_NAME ||
  process.env.MAIL_ROOT_DOMAIN ||
  ""
).trim();
const WORKER_NAME = (process.env.WORKER_NAME || "creezio-email-inbound").trim();
const SECRET_ENV_NAME = (
  process.env.INBOUND_SECRET_ENV_NAME || "EMAIL_INBOUND_SECRET"
).trim();

if (!TOKEN || !ZONE_ID) {
  console.error("CF_API_TOKEN et CF_ZONE_ID requis");
  process.exit(1);
}
if (!ZONE_NAME) {
  console.error("MAIL_ROOT_DOMAIN (ou CF_ZONE_NAME) requis");
  process.exit(1);
}

async function cf(method, urlPath, body, { raw = false } = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg =
      (data.errors && data.errors[0] && data.errors[0].message) ||
      `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.cf = data;
    throw err;
  }
  return raw ? data : data.result;
}

function genSecret() {
  return crypto.randomBytes(32).toString("hex");
}

async function main() {
  const zone = await cf("GET", `/zones/${ZONE_ID}`);
  ACCOUNT_ID = ACCOUNT_ID || zone.account?.id;
  if (!ACCOUNT_ID) throw new Error("CF_ACCOUNT_ID introuvable");
  console.log(`✓ zone ${zone.name} account=${ACCOUNT_ID}`);

  try {
    const settings = await cf("GET", `/zones/${ZONE_ID}/email/routing`);
    console.log(
      `✓ email routing enabled=${settings.enabled} status=${settings.status}`,
    );
    if (!settings.enabled) {
      await cf("POST", `/zones/${ZONE_ID}/email/routing/enable`);
      console.log("✓ email routing activé");
    }
  } catch (e) {
    console.warn(
      "! email routing settings API indisponible (",
      e.message,
      ") — on continue avec Rules + MX subdomain",
    );
  }

  const secret = (process.env.EMAIL_INBOUND_SECRET || "").trim() || genSecret();
  console.log(`✓ EMAIL_INBOUND_SECRET prêt (${secret.slice(0, 8)}…)`);

  // wrangler.toml généré (ne pas committer de domaines marque dans le kit)
  const wranglerPath = path.join(__dirname, "wrangler.toml");
  const toml = [
    `name = "${WORKER_NAME}"`,
    `main = "worker.js"`,
    `compatibility_date = "2026-01-15"`,
    `account_id = "${ACCOUNT_ID}"`,
    ``,
    `[vars]`,
    `MAIL_ROOT_DOMAIN = "${ZONE_NAME}"`,
    `MAIL_SUBDOMAIN = "mail"`,
    ``,
  ].join("\n");
  fs.writeFileSync(wranglerPath, toml, "utf8");

  const env = {
    ...process.env,
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
  };
  let r = spawnSync("npx", ["wrangler", "deploy"], {
    cwd: __dirname,
    env,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stdout || "");
    console.error(r.stderr || "");
    throw new Error(
      "wrangler deploy échoué — permission Workers Scripts Edit manquante ?",
    );
  }
  console.log("✓ worker déployé");

  r = spawnSync("npx", ["wrangler", "secret", "put", "EMAIL_INBOUND_SECRET"], {
    cwd: __dirname,
    env,
    input: secret + "\n",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || "");
    throw new Error("wrangler secret put échoué");
  }
  console.log("✓ secret Worker EMAIL_INBOUND_SECRET");

  try {
    await cf("PUT", `/zones/${ZONE_ID}/email/routing/rules/catch_all`, {
      actions: [{ type: "worker", value: [WORKER_NAME] }],
      matchers: [{ type: "all" }],
      enabled: true,
      name: `${WORKER_NAME} catch-all`,
    });
    console.log("✓ catch-all → worker", WORKER_NAME);
  } catch (e) {
    console.warn("! catch_all PUT:", e.message);
    throw e;
  }

  const labSlug = process.env.MAIL_LAB_SLUG || "creezio-mail-lab";
  const mailHost = `${labSlug}.mail.${ZONE_NAME}`;
  for (const [priority, content] of [
    [10, "route1.mx.cloudflare.net"],
    [20, "route2.mx.cloudflare.net"],
    [30, "route3.mx.cloudflare.net"],
  ]) {
    const existing = await cf(
      "GET",
      `/zones/${ZONE_ID}/dns_records?type=MX&name=${encodeURIComponent(mailHost)}`,
    );
    const have = (existing || []).some(
      (x) => String(x.content || "").toLowerCase() === content,
    );
    if (have) continue;
    await cf("POST", `/zones/${ZONE_ID}/dns_records`, {
      type: "MX",
      name: mailHost,
      content,
      priority,
      ttl: 1,
      comment: `Creezio email lab ${labSlug}`,
    });
  }
  console.log(`✓ MX lab ${mailHost}`);

  console.log("\n=== À mettre sur le provisioner / CRM desktop ===");
  console.log(`${SECRET_ENV_NAME}=${secret}`);
  console.log(`EMAIL_INBOUND_SECRET=${secret}`);
  console.log(`MAIL_ROOT_DOMAIN=${ZONE_NAME}`);
  console.log("\nTest : envoyer un mail à achats@" + mailHost);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  if (e.cf) console.error(JSON.stringify(e.cf.errors || e.cf, null, 2));
  process.exit(1);
});
