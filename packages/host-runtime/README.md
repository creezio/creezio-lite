# @creezio/host-runtime

**Host runtime Node pur** du kit Creezio, extrait de
`@creezio/electron-shell` en P1.b (déménagement pur, zéro changement de
comportement runtime). C'est le socle qu'exécutent le desktop Electron ET
le serveur Docker headless — sans jamais importer Electron statiquement.

## Contenu

- `src/logger.ts` — journal main (`initLogger`, `log`, `logError`…).
- `src/load-electron.ts` — chargement dynamique lazy d'Electron
  (`loadElectron()`), unique porte d'entrée vers `require("electron")`.
- `src/server-launcher.ts` / `src/server-env.ts` — lancement Next marque.
- `src/brand-kernel-http.ts` — kernel HTTP marque (`listenBrandKernelHttp`).
- `src/brand-host-stack.ts` / `src/brand-host-runtime.ts` — stack host
  marque (Hermes, n8n, plugins, tunnel, Meili via `@creezio/search`).
- `src/hermes/` — launcher Hermes, clé CRM, seed skills, bootstrap runtime.
- `src/n8n/` — launcher n8n, API key, isolation agents.
- `src/plugins/` — host plugins complet (launcher, control-plane, git,
  data, accept-check, test-runner, bindings marque).
- `src/tunnel/` — cloudflared in-process + respawn.
- `src/sandbox/` — sandbox OS + embeds.
- `src/ai-workspace/` — workspace navigateur IA (manager, actions,
  screencast, profil). H11 : `preload.js` obligatoire, pas de fallback
  `preload-app.js`.
- `src/plugins/brand-bindings.ts` — clés env plugins = préfixe manifeste
  uniquement (H11 : plus d'alias `TEMPOFLOW_*`).
- `src/node-runtime.ts`, `src/npm-cli.ts`, `src/ensure-kit-binaries.ts` —
  outillage Node/npm/binaires kit (Meili, cloudflared).
- `src/crash-reporter.ts`, `src/bridge-client.ts`, `src/contracts.ts`,
  `src/context.ts`, `src/safe-storage.ts`, `src/local-config.ts`,
  `src/feature-off-host.ts`, `src/factory-reset-runtime.ts`.

## Frontières

- Node pur — zéro import statique `electron` (gate
  `test-phase-host-no-electron`) ; valeurs Electron via `loadElectron()`.
- Dépend de `@creezio/search` (Meili), `@creezio/platform-core`,
  `@creezio/product-hub`, `@creezio/brand-config`, `@creezio/observability`,
  `@creezio/browser-host`. `@creezio/electron-shell` dépend de ce package —
  jamais l'inverse.
- Les binaires/vendor kit (`resources/vendor`, `resources/scripts`,
  `resources/bin`) sont shippés ICI et résolus par
  `kitOsResourcesRoot()` (platform-core).

## Compat

H12 (0.24.0) : les ré-exports de compat `@deprecated` d'electron-shell ont
été supprimés — ce package est l'UNIQUE point d'import du host Node pur.
Migration marques : codemod `scripts/codemods/H12/` (`creezio upgrade`).
Les alias host nommés marque (ensure node « première marque », pins TF2,
sandbox paths) ont été purgés au profit des noms `Desktop*` génériques.

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
