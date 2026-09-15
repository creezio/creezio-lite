/**
 * Accès PARESSEUX aux modules host-only — port du pattern kit host-stack.ts.
 *
 * Les apps marques construisent un HostStack via `createHostStack(deps)`
 * et n'importent les launchers que sur les chemins allowLocalStack.
 */

import type { HostRuntimeContext } from "./context.js";
import type { LocalConfigStore } from "./local-config.js";
import { createHermesHost, type HermesHost } from "./hermes/launcher.js";
import { createN8nHost, type N8nHost } from "./n8n/launcher.js";
import { createTunnelService, type TunnelService } from "./tunnel/tunnel.js";
import { createPluginsHost, type PluginsHost } from "./plugins/host.js";
import { startMeili, type RunningMeili, type StartMeiliOptions } from "@creezio/search";
import {
  startNextServerCore,
  type RunningServer,
  type StartServerCoreOptions,
} from "./server-env.js";

export type HostStack = {
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
  hermes: HermesHost;
  n8n: N8nHost;
  tunnel: TunnelService;
  plugins: PluginsHost;
  startMeili: (opts: StartMeiliOptions) => Promise<RunningMeili | null>;
  startNextServerCore: (opts: StartServerCoreOptions) => Promise<RunningServer>;
};

/**
 * Construit le graphe host pour une marque (à appeler uniquement si
 * bootBehavior.allowLocalStack).
 */
export function createHostStack(opts: {
  ctx: HostRuntimeContext;
  store: LocalConfigStore;
}): HostStack {
  const hermes = createHermesHost(opts);
  const n8n = createN8nHost(opts);
  const tunnel = createTunnelService(opts);
  const plugins = createPluginsHost({ ctx: opts.ctx });
  return {
    ctx: opts.ctx,
    store: opts.store,
    hermes,
    n8n,
    tunnel,
    plugins,
    startMeili,
    startNextServerCore,
  };
}

/** Lazy accessor pattern (équivalent kit `lazy(() => require(...))`). */
export function lazyHost<T>(load: () => T): () => T {
  let mod: T | undefined;
  return () => (mod ??= load());
}
