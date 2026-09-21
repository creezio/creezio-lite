import {stabilizeVinextSlotContexts} from "../runtime/modules/sites-adapter/build/router-contexts";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import type { Plugin } from "vite";

/** Resolve the actual Lite source packages. No generated replacement UI. */
export function liteSource(): Plugin {
  const packages = resolve("runtime/modules");
  function source(path: string): string | undefined {
    const normalized = path.replace(/\/dist\//g, "/src/");
    const stem = normalized.replace(/\.(?:m?js)$/, "");
    return [normalized, `${stem}.ts`, `${stem}.tsx`, join(normalized, "index.ts"), join(normalized, "index.tsx")].find(existsSync);
  }
  return {
    name: "lite-source-packages",
    enforce: "pre",
    transform(code,id){const result=stabilizeVinextSlotContexts(code,id);return result===null?null:{code:result,map:null};},
    resolveId(id, importer) {
      if (importer?.startsWith(packages) && ["recharts", "react-resizable-panels"].includes(id)) {
        return this.resolve(id === "recharts" ? "lite-recharts" : "lite-resizable-panels", resolve("app/page.tsx"), { skipSelf: true });
      }
      if (id === "@lite/core" || id.startsWith("@lite/core/")) return source(resolve("runtime/core", id.slice("@lite/core/".length) || "index.ts"));
      if (id.startsWith("@lite/")) {
        const [name, ...parts] = id.slice("@lite/".length).split("/");
        const root = join(packages, name);
        if (!existsSync(join(root, "package.json"))) return;
        const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        const key = parts.length ? `./${parts.join("/")}` : ".";
        let entry = manifest.exports?.[key];
        if (!entry && ["ui","src"].includes(parts[0])) entry = `./${parts.join("/")}`;
        if (!entry) for (const [pattern, value] of Object.entries(manifest.exports ?? {})) {
          if (!pattern.includes("*")) continue;
          const [prefix, suffix] = pattern.split("*");
          if (key.startsWith(prefix) && key.endsWith(suffix)) {
            const val = typeof value === "string" ? value : (value as any).import;
            entry = val?.replace("*", key.slice(prefix.length, suffix ? -suffix.length : undefined));
            break;
          }
        }
        const file = typeof entry === "string" ? entry : entry?.import ?? entry?.default;
        if (file) return source(resolve(root, file));
      }
      if (importer?.startsWith(packages) && id.startsWith(".") && id.includes("dist/")) {
        return source(resolve(dirname(importer), id));
      }
    },
  };
}
