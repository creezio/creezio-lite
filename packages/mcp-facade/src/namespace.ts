/**
 * Namespacing H4 — core.* / creezio.* · module.<owner>.* · plugin.<owner>.*
 */

import type { McpToolSpace } from "./types.js";

export type ParsedToolName = {
  space: McpToolSpace;
  ownerId?: string;
  rest: string;
};

const OWNER_RE = /^[a-z][a-z0-9_-]{0,62}$/;

/**
 * Parse un nom de tool namespacé. Retourne null si le format est invalide
 * pour la couche attendue.
 */
export function parseNamespacedToolName(name: string): ParsedToolName | null {
  if (!name || typeof name !== "string") return null;
  if (name.startsWith("creezio.") || name.startsWith("core.")) {
    return { space: "core", rest: name.replace(/^(creezio|core)\./, "") };
  }
  const mod = /^module\.([a-z][a-z0-9_-]{0,62})\.(.+)$/.exec(name);
  if (mod) {
    return { space: "module", ownerId: mod[1], rest: mod[2]! };
  }
  const plug = /^plugin\.([a-z][a-z0-9_-]{0,62})\.(.+)$/.exec(name);
  if (plug) {
    return { space: "plugin", ownerId: plug[1], rest: plug[2]! };
  }
  return null;
}

/**
 * Vérifie qu'un tool déclaré respecte le préfixe de sa `space`.
 * Les alias legacy (snake_case historique) ne passent pas ici — ils
 * passent par `registerAlias`.
 */
export function assertNamespacedToolName(
  space: McpToolSpace,
  name: string,
  ownerId?: string,
): void {
  const parsed = parseNamespacedToolName(name);
  if (!parsed) {
    throw new Error(
      `mcp_namespace_invalid: « ${name} » doit être core.*/creezio.* | module.<id>.* | plugin.<id>.*`,
    );
  }
  if (parsed.space !== space) {
    throw new Error(
      `mcp_namespace_mismatch: « ${name} » parse comme ${parsed.space}, déclaré ${space}`,
    );
  }
  if (space === "module" || space === "plugin") {
    if (!ownerId || !OWNER_RE.test(ownerId)) {
      throw new Error(`mcp_owner_invalid: ownerId requis pour space=${space}`);
    }
    if (parsed.ownerId !== ownerId) {
      throw new Error(
        `mcp_owner_mismatch: nom « ${name} » owner=${parsed.ownerId}, déclaré ${ownerId}`,
      );
    }
  }
}

/** True si le nom ressemble à un alias legacy (hors namespace H4). */
export function isLegacyAliasName(name: string): boolean {
  return parseNamespacedToolName(name) === null;
}
