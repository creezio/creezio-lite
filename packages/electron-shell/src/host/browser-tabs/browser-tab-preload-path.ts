/**
 * Chemin absolu du preload onglet kit (O1 — plus de façade marque).
 * Dual ESM/CJS : ESM (dist) n'a pas `__dirname` → `import.meta.url` ;
 * CJS Electron (dist-cjs) n'a pas `import.meta` → `__dirname`.
 * Les deux lus via eval pour rester compilables dans les deux modes.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

function compiledDir(): string {
  try {
    // eslint-disable-next-line no-eval
    const metaUrl = eval("import.meta.url") as string;
    return path.dirname(fileURLToPath(metaUrl));
  } catch {
    /* CJS */
  }
  try {
    // eslint-disable-next-line no-eval
    return eval("__dirname") as string;
  } catch {
    return process.cwd();
  }
}

export function browserTabPreloadPath(): string {
  return path.join(compiledDir(), "browser-tab-preload.js");
}
