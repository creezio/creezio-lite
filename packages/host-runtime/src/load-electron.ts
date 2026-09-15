/**
 * Charge electron en sync pour le main des marques.
 * Évite `import "electron"` au top-level (casse les tests kit Node sans peer).
 *
 * Packagé ESM (asar `dist/`) : `require` global absent → createRequire(import.meta).
 * CJS (dist-cjs) : `eval("require")` hérite du scope CJS.
 *
 * `import.meta` est lu via eval(string) pour rester compilable en
 * tsconfig.cjs (module: commonjs) — TS1343 sinon.
 */
import { createRequire } from "node:module";
import { createAppRequire } from "@creezio/platform-core";

export function loadElectron(): typeof import("electron") {
  const errors: string[] = [];

  // 1) Scope CJS (dist-cjs, scripts CommonJS)
  try {
    // eslint-disable-next-line no-eval
    const req = eval("require") as NodeRequire;
    return req("electron") as typeof import("electron");
  } catch (e) {
    errors.push(`eval: ${e instanceof Error ? e.message : e}`);
  }

  // 2) ESM packagé — createRequire(import.meta.url)
  try {
    // eslint-disable-next-line no-eval
    const metaUrl = eval("import.meta.url") as string;
    const req = createRequire(metaUrl);
    return req("electron") as typeof import("electron");
  } catch (e) {
    errors.push(`import.meta: ${e instanceof Error ? e.message : e}`);
  }

  // 3) Fallback cwd (tests / harness)
  try {
    const req = createAppRequire();
    return req("electron") as typeof import("electron");
  } catch (e) {
    errors.push(`cwd: ${e instanceof Error ? e.message : e}`);
  }

  throw new Error(
    `@creezio/electron-shell: require('electron') indisponible (${errors.join(" | ")})`,
  );
}
