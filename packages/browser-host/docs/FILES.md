# packages/browser-host — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs browser-host` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/smoke-live.mjs`](../scripts/smoke-live.mjs) | Smoke live browser-host : lance Chromium (profil temporaire), ouvre une page HTML locale, exécute list_targets / click / type / read / screenshot via le driver partagé, capture 2+ frames de screencast. |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/ai-session-host.ts`](../src/ai-session-host.ts) | Sessions IA côté serveur (parité `ai-workspace/manager.ts` Electron, sans fenêtre) : un Chromium persistant par collaborateur IA (`{browserDataRoot}/<aiUserId>`), tools `external_*` + screencast. |
| [`src/browser-host.ts`](../src/browser-host.ts) | Hôte Chromium sidecar : un process Chromium PAR PROFIL (user-data-dir persistant), pages pilotées en CDP websocket (protocole plat). |
| [`src/browser-screencaster.ts`](../src/browser-screencaster.ts) | Screencast des sessions IA sidecar (parité AiScreencaster Electron) : frames JPEG via `Page.startScreencast` CDP, poussées au hub. |
| [`src/cdp-connection.ts`](../src/cdp-connection.ts) | Client CDP websocket minimal (protocole plat, sessions Target.attachToTarget flatten:true) — WebSocket natif Node ≥ 22, zéro dépendance. |
| [`src/chrome-ua.ts`](../src/chrome-ua.ts) | User-Agent cohérent pour le sidecar Chromium serveur (même intention que `chrome-ua.ts` d'electron-shell : masquer le marqueur automatisation). |
| [`src/chromium-process.ts`](../src/chromium-process.ts) | Spawn / supervision du binaire Chromium (sidecar serveur, sans Electron). |
| [`src/driver-scripts.ts`](../src/driver-scripts.ts) | Scripts in-page du driver sites externes — SOURCE OF TRUTH partagée. |
| [`src/index.ts`](../src/index.ts) | @creezio/browser-host — navigateur Chromium sidecar serveur (sans Electron). |
| [`src/screencast-hub.ts`](../src/screencast-hub.ts) | Hub screencast des espaces IA — jumeau headless du hub kit `@creezio/shell-ui/ui/lib/ai-screencast-hub.ts` (celui-ci vit dans le process Next des forks TF2 ; ce module vit dans le process harness/serveur). |
| [`src/shared-driver.ts`](../src/shared-driver.ts) | Driver `external_*` / `ui_*` PORTABLE — logique unique Electron ↔ Chromium sidecar derrière l'interface `CdpTransport`. |
