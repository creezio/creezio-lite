# packages/sites-adapter — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs sites-adapter` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/context.ts`](../src/context.ts) | Contexte D1, droits, validation de texte et journal transactionnel. |
| [`src/demo.ts`](../src/demo.ts) | Persistance D1 des scénarios et préférences du handler natif. |
| [`src/index.ts`](../src/index.ts) | Entrée API native, identité Sites et composition du kernel. |
| [`src/nav.ts`](../src/nav.ts) | Catalogue web et persistance atomique des overrides du module natif. |
| [`src/support.ts`](../src/support.ts) | Dépôt D1 des tickets et messages pour le handler support natif. |
| [`src/tasks.ts`](../src/tasks.ts) | Contrat du kanban humain sur D1, sans runner simulé. |
