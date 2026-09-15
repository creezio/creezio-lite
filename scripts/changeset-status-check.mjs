#!/usr/bin/env node
/**
 * Gate PR changesets — un check qui a du sens sur TOUTE PR, y compris
 * `changeset-release/*` (la PR qui *consomme* les changesets).
 *
 * - PR de version (`changeset-release/*`) : plus aucun `.changeset/*.md`
 *   hors README (tous consommés par `changeset version`) → vert.
 * - Autres PR : `changeset status --since=<base>` (rouge sans changeset
 *   couvrant les packages touchés).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function pendingChangesetFiles(changesetDir = path.join(ROOT, ".changeset")) {
  if (!fs.existsSync(changesetDir)) return [];
  return fs
    .readdirSync(changesetDir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .sort();
}

export function isVersionPrRef(headRef) {
  return String(headRef || "").startsWith("changeset-release/");
}

export function runChangesetStatusCheck(opts = {}) {
  const headRef = opts.headRef ?? process.env.GITHUB_HEAD_REF ?? "";
  const since =
    opts.since ?? process.env.CHANGESET_SINCE ?? "origin/main";
  const cwd = opts.cwd ?? ROOT;
  const changesetDir = opts.changesetDir ?? path.join(cwd, ".changeset");

  if (isVersionPrRef(headRef)) {
    const leftover = pendingChangesetFiles(changesetDir);
    if (leftover.length) {
      return {
        ok: false,
        message: `Changesets orphelins après version : ${leftover.join(", ")}`,
      };
    }
    return {
      ok: true,
      message: "OK: aucun changeset orphelin (PR de version)",
    };
  }

  const r = spawnSync(
    "npx",
    ["changeset", "status", `--since=${since}`],
    { cwd, encoding: "utf8" },
  );
  if (r.status !== 0) {
    return {
      ok: false,
      message: (r.stderr || r.stdout || `changeset status exit ${r.status}`).trim(),
    };
  }
  return { ok: true, message: (r.stdout || "OK: changeset status").trim() };
}

const launchedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (launchedDirectly) {
  const result = runChangesetStatusCheck();
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}
