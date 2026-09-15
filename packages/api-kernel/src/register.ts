/**
 * Helpers DX — enregistrement batch de mounts + factory marque documentée.
 *
 * Pattern recommandé (Electron + Next, une seule SoT) :
 *
 * ```ts
 * // modules/register-brand-api.ts
 * export function registerBrandModuleApis(api: ApiKernel): void {
 *   registerApiMounts(api, {
 *     modules: [
 *       ["panier", createPanierMount()],
 *       ["dispatch", createDispatchMount()],
 *     ],
 *   });
 * }
 *
 * // brand-runtime.ts + brand-module-api.ts
 * const api = createApiKernel({ brandId, sqliteRuntime });
 * registerBrandModuleApis(api);
 * registerApiMounts(api, {
 *   platform: [
 *     ["platform-tasks", createTasksApiMount(tasks)],
 *     ["platform-mails", createMailsApiMount(mails)],
 *     ["observability", createObservabilityApiMount(obs)],
 *     ["automations", createAutomationsApiMount(automations)],
 *   ],
 * });
 * ```
 */

import type { ApiKernel } from "./kernel.js";
import type { ApiMount } from "./types.js";

export type ApiMountEntry = readonly [id: string, mount: ApiMount];

export type RegisterApiMountsInput = {
  platform?: readonly ApiMountEntry[];
  modules?: readonly ApiMountEntry[];
  plugins?: readonly ApiMountEntry[];
};

/** Enregistre une liste de mounts platform / modules / plugins. */
export function registerApiMounts(
  api: ApiKernel,
  input: RegisterApiMountsInput,
): void {
  for (const [id, mount] of input.platform || []) {
    api.registerPlatformApi(id, mount);
  }
  for (const [id, mount] of input.modules || []) {
    api.registerModuleApi(id, mount);
  }
  for (const [id, mount] of input.plugins || []) {
    api.registerPluginApi(id, mount);
  }
}
