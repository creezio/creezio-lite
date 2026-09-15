#!/usr/bin/env node
/**
 * H0 « Hermes cerveau unique » — allowlist web appliquée AU NIVEAU EXÉCUTION.
 *
 * - helper partagé `checkWebHostAllowed` (@creezio/platform-core) ;
 * - `AiSessionHost.executeSupplierRequest` (browser-host serveur) refuse un
 *   `ai_workspace_open_tab` hors allowlist AVANT toute session/spawn ;
 * - `executeSupplierAction` (electron-shell browser-tabs) refuse un
 *   `external_open_tab` hors allowlist sans toucher au manager ;
 * - la garde UX du runner (`aiWebHostAllowed`, @creezio/tasks) reste en place.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const ENV_KEY = "HERMESGATE_TEST_WEB_ALLOWED_HOSTS";

function withAllowlist(value, fn) {
  const prev = process.env[ENV_KEY];
  if (value == null) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = prev;
    });
}

test("H0.1 helper platform-core — sémantique allowlist", async () => {
  const core = require(
    path.join(root, "packages/platform-core/dist-cjs/index.js"),
  );
  assert.equal(typeof core.checkWebHostAllowed, "function");
  assert.equal(typeof core.readWebAllowedHosts, "function");
  assert.equal(core.WEB_HOST_NOT_ALLOWED_CODE, "web_host_not_allowed");

  await withAllowlist(null, () => {
    // Pas d'allowlist configurée → tout http(s) passe, URL invalide refusée.
    assert.equal(core.checkWebHostAllowed("https://exemple.com/x").ok, true);
    assert.equal(core.checkWebHostAllowed("pas-une-url").ok, false);
    assert.equal(core.checkWebHostAllowed("file:///etc/passwd").ok, false);
  });

  await withAllowlist("exemple.com, *.fournisseur.fr", () => {
    assert.deepEqual(
      [...core.readWebAllowedHosts()].sort(),
      ["exemple.com", "fournisseur.fr"],
    );
    assert.equal(core.checkWebHostAllowed("https://exemple.com/p").ok, true);
    assert.equal(
      core.checkWebHostAllowed("https://shop.fournisseur.fr/p").ok,
      true,
    );
    const refused = core.checkWebHostAllowed("https://evil.example/p");
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "web_host_not_allowed");
    assert.match(refused.error, /evil\.example/);
  });
});

test("H0.2 AiSessionHost (serveur) — open_tab hors allowlist refusé au host", async () => {
  const bh = require(path.join(root, "packages/browser-host/dist-cjs/index.js"));
  assert.equal(typeof bh.AiSessionHost, "function");
  const host = new bh.AiSessionHost({
    browserDataRoot: "/tmp/gate-h0-browser",
    sessionCookieName: "gate_session",
    crmBaseUrl: () => "http://127.0.0.1:9",
    mintSessionToken: async () => "jwt",
    onLog: () => {},
  });

  await withAllowlist("fournisseur.fr", async () => {
    const res = await host.executeSupplierRequest({
      actionId: "a1",
      type: "ai_workspace_open_tab",
      params: {
        ai_user_id: "ai-1",
        site_id: 1,
        url: "https://evil.example/login",
      },
    });
    assert.equal(res.ok, false);
    // Refus allowlist (host-level) — jamais un refus « session absente »
    // trompeur : le contrôle passe avant tout spawn Chromium.
    assert.equal(res.code, "web_host_not_allowed", JSON.stringify(res));
  });

  await withAllowlist("fournisseur.fr", async () => {
    // Hôte autorisé : le refus suivant est « session absente » (pas
    // d'allowlist) — preuve que le contrôle n'est pas trop large.
    const res = await host.executeSupplierRequest({
      actionId: "a2",
      type: "ai_workspace_open_tab",
      params: {
        ai_user_id: "ai-1",
        site_id: 1,
        url: "https://www.fournisseur.fr/login",
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "ai_workspace_missing", JSON.stringify(res));
  });
});

test("H0.3 executeSupplierAction (Electron) — external_open_tab hors allowlist refusé sans toucher au manager", async () => {
  const driver = require(
    path.join(
      root,
      "packages/electron-shell/dist-cjs/host/browser-tabs/browser-tab-driver.js",
    ),
  );
  assert.equal(typeof driver.executeSupplierAction, "function");
  const calls = [];
  const fakeManager = {
    list: () => [],
    get: () => null,
    getActive: () => null,
    activate: () => {},
    openTab: async (siteId, url) => {
      calls.push({ siteId, url });
      throw new Error("ne doit pas être atteint dans ce test");
    },
  };

  await withAllowlist("fournisseur.fr", async () => {
    const res = await driver.executeSupplierAction(fakeManager, {
      actionId: "a3",
      type: "external_open_tab",
      params: { site_id: 4, url: "https://evil.example/panier" },
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "web_host_not_allowed", JSON.stringify(res));
    assert.equal(calls.length, 0, "manager.openTab ne doit pas être appelé");
  });
});

test("H0.4 garde UX runner conservée (aiWebHostAllowed dans open_tab)", () => {
  const src = fs.readFileSync(
    path.join(root, "packages/tasks/src/ai-task-agent.ts"),
    "utf8",
  );
  assert.match(src, /aiWebHostAllowed\(url\)/);
  assert.match(src, /host_not_allowed/);
  // Les exécuteurs portent le contrôle host-level partagé.
  const aiHost = fs.readFileSync(
    path.join(root, "packages/browser-host/src/ai-session-host.ts"),
    "utf8",
  );
  assert.match(aiHost, /checkWebHostAllowed/);
  const electronDriver = fs.readFileSync(
    path.join(
      root,
      "packages/electron-shell/src/host/browser-tabs/browser-tab-driver.ts",
    ),
    "utf8",
  );
  assert.match(electronDriver, /checkWebHostAllowed/);
});
