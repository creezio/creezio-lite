# packages/brand-config — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs brand-config` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/build-builder-config.ts`](../src/build-builder-config.ts) | Générateur de config electron-builder Client / Serveur à partir d'un AppManifest. Port brand-agnostic de `crm/scripts/electron/build-builder-config.mjs` (TF2 0.10.26). L'appelant fournit la config de base (YAML/JSON parsé) et reçoit les overrides. Usage typique dans une app marque |
| [`src/create-manifest.ts`](../src/create-manifest.ts) | Fabrique un AppManifest Client+Serveur à partir d'un spec minimal. Utilisé par `@creezio/factory` (Phase D) — jamais pour écraser les manifests prod TempoFlow / Certivan / Fidu. |
| [`src/index.ts`](../src/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/nsis-guid.ts`](../src/nsis-guid.ts) | GUID NSIS déterministe — même algorithme qu'electron-builder (`UUID.v5(appId, NAMESPACE_OID)`). NAMESPACE_OID = `6ba7b812-9dad-11d1-80b4-00c04fd430c8` (vérifié contre les GUID Fidu kit). |
| [`src/render-nsis-installer.ts`](../src/render-nsis-installer.ts) | Include NSIS commun client + serveur (parité TF2) — segments userData dérivés de l'AppManifest. |
| [`src/types.ts`](../src/types.ts) | Schéma AppManifest — identité d'une marque desktop Creezio. Le modèle standard est **toujours** multi-exe Client + Serveur (deux appId, deux feeds, deux GUID NSIS, deux segments userData). Ce n'est pas une option : brand-config l'exige pour chaque marque. |

## `src/manifests/`

| Fichier | Rôle |
|---|---|
| [`src/manifests/demobrand.ts`](../src/manifests/demobrand.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
