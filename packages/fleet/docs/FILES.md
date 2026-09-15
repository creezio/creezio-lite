# packages/fleet — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs fleet` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/agent-tunnel.ts`](../src/agent-tunnel.ts) | T7 — surveillance respawn (bornée, miroir cloudflared-respawn) du container cloudflared DÉDIÉ agent `creezio-agent-tunnel` : politique ignore/respawn/give-up + watch docker injecté ; jamais de (re)création de tunnel CF ici. |
| [`src/agent-updates.ts`](../src/agent-updates.ts) | (à documenter) |
| [`src/docker.ts`](../src/docker.ts) | (à documenter) |
| [`src/host-agent.ts`](../src/host-agent.ts) | (à documenter) |
| [`src/index.ts`](../src/index.ts) | (à documenter) |
| [`src/instance-stack.ts`](../src/instance-stack.ts) | Stack compose par instance : rendu compose, politique update (preserve-sidecar / refuse), `hostPort` persisté et réutilisé au recreate, I/O privilégié des env_file 600. |
| [`src/priv-io.ts`](../src/priv-io.ts) | Lecture/écriture privilégiée (direct → `sudo -n` → wrapper `creezio-server-docker priv-io`) des fichiers stack root:root 600 — fail-closed, jamais chmod/chown. |
| [`src/protocol.ts`](../src/protocol.ts) | (à documenter) |
| [`src/registry-pull-proxy.ts`](../src/registry-pull-proxy.ts) | (à documenter) |
| [`src/server-admin-client.ts`](../src/server-admin-client.ts) | Client typé du backend flotte pour l'app admin (T4) : résolution env `CREEZIO_FLEET_BACKEND_URL`/`_BASIC`, `fleetBackendFetch` (Basic, timeout), helpers `fetchFleetBackendServers` / `verifyFleetHostCredential` — transport HTTP loopback conservé (backend = container séparé, seul détenteur du socket Docker) |
| [`src/server-admin.ts`](../src/server-admin.ts) | (à documenter) |
| [`src/server-lib.ts`](../src/server-lib.ts) | (à documenter) |
| [`src/types.ts`](../src/types.ts) | (à documenter) |
| [`src/update-status-store.ts`](../src/update-status-store.ts) | Persistance du suivi update-status (T8) : journal JSON atomique (tmp+rename) par process dans le répertoire d'état existant, reload au boot avec résolution via `servers.json` + flag additif `agentRestarted`, TTL 24 h sur les entrées terminées |

## `src/bin/`

| Fichier | Rôle |
|---|---|
| [`src/bin/host-agent-main.ts`](../src/bin/host-agent-main.ts) | (à documenter) |
| [`src/bin/server-admin-main.ts`](../src/bin/server-admin-main.ts) | (à documenter) |
