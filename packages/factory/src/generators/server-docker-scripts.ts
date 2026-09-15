/**
 * Scripts npm `server-docker:*` + résolveur CLI kit pour les apps générées.
 * Toute app factory hérite du serveur Docker (harness + Dockerfile kit) —
 * rien n'est copié à la main dans la marque.
 */

/** Scripts npm injectés dans le package.json généré. */
export function serverDockerNpmScripts(brandId?: string): Record<string, string> {
  const cli = "node scripts/creezio-cli.mjs server-docker";
  // Admin flotte = repo dédié `<brand>-admin` (frère du monorepo par défaut).
  const adminRoot = brandId ? `../${brandId}-admin` : ".";
  return {
    "server-docker:build": `${cli} build --brand-root .`,
    "server-docker:create": `${cli} create --brand-root .`,
    "server-docker:start": `${cli} start --brand-root .`,
    "server-docker:stop": `${cli} stop --brand-root .`,
    "server-docker:rm": `${cli} rm --brand-root .`,
    "server-docker:logs": `${cli} logs --brand-root .`,
    "server-docker:ls": `${cli} ls --brand-root .`,
    "server-docker:update": `${cli} update --brand-root .`,
    "server-docker:backup": `${cli} backup --brand-root .`,
    "server-docker:admin": `${cli} admin up --admin-root ${adminRoot} --brand-root .`,
    "server-docker:up": `${cli} up --brand-root .`,
    "server-docker:down": `${cli} down --brand-root .`,
    "server-docker:proof": `${cli} proof --brand-root .`,
  };
}

/** Scripts npm dev/stop/status/setup injectés dans le package.json généré (Q1/Q6). */
export function devStackNpmScripts(): Record<string, string> {
  const proxy = "node scripts/creezio-dev.mjs";
  return {
    dev: `${proxy} dev`,
    stop: `${proxy} stop`,
    status: `${proxy} status`,
    setup: `${proxy} setup`,
  };
}

/**
 * Proxy dev-stack : résout @creezio/app-runtime/scripts/dev-stack.mjs depuis
 * les node_modules de l'app (workspace racine ou server/). Aucune copie de
 * l'orchestrateur dans la marque — la SoT reste le kit publié.
 */
export function renderCreezioDevProxyMjs(): string {
  return `#!/usr/bin/env node
/** Thin → dev-stack kit (@creezio/app-runtime). Résolution : node_modules app. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  path.join(root, "node_modules/@creezio/app-runtime/scripts/dev-stack.mjs"),
  path.join(root, "server/node_modules/@creezio/app-runtime/scripts/dev-stack.mjs"),
];
const script = candidates.find((p) => fs.existsSync(p));
if (!script) {
  console.error(
    "dev-stack introuvable — dépendances absentes ? npm run setup d'abord.",
  );
  process.exit(1);
}
const r = spawnSync(process.execPath, [script, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, CREEZIO_APP_ROOT: process.env.CREEZIO_APP_ROOT || root },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
`;
}

/** Résolveur CLI `creezio` : kit env → node_modules → chemin VPS. */
export function renderCreezioCliProxyMjs(): string {
  return `#!/usr/bin/env node
/** Thin → CLI creezio (kit). Résolution : CREEZIO_KIT_ROOT > node_modules. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.CREEZIO_KIT_ROOT &&
    path.join(process.env.CREEZIO_KIT_ROOT, "packages/factory/bin/creezio.js"),
  path.join(root, "node_modules/@creezio/factory/bin/creezio.js"),
  "/opt/docker/creezio/packages/factory/bin/creezio.js",
].filter(Boolean);
const cli = candidates.find((p) => fs.existsSync(p));
if (!cli) {
  console.error(
    "CLI creezio introuvable — définir CREEZIO_KIT_ROOT (racine du kit creezio)",
  );
  process.exit(1);
}
const kitRoot = path.resolve(cli, "../../../..");
const r = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, CREEZIO_KIT_ROOT: process.env.CREEZIO_KIT_ROOT || kitRoot },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
`;
}
