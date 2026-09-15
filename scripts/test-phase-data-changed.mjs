#!/usr/bin/env node
/**
 * Gate — bus réactivité data + keep-alive cold + liens assistant navigate.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CREEZIO_DATA_CHANGED_EVENT,
  CREEZIO_DATA_CHANGED_HEADER,
  emitDataChanged,
  inferResourceFromToolName,
  parseDataChangedHeader,
  subscribeDataChanged,
} from "../packages/shell-ui/dist/index.js";
import { CREEZIO_DATA_CHANGED_HEADER as API_HEADER } from "../packages/api-kernel/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("data-changed: constantes alignées shell-ui / api-kernel", () => {
  assert.equal(CREEZIO_DATA_CHANGED_HEADER, "x-creezio-data-changed");
  assert.equal(API_HEADER, CREEZIO_DATA_CHANGED_HEADER);
  assert.equal(CREEZIO_DATA_CHANGED_EVENT, "creezio:data-changed");
});

test("data-changed: parse header CSV + infer tool names", () => {
  assert.deepEqual(parseDataChangedHeader("panier, commandes"), [
    "panier",
    "commandes",
  ]);
  // Legacy plats
  assert.equal(inferResourceFromToolName("add_to_panier"), "panier");
  assert.equal(inferResourceFromToolName("update_panier_ligne"), "panier");
  assert.equal(inferResourceFromToolName("close_panier"), "panier");
  assert.equal(inferResourceFromToolName("get_panier"), null);
  assert.equal(inferResourceFromToolName("list_clients"), null);
  assert.equal(inferResourceFromToolName("create_widget"), "widgets");
  assert.equal(inferResourceFromToolName("create_ai_task"), "tasks");
  assert.equal(inferResourceFromToolName("add_to_stack"), "stack");
  // Convention module.<owner>.<action>
  assert.equal(inferResourceFromToolName("module.panier.add"), "panier");
  assert.equal(inferResourceFromToolName("module.panier.get"), null);
  assert.equal(inferResourceFromToolName("module.promotions.list"), null);
  assert.equal(inferResourceFromToolName("module.catalog.search_products"), null);
  assert.equal(inferResourceFromToolName("module.catalog.get_sku"), null);
  assert.equal(inferResourceFromToolName("module.fournisseurs.list"), null);
  assert.equal(inferResourceFromToolName("module.conditions.rfa"), null);
  assert.equal(inferResourceFromToolName("module.optimiser.suggest"), null);
  // Mutation module hors lecture → resource = owner (aliasés)
  assert.equal(
    inferResourceFromToolName("module.commandes.create"),
    "commandes",
  );
  assert.equal(
    inferResourceFromToolName("module.promotions.create"),
    "promotions",
  );
});

test("data-changed: emit + subscribe (jsdom-less via EventTarget polyfill)", () => {
  // Node n'a pas window — on simule le minimum pour le module.
  const listeners = new Map();
  globalThis.window = {
    dispatchEvent(ev) {
      const set = listeners.get(ev.type) || new Set();
      for (const fn of set) fn(ev);
      return true;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
  class CE extends Event {
    constructor(type, init) {
      super(type);
      this.detail = init?.detail;
    }
  }
  globalThis.CustomEvent = CE;

  const seen = [];
  const off = subscribeDataChanged((d) => seen.push(d), { resource: "panier" });
  emitDataChanged({ resource: "panier", source: "test" });
  emitDataChanged({ resource: "commandes", source: "test" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].resource, "panier");
  assert.equal(seen[0].source, "test");
  off();
  emitDataChanged({ resource: "panier", source: "test2" });
  assert.equal(seen.length, 1);
  delete globalThis.window;
  delete globalThis.CustomEvent;
});

test("data-changed: keep-alive cold placeholder (source)", () => {
  const ka = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/keep-alive.tsx"),
    "utf8",
  );
  assert.match(ka, /coldTarget/);
  assert.match(ka, /data-workspace-pane-placeholder/);
  assert.match(ka, /JAMAIS l'ancienne pane|contenu page précédente/);
});

test("data-changed: assistant liens → onNavigate + attrs creezio", () => {
  const msg = fs.readFileSync(
    path.join(root, "packages/assistant/ui/assistant-message-content.tsx"),
    "utf8",
  );
  assert.match(msg, /onNavigate/);
  assert.match(msg, /CrmNavLink/);
  const widget = fs.readFileSync(
    path.join(root, "packages/assistant/ui/assistant-widget.tsx"),
    "utf8",
  );
  assert.match(widget, /data-creezio-assistant-ui/);
  assert.match(widget, /inferResourceFromToolName/);
  assert.match(widget, /emitDataChanged/);
  assert.match(widget, /from \"@creezio\/shell-ui\"/);
  assert.match(widget, /onNavigate=\{/);
});

test("data-changed: WorkspaceRoot branche assistant tab workspace", () => {
  const ctx = fs.readFileSync(
    path.join(
      root,
      "packages/shell-ui/ui/workspace/tab-workspace-context.tsx",
    ),
    "utf8",
  );
  assert.match(ctx, /configureAssistantTabWorkspace/);
  assert.match(ctx, /getShellDesktopApi/);
  assert.doesNotMatch(ctx, /window\.tempoflowDesktop/);
  // Contrat openOrNotify : focus (pas pastille-only)
  assert.match(ctx, /openOrNotify/);
  assert.match(ctx, /\"focused\"/);
  assert.match(ctx, /activateTab\(existing\.id\)/);
  assert.doesNotMatch(
    ctx,
    /pastille de notification dessus|pose une pastille/,
  );
});

test("data-changed: WorkspaceRoot enveloppe AssistantProvider kit", () => {
  const wr = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/workspace-root.tsx"),
    "utf8",
  );
  const shell = fs.readFileSync(
    path.join(root, "packages/shell-ui/ui/workspace/workspace-shell.tsx"),
    "utf8",
  );
  // Consommateurs du context kit
  assert.match(shell, /useAssistantUi/);
  assert.match(wr, /AssistantWidget/);
  // Provider kit obligatoire (pas un jumeau marque)
  assert.match(wr, /AssistantProvider/);
  assert.match(wr, /from ["']@creezio\/assistant\/ui["']/);
  assert.match(
    wr,
    /<AssistantProvider>[\s\S]*<TabWorkspaceProvider>/,
  );
});

test("data-changed: docs CREATE-MODULE + DOC-STANDARD-UI", () => {
  const create = fs.readFileSync(
    path.join(root, "docs/agents/CREATE-MODULE.md"),
    "utf8",
  );
  assert.match(create, /useCreezioResource/);
  assert.match(create, /x-creezio-data-changed|creezio:data-changed/);
  const ui = fs.readFileSync(
    path.join(root, "docs/DOC-STANDARD-UI.md"),
    "utf8",
  );
  assert.match(ui, /useCreezioResource/);
});

test("data-changed: CreezioUiBoot installe le fetch interceptor", () => {
  const boot = fs.readFileSync(
    path.join(root, "packages/os-ui/src/boot.tsx"),
    "utf8",
  );
  assert.match(boot, /installCreezioDataChangedFetch/);
});
