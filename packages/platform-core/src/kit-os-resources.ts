/**
 * Ressources OS natives shippées par le kit (@creezio/host-runtime),
 * pas par la marque. Toute app Creezio résout Hermes/n8n via ce chemin
 * si `resourcesRoot` marque n’embarque pas de vendor.
 *
 * P1.c (0.20) : `resources/{vendor,scripts,bin}` a quitté electron-shell
 * pour que l’image serveur headless n’embarque plus `@creezio/electron-shell`
 * ni le wrapper npm `electron`.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createAppRequire } from "./app-require.js";
import { fileURLToPath } from "node:url";

let cachedShellRoot: string | null = null;
let cachedHostRoot: string | null = null;

/**
 * Dossier du module compilé (dist/host ou dist-cjs/host).
 * ESM packagé (asar) : pas de `__dirname` → `import.meta.url`.
 * CJS (dist-cjs) : `import.meta` absent → `__dirname`.
 * `import.meta` / `__dirname` lus via eval pour rester compilables dual ESM/CJS.
 */
function compiledHostDir(): string {
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

function resolveFromEntry(entry: string): string | null {
  // dist/index.js ou dist-cjs/index.js → package root
  let root = path.resolve(path.dirname(entry), "..");
  if (!fs.existsSync(path.join(root, "resources", "vendor"))) {
    // si resolve pointe dans dist/host/… remonter encore
    const alt = path.resolve(root, "..");
    if (fs.existsSync(path.join(alt, "resources", "vendor"))) {
      root = alt;
    }
  }
  return fs.existsSync(path.join(root, "package.json")) ? root : null;
}

function resolvePackageRoot(
  spec: "@creezio/electron-shell" | "@creezio/host-runtime",
): string | null {
  try {
    const req = createRequire(path.join(compiledHostDir(), "kit-os-resources.js"));
    const root = resolveFromEntry(req.resolve(spec));
    if (root) return root;
  } catch {
    /* fallthrough */
  }
  try {
    const req = createAppRequire();
    const root = resolveFromEntry(req.resolve(spec));
    if (root) return root;
  } catch {
    /* fallthrough */
  }
  return null;
}

/** Racine package electron-shell (…/packages/electron-shell). */
export function electronShellPackageRoot(): string {
  if (cachedShellRoot && fs.existsSync(cachedShellRoot)) return cachedShellRoot;
  const resolved = resolvePackageRoot("@creezio/electron-shell");
  cachedShellRoot =
    resolved ?? path.resolve(compiledHostDir(), "../../electron-shell");
  return cachedShellRoot;
}

function hostRuntimePackageRoot(): string {
  if (cachedHostRoot && fs.existsSync(cachedHostRoot)) return cachedHostRoot;
  const resolved = resolvePackageRoot("@creezio/host-runtime");
  cachedHostRoot =
    resolved ?? path.resolve(compiledHostDir(), "../../host-runtime");
  return cachedHostRoot;
}

/** `packages/host-runtime/resources` — vendor Hermes/n8n + scripts + bin kit. */
export function kitOsResourcesRoot(): string {
  return path.join(hostRuntimePackageRoot(), "resources");
}

export function kitOsVendorDir(name: "hermes-agent" | "n8n"): string {
  return path.join(kitOsResourcesRoot(), "vendor", name);
}
