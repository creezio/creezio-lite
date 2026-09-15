# packages/admin — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs admin` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/fleet-registry.ts`](../src/fleet-registry.ts) | Module `fleet-registry` — DB centrale de la flotte (table `admin_fleet_servers`, vue matérialisée ; les JSON `servers.json`/`fleet-hosts.json` restent la SoT des gestes Docker). Sources : sync manuel, poller, auto-inscription. Sync via le client typé `fetchFleetBackendServers` de `@creezio/fleet` (T4). |
| [`src/fleet-releases.ts`](../src/fleet-releases.ts) | Module `fleet-releases` — updates en PULL de la flotte (F5) : releases déclarées côté admin, pollées par les host-agents via le registre pull-only (F4). Vérif credential agents via `verifyFleetHostCredential` de `@creezio/fleet` (T4). |
| [`src/index.ts`](../src/index.ts) | Export public @creezio/admin — modules natifs des apps admin de marque (fleet, support, prospection, roadmap, billing). ADR-admin-app-os. |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/billing-admin-client.tsx`](../ui/billing-admin-client.tsx) | Module Billing (admin) — projections `admin_billing_*` alimentées par webhooks Stripe signés : abonnements, factures, rapprochement client ↔ serveur. |
| [`ui/fleet-admin-client.tsx`](../ui/fleet-admin-client.tsx) | Module Flotte — UI admin (design system kit) : hôtes VPS enrôlés, création serveur, start/stop/update (202 + poll), update en masse, logs. |
| [`ui/index.ts`](../ui/index.ts) | Export des clients React des modules admin natifs (Fleet, Tickets, Prospects, Billing…). |
| [`ui/module-gate.tsx`](../ui/module-gate.tsx) | `AdminModuleGate` — état explicite « Accès refusé » en URL directe sans la permission du module (même règle que la sidebar : owner bypass, sinon `me.permissions`) |
| [`ui/prospects-kanban-client.tsx`](../ui/prospects-kanban-client.tsx) | Module Prospection — kanban drag & drop générique (colonnes = champ `colonne` de `admin_prospects`, DnD HTML5 natif sans dépendance). |
| [`ui/tickets-admin-client.tsx`](../ui/tickets-admin-client.tsx) | Module Support (admin) — tickets agrégés de toute la flotte : sync pull, fil de messages, réponse relayée au serveur marque (/support). |
