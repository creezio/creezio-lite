/**
 * @creezio/fleet — backend flotte typé (ex packages/observability/fleet-collector *.mjs).
 *
 * Barrel des briques réutilisables. Les serveurs (server-admin, host-agent)
 * sont exposés en sous-chemins dédiés pour ne pas alourdir les consommateurs :
 *   - `@creezio/fleet/server-admin`  → startServerAdmin()
 *   - `@creezio/fleet/host-agent`    → startHostAgent()
 *   - `@creezio/fleet/server-admin-main` / `host-agent-main` → exécution directe (CMD images)
 */

export * from "./protocol.js";
export * from "./types.js";
export * from "./docker.js";
export * from "./agent-tunnel.js";
export * from "./server-lib.js";
export * from "./server-admin-client.js";
export * from "./instance-stack.js";
export * from "./priv-io.js";
export * from "./agent-updates.js";
export * from "./update-status-store.js";
export * from "./registry-pull-proxy.js";
