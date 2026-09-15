/**
 * createRequire asar-safe pour le runtime packagé.
 *
 * Piège Win Server (install-dir) : `process.cwd()` = `{installDir}` qui n’a
 * PAS de `node_modules`. Les `@creezio/*` vivent dans `app.asar`.
 * `createRequire(cwd/package.json)` → `Cannot find module '@creezio/auth'`
 * (Require stack : …\TempoFlow-Server\package.json) alors que l’asar les
 * embarque correctement.
 *
 * Ancrage : ce module (dans asar → remonte vers `node_modules/@creezio/*`),
 * puis `process.resourcesPath/app.asar`, puis cwd (dev / harness).
 *
 * `import.meta` / `__filename` via eval — dual-build ESM + CJS (TS1343).
 */

import path from "node:path";
import { createRequire } from "node:module";

function moduleAnchor(): string {
  try {
    // eslint-disable-next-line no-eval
    return eval("import.meta.url") as string;
  } catch {
    /* CJS */
  }
  try {
    // eslint-disable-next-line no-eval
    return eval("__filename") as string;
  } catch {
    return path.join(process.cwd(), "package.json");
  }
}

function canResolve(req: NodeRequire, id: string): boolean {
  try {
    req.resolve(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Require ancré pour résoudre `@creezio/*`, `better-sqlite3`, etc.
 * depuis le layout packagé (asar) ou le workspace marque.
 */
export function createAppRequire(): NodeRequire {
  const probe = "@creezio/brand-config";
  const candidates: string[] = [moduleAnchor()];

  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, "app.asar", "package.json"));
    candidates.push(path.join(resourcesPath, "app", "package.json"));
  }
  candidates.push(path.join(process.cwd(), "package.json"));

  let fallback: NodeRequire | null = null;
  for (const anchor of candidates) {
    try {
      const req = createRequire(anchor);
      if (!fallback) fallback = req;
      if (canResolve(req, probe) || canResolve(req, "@creezio/platform-core")) {
        return req;
      }
    } catch {
      /* try next */
    }
  }
  return fallback ?? createRequire(path.join(process.cwd(), "package.json"));
}
