import fs from "node:fs";
import path from "node:path";
import {
  createFileOrgPluginRegistry,
  snapshotOrgPluginRegistry,
  type OrgPluginRecord,
  type OrgPluginRegistry,
} from "@creezio/propagation";

function kitRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const marker = path.join(dir, "packages", "propagation", "package.json");
    if (fs.existsSync(marker)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), "../..");
}

/** Fichier ops kit (I6) — hors cloud. */
export function orgPluginRegistryFilePath(): string {
  return (
    process.env.CREEZIO_ORG_PLUGIN_REGISTRY_PATH ||
    path.join(kitRoot(), "var", "org-plugin-registry.json")
  );
}

let cached: (OrgPluginRegistry & { filePath: string }) | null = null;

export function getOrgPluginRegistry(): OrgPluginRegistry & {
  filePath: string;
} {
  if (!cached) {
    cached = createFileOrgPluginRegistry({
      filePath: orgPluginRegistryFilePath(),
    });
  }
  return cached;
}

export function loadOrgPluginRegistrySnapshot() {
  const reg = getOrgPluginRegistry();
  return {
    ...snapshotOrgPluginRegistry(reg),
    filePath: reg.filePath,
  };
}

export type { OrgPluginRecord };
