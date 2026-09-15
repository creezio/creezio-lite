/**
 * Marqueur plugins gérés par Product Hub (migration douce).
 */

import fs from "node:fs";
import path from "node:path";
import { PRODUCT_HUB_MANAGED_MARKER } from "./schema-sql.js";

export function productHubManagedPath(pluginDir: string): string {
  return path.join(pluginDir, PRODUCT_HUB_MANAGED_MARKER);
}

export function isProductHubManaged(pluginDir: string): boolean {
  return fs.existsSync(productHubManagedPath(pluginDir));
}

export function markProductHubManaged(pluginDir: string): void {
  fs.writeFileSync(
    productHubManagedPath(pluginDir),
    `${new Date().toISOString()}\n`,
    "utf8",
  );
}
