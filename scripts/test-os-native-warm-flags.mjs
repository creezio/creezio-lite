#!/usr/bin/env node
/**
 * Contrat warm natif : n8n et Hermes sont indépendants en local.
 * VPS create/update : skip n8n/Hermes ignoré (les deux requis).
 * GET /plugin-approvals : 200 liste vide sans Product Hub.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAssistantRoutes } from "../packages/assistant/dist/http/assistant-routes.js";
import { applyVpsNativeWarmDefaults } from "../packages/factory/dist/server-docker-cli.js";
import { resolveNativeWarmFlags } from "../packages/app-runtime/dist/warm-brand-native-hosts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("warm flags : n8n skip ne coupe pas Hermes", () => {
  assert.deepEqual(resolveNativeWarmFlags({}), { n8n: true, hermes: true });
  assert.deepEqual(resolveNativeWarmFlags({ CREEZIO_NATIVE_WARM: "1" }), {
    n8n: true,
    hermes: true,
  });
  assert.deepEqual(
    resolveNativeWarmFlags({
      CREEZIO_NATIVE_WARM: "1",
      CREEZIO_NATIVE_WARM_N8N: "0",
    }),
    { n8n: false, hermes: true },
  );
  assert.deepEqual(resolveNativeWarmFlags({ CREEZIO_NATIVE_WARM: "0" }), {
    n8n: false,
    hermes: false,
  });
  assert.deepEqual(
    resolveNativeWarmFlags({
      CREEZIO_NATIVE_WARM: "0",
      CREEZIO_NATIVE_WARM_HERMES: "1",
    }),
    { n8n: false, hermes: true },
  );
  assert.deepEqual(
    resolveNativeWarmFlags({
      CREEZIO_NATIVE_WARM: "1",
      CREEZIO_NATIVE_WARM_HERMES: "0",
    }),
    { n8n: true, hermes: false },
  );
  assert.deepEqual(
    resolveNativeWarmFlags({
      CREEZIO_NATIVE_WARM: "0",
      CREEZIO_NATIVE_WARM_N8N: "0",
      CREEZIO_NATIVE_WARM_HERMES: "1",
    }),
    { n8n: false, hermes: true },
  );
});

test("VPS defaults : n8n+Hermes forcés, skip ignoré", () => {
  const forced = {
    CREEZIO_NATIVE_WARM: "1",
    CREEZIO_NATIVE_WARM_N8N: "1",
    CREEZIO_NATIVE_WARM_HERMES: "1",
  };
  assert.deepEqual(applyVpsNativeWarmDefaults({}), forced);
  assert.deepEqual(
    applyVpsNativeWarmDefaults({ CREEZIO_NATIVE_WARM: "0" }),
    forced,
  );
  assert.deepEqual(
    applyVpsNativeWarmDefaults({
      CREEZIO_NATIVE_WARM: "1",
      CREEZIO_NATIVE_WARM_N8N: "0",
    }),
    forced,
  );
  assert.deepEqual(
    applyVpsNativeWarmDefaults({ CREEZIO_NATIVE_WARM_HERMES: "0" }),
    forced,
  );
});

test("harness + factory câblent les flags découplés", () => {
  const harness = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-kernel-harness.ts"),
    "utf8",
  );
  assert.match(harness, /resolveNativeWarmFlags/);
  assert.match(harness, /n8n: warmFlags\.n8n/);
  assert.match(harness, /Hermes indépendant/);
  const desktop = fs.readFileSync(
    path.join(ROOT, "packages/app-runtime/src/start-brand-desktop.ts"),
    "utf8",
  );
  assert.match(desktop, /resolveNativeWarmFlags/);
  assert.match(desktop, /n8n: warmFlags\.n8n/);
  const cli = fs.readFileSync(
    path.join(ROOT, "packages/factory/src/server-docker-cli.ts"),
    "utf8",
  );
  assert.match(cli, /applyVpsNativeWarmDefaults/);
  assert.match(cli, /CREEZIO_NATIVE_WARM_HERMES/);
});

test("GET /plugin-approvals sans Product Hub → 200 liste vide", async () => {
  const app = createAssistantRoutes({});
  const res = await app.request("/plugin-approvals");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { approvals: [], clarifications: [], qa: [] });
  const res2 = await app.request("/plugin-approvals?conversationId=abc");
  assert.equal(res2.status, 200);
  assert.deepEqual(await res2.json(), {
    approvals: [],
    clarifications: [],
    qa: [],
  });
});
