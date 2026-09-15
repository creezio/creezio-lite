/**
 * Injection host pour mcp-admin (évite imports `@/` marque).
 */

import type { McpAdminAdapters } from "./types.js";

let adapters: McpAdminAdapters | null = null;

export function configureMcpAdmin(next: McpAdminAdapters): void {
  adapters = next;
}

export function getMcpAdminAdapters(): McpAdminAdapters {
  if (!adapters) {
    throw new Error(
      "@creezio/mcp-admin: configureMcpAdmin({ getDb, getWriteDb, … }) requis avant usage",
    );
  }
  return adapters;
}

/** True si `configureMcpAdmin` a été câblé (garde opt-in non cassante). */
export function isMcpAdminConfigured(): boolean {
  return adapters !== null;
}

export function resetMcpAdminAdaptersForTests(): void {
  adapters = null;
}
