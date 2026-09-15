/**
 * Générateur `scripts/verify-prod.mjs` — vérification E2E canonique de toute
 * app générée (ticket BACKLOG « Scaffold verify-prod factory », skill
 * fleet-ops §3b).
 *
 * Checks PLATEFORME uniquement (le métier reste dans le repo marque via
 * `scripts/verify-prod.local.mjs`, jamais régénéré) :
 *   profil brand : core/version · login E2E · auth/me (role owner) · browse
 *                  d'un module à `meiliIndexes` (engine:"meili") ·
 *                  assistant llm-status (si chat activé)
 *   profil admin : core/version · login E2E · auth/me (le compte E2E admin
 *                  est collaborateur — pas de gestes owner)
 *
 * SoT credentials : `CREEZIO_E2E_EMAIL`/`CREEZIO_E2E_PASSWORD` dans le
 * `secrets.env` (chmod 600) de la stack de chaque instance — posés par
 * `creezio server-docker create|ensure-owner`.
 */

export type VerifyProdOptions = {
  brandId: string;
  profile: "brand" | "admin";
  /**
   * Module déclarant `meiliIndexes` à browser (`engine:"meili"` attendu).
   * `null` = aucun connu au scaffold → check SKIP explicite (le repo marque
   * le pose via CREEZIO_VERIFY_MEILI_MODULE ou un check local).
   */
  meiliModule: string | null;
  /** Assistant activé (platformNeeds.chat) → check llm-status. */
  assistant: boolean;
};

