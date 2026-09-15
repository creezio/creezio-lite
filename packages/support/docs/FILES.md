# packages/support — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs support` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/index.ts`](../src/index.ts) | @creezio/support — support natif OS côté serveur marque : page `/support` (tickets du détenteur) + export consommé par l'app admin via le host-agent (l'admin initie tous les appels). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | Export du client React de la page /support. |
| [`ui/support-client.tsx`](../ui/support-client.tsx) | Page `/support` côté serveur marque — ouverture de tickets et lecture des réponses admin. API : `/api/v1/platform/platform-support/*`. |
