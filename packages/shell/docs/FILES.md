# packages/shell — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs shell` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/create-crm-host-preload.ts`](../src/create-crm-host-preload.ts) | Extensions preload CRM hôte (Hermes / n8n / plugins / flotte / setup…) + télémétrie renderer — extrait gold preload-app ×3 (O7). Les canaux restent les littéraux historiques (handlers main), pas une renumérotation IpcChannels partielle. |
| [`src/create-desktop-api.ts`](../src/create-desktop-api.ts) | Fabrique l'objet exposé via contextBridge sous `window[bridgeName]`. Port structurel de electron/preload-app.ts (TF2 0.10.26) — sans hardcoder le nom du bridge. ⚠️ Préload packagé via extraResources (hors asar) : NE PAS `require` `@creezio/shell` ni le manifest depuis le preload compilé — Node ne résout pas `node_modules` depuis `resources/electron/`. Préférer un littéral `contextBridge.exposeInMainWorld("…Desktop", api)` dans le preload de l'app, ou bundler le preload (esbuild) pour inliner ce module. |
| [`src/index.ts`](../src/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/ipc-channels.ts`](../src/ipc-channels.ts) | Canaux IPC communs aux shells desktop Creezio. Extraits des preload-app.ts (TF2 0.10.26, Certivan, Fidu) — contrat de nommage partagé. Le runtime Electron (handlers) sera porté en Phase B. |
| [`src/types.ts`](../src/types.ts) | Types communs preload / renderer — abstraction des window.*Desktop. Intersection des API TempoFlow / Certivan / Fidu (noyau partagé). Les extensions verticales restent dans chaque app jusqu'à Phase B/G. |
