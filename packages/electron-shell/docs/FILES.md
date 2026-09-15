# packages/electron-shell — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs electron-shell` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `scripts/`

| Fichier | Rôle |
|---|---|
| [`scripts/ensure-kit-binaries.mjs`](../scripts/ensure-kit-binaries.mjs) | Téléchargement des binaires OS kit (Meili, cloudflared) sous `resources/bin` — preuves/packaging, jamais côté marque. |

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/admin-window.ts`](../src/admin-window.ts) | Fenêtre « app admin » (cockpit serveur → /dashboard). Port paramétré de electron/admin-window.ts. |
| [`src/boot.ts`](../src/boot.ts) | Façade boot Electron plateforme — structure générique (pas le métier). Les apps marques appellent `prepareDesktopBoot(manifest)` **avant** `app.requestSingleInstanceLock()` pour isoler userData Client/Serveur. Le monolithe main.ts (catalogue, tabs fournisseurs, Hermes…) reste vertical. |
| [`src/index.ts`](../src/index.ts) | @creezio/electron-shell — runtime Electron plateforme (Phase B / B.2). |
| [`src/main-facade.ts`](../src/main-facade.ts) | Façades supplémentaires pour un `main.ts` mince (Phase B.2 / G). `prepareDesktopBoot` (boot.ts) + ces helpers couvrent le shell platform avant le métier vertical (catalogue, tabs, AI workspace…). |
| [`src/splash-ui.ts`](../src/splash-ui.ts) | Splash de démarrage — modèle + HTML riche (aucun import Electron). Port brand-agnostic de electron/splash-ui.ts (TF2) — productName / bridgeName / cssPrefix. |
| [`src/tray.ts`](../src/tray.ts) | Icône Tray générique — labels depuis AppManifest.productName. Port de electron/tray.ts (TF2) — setup/refresh sync (require electron). |
| [`src/updater.ts`](../src/updater.ts) | Auto-update via electron-updater (provider generic). Port de electron/updater.ts — feed URL fourni par l'appelant (manifest). Les apps marques appellent `setupAutoUpdater({ feedUrl, … })` après boot UI. |
| [`src/window-chrome.ts`](../src/window-chrome.ts) | Chrome fenêtre frameless — HTML/CSS/JS purs. Port de electron/window-chrome-html.ts, paramétré par bridgeName + cssPrefix. |

## `src/desktop/`

| Fichier | Rôle |
|---|---|
| [`src/desktop/assistant-chrome.ts`](../src/desktop/assistant-chrome.ts) | // @ts-nocheck — Electron BaseWindow / WebContentsView (shim kit mince) Chrome assistant Electron (FAB) — gold TempoFlow paramétré (deepLink / title). Electron chargé via loadElectron (pas d'import top-level — tests kit Node). |
| [`src/desktop/brand-desktop-runtime.ts`](../src/desktop/brand-desktop-runtime.ts) | Runtime desktop plateforme — extrait mécanique de tempoflow2/crm/electron/main.ts (M12). Comportement préservé ; la marque injecte deps (store, hosts, paths, vertical). |
| [`src/desktop/desktop-session.ts`](../src/desktop/desktop-session.ts) | Session desktop légère (first-run / login / connexion) pour les apps from-prd — store local-config + handlers IPC stables, pas de store custom marque. |
| [`src/desktop/error-page-html.ts`](../src/desktop/error-page-html.ts) | Écran d’erreur boot / crash (hors React) — gold TempoFlow paramétré. |
| [`src/desktop/oauth-loopback.ts`](../src/desktop/oauth-loopback.ts) | // @ts-nocheck — Electron shell.openExternal (shim kit mince) OAuth 2.0 RFC 8252 (native apps) Google — gold TempoFlow paramétré. Store tokens injecté ; Electron via loadElectron (pas d'import top-level). |
| [`src/desktop/profile-picker-html.ts`](../src/desktop/profile-picker-html.ts) | Écran de profils au boot — gold TempoFlow paramétré (brand / bridge / tunnel). |
| [`src/desktop/remote-offline-html.ts`](../src/desktop/remote-offline-html.ts) | Écran offline du client thin : retry backoff via `testConnection`, rechargement CRM, bouton « Changer de serveur » (repasse par le picker). |

## `src/host/`

| Fichier | Rôle |
|---|---|
| [`src/host/web-telemetry.ts`](../src/host/web-telemetry.ts) | // @ts-nocheck — WebContents events Electron (shim kit volontairement mince) Télémétrie des WebContents (UI CRM + onglets fournisseurs). Couvre les plantages "invisibles" côté rendu que les handlers process-level (uncaughtException…) ne voient pas : crash du process de rendu, preload qui ne charge pas, page qui échoue à charger, page qui ne répond plus, erreurs console. Chaque anomalie est loggée localement ET envoyée au collecteur |

## `src/host/browser-tabs/`

| Fichier | Rôle |
|---|---|
| [`src/host/browser-tabs/browser-tab-driver.ts`](../src/host/browser-tabs/browser-tab-driver.ts) | // @ts-nocheck — Electron WebContents/session (shim kit mince, N7) Exécuteur des actions `external_*` (alias déprécié `supplier_*`) sur les onglets sites externes. Architecture hybride (portage de src/components/assistant/ui-driver.tsx) : - ÉNUMÉRATION / RÉSOLUTION des cibles : JavaScript exécuté dans un MONDE ISOLÉ de la page (executeJavaScriptInIsolatedWorld) — même logique que |
| [`src/host/browser-tabs/browser-tab-manager.ts`](../src/host/browser-tabs/browser-tab-manager.ts) | // @ts-nocheck — Electron WebContents/session (shim kit mince, N7) Onglets sites externes : une WebContentsView par onglet, chacune dans une partition persistante `persist:fournisseur-<id>` (cookies/sessions isolés par outil, conservés entre les lancements). Layout : la vue UI CRM occupe toute la fenêtre ; la vue site active n'occupe QUE la content area du workspace (`ContentRect` : x, y, width, |
| [`src/host/browser-tabs/browser-tab-preload-path.ts`](../src/host/browser-tabs/browser-tab-preload-path.ts) | Chemin absolu du preload onglet kit (O1 — plus de façade marque). Consommé en CJS Electron (`dist-cjs`) — `__dirname` = dossier émis. |
| [`src/host/browser-tabs/browser-tab-preload.ts`](../src/host/browser-tabs/browser-tab-preload.ts) | Preload onglet navigateur (WebContentsView) — gold TF `preload-supplier`. Volontairement MINIMAL : contextIsolation + sandbox actifs, rien n'est exposé au site tiers. Le pilotage bot passe par CDP + monde isolé (browser-tab-driver), pas par ce preload. O1 : SoT kit — marques hors TF pointent ici via `browserTabPreloadPath()`. |
| [`src/host/browser-tabs/chrome-ua.ts`](../src/host/browser-tabs/chrome-ua.ts) | // @ts-nocheck — Electron WebContents/session (shim kit mince, N7) User-Agent cohérent pour toutes les vues (CRM + onglets fournisseurs). Objectif : ne PAS exposer le token `Electron/x.y` ni le nom de l'app dans l'UA (certains sites le refusent), tout en restant COHÉRENT avec les Client Hints (`Sec-CH-UA`) que Chromium renseigne déjà (brands Chromium). |
| [`src/host/browser-tabs/fake-cursor-inject.ts`](../src/host/browser-tabs/fake-cursor-inject.ts) | Script injectable (monde isolé fournisseur) — même curseur visuel que le chatbot CRM (`server/ui/components/assistant/fake-cursor.ts` côté repo marque — SVG + badge IA + halo de clic). Nécessaire car la WebContentsView fournisseur est AU-DESSUS de la vue CRM : le singleton DOM du chatbot ne peut pas peindre par-dessus. On réutilise donc le même design / timing dans la page fournisseur avant le clic CDP. |
| [`src/host/browser-tabs/index.ts`](../src/host/browser-tabs/index.ts) | Onglets sites externes génériques (N7). Vocabulaire natif = site externe / BrowserTab — pas « fournisseur » (métier TF). Alias Supplier* conservés dépréciés pour compat marques. |
| [`src/host/browser-tabs/tab-load-state.ts`](../src/host/browser-tabs/tab-load-state.ts) | Machine d'état pure du chargement d'onglet site externe (WebContentsView). Objectif UX : spinner React uniquement pour un chargement **intentionnel** (openTab / loadAndWait → intent-load). Les navigations main-frame initiées par le site (liens, redirects SPA mal classées, History API) ne doivent PAS masquer la WebContentsView — sinon flash « Chargement du site… » et impression de reload de toute la zone contenu. Ne jamais rebloquer l'UI sur did-start-loading parasite (iframes, sous-ressources) après did-finish-load. |
| [`src/host/browser-tabs/tab-url.ts`](../src/host/browser-tabs/tab-url.ts) | Comparaison d'URL « même document » pour onglets sites externes. Garder aligné avec src/lib/tab-document-url.ts (rootDir Electron isolé). |
