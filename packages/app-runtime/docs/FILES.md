# packages/app-runtime — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs app-runtime` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/dev-stack.mjs`](../scripts/dev-stack.mjs) | (à documenter) |
| [`scripts/smoke-platform-surface.mjs`](../scripts/smoke-platform-surface.mjs) | Smoke live hors Docker : surface plateforme (login owner kit-first, collab IA) + sidecar navigateur IA. |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/apply-brand-module-auth.ts`](../src/apply-brand-module-auth.ts) | D8 — `applyBrandModuleAuth` : `configureAuth({ ownerPermissions })` + fusion `permissionGroups` si access-control déjà configuré |
| [`src/boot-progress.ts`](../src/boot-progress.ts) | Progression de boot headless (modèle splash partagé) — JSON `GET /api/v1/os/boot-status`, JSONL stdout, journal ops |
| [`src/brand-platform-store.ts`](../src/brand-platform-store.ts) | Store plateforme marque |
| [`src/cockpit-health.ts`](../src/cockpit-health.ts) | (à documenter) |
| [`src/compose-brand-os.ts`](../src/compose-brand-os.ts) | Composition OS natif : kernel, stores, auth, fleet (sentinelle `ingest-disabled` par défaut), surfaces |
| [`src/create-brand-kernel.ts`](../src/create-brand-kernel.ts) | Création du kernel API + auto-register mount `@creezio/nav` (migrations brand.db + `registerModuleApi("nav")`) |
| [`src/fleet-heartbeat.ts`](../src/fleet-heartbeat.ts) | Auto-inscription flotte + heartbeat (~90 s) d'un serveur marque vers le module `fleet-registry` de l'app admin (F3) — Bearer secret partagé au register, serverKey ensuite. Câblé harness + desktop serveur. |
| [`src/harness-server-phases.ts`](../src/harness-server-phases.ts) | Phases serveur post-boot du harness Docker (parité TF2 desktop) : catalogue, clé CRM Hermes + bridge n8n, plugins, tunnel, fleet — flags/env explicites, étape boot-status par phase, no-op propre si non configuré. |
| [`src/hermes-mcp-host-tools.ts`](../src/hermes-mcp-host-tools.ts) | Branche les tools host tasks (`create_ai_task`…) + workspace (`workspace.*`, `platform.ask_human`) sur la façade MCP (H1/H4) ; résolution Bearer clé service Hermes (`user_id NULL`+`full` → owner, fail-closed sinon). Câblé desktop + harness. |
| [`src/index.ts`](../src/index.ts) | Surface publique du package |
| [`src/install-brand-os-desktop.ts`](../src/install-brand-os-desktop.ts) | Installation des services OS dans le main Electron |
| [`src/listen-brand-boot-http.ts`](../src/listen-brand-boot-http.ts) | Early-listen : `boot-status`/healthz répondent pendant le boot |
| [`src/listen-brand-os-http.ts`](../src/listen-brand-os-http.ts) | Serveur HTTP OS (`/api/v1`, CRM web) |
| [`src/mcp-jsonrpc.ts`](../src/mcp-jsonrpc.ts) | Pont JSON-RPC 2.0 stateless du endpoint `/mcp` du plane OS (H1) — seuls les corps `jsonrpc:"2.0"` y passent, le transport JSON simple historique est conservé. Consommé par le client MCP natif de Hermes. |
| [`src/module-contract.ts`](../src/module-contract.ts) | SoT du contrat de module marque (P2.c/H9 + F3.4 + D8) : `BrandModuleDef` + `createBrandModuleRegistry` (collecteurs F3.4 assistant/onboarding **et** D8 `collectNavPermissions` / `collectPermissionGroups`) |
| [`src/module-mount-auth.ts`](../src/module-mount-auth.ts) | Garde session HTTP default-deny sur `/api/v1/modules/*` (BACKLOG F3) : cookie session / Bearer JWT, allowlist webhook/register/heartbeat/releases/landing public ; boot catalogue (`x-creezio-catalog-internal` = secret par processus `CREEZIO_CATALOG_INTERNAL_SECRET`, `ensureCatalogInternalSecret` — plus de constante `1`, fix P0) ; `AUTH_DISABLED` → session virtuelle harness (refusée si `NODE_ENV=production`). |
| [`src/mount-brand-admin-database.ts`](../src/mount-brand-admin-database.ts) | Enregistrement auto stores SQLite runtime (`core`/`brand`/plugins) + routes Admin Database montées sur `/api/v1/admin` |
| [`src/mount-brand-email-surface.ts`](../src/mount-brand-email-surface.ts) | Surface mails optionnelle |
| [`src/mount-brand-mcp-surface.ts`](../src/mount-brand-mcp-surface.ts) | Surface MCP/admin : OAuth (session cookie/Bearer CRM + login kit), MCP admin, Database, Analytics usage, registre endpoints (`listOperations` + Hono admin) + stub OpenAPI `/api/v1/openapi.json` |
| [`src/mount-brand-platform-surface.ts`](../src/mount-brand-platform-surface.ts) | Surface plateforme (auth/tasks/assistant/users) — autoconfig assistant + tasks kit si marque silencieuse |
| [`src/plugin-acl-wiring.ts`](../src/plugin-acl-wiring.ts) | Câblage ACL Product Hub → façade MCP pour les plugins (fail-closed : sans grant, ni visible ni appelable, sauf owner/clé service). |
| [`src/plugin-proxy-mount.ts`](../src/plugin-proxy-mount.ts) | Mount api-kernel proxy `/api/v1/plugins/<id>/*` → sidecar loopback (enregistré au start, retiré au stop → `plugin_not_mounted`). |
| [`src/plugin-seed.ts`](../src/plugin-seed.ts) | Seed des plugins embarqués marque (`<appRoot>/plugins/` → `<userData>/plugins/`) au boot — idempotent, jamais d'écrasement ni de réactivation d'un plugin désactivé. |
| [`src/plugin-tools-discovery.ts`](../src/plugin-tools-discovery.ts) | Découverte des tools MCP plugins : `plugin.<id>.status`/`.call` + tools déclarés `manifest.mcpTools` (proxy méthode/path). |
| [`src/start-brand-desktop.ts`](../src/start-brand-desktop.ts) | Boot desktop Electron complet — early crash writer, data layout packagé, splash, updater, host stack |
| [`src/start-brand-kernel-harness.ts`](../src/start-brand-kernel-harness.ts) | Boot OS sans Electron (serveur Docker headless, smokes) |
| [`src/start-brand-ui-plane.ts`](../src/start-brand-ui-plane.ts) | Plan UI (Next standalone / dev) |
| [`src/types.ts`](../src/types.ts) | Types de config (StartBrandDesktopConfig, harness…) |
| [`src/warm-brand-native-hosts.ts`](../src/warm-brand-native-hosts.ts) | Préchauffage embeds n8n/Hermes |
| [`src/wire-assistant-mcp.ts`](../src/wire-assistant-mcp.ts) | (à documenter) |
| [`src/wire-brand-browser-sidecar.ts`](../src/wire-brand-browser-sidecar.ts) | Wiring sidecar navigateur IA (AiSessionHost, proxy `CREEZIO_BROWSER_PROXY`) |
