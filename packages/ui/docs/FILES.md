# packages/ui — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs ui` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/client.ts`](../src/client.ts) | Client HTTP et chargement des ressources web. |
| [`src/entity-header.tsx`](../src/entity-header.tsx) | Réexport du composant original shell-ui. |
| [`src/module-view.tsx`](../src/module-view.tsx) | Grille DataTable native et formulaires des modules web. |
| [`src/system-views.tsx`](../src/system-views.tsx) | Documents, équipe, activité et gestion des espaces. |
| [`src/webmcp.ts`](../src/webmcp.ts) | Outils WebMCP des modules web, validation et nettoyage. |

## `src/upstream/`

| Fichier | Rôle |
|---|---|
| [`src/upstream/registry.ts`](../src/upstream/registry.ts) | Source conservée du kit original. |
| [`src/upstream/types.ts`](../src/upstream/types.ts) | Types publics des extensions Sites. |