export function renderVerifyProdMjs(o: VerifyProdOptions): string {
  return `#!/usr/bin/env node
/**
 * verify-prod — vérification E2E canonique d'une instance prod (générée par
 * @creezio/factory — régénérée au prochain apply : NE PAS y mettre de checks
 * métier, ils vivent dans scripts/verify-prod.local.mjs, jamais régénéré).
 *
 * SoT credentials : compte E2E (CREEZIO_E2E_EMAIL / CREEZIO_E2E_PASSWORD)
 * persisté dans le secrets.env (chmod 600) de la stack de CHAQUE instance
 * (posé par \`creezio server-docker create|ensure-owner\`) :
 *   {racineRepo}/docker-data/stacks/<instance>/secrets.env
 *
 * Règle flotte : tout agent qui (re)provisionne un compte E2E DOIT persister
 * les nouveaux identifiants dans ce secrets.env — voir skill kit
 * creezio-fleet-ops §3b « Vérification E2E canonique ».
 *
 * Usage :
 *   node scripts/verify-prod.mjs <instance…>
 *   node scripts/verify-prod.mjs --all      # toutes les stacks du repo
 *   # overrides : --base <url> --secrets <path> --container <nom>
 *   #             --profile brand|admin
 *   # module browse Meili : env CREEZIO_VERIFY_MEILI_MODULE (prime sur la
 *   #                       valeur scaffoldée)
 *
 * Checks métier additionnels : scripts/verify-prod.local.mjs (optionnel,
 * jamais écrasé) exportant \`localChecks(ctx)\` — ctx = { instance, profile,
 * base, cookie, req, report }.
 *
 * Sortie : [OK]/[KO]/[SKIP] par check, récap par instance, exit 0 si tout OK.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CONFIG = {
  brandId: ${JSON.stringify(o.brandId)},
  profile: ${JSON.stringify(o.profile)},
  // Module déclarant meiliIndexes (browse engine:"meili" attendu) — null si
  // aucun au scaffold. Override runtime : CREEZIO_VERIFY_MEILI_MODULE.
  meiliModule: ${JSON.stringify(o.meiliModule)},
  assistant: ${JSON.stringify(o.assistant)},
};

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const INTERNAL_PORT = "18791/tcp";

const args = process.argv.slice(2);
const argVal = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const optionValues = new Set(
  ["--base", "--secrets", "--container", "--profile"].map(argVal),
);

function discoverInstances() {
  const stacksDir = path.join(ROOT, "docker-data", "stacks");
  try {
    return fs
      .readdirSync(stacksDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

const instances = args.includes("--all")
  ? discoverInstances()
  : args.filter((a) => !a.startsWith("--") && !optionValues.has(a));

if (instances.length === 0) {
  console.error(
    "Usage : node scripts/verify-prod.mjs <instance…|--all> [--base url] [--secrets path] [--container nom] [--profile brand|admin]",
  );
  console.error(
    "(--all : aucune stack sous docker-data/stacks/ — instance créée via creezio server-docker create ?)",
  );
  process.exit(2);
}

function readSecrets(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function discoverBase(container) {
  const out = execFileSync(
    "docker",
    [
      "inspect",
      "-f",
      \`{{(index (index .NetworkSettings.Ports "\${INTERNAL_PORT}") 0).HostPort}}\`,
      container,
    ],
    { encoding: "utf8" },
  ).trim();
  if (!/^\\d+$/.test(out)) {
    throw new Error(\`port introuvable pour \${container} (\${out})\`);
  }
  return \`http://127.0.0.1:\${out}\`;
}

async function req(base, method, p, { cookie, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    json = { __text: (await res.text()).slice(0, 160) };
  }
  return { status: res.status, json, headers: res.headers };
}

async function loadLocalChecks() {
  const file = path.join(ROOT, "scripts", "verify-prod.local.mjs");
  if (!fs.existsSync(file)) return null;
  const mod = await import(file);
  return typeof mod.localChecks === "function" ? mod.localChecks : null;
}

async function verifyInstance(name, overrides, localChecks) {
  const profile = overrides.profile || CONFIG.profile;
  const secretsFile =
    overrides.secrets ||
    path.join(ROOT, "docker-data/stacks", name, "secrets.env");
  const container =
    overrides.container || \`\${CONFIG.brandId}-server-\${name}\`;

  console.log(\`\\n== \${name} (profil \${profile}) ==\`);
  const checks = [];
  const report = (label, ok, detail = "") => {
    checks.push({ label, ok });
    console.log(
      \`  [\${ok === "skip" ? "SKIP" : ok ? "OK" : "KO"}] \${label}\${detail ? \` — \${detail}\` : ""}\`,
    );
  };

  let env;
  try {
    env = readSecrets(secretsFile);
  } catch (e) {
    report(
      "secrets.env lisible",
      false,
      \`\${secretsFile} : \${e.code || e.message} (fichier 600 — lancer en propriétaire/root, ou provisionner via \\\`creezio server-docker ensure-owner\\\`)\`,
    );
    return checks;
  }
  const email = env.CREEZIO_E2E_EMAIL;
  const pass = env.CREEZIO_E2E_PASSWORD;
  if (!email || !pass) {
    report(
      "credentials E2E présents",
      false,
      \`CREEZIO_E2E_EMAIL/PASSWORD absents de \${secretsFile} — provisionner via \\\`creezio server-docker ensure-owner \${name}\\\` (les persiste dans secrets.env)\`,
    );
    return checks;
  }
  report("credentials E2E présents", true, email);

  let base = overrides.base;
  try {
    base = base || discoverBase(container);
  } catch (e) {
    report("port instance découvert", false, String(e.message));
    return checks;
  }

  try {
    const ver = await req(base, "GET", "/api/v1/core/version");
    report(
      "core/version",
      ver.status === 200 && !!ver.json?.version,
      \`\${ver.status} \${ver.json?.version || ""} \${ver.json?.architectureVersion || ""}\`,
    );

    const login = await req(base, "POST", "/api/v1/auth/login", {
      body: { email, password: pass },
    });
    const cookie = (login.headers.getSetCookie?.() || [])
      .map((c) => c.split(";")[0])
      .join("; ");
    report("login E2E", login.status === 200 && !!cookie, \`\${login.status}\`);
    if (!cookie) return checks;

    const me = await req(base, "GET", "/api/v1/auth/me", { cookie });
    if (profile === "brand") {
      report(
        "auth/me role owner",
        me.status === 200 && me.json?.ok === true && me.json?.role === "owner",
        \`role=\${me.json?.role}\`,
      );
    } else {
      report(
        "auth/me",
        me.status === 200 && me.json?.ok === true,
        \`role=\${me.json?.role}\`,
      );
    }

    if (profile === "brand") {
      const meiliModule =
        (process.env.CREEZIO_VERIFY_MEILI_MODULE || "").trim() ||
        CONFIG.meiliModule;
      if (!meiliModule) {
        report(
          'browse module engine:"meili"',
          "skip",
          "aucun module à meiliIndexes connu du scaffold — poser CREEZIO_VERIFY_MEILI_MODULE ou un check local",
        );
      } else {
        const browse = await req(
          base,
          "GET",
          \`/api/v1/modules/\${meiliModule}?limit=1\`,
          { cookie },
        );
        const engine = browse.json?.engine;
        report(
          \`browse \${meiliModule} engine:"meili"\`,
          browse.status === 200 && engine === "meili",
          \`\${browse.status} engine=\${engine ?? "?"} total=\${browse.json?.total ?? "?"}\${engine === "indexing" ? " (indexation initiale en cours — réessayer)" : ""}\`,
        );
      }

      if (CONFIG.assistant) {
        const llm = await req(base, "GET", "/api/v1/assistant/llm-status", {
          cookie,
        });
        report(
          "assistant llm-status ready",
          llm.status === 200 && llm.json?.assistantReady === true,
          \`\${llm.status} assistantReady=\${llm.json?.assistantReady}\`,
        );
      }
    }

    if (localChecks) {
      await localChecks({ instance: name, profile, base, cookie, req, report });
    }
  } catch (e) {
    report(
      "instance joignable",
      false,
      \`\${base} : \${String(e.cause?.code || e.message).slice(0, 120)}\`,
    );
  }
  return checks;
}

const overrides = {
  base: argVal("--base"),
  secrets: argVal("--secrets"),
  container: argVal("--container"),
  profile: argVal("--profile"),
};

const localChecks = await loadLocalChecks();
let failed = 0;
for (const name of instances) {
  const checks = await verifyInstance(
    name,
    instances.length === 1 ? overrides : {},
    localChecks,
  );
  const ko = checks.filter((c) => c.ok === false).length;
  failed += ko;
  console.log(
    \`  → \${name} : \${ko === 0 ? "TOUT OK" : \`\${ko} check(s) KO\`} (\${checks.length} checks)\`,
  );
}
process.exit(failed === 0 ? 0 : 1);
`;
}
