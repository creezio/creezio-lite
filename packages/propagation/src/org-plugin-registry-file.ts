/**
 * Registre org plugins **persisté fichier JSON** (Phase I6).
 * Survives restart — console ops / dry-run remontée.
 * Pas de cloud multi-tenant ; pas d'auto-promotion.
 */

import fs from "node:fs";
import path from "node:path";
import {
  createMemoryOrgPluginRegistry,
  type OrgPluginRecord,
  type OrgPluginRegistry,
  type OrgPluginVisibility,
  type PropagationLevel,
} from "./org-plugin-registry.js";

export type CreateFileOrgPluginRegistryOptions = {
  /** Chemin fichier JSON (créé si absent). */
  filePath: string;
  seed?: OrgPluginRecord[];
};

function loadRecords(filePath: string): OrgPluginRecord[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      plugins?: OrgPluginRecord[];
    };
    return Array.isArray(raw.plugins) ? raw.plugins : [];
  } catch {
    return [];
  }
}

function saveRecords(filePath: string, plugins: OrgPluginRecord[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        count: plugins.length,
        plugins,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.renameSync(tmp, filePath);
}

/**
 * Store fichier : même API que `createMemoryOrgPluginRegistry`,
 * avec flush synchrone après chaque mutation.
 */
export function createFileOrgPluginRegistry(
  opts: CreateFileOrgPluginRegistryOptions,
): OrgPluginRegistry & { readonly filePath: string; flush(): void } {
  const existing = loadRecords(opts.filePath);
  const seed =
    existing.length > 0 ? existing : opts.seed ? [...opts.seed] : [];
  const memory = createMemoryOrgPluginRegistry(seed);

  function persist(): void {
    saveRecords(opts.filePath, memory.list());
  }

  // Premier flush si seed sans fichier
  if (!fs.existsSync(opts.filePath) && seed.length > 0) persist();

  const registry: OrgPluginRegistry & {
    readonly filePath: string;
    flush(): void;
  } = {
    filePath: opts.filePath,
    flush: persist,
    list: (filter) => memory.list(filter),
    get: (id) => memory.get(id),
    upsert(record) {
      const next = memory.upsert(record);
      persist();
      return next;
    },
    submitForOrgReview(pluginId) {
      const next = memory.submitForOrgReview(pluginId);
      persist();
      return next;
    },
    proposeVerticalPromotion(pluginId) {
      const next = memory.proposeVerticalPromotion(pluginId);
      persist();
      return next;
    },
    proposeKitPromotion(pluginId) {
      const next = memory.proposeKitPromotion(pluginId);
      persist();
      return next;
    },
  };

  return registry;
}

export type { OrgPluginRecord, OrgPluginVisibility, PropagationLevel };
