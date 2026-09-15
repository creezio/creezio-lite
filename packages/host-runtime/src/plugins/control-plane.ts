/**
 * Control plane plugins — façade electron-shell sur @creezio/product-hub.
 * C7 : point d'entrée unifié `startHostPluginControlPlane` (4 boots).
 */

import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  productHubTokensFromManifest,
  startPluginControlPlane,
  type PluginControlPlaneAcl,
  type PluginControlPlaneAdapters,
  type PluginControlPlaneState,
  type ProductHubStore,
} from "@creezio/product-hub";
import { pluginsRootDir } from "@creezio/platform-core";
import type { HostRuntimeContext } from "../context.js";
import { hostLog } from "../context.js";
import { ensurePluginControlToken } from "./control-token.js";
import { createPluginsHost, type PluginsHost } from "./host.js";

export type StartHostPluginControlPlaneOptions = {
  ctx: HostRuntimeContext;
  /**
   * Host sidecars. Si omis (C7), `createPluginsHost({ ctx })` est utilisé
   * (Fidu / demobrand / boots sans launcher custom).
   */
  pluginsHost?: PluginsHost;
  /** Port effectif (0 = éphémère). */
  port?: number;
  /** Port préféré passé au server kit (info / findFree côté marque). */
  preferredPort?: number;
  /**
   * Store Product Hub (mémoire ou SQLite vertical) pour fetchProductDetails.
   * Si absent, POST …/grant renvoie 503 sauf adapter custom.
   */
  productHubStore?: ProductHubStore;
  /** Adapters verticaux (git, scaffold riche…) — override partiel. */
  adapters?: Partial<PluginControlPlaneAdapters>;
  /** H5 — ACL L3 Product Hub (optionnel, rétrocompat sans filtre). */
  acl?: PluginControlPlaneAcl;
  /** C7 — extras marque (accept-check, versions…) avant handler kit. */
  preHandle?: (
    req: IncomingMessage,
    res: ServerResponse,
  ) => boolean | Promise<boolean>;
  /**
   * Override token Bearer (sinon `ensurePluginControlToken(ctx)`).
   * Utile quand la marque a déjà matérialisé le fichier token.
   */
  controlToken?: string;
};

function defaultScaffold(
  pluginsDir: string,
  opts: { id: string; name?: string; description?: string },
): { ok: true; plugin: { id: string; dir: string } } | { ok: false; error: string } {
  const id = opts.id;
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(id)) {
    return { ok: false, error: "plugin_id invalide" };
  }
  const dir = path.join(pluginsDir, id);
  if (fs.existsSync(dir)) {
    return { ok: false, error: "plugin déjà présent" };
  }
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    name: opts.name || id,
    version: "0.1.0",
    description: opts.description || "",
    main: "index.js",
    permissions: ["net:loopback"],
    creezio: { factory: "c7-host", db: "plugin", mcpSpace: "plugin" },
  };
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(dir, "index.js"),
    `"use strict";\nmodule.exports = { id: ${JSON.stringify(id)}, start() { return { ok: true, pluginId: ${JSON.stringify(id)} }; } };\n`,
    "utf8",
  );
  return { ok: true, plugin: { id, dir } };
}

/**
 * Démarre le control plane loopback brandé depuis HostRuntimeContext.
 * **C7** — entrée unique marques / demobrand.
 */
export async function startHostPluginControlPlane(
  opts: StartHostPluginControlPlaneOptions,
): Promise<PluginControlPlaneState> {
  const { ctx } = opts;
  const pluginsHost = opts.pluginsHost || createPluginsHost({ ctx });
  const tokens = productHubTokensFromManifest(ctx.manifest);
  const storedToken =
    opts.controlToken || ensurePluginControlToken(ctx).token;
  const pluginsDir = pluginsRootDir(ctx.userDataDir);
  fs.mkdirSync(pluginsDir, { recursive: true });

  const baseAdapters: PluginControlPlaneAdapters = {
    listStatus: () => pluginsHost.pluginsStatusPayload(),
    createPlugin: async (input) => defaultScaffold(pluginsDir, input),
    writeFiles: async (id, files) => {
      const dir = path.join(pluginsDir, id);
      if (!fs.existsSync(dir)) return { ok: false, error: "plugin inconnu" };
      const written: string[] = [];
      for (const [rel, content] of Object.entries(files)) {
        if (rel.includes("..") || path.isAbsolute(rel)) {
          return { ok: false, error: `chemin interdit: ${rel}` };
        }
        const target = path.join(dir, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
        written.push(rel);
      }
      return { ok: true, written };
    },
    enablePlugin: async (id, enabled) => {
      const plug = pluginsHost.enablePlugin(id, enabled);
      if (!plug) return { ok: false, error: "plugin inconnu" };
      if (enabled) await pluginsHost.startEnabledPlugins();
      return { ok: true, plugin: plug };
    },
    restartPlugin: async (id) => {
      const found = pluginsHost.listPlugins().find((p) => p.manifest.id === id);
      if (!found) return { ok: false, error: "plugin inconnu" };
      pluginsHost.enablePlugin(id, true);
      await pluginsHost.startEnabledPlugins();
      const run = pluginsHost
        .getRunningPlugins()
        .find((r) => r.id === id);
      return { ok: true, running: run || null };
    },
    deletePlugin: async (id) => {
      const dir = path.join(pluginsDir, id);
      if (!fs.existsSync(dir)) return { ok: false, error: "plugin inconnu" };
      pluginsHost.enablePlugin(id, false);
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true, deleted: id };
    },
    pluginDir: (id) => path.join(pluginsDir, id),
    fetchProductDetails: opts.productHubStore
      ? async (productId) => {
          const details = opts.productHubStore!.productDetails(productId);
          if (!details) return null;
          return {
            product: details.product,
            prdRevisions: details.prdRevisions,
          };
        }
      : undefined,
  };

  const adapters: PluginControlPlaneAdapters = {
    ...baseAdapters,
    ...opts.adapters,
    pluginDir: opts.adapters?.pluginDir || baseAdapters.pluginDir,
    fetchProductDetails:
      opts.adapters?.fetchProductDetails || baseAdapters.fetchProductDetails,
  };

  const state = await startPluginControlPlane({
    tokens,
    controlToken: storedToken,
    pluginsDir,
    adapters,
    port: opts.port ?? 0,
    preferredPort: opts.preferredPort,
    ...(opts.acl ? { acl: opts.acl } : {}),
    ...(opts.preHandle ? { preHandle: opts.preHandle } : {}),
  });
  hostLog(
    ctx,
    "plugins-api",
    `control plane ${tokens.controlPlaneServiceName} sur ${state.url} (startHostPluginControlPlane)`,
  );
  return state;
}
