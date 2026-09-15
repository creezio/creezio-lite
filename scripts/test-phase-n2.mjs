#!/usr/bin/env node
/**
 * Phase N2 — Jumeaux hosts → @creezio/electron-shell (kit only).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// P1.b : le host Node pur vit dans @creezio/host-runtime, le sous-domaine
// Meili dans @creezio/search ; electron-shell garde le reliquat desktop
// (web-telemetry). H12 : plus de ré-exports compat via electron-shell.
const hostRuntimeDir = path.join(root, "packages/host-runtime/src");
const searchDir = path.join(root, "packages/search/src");
const esHostDir = path.join(root, "packages/electron-shell/src/host");
const idxPath = path.join(root, "packages/electron-shell/src/index.ts");

/** Résout un module host historique vers son emplacement P1.b. */
function hostFile(rel) {
  if (rel.startsWith("meili/")) return path.join(searchDir, rel);
  if (rel === "web-telemetry.ts") return path.join(esHostDir, rel);
  return path.join(hostRuntimeDir, rel);
}
const PAPERCLIP_RE = /paperclipApi|startPaperclip\b|paperclip-launcher/;

const REQUIRED = [
  "crash-reporter.ts",
  "web-telemetry.ts",
  "bridge-client.ts",
  "server-launcher.ts",
  "ai-workspace/bindings.ts",
  "ai-workspace/manager.ts",
  "ai-workspace/actions.ts",
  "ai-workspace/screencast.ts",
  "ai-workspace/profile-window.ts",
  "meili/index-schema.ts",
  "meili/coherence.ts",
  "meili/coherence-db.ts",
  "meili/indexer.ts",
];

test("N2.1 PHASE-N2.md + PLAN-N N2 livré", () => {
  const phase = fs.readFileSync(path.join(root, "docs/archive/PHASE-N2.md"), "utf8");
  assert.match(phase, /Jumeaux hosts/i);
  assert.match(phase, /16b61f7/);
  assert.match(phase, /configureAiWorkspaceHost|configureMeiliCoherencePaths/);
  assert.match(phase, /Sign-off|gates verts/i);
  assert.match(phase, /test-phase-n2/);
  assert.match(phase, /wc -l|LOC/i);

  const plan = fs.readFileSync(path.join(root, "docs/archive/PLAN-N.md"), "utf8");
  assert.match(plan, /## N2 — Jumeaux hosts → kit/);
  assert.match(plan, /PHASE-N2\.md/);
  assert.match(plan, /Done|livr/i);
});

test("N2.2 modules host présents", () => {
  for (const rel of REQUIRED) {
    const p = hostFile(rel);
    assert.ok(fs.existsSync(p), `manquant: ${rel}`);
    const loc = fs.readFileSync(p, "utf8").split("\n").length;
    assert.ok(loc > 15, `${rel} trop court: ${loc}`);
  }
});

test("N2.3 bindings + exports publics index.ts", () => {
  const bind = fs.readFileSync(
    hostFile("ai-workspace/bindings.ts"),
    "utf8",
  );
  assert.match(bind, /export function configureAiWorkspaceHost/);
  assert.match(bind, /aiPartitionSlug/);
  assert.match(bind, /sessionCookieName/);

  const coh = fs.readFileSync(hostFile("meili/coherence.ts"), "utf8");
  assert.match(coh, /export function configureMeiliCoherencePaths/);
  assert.match(coh, /export async function decideMeiliReady/);

  const crash = fs.readFileSync(
    hostFile("crash-reporter.ts"),
    "utf8",
  );
  assert.match(crash, /export function configureCrashReporter/);
  assert.doesNotMatch(crash, /crm\.tempoflow\.fr\/crash/);

  // H12 : plus de ré-export compat via electron-shell — chaque symbole se
  // vérifie dans sa source SoT (host-runtime / search / electron-shell).
  const sotSources = [
    fs.readFileSync(idxPath, "utf8"), // desktop natif (instrumentWebContents)
    fs.readFileSync(hostFile("crash-reporter.ts"), "utf8"),
    fs.readFileSync(hostFile("bridge-client.ts"), "utf8"),
    fs.readFileSync(hostFile("server-launcher.ts"), "utf8"),
    fs.readFileSync(hostFile("ai-workspace/bindings.ts"), "utf8"),
    fs.readFileSync(hostFile("ai-workspace/manager.ts"), "utf8"),
    fs.readFileSync(hostFile("ai-workspace/actions.ts"), "utf8"),
    fs.readFileSync(hostFile("meili/coherence.ts"), "utf8"),
    fs.readFileSync(
      path.join(root, "packages/search/src/meili/indexer.ts"),
      "utf8",
    ),
  ].join("\n");
  for (const sym of [
    "configureCrashReporter",
    "instrumentWebContents",
    "BridgeClient",
    "startBrandNextServer",
    "configureAiWorkspaceHost",
    "AiWorkspaceManager",
    "executeAiWorkspaceAction",
    "configureMeiliCoherencePaths",
    "decideMeiliReady",
    "runIndexation",
  ]) {
    assert.match(sotSources, new RegExp(sym), `export manquant: ${sym}`);
  }

  assert.ok(
    fs.existsSync(
      path.join(
        root,
        "packages/host-runtime/dist/ai-workspace/manager.js",
      ),
    ),
    "dist ai-workspace manquant — rebuild electron-shell",
  );
  assert.ok(
    fs.existsSync(
      path.join(root, "packages/search/dist/meili/indexer.js"),
    ),
    "dist meili indexer manquant — rebuild electron-shell",
  );
});

test("N2.4 embeds B2 toujours SoT platform-core + sandbox kit", () => {
  const embeds = path.join(root, "packages/platform-core/src/embeds");
  for (const name of [
    "hermes-embed.ts",
    "n8n-embed.ts",
    "embed-env-catalog.ts",
    "embed-stack-hooks.ts",
  ]) {
    assert.ok(fs.existsSync(path.join(embeds, name)), `embed manquant: ${name}`);
  }
  assert.ok(
    fs.existsSync(hostFile("sandbox/os-sandbox.ts")),
    "os-sandbox kit manquant",
  );
  assert.ok(
    fs.existsSync(hostFile("sandbox/embed-sandbox.ts")),
    "embed-sandbox kit manquant",
  );
  const pcIdx = fs.readFileSync(
    path.join(root, "packages/platform-core/src/index.ts"),
    "utf8",
  );
  assert.match(pcIdx, /hermes-embed/);
  assert.match(pcIdx, /n8n-embed/);
});

test("N2.5 shell ipc aiWorkspace + zéro hardcode TF crash kit", () => {
  const ipc = fs.readFileSync(
    path.join(root, "packages/shell/src/ipc-channels.ts"),
    "utf8",
  );
  assert.match(ipc, /aiWorkspace/);
  assert.match(ipc, /ai-workspace:list/);

  const mgr = fs.readFileSync(
    hostFile("ai-workspace/manager.ts"),
    "utf8",
  );
  assert.doesNotMatch(mgr, /tempoflow2_crm_session/);
  assert.doesNotMatch(mgr, /TF2_AI_SHARE_WEB_SESSIONS/);
});

test("N2.6 paperclip mort + gate dans npm test", () => {
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  assert.match(pkg, /test-phase-n2\.mjs/);

  for (const rel of REQUIRED) {
    const src = fs.readFileSync(hostFile(rel), "utf8");
    assert.doesNotMatch(src, PAPERCLIP_RE, `paperclip dans ${rel}`);
  }
});
