/**
 * Factory adapters control-plane — port générique TF plugin-control-adapters (N1).
 * Injection marque : readHostCrmApiKey, envPrefix (+ aliases), plugins CRM port.
 */

import fs from "node:fs";
import path from "node:path";
import type { PluginControlPlaneAdapters } from "@creezio/product-hub";
import { getPluginHostBindings, pluginEnvKeys } from "./brand-bindings.js";
import {
  createPluginScaffoldWithGit,
  deletePlugin,
  enablePlugin,
  getPluginsCrmPort,
  pluginsStatusPayloadWithGit,
  restartPlugin,
  startEnabledPlugins,
  writePluginFilesAndCommit,
} from "./launcher.js";
import { pluginsRootDir } from "./runtime.js";

function crmProductsBase(): { url: string; key: string } | null {
  const bindings = getPluginHostBindings();
  for (const urlKey of pluginEnvKeys(bindings, "PLUGIN_PRODUCTS_API_URL")) {
    const overrideUrl = String(process.env[urlKey] || "").trim();
    if (!overrideUrl) continue;
    let overrideKey = "";
    for (const keyKey of pluginEnvKeys(bindings, "PLUGIN_PRODUCTS_API_KEY")) {
      overrideKey = String(process.env[keyKey] || "").trim();
      if (overrideKey) break;
    }
    return { url: overrideUrl.replace(/\/+$/, ""), key: overrideKey };
  }
  const port = getPluginsCrmPort();
  const stored = bindings.readHostCrmApiKey?.();
  if (!port || !stored?.apiKey) return null;
  return { url: `http://127.0.0.1:${port}/api/v1`, key: stored.apiKey };
}

/**
 * Adapters riches (git / scaffold / Product Hub CRM) — même contrat TF gold.
 * Remplace `buildTempoflowControlPlaneAdapters` au cutover N1p.
 */
export function buildPluginControlPlaneAdapters(): PluginControlPlaneAdapters {
  return {
    listStatus: () => pluginsStatusPayloadWithGit(),

    createPlugin: async (input) => {
      const r = await createPluginScaffoldWithGit({
        id: input.id,
        name: input.name,
        description: input.description,
      });
      if (!r.ok) return r;
      try {
        fs.writeFileSync(
          path.join(r.plugin.dir, ".product-hub-managed"),
          `${new Date().toISOString()}\n`,
          "utf8",
        );
      } catch {
        /* best-effort */
      }
      return r;
    },

    writeFiles: async (id, files, message) =>
      writePluginFilesAndCommit(id, files, message),

    enablePlugin: async (id, enabled) => {
      const plug = enablePlugin(id, enabled);
      if (!plug) return { ok: false, error: "plugin inconnu" };
      if (enabled) await startEnabledPlugins();
      return { ok: true, plugin: plug };
    },

    restartPlugin: async (id) => restartPlugin(id),

    deletePlugin: async (id) => deletePlugin(id),

    pluginDir: (id) => path.join(pluginsRootDir(), id),

    fetchProductDetails: async (productId) => {
      const base = crmProductsBase();
      if (!base) {
        throw new Error("CRM local indisponible (port ou clé manquants)");
      }
      const r = await fetch(
        `${base.url}/plugin-products/${encodeURIComponent(productId)}`,
        {
          headers: base.key ? { Authorization: `Bearer ${base.key}` } : {},
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (r.status === 404) return null;
      if (!r.ok) {
        throw new Error(`CRM plugin-products HTTP ${r.status}`);
      }
      return (await r.json()) as {
        product?: {
          plugin_id?: string | null;
          archived_at?: string | null;
          lifecycle_state?: string;
        };
        prdRevisions?: Array<{
          id?: string;
          validated_at?: string | null;
          version?: number;
        }>;
      };
    },
  };
}
