/**
 * CLI Node vanilla : lit counts SQL + fingerprint (JSON sur stdout).
 * Spawn depuis electron/main via nodeBinary() + NODE_PATH (better-sqlite3).
 *
 *   DB_PATH=... node …/meili/coherence-query.js
 *
 * Dual-build safe : pas d'`import.meta` (CJS Electron).
 */

import { readCoherenceDbSnapshot } from "./coherence-db.js";

function main(): void {
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    console.error("DB_PATH manquant");
    process.exit(2);
  }
  const snap = readCoherenceDbSnapshot(dbPath);
  process.stdout.write(JSON.stringify(snap) + "\n");
}

const cliEntry = process.argv[1] || "";
if (/(^|[\\/])coherence-query\.(c?js|mjs)$/.test(cliEntry)) {
  main();
}
