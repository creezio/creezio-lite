# packages/desktop-tooling — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs desktop-tooling` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/after-pack.cjs`](../scripts/after-pack.cjs) | Hook electron-builder afterPack — générique multi-marque. Port de `crm/scripts/electron/after-pack.cjs` (TF2 0.10.26). |
| [`scripts/build-server.mjs`](../scripts/build-server.mjs) | Assemble le serveur Next standalone dans build/server/ pour afterPack. |
| [`scripts/desktop-build-status.mjs`](../scripts/desktop-build-status.mjs) | CLI statut build Windows (état/phase/versions/process/log) via `collectDesktopBuildStatusFromArgv`. |
| [`scripts/e2e-browser-parcours.mjs`](../scripts/e2e-browser-parcours.mjs) | E2E navigateur générique (marque from-prd / sandbox) — sans hôte Windows. |
| [`scripts/ensure-linux-icons.mjs`](../scripts/ensure-linux-icons.mjs) | electron-builder Linux CollectIcons exige `resources/icons/{N}x{N}.png`. |
| [`scripts/ensure-linux-native-modules.mjs`](../scripts/ensure-linux-native-modules.mjs) | Rebuild better-sqlite3 ELF pour Electron courant (après ensure-win-native MZ). |
| [`scripts/ensure-win-native-modules.mjs`](../scripts/ensure-win-native-modules.mjs) | Prépare better-sqlite3 win32 (PE) avant pack:win cross-compilé depuis Linux. |
| [`scripts/load-local-env.mjs`](../scripts/load-local-env.mjs) | Charge `<appRoot>/.env` (gitignoré) dans process.env. N’écrase pas une variable déjà définie dans le shell. |
| [`scripts/meili-list-poll.mjs`](../scripts/meili-list-poll.mjs) | Helper SoT des smokes « créé puis listé » — cohérence éventuelle Meili : hydratation `?ids=` déterministe + polling borné (échec explicite si `engine:"meili"` sans le doc). Importé par e2e-browser-parcours et les smokes générés factory. |
| [`scripts/port-guard.mjs`](../scripts/port-guard.mjs) | Garde ports dev/test — occupé = erreur avec PID + consigne (`npm run stop` / port=0), SoT e2e + dev-stack. |
| [`scripts/publish-desktop.sh`](../scripts/publish-desktop.sh) | Publie l'installeur (NSIS win / AppImage linux) + latest*.yml vers le feed. |
| [`scripts/remote-build-win.sh`](../scripts/remote-build-win.sh) | Build Windows (NSIS) distant — générique multi-marque (AppManifest). |
| [`scripts/resolve-config.mjs`](../scripts/resolve-config.mjs) | CLI dump JSON ou export shell de la config publish (`--brand` / `--kind` / `--export-shell`). |
| [`scripts/smoke-packaged-server.mjs`](../scripts/smoke-packaged-server.mjs) | Smoke headless du serveur Electron packagé (linux-unpacked) : boot + health HTTP sans GUI. |
| [`scripts/smoke-tunnel-catalog.mjs`](../scripts/smoke-tunnel-catalog.mjs) | Smoke ops générique : provisioner tunnel + HEAD catalogue distant (optionnel). |
| [`scripts/smoke-tunnel.mjs`](../scripts/smoke-tunnel.mjs) | Smoke générique tunnel Cloudflare provisioner (toutes marques). |
| [`scripts/stage-win-bins.sh`](../scripts/stage-win-bins.sh) | Stage les binaires Windows (Meili + cloudflared) pour le packaging serveur. |
| [`scripts/verify-pack-runtime.mjs`](../scripts/verify-pack-runtime.mjs) | Gate pré-publish — clôture runtime asar : chaque `@creezio/*` requis + seeds npm (hono, better-sqlite3…) présents dans app.asar, sans require cassé. |
| [`scripts/write-app-kind.mjs`](../scripts/write-app-kind.mjs) | Pose `build/electron/app-kind.json` ({"kind":"server"\|"client"}) avant le packaging electron-builder. |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/desktop-build-status.ts`](../src/desktop-build-status.ts) | Agrège le statut build Windows d'une marque (hook JSON + feed + process). Port générique de `desktop-build-status.mjs` TF2 0.10.26. |
| [`src/fetch-feed.ts`](../src/fetch-feed.ts) | Lecture HTTP des feeds `latest.yml` (client + serveur) pour une marque. |
| [`src/index.ts`](../src/index.ts) | Façade publique `@creezio/desktop-tooling` — config publish, feeds `latest.yml`, statut build Windows. |
| [`src/parse-latest-yml.ts`](../src/parse-latest-yml.ts) | Parse minimal d'un `latest.yml` electron-updater (version, path, releaseDate, size, sha512). |
| [`src/resolve-publish-config.ts`](../src/resolve-publish-config.ts) | Résout la config publish / remote-build pour une marque + kind. Consommé par les scripts bash (JSON / export shell) et la console. |
