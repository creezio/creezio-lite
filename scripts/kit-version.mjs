#!/usr/bin/env node
/**
 * kit:version — bump semver packages @creezio/* + release notes (dry-run par défaut).
 *
 * Usage:
 *   node scripts/kit-version.mjs --package=@creezio/platform-core --bump=minor
 *   node scripts/kit-version.mjs --package=platform-core --bump=patch --apply
 *   node scripts/kit-version.mjs --from-commits --since=HEAD~5 --package=@creezio/product-hub
 *   node scripts/kit-version.mjs --impact-only --package=@creezio/platform-core
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KIT_PACKAGES,
  applyBump,
  bumpKindFromCommits,
  collectKitInventory,
  entriesFromCommits,
  formatImpactReport,
  impactForPackageBump,
  prependChangelog,
  renderChangelogMarkdown,
  buildAllBrandPrPayloads,
} from "../packages/propagation/dist/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = {
    package: null,
    bump: null,
    apply: false,
    fromCommits: false,
    since: "HEAD~20",
    impactOnly: false,
    forcePatch: false,
    help: false,
    json: false,
  };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--apply") out.apply = true;
    else if (a === "--from-commits") out.fromCommits = true;
    else if (a === "--impact-only") out.impactOnly = true;
    else if (a === "--force-patch") out.forcePatch = true;
    else if (a === "--json") out.json = true;
    else if (a.startsWith("--package=")) out.package = a.slice("--package=".length);
    else if (a === "--package") out.package = rest.shift();
    else if (a.startsWith("--bump=")) out.bump = a.slice("--bump=".length);
    else if (a === "--bump") out.bump = rest.shift();
    else if (a.startsWith("--since=")) out.since = a.slice("--since=".length);
    else if (a === "--since") out.since = rest.shift();
    else throw new Error(`Argument inconnu: ${a}`);
  }
  return out;
}

function normalizePackageName(raw) {
  if (!raw) return null;
  if (raw.startsWith("@creezio/")) return raw;
  return `@creezio/${raw}`;
}

function readPackageJson(pkgName) {
  const meta = KIT_PACKAGES.find((p) => p.name === pkgName);
  if (!meta) throw new Error(`Package inconnu: ${pkgName}`);
  const file = path.join(ROOT, "packages", meta.dir, "package.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return { file, json, meta };
}

function gitLogSince(since) {
  const r = spawnSync(
    "git",
    ["log", `${since}..HEAD`, "--pretty=format:%s"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (r.status !== 0) return [];
  return (r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`kit:version — bump @creezio/* + release notes

Usage:
  npm run kit:version -- --package=@creezio/platform-core --bump=minor
  npm run kit:version -- --package=platform-core --bump=patch --apply
  npm run kit:version -- --package=product-hub --from-commits --since=HEAD~10
  npm run kit:version -- --impact-only --package=@creezio/platform-core

Options:
  --package       Nom @creezio/* ou short name (platform-core)
  --bump          major | minor | patch | none
  --from-commits  Déduit le bump depuis git log (--since)
  --since         Plage git (défaut HEAD~20)
  --impact-only   Affiche uniquement le rapport d'impact (dry-run)
  --apply         Écrit package.json + CHANGELOG (sinon dry-run)
  --force-patch   Si bump=none depuis commits, forcer patch
  --json          Sortie JSON
  -h, --help
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.package) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const packageName = normalizePackageName(args.package);
  let bump = args.bump;
  const messages = args.fromCommits ? gitLogSince(args.since) : [];

  if (args.fromCommits) {
    bump = bumpKindFromCommits(messages);
    if (bump === "none" && args.forcePatch) bump = "patch";
  }
  if (!bump) bump = "minor";
  if (!["major", "minor", "patch", "none"].includes(bump)) {
    throw new Error(`--bump invalide: ${bump}`);
  }

  const impact = impactForPackageBump({ packageName, bumpKind: bump });
  const { file, json } = readPackageJson(packageName);
  const current = json.version;
  const next = applyBump(current, bump);
  const inventory = collectKitInventory(ROOT);
  const prs = buildAllBrandPrPayloads(impact);

  const entries = entriesFromCommits(
    messages.length
      ? messages
      : [`${bump === "none" ? "chore" : bump === "patch" ? "fix" : bump === "major" ? "feat!" : "feat"}: bump ${packageName}`],
    packageName,
  );
  const notes = renderChangelogMarkdown({
    packageName,
    version: next,
    bumpKind: bump,
    entries,
  });

  const payload = {
    dryRun: !args.apply,
    packageName,
    bump,
    currentVersion: current,
    nextVersion: next,
    impact,
    brandPrs: prs.map((p) => ({
      brandId: p.brandId,
      title: p.title,
      gateDoc: p.gateDoc,
    })),
    releaseNotesPreview: notes,
    inventoryPackages: inventory.packages.map((p) => ({
      name: p.name,
      version: p.version,
    })),
  };

  if (args.impactOnly) {
    if (args.json) {
      console.log(JSON.stringify({ impact, brandPrs: payload.brandPrs }, null, 2));
    } else {
      console.log(formatImpactReport(impact));
      console.log("\n## PR marques (contrat)\n");
      for (const p of prs) {
        console.log(`- [${p.brandId}] ${p.title}`);
      }
    }
    return;
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`kit:version ${args.apply ? "APPLY" : "DRY-RUN"}`);
    console.log(`${packageName}: ${current} → ${next} (${bump})`);
    console.log("");
    console.log(formatImpactReport(impact));
    console.log("## Release notes preview\n");
    console.log(notes);
    if (!args.apply) {
      console.log("(dry-run — passer --apply pour écrire package.json + CHANGELOG.md)");
    }
  }

  if (args.apply) {
    if (bump === "none") {
      console.error("Rien à appliquer (bump=none).");
      process.exit(2);
    }
    json.version = next;
    fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");

    const changelogPath = path.join(ROOT, "CHANGELOG.md");
    const existing = fs.existsSync(changelogPath)
      ? fs.readFileSync(changelogPath, "utf8")
      : "";
    fs.writeFileSync(
      changelogPath,
      prependChangelog(existing, notes),
      "utf8",
    );
    console.log(`Écrit: ${file}`);
    console.log(`Écrit: ${changelogPath}`);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
