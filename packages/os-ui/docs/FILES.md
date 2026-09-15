# packages/os-ui — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs os-ui` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `routes/admin/access/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/access/page.tsx`](../routes/admin/access/page.tsx) | Page admin « Rôles & accès » (wrapper AccessAdminClient @creezio/access-control/ui) |

## `routes/admin/analytics/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/analytics/page.tsx`](../routes/admin/analytics/page.tsx) | Admin analytics (wrapper `@creezio/observability/ui`) |

## `routes/admin/api/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/api/page.tsx`](../routes/admin/api/page.tsx) | Admin API endpoints (wrapper `@creezio/observability/ui`) |

## `routes/admin/database/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/database/page.tsx`](../routes/admin/database/page.tsx) | Admin Database (wrapper `@creezio/database/ui`) |

## `routes/admin/integrations/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/integrations/page.tsx`](../routes/admin/integrations/page.tsx) | Wrapper page OS `/admin/integrations` → `IntegrationsClient` (`@creezio/integrations/ui`). |

## `routes/admin/mcp/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/mcp/page.tsx`](../routes/admin/mcp/page.tsx) | Admin MCP (`McpAdminClient` + `logsSlot` RequestLogsClient) |

## `routes/admin/nav/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/nav/page.tsx`](../routes/admin/nav/page.tsx) | Page admin « Navigation » (wrapper NavAdminClient @creezio/nav/ui) |

## `routes/admin/plugins/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/plugins/page.tsx`](../routes/admin/plugins/page.tsx) | Admin plugins (Product Hub) |

## `routes/admin/request-logs/`

| Fichier | Rôle |
|---|---|
| [`routes/admin/request-logs/page.tsx`](../routes/admin/request-logs/page.tsx) | Admin request-logs (wrapper `@creezio/observability/ui`) |

## `routes/cockpit/`

| Fichier | Rôle |
|---|---|
| [`routes/cockpit/page.tsx`](../routes/cockpit/page.tsx) | Cockpit (wrapper `@creezio/cockpit/ui`) |

## `routes/collaborateurs/`

| Fichier | Rôle |
|---|---|
| [`routes/collaborateurs/page.tsx`](../routes/collaborateurs/page.tsx) | Gestion collaborateurs (OS) |

## `routes/configuration/`

| Fichier | Rôle |
|---|---|
| [`routes/configuration/page.tsx`](../routes/configuration/page.tsx) | Configuration OS |

## `routes/developers/`

| Fichier | Rôle |
|---|---|
| [`routes/developers/page.tsx`](../routes/developers/page.tsx) | Espace développeurs / MCP (`McpAdminClient` + `logsSlot` RequestLogsClient) |

## `routes/granola/`

| Fichier | Rôle |
|---|---|
| [`routes/granola/page.tsx`](../routes/granola/page.tsx) | Wrapper page OS `/granola` → `GranolaClient` (`@creezio/granola/ui`). |

## `routes/grokbot/`

| Fichier | Rôle |
|---|---|
| [`routes/grokbot/page.tsx`](../routes/grokbot/page.tsx) | Wrapper page OS `/grokbot` → `GrokbotClient` (`@creezio/grokbot/ui`). |

## `routes/login/`

| Fichier | Rôle |
|---|---|
| [`routes/login/page.tsx`](../routes/login/page.tsx) | Page login OS (wrapper `@creezio/auth/ui`) |

## `routes/mails/`

| Fichier | Rôle |
|---|---|
| [`routes/mails/page.tsx`](../routes/mails/page.tsx) | Webmail (wrapper `MailWorkspace` @creezio/mails/ui) |

## `routes/mcp/`

| Fichier | Rôle |
|---|---|
| [`routes/mcp/page.tsx`](../routes/mcp/page.tsx) | Console MCP (`McpAdminClient` + `logsSlot` RequestLogsClient) |

## `routes/onboarding/`

| Fichier | Rôle |
|---|---|
| [`routes/onboarding/page.tsx`](../routes/onboarding/page.tsx) | Fallback OS : `redirect("/")` si pas de page métier marque (jamais de placeholder mort) |

## `routes/parametres/`

| Fichier | Rôle |
|---|---|
| [`routes/parametres/page.tsx`](../routes/parametres/page.tsx) | Paramètres |

## `routes/parametres/email/`

| Fichier | Rôle |
|---|---|
| [`routes/parametres/email/page.tsx`](../routes/parametres/email/page.tsx) | Paramètres email owner (wrapper `MailSettings` @creezio/mails/ui) |

## `routes/server-cockpit/`

| Fichier | Rôle |
|---|---|
| [`routes/server-cockpit/page.tsx`](../routes/server-cockpit/page.tsx) | Cockpit serveur (wrapper `@creezio/cockpit/ui`) |

## `routes/settings/`

| Fichier | Rôle |
|---|---|
| [`routes/settings/page.tsx`](../routes/settings/page.tsx) | Settings desktop |

## `routes/setup/`

| Fichier | Rôle |
|---|---|
| [`routes/setup/page.tsx`](../routes/setup/page.tsx) | Setup first-run (wrapper `@creezio/onboarding/ui`) |

## `routes/support/`

| Fichier | Rôle |
|---|---|
| [`routes/support/page.tsx`](../routes/support/page.tsx) | Wrapper page OS `/support` → `SupportClient` (`@creezio/support/ui`). |

## `routes/taches/`

| Fichier | Rôle |
|---|---|
| [`routes/taches/page.tsx`](../routes/taches/page.tsx) | Kanban tâches (wrapper `@creezio/tasks/ui`) |

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/materialize.mjs`](../scripts/materialize.mjs) | CLI `creezio-materialize-os-ui` — copie `routes/` vers `ui/app/(creezio-os)/` d'une marque (dossier gitignoré côté marque) |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/boot-types.ts`](../src/boot-types.ts) | Types `CreezioUiBoot` pour le barrel `@creezio/os-ui` (tsc NodeNext) — l'implémentation React + `InteractiveDemoRoot` reste `boot.tsx` (export `./boot`, source Next) |
| [`src/boot.tsx`](../src/boot.tsx) | `CreezioUiBoot` — boot client OS : identité desktop (`desktopApiGlobal`, `productName`, `publicHostSuffix`) + `configureShellUiBrand` + `InteractiveDemoRoot` (démo interactive native, lanceur sidebar) |
| [`src/index.ts`](../src/index.ts) | Exports : `CreezioUiBoot`, `OS_UI_ROUTE_SEGMENTS`, `OS_PRIMARY_NAV_SEGMENTS`, `OS_UI_HORS_NAV_JUSTIFICATIONS`, `OS_UI_ROUTE_GROUP` (`(creezio-os)`) |
