# AGENTS — @creezio/browser-host

Chromium serveur pour IA (sidecar Docker). **Zéro dépendance Electron.**

## Frontières

1. **Jamais d'import `electron`** ici — ce package tourne dans le container
   Node headless. Le jumeau Electron est `electron-shell/host/ai-workspace`.
2. **`driver-scripts.ts` = SoT des helpers driver** (`DRIVER_HELPERS`,
   `FAKE_CURSOR_INJECT`). Id DOM `creezio-fake-cursor`, global
   `__creezioFakeCursor` (H13 — plus de préfixe nommé marque). La
   version Electron les importe d'ici — ne PAS forker : toute évolution
   de verbe `external_*` se fait ici puis profite aux deux mondes via
   `CdpTransport` (`shared-driver.ts`).
3. **Profils persistants** : `/data/browser/<aiUserId>` — ne pas purger le
   `user-data-dir` (sessions fournisseurs IA). Les verrous Singleton* sont
   purgés au launch (`clearStaleProfileLocks`) car le hostname change à
   chaque recréation de container.
4. **Screencast in-process** : publier via `screencast-hub.ts` (même clé
   `globalThis` que `shell-ui/ui/lib/ai-screencast-hub.ts`) — pas de POST
   HTTP interne.
5. **Allowlist web host-level (H0)** : `openTab` applique
   `checkWebHostAllowed` (@creezio/platform-core, env `*_WEB_ALLOWED_HOSTS`)
   AVANT toute session — refus `web_host_not_allowed`. Ne pas retirer : c'est
   la défense en profondeur derrière la garde UX du runner de tâches. Gate :
   `scripts/test-phase-hermes-web-allowlist.mjs`.

## Points d'entrée

- `chromium-process.ts` — spawn, args, détection binaire, ws URL.
- `browser-host.ts` — connexion CDP, `CdpPage` (navigate, cookies,
  screencast, evalIsolated).
- `ai-session-host.ts` — sessions par IA (page CRM + onglets externes),
  actions workspace/driver/ui.
- `browser-screencaster.ts` — capture + throttle + stop auto.

## Pièges

- `Page.startScreencast` : `everyNthFrame: 1` obligatoire (une page
  statique n'émet qu'une frame — la throttle applicative suffit).
- Wiring runtime : voir `app-runtime/src/wire-brand-browser-sidecar.ts`
  (exécuteurs in-process par userId IA, étape boot « Navigateur IA »).
- Gate : `scripts/test-phase-hybrid.mjs`.
