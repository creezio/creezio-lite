# AGENTS — @creezio/host-runtime

## Mission du package

Host runtime Node pur du kit : lancement du serveur Next marque, kernel
HTTP, stack host (Hermes, n8n, plugins, tunnel, sandbox, ai-workspace),
outillage binaires kit et crash reporter. Extrait de
`@creezio/electron-shell` en P1.b — tout nouveau code host vit ICI, plus
jamais dans electron-shell.

## Frontières absolues

- **Node pur** : aucun import statique `electron` dans `src/**` — gate
  `test-phase-host-no-electron`. L'UNIQUE exception est
  `src/load-electron.ts` (le helper lui-même). Valeurs via `loadElectron()`,
  types via `import type`.
- **Pas de vocabulaire marque** (`test-phase-no-brand-vocab`, dette héritée
  déplacée avec les fichiers — compteurs décroissants uniquement).
- Sens du graphe : dépend de `@creezio/search` (jamais l'inverse) ;
  `@creezio/electron-shell` et `@creezio/app-runtime` dépendent d'ici.
- Piège plugins (hérité) : dans `src/plugins/launcher.ts`, le handler
  `child.on("exit")` doit comparer `cur?.child === child` avant
  `running.delete(id)` — sinon un restart après PUT files efface le
  process respawné.

## Points d'entrée

- `src/index.ts` — barrel public complet.
- `src/brand-host-stack.ts` — `createBrandHostStack` (composition complète).
- `src/brand-kernel-http.ts` — `listenBrandKernelHttp` (desktop + harness
  Docker headless).
- `src/plugins/brand-bindings.ts` — `configurePluginHost` (bindings marque).
- `src/ensure-kit-binaries.ts` — binaires Meili/cloudflared
  (`resources/bin` d'electron-shell, versions alignées sur
  `docker/server/Dockerfile`).

## Comment modifier sans casser

1. Nouveau symbole public → exporter depuis `src/index.ts` d'ICI. Ne PAS
   le ré-exporter via electron-shell (les shims compat ont été purgés en
   H12 — ce package est l'unique point d'import du host).
2. Chemins ressources : `kitOsResourcesRoot()` / `kitOsVendorDir()` vivent
   dans `@creezio/platform-core` et résolvent le package
  `@creezio/host-runtime` (qui ship `resources/vendor`). Ne pas
  dupliquer cette résolution.
3. `envForNodeScriptSpawn` vit dans `@creezio/platform-core`
   (`node-spawn-env.ts`) — ré-exporté ici pour compat.
4. Zéro changement de comportement runtime sans gate : hermes
   (`test-phase-hermes-*`), plugins (`test-phase-n1`, `test-os-plugins`),
   tunnel (`test-phase-cloudflared-respawn`,
   `test-phase-tunnel-self-provision`), crash
   (`test-phase-crash-reporter`).
5. H11 — plus de dual-read env première marque ni alias password WebUI :
   `pluginEnvKeys` = `${envPrefix}_${suffix}` uniquement ; secret Hermes
   = `.{secretFilePrefix}-api-server-key` ; `AiWorkspaceManager` exige
   `preload.js` (échec explicite si absent). Ne pas réintroduire d'alias.
6. H13 — `pluginCrmKeyPath` dual-lit le nom fichier déjà déployé
   (`PLUGIN_CRM_KEY_FILE`) puis le nom dérivé `.{brandId}-plugin-api-key.json`.
   Retrait du littéral au H14 (ADR-h13-allowlist-residue). `tempoflow-npm`
   reste un dual-read de chemin disque (même ADR).

## Tests / gates liés

```bash
npm run typecheck -w @creezio/host-runtime
npm run build -w @creezio/host-runtime
node --test scripts/test-phase-host-no-electron.mjs
```

Gates : `test-phase-host-no-electron`, `test-phase-n1` (plugins),
`test-phase-n2` (jumeaux hosts), `test-phase-hermes-*`,
`test-phase-cloudflared-respawn`, `test-phase-crash-reporter`,
`test-phase-runtime-dist-freshness`, `test-phase-build-order-imports`.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- [../electron-shell/AGENTS.md](../electron-shell/AGENTS.md)
