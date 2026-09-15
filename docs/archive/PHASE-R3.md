# Phase R3 — Electron host cutover (`@creezio/electron-shell`)

| | |
|--|--|
| **Statut** | ✅ **Sign-off R3.3** (launchers lourds + stubs TF) |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-R2.md](PHASE-R2.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish exe TF** | **Non** (cutover lib + vendor ; pas de nécessité) |
| **Kit SHA** | `0c654ba` |
| **TF SHA** | `16fab4f` |

---

## Objectif

Couper TempoFlow du **fork shell/host** : consommer
`@creezio/electron-shell` (SoT kit) avec **hooks brand** (labels, feeds,
paths, basename logs), sans réécrire un 3ᵉ launcher Hermes/n8n et sans
casser les chemins produit gold.

**Intention** : commun = kit ; TF = min métier ; **extraire**, ne pas inventer.

---

## Plan de cutover (ordre obligatoire)

| Étape | Contenu | Statut |
|-------|---------|--------|
| **R3.0** | Doc + inventaire forks TF vs kit | ✅ |
| **R3.1 MVP shell** | `logger` / `splash-ui` / `tray` / `updater` / `window-chrome` → kit | ✅ |
| **R3.2 Hosts légers** | `meili-launcher` → kit `startMeili` + paths/sandbox/crash | ✅ |
| **R3.3 Launchers lourds** | Hermes / n8n / tunnel / node / npm via factories kit + hooks | ✅ |
| **R3.4 Verify** | compile + smokes shell | ✅ |
| **R3.5 Push** | kit + TF ; vendor sync | ✅ |

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `docs/PHASE-R3.md` + plan cutover | ✅ |
| 2 | Kit logger : `scoped` / `recentLines` / `logFileTail` + format TF | ✅ |
| 3 | Kit splash HTML riche + `cssPrefix` / `runtime` step option | ✅ |
| 4 | Kit window-chrome IDs préfixés ; tray setup sync CJS-safe | ✅ |
| 5 | TF stubs shell → `@creezio/electron-shell` | ✅ |
| 6 | TF `meili-launcher` → kit | ✅ |
| 7 | `scripts/test-phase-r3.mjs` | ✅ |
| 8 | Smokes TF verts (ops / splash / updater / node / main-graph / hermes / n8n) | ✅ |
| 9 | Push kit + TF | ✅ |
| 10 | Kit `createHermesHost` / `createN8nHost` (gold TF porté) + hooks ctx | ✅ |
| 11 | Exports `N8nAgentKeysHooks` / `clear*WebuiPassword` | ✅ |
| 12 | TF `host-runtime-ctx.ts` + stubs hermes/n8n/tunnel/node/npm | ✅ |

---

## Frontière

| Dans `@creezio/electron-shell` | Reste TF (marque / vertical) |
|--------------------------------|------------------------------|
| logger, splash modèle+HTML, tray, updater, window-chrome | Labels splash, `cssPrefix: tf`, feed/onTrack/fleet updater |
| `startMeili` | Injection paths + sandbox + crash-reporter |
| `createHermesHost` / `createN8nHost` / `createTunnelService` / node / npm | Hooks : seeds Hermes, bridge CRM, n8n-api-key, agent keys, provision tunnel |
| Control plane host (C7) | plugin-git/data vertical |

---

## Hooks brand TempoFlow

| Hook | Source |
|------|--------|
| `logBasename` | `tempoflowManifest.logBasename` → `tempoflow-main` |
| Tray / splash productName | `tempoflowManifest.client.productName` |
| Feed updater | `client.feedUrl` / `server.feedUrl` via `resolveAppKind` |
| Splash labels | catalogue / Node TempoFlow + `includeRuntime: true` |
| cssPrefix chrome | `"tf"` |
| Meili | `meiliBinary` / `meiliDataDir` / `applyOsSandboxEnv` / `reportCrash` |
| R3.3 `tfHostRuntimeContext` | `seedHermesSkills`, `getHermesBridgeEnv`, `onN8nReady`→`ensureN8nApiKey`, `agentKeys`, tunnel provision TF |

---

## Forks restants (après R3.3)

| Module TF | Action |
|-----------|--------|
| `hermes-launcher.ts` | ✅ stub → `tfHermesHost()` |
| `n8n-launcher.ts` | ✅ stub → `tfN8nHost()` |
| `tunnel.ts` | ✅ stub → `tfTunnelService()` |
| `node-runtime.ts` / `npm-cli.ts` | ✅ stubs → kit + `tfHostRuntimeContext()` |
| `host-stack.ts` | **garde** lazy graphe client (filtre host-only) |
| `local-config.ts` | store module TF exposé comme `LocalConfigStore` |
| `admin-window.ts` | thin wrapper kit (+ `destroy` TF) |

**Interdit respecté** : pas de 3ᵉ launcher ; chemins Hermes→Product Hub / n8n gold intacts (SoT kit).

---

## Cutover TempoFlow (ops)

```bash
cd /opt/docker/creezio && npm run build -w @creezio/electron-shell && npx tsc -p packages/electron-shell/tsconfig.cjs.json
cd /opt/docker/tempoflow2/crm && npm run electron:sync-vendor   # liste complète, pas un seul package
npm run electron:compile
npm run test:ops-journal && npm run test:hermes-embed && npm run test:n8n-embed
npm run test:node-runtime && npm run test:electron-main-graph
```

⚠️ `CREEZIO_VENDOR_PACKAGES=electron-shell` seul **vide** le vendor — toujours sync baseline complète.

---

## Suite

**R4** — Observabilité unifiée (`@creezio/observability` ← ops-journal TF) — voir [PHASE-R4.md](PHASE-R4.md).

---

## Verdict

**Phase R3.3 : TERMINÉE.** TempoFlow consomme `@creezio/electron-shell` pour
shell + meili + launchers Hermes/n8n/tunnel/node/npm via factories +
`host-runtime-ctx` (hooks marque) ; stubs TF sans 3ᵉ launcher.
