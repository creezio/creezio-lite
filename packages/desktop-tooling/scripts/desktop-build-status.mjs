#!/usr/bin/env node
/**
 * Statut build Windows générique (marque via --brand / CREEZIO_BRAND).
 *
 *   CREEZIO_BRAND=tempoflow node scripts/desktop-build-status.mjs
 *   node scripts/desktop-build-status.mjs --brand=fidu --json
 *   node scripts/desktop-build-status.mjs --brand=certivan --pretty --remote
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectDesktopBuildStatusFromArgv } from "../dist/desktop-build-status.js";

function printHuman(status) {
  const pad = (k, v) => `${k.padEnd(18)} ${v}`;
  console.log(`${status.brandId} — statut build Windows`);
  console.log(pad("État:", `${status.state} / phase=${status.phase}`));
  console.log(pad("Code:", status.codeVersion || "—"));
  console.log(pad("Buildé:", status.builtVersion || "—"));
  console.log(pad("Publié client:", status.publishedVersion || "—"));
  console.log(pad("Publié serveur:", status.publishedServerVersion || "—"));
  console.log(pad("Aligné:", status.aligned ? "oui" : "non"));
  console.log(
    pad(
      "Process:",
      status.process.localRunning
        ? `oui (${status.process.pids.join(", ")})`
        : "non",
    ),
  );
  if (status.log.path) console.log(pad("Log:", status.log.path));
  if (status.message) console.log(pad("Message:", status.message));
  console.log(pad("Feed client:", status.links.feedLatestYml));
  console.log(pad("Feed serveur:", status.links.feedServerLatestYml));
  if (status.log.lines?.length) {
    console.log("\n--- dernières lignes log ---");
    for (const line of status.log.lines.slice(-15)) console.log(line);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = new Set(process.argv.slice(2));
  const status = collectDesktopBuildStatusFromArgv(process.argv.slice(2));
  if (args.has("--pretty") || (!args.has("--json") && process.stdout.isTTY)) {
    if (args.has("--json") || args.has("--pretty")) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printHuman(status);
    }
  } else {
    console.log(JSON.stringify(status, null, args.has("--pretty") ? 2 : 0));
  }
}
