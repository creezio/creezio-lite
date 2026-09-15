# packages/granola — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs granola` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/client.ts`](../src/client.ts) | Client REST API publique Granola (notes, transcript, folders, webhook-endpoints) — `fetchImpl` injectable. **Câblé en prod** via le mount. |
| [`src/config.ts`](../src/config.ts) | `GranolaModuleConfig`, schéma SQL (`granola_settings`/`granola_events`/`granola_notes`), `granola_002_note_transcript_folder`, `granolaMigrations()`, merge défauts/override, masquage secrets. |
| [`src/index.ts`](../src/index.ts) | Surface publique du package (toute l'API passe par ici). |
| [`src/mount.ts`](../src/mount.ts) | `createGranolaMount` → `/api/v1/modules/granola/*` : webhook signé, webhook-info, register-webhook, config, events, notes, `GET notes/:id/transcript`, proxys remote/*. **Câblé par la marque** (`registerModuleApi`). |
| [`src/signature.ts`](../src/signature.ts) | Vérification Standard Webhooks (HMAC-SHA256, tolérance rejeu) + `signGranolaPayload` (tests/simulateur). |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/granola-client.tsx`](../ui/granola-client.tsx) | Page `GranolaClient` : compose `GranolaNotesPanel` + `GranolaConnectPanel`. **Câblée** via `@creezio/os-ui` (`/granola`) + sidebar OS (`defaultOsPrimaryNavItems`). |
| [`ui/granola-connect-panel.tsx`](../ui/granola-connect-panel.tsx) | Connecteur opérable — **GRANOLA-2** : santé (badges + bandeau signature), endpoints distants (list / PATCH / DELETE), livraisons filtrables, empty/error. |
| [`ui/granola-notes-panel.tsx`](../ui/granola-notes-panel.tsx) | Workspace notes (liste + fiche résumé/transcript) — **GRANOLA-1**. |
| [`ui/index.ts`](../ui/index.ts) | Export UI public (`GranolaClient`). |
