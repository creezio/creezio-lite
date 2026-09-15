#!/usr/bin/env node
/**
 * Phase R4 — smoke kit `@creezio/observability` (ops journal + fleet factory).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const obsCjs = path.join(root, "packages/observability/dist-cjs/index.js");

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.error(`✗ ${name}:`, e.message || e);
    process.exitCode = 1;
  }
}

check("dist-cjs observability présent", () => {
  assert.ok(fs.existsSync(obsCjs), obsCjs);
});

const obs = require(obsCjs);

check("exports ops + fleet", () => {
  assert.equal(typeof obs.initOpsJournal, "function");
  assert.equal(typeof obs.track, "function");
  assert.equal(typeof obs.evaluateRulesPure, "function");
  assert.equal(typeof obs.emitOpsEvent, "function");
  assert.equal(typeof obs.createFleetAgent, "function");
  assert.equal(obs.TF2EVENT_PREFIX, "TF2EVENT ");
});

check("journal JSONL + drain", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r4-ops-"));
  obs.__resetOpsJournalForTests();
  obs.initOpsJournal(tmp, "9.9.9", {
    log: () => {},
  });
  obs.track({ level: "event", kind: "boot.start" });
  obs.trackDecision("meili.ready", "full-reindex", {
    reason: "fingerprint-absent",
  });
  const drained = obs.drainPendingOpsEvents(10);
  assert.ok(drained.length >= 2);
  const bootId = obs.getOpsBootId();
  assert.ok(bootId);
  const file = path.join(tmp, "ops", `${bootId}.jsonl`);
  assert.ok(fs.existsSync(file));
  obs.__resetOpsJournalForTests();
});

check("parseOpsLine TF2EVENT", () => {
  const input = obs.parseOpsLine(
    'TF2EVENT {"level":"event","kind":"index.done"}',
  );
  assert.equal(input?.kind, "index.done");
  assert.equal(obs.parseOpsLine("hello"), null);
});

check("evaluateRulesPure repeated-negative", () => {
  const current = {
    bootId: "b2",
    startedAt: "2026-07-29T00:00:01.000Z",
    counts: {},
    decisions: {
      "meili.ready": { outcome: "full-reindex", reason: "x" },
    },
    durations: {},
  };
  const previous = [
    {
      bootId: "b1",
      startedAt: "2026-07-29T00:00:00.000Z",
      counts: {},
      decisions: {
        "meili.ready": { outcome: "full-reindex", reason: "x" },
      },
      durations: {},
    },
  ];
  const findings = obs.evaluateRulesPure(current, previous);
  assert.ok(findings.some((f) => f.rule === "repeated-negative-decision"));
});

check("createFleetAgent façade", () => {
  const agent = obs.createFleetAgent({
    baseUrl: "https://example.test/fleet",
    getConfig: () => ({ enabled: false, scopes: {} }),
    isScopeActive: () => false,
    getInstallId: () => "install-test",
    getAppVersion: () => "0.0.0",
  });
  assert.equal(agent.fleetEndpointBase(), "https://example.test/fleet");
  assert.equal(typeof agent.startFleetAgent, "function");
  assert.equal(typeof agent.stopFleetAgent, "function");
});

check("V2 store toujours exporté", () => {
  assert.equal(typeof obs.createMemoryObservabilityStore, "function");
  assert.equal(typeof obs.createSqliteObservabilityStore, "function");
});

if (!process.exitCode) console.log("\nOK test-phase-r4");
