/**
 * Adapters FS génériques pour scaffold / writeFiles (control-plane compatible).
 */

import fs from "node:fs";
import path from "node:path";
import { isValidPluginId } from "@creezio/platform-core";
import type {
  FactoryScaffoldResult,
  FactoryWriteFilesResult,
} from "./types.js";

export function createFsPluginScaffoldAdapters(pluginsDir: string): {
  scaffoldPlugin: (input: {
    id: string;
    name?: string;
    description?: string;
  }) => FactoryScaffoldResult;
  writePluginFiles: (
    id: string,
    files: Record<string, string>,
  ) => FactoryWriteFilesResult;
  pluginDir: (id: string) => string;
} {
  return {
    pluginDir: (id) => path.join(pluginsDir, id),
    scaffoldPlugin(input) {
      const id = input.id;
      if (!isValidPluginId(id)) {
        return { ok: false, error: "plugin_id invalide" };
      }
      const dir = path.join(pluginsDir, id);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const manifestPath = path.join(dir, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        const manifest = {
          id,
          name: input.name || id,
          version: "0.1.0",
          description: input.description || "",
          main: "index.js",
          permissions: ["net:loopback"],
        };
        fs.writeFileSync(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf8",
        );
      }
      // index.js / schema / api / mcp écrits par writePluginFiles (scaffold C3).
      return { ok: true, plugin: { id, dir } };
    },
    writePluginFiles(id, files) {
      if (!isValidPluginId(id)) {
        return { ok: false, error: "plugin_id invalide" };
      }
      const dir = path.join(pluginsDir, id);
      if (!fs.existsSync(dir)) {
        return { ok: false, error: "plugin inconnu" };
      }
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
  };
}
