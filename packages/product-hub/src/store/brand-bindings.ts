/**
 * Bindings marque — singleton store core.db + ACL control-plane.
 */

import fs from "node:fs";
import path from "node:path";
import { withBearerServiceKeyFallback } from "../control-plane/acl-service-key.js";
import {
  createPluginControlPlaneAclFromStore,
  type CreatePluginControlPlaneAclFromStoreOptions,
} from "../control-plane/acl-from-store.js";
import type { PluginControlPlaneAcl } from "../control-plane/types.js";
import type { PluginAclActor } from "../acl.js";
import {
  createSqliteProductHubStore,
  type SqliteProductHubStore,
} from "./sqlite-store.js";

export type BrandProductHubBindings = {
  ensure: () => SqliteProductHubStore;
  close: () => void;
  createAcl: (opts?: {
    onInstalled?: (pluginId: string, actor: PluginAclActor) => void;
    onUninstalled?: (pluginId: string) => void;
  }) => PluginControlPlaneAcl;
};

export type CreateBrandProductHubBindingsOptions = {
  resolveCorePath: () => string;
  conversationPrefix: string;
  fallbackOwnerOrgId: string;
  requireAdminToBootstrapInstall?: boolean;
};

/** Singleton store + ACL Bearer service-key fallback (marques). */
export function createBrandProductHubBindings(
  opts: CreateBrandProductHubBindingsOptions,
): BrandProductHubBindings {
  let hub: SqliteProductHubStore | null = null;
  let hubPath: string | null = null;

  function ensure(): SqliteProductHubStore {
    const corePath = opts.resolveCorePath();
    if (hub && hubPath === corePath) return hub;
    if (hub) {
      try {
        hub.close();
      } catch {
        /* ok */
      }
      hub = null;
    }
    fs.mkdirSync(path.dirname(corePath), { recursive: true });
    hub = createSqliteProductHubStore({
      coreDbPath: corePath,
      conversationPrefix: opts.conversationPrefix,
    });
    hubPath = corePath;
    return hub;
  }

  function close(): void {
    if (!hub) return;
    try {
      hub.close();
    } catch {
      /* ok */
    }
    hub = null;
    hubPath = null;
  }

  function createAcl(hooks?: {
    onInstalled?: (pluginId: string, actor: PluginAclActor) => void;
    onUninstalled?: (pluginId: string) => void;
  }): PluginControlPlaneAcl {
    const baseOpts: CreatePluginControlPlaneAclFromStoreOptions = {
      store: ensure(),
      fallbackOwnerOrgId: opts.fallbackOwnerOrgId,
      requireAdminToBootstrapInstall:
        opts.requireAdminToBootstrapInstall !== false,
      onInstalled: hooks?.onInstalled,
      onUninstalled: hooks?.onUninstalled,
    };
    return withBearerServiceKeyFallback(
      createPluginControlPlaneAclFromStore(baseOpts),
    );
  }

  return { ensure, close, createAcl };
}
