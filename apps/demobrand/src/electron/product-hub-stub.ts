/**
 * Stub Product Hub sandbox DemoBrand.
 * H2 : utilise le sqlite **core** du runtime sandbox quand disponible ;
 * sinon opt-in `DEMOBRAND_PRODUCT_HUB_SQLITE=1` (tmp) ou mémoire.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPluginImpactReport,
  createMemoryProductHubStore,
  createSqliteProductHubStore,
  productHubTokensFromManifest,
  type ProductHubStore,
} from "@creezio/product-hub";
import { demobrandManifest as manifest } from "./app-manifest.js";

export const demobrandProductHubTokens =
  productHubTokensFromManifest(manifest);

let store: ProductHubStore | null = null;
let boundCorePath: string | null = null;

/** Injecte un store déjà ouvert (ex. sandbox H2) sans rouvrir core. */
export function setDemobrandProductHubStore(next: ProductHubStore): void {
  store = next;
  boundCorePath = "dbPath" in next ? String((next as { dbPath?: string }).dbPath ?? "") : null;
}

/** Branche le store sur le core du SqliteRuntime H2 (préféré). */
export function bindDemobrandProductHubCore(coreDbPath: string): ProductHubStore {
  if (
    store &&
    "close" in store &&
    typeof (store as { close?: () => void }).close === "function" &&
    boundCorePath &&
    boundCorePath !== coreDbPath
  ) {
    try {
      (store as { close: () => void }).close();
    } catch {
      /* ignore */
    }
  }
  boundCorePath = coreDbPath;
  store = createSqliteProductHubStore({
    coreDbPath,
    conversationPrefix: "demobrand",
  });
  return store;
}

export function getDemobrandProductHubStore(): ProductHubStore {
  if (!store) {
    if (boundCorePath) {
      store = createSqliteProductHubStore({
        coreDbPath: boundCorePath,
        conversationPrefix: "demobrand",
      });
    } else if (process.env.DEMOBRAND_PRODUCT_HUB_SQLITE === "1") {
      const dir = path.join(os.tmpdir(), "creezio-demobrand-sqlite");
      fs.mkdirSync(dir, { recursive: true });
      const coreDbPath = path.join(dir, "core.db");
      store = createSqliteProductHubStore({
        coreDbPath,
        conversationPrefix: "demobrand",
      });
    } else {
      store = createMemoryProductHubStore({ conversationPrefix: "demobrand" });
    }
  }
  return store;
}

/** Crée une demande plugin démo (impact local, sans CRM). */
export function createDemoPluginRequest(input: {
  name: string;
  description?: string;
}) {
  const hub = getDemobrandProductHubStore();
  const impact = buildPluginImpactReport({
    name: input.name,
    description: input.description || "",
    evidence: [],
  });
  return hub.createRequest({
    name: input.name,
    description: input.description,
    impact,
  });
}
