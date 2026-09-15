/**
 * Bus d'événements CRM → plugins — logique pure (kit plugin-events.ts).
 */

import fs from "node:fs";
import path from "node:path";

export const PLUGIN_RUNTIME_FILE = ".runtime.json";

export type PluginRuntimeEntry = {
  id: string;
  port: number | null;
  hooks: string[];
  permissions: string[];
  panel: boolean;
};

export type PluginRuntimeState = {
  updatedAt: string;
  plugins: PluginRuntimeEntry[];
};

export function pluginRuntimePath(pluginsRoot: string): string {
  return path.join(pluginsRoot, PLUGIN_RUNTIME_FILE);
}

export function writePluginRuntimeState(
  pluginsRoot: string,
  plugins: PluginRuntimeEntry[],
): void {
  const state: PluginRuntimeState = {
    updatedAt: new Date().toISOString(),
    plugins,
  };
  fs.mkdirSync(pluginsRoot, { recursive: true });
  fs.writeFileSync(
    pluginRuntimePath(pluginsRoot),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

export function readPluginRuntimeState(
  pluginsRoot: string,
): PluginRuntimeState | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(pluginRuntimePath(pluginsRoot), "utf8"),
    ) as PluginRuntimeState;
    if (!raw || !Array.isArray(raw.plugins)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function pluginAcceptsHook(
  hooks: string[] | undefined,
  event: string,
): boolean {
  if (!hooks || !hooks.length) return true;
  return hooks.includes("*") || hooks.includes(event);
}

export function pluginHookUrl(port: number, event: string): string {
  const safe = encodeURIComponent(event);
  return `http://127.0.0.1:${port}/hooks/${safe}`;
}

export function pluginN8nWebhookUrl(port: number): string {
  return `http://127.0.0.1:${port}/webhooks/n8n`;
}

export const PLUGIN_SITE_ID_BASE = 910000;
export const PLUGIN_SITE_ID_SPAN = 10000;

export function pluginSiteId(pluginId: string): number {
  let h = 2166136261;
  for (let i = 0; i < pluginId.length; i++) {
    h ^= pluginId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = (h >>> 0) % PLUGIN_SITE_ID_SPAN;
  return PLUGIN_SITE_ID_BASE + idx;
}
