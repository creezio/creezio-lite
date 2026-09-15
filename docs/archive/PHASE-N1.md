# Phase N1 — Runtime plugins Electron → kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-N0.md](PHASE-N0.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N0 SHA** | `1aac0e2` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

SoT spawn / discover wrappers / scaffold / git / control-extras (+ deps
plateforme jumelles) dans `@creezio/electron-shell` — extraction TF gold,
injection marque via `configurePluginHost`, **sans cutover** (→ N1p).

**Paperclip = mort** — aucun artefact introduit.

---

## Inventaire fichiers extraits (kit)

Source TF : `/opt/docker/tempoflow2/crm/electron/plugin-*.ts`  
Cible : `packages/electron-shell/src/host/plugins/`

| Module kit | Source TF | LOC kit (`wc -l`) | Notes |
|------------|-----------|-------------------|-------|
| `brand-bindings.ts` | *(nouveau)* | 189 | `PluginHostBindings` + `configurePluginHost` |
| `runtime.ts` | `plugin-runtime.ts` | 488 | scaffold + wrappers ; discover/types → platform-core |
| `launcher.ts` | `plugin-launcher.ts` | 626 | spawn / status / versions |
| `git.ts` | `plugin-git.ts` | 440 | MinGit + sandbox |
| `control-extras.ts` | `plugin-control-extras.ts` | 452 | `startPluginControlApi` + extras |
| `control-adapters.ts` | `plugin-control-adapters.ts` | 113 | factory générique |
| `crm-key.ts` | `plugin-crm-key.ts` | 166 | clé CRM plugin |
| `accept-check.ts` | `plugin-accept-check.ts` | 210 | smokes + G5 UI |
| `test-runner.ts` | `plugin-test-runner.ts` | 129 | `node --test` |
| `data.ts` | `plugin-data.ts` | 120 | migrations (`node:sqlite` kit) |
| `events.ts` | `plugin-events.ts` | 19 | **réexport** platform-core |
| `execution-grant.ts` | `plugin-execution-grant.ts` | 11 | **réexport** platform-core |

**Total modules N1 nouveaux / portés** : ~2963 LOC (hors host/control-plane/token préexistants).

### Déjà dans platform-core (non dupliqués)

- `plugin-manifest` (types, parse, discover, enable)
- `plugin-events` (runtime state, siteId, hooks)
- `plugin-execution-grant` (issue / verify)

---

## API parity (exports publics `@creezio/electron-shell`)

| API TF | Export kit |
|--------|------------|
| `scaffoldPlugin` / `scaffoldPluginUiCss` | ✅ |
| `discoverPlugins` / `pluginsRootDir` | ✅ (wrappers bindings) |
| `startEnabledPlugins` / `stopAllPlugins` / `enablePlugin` | ✅ |
| `createPluginScaffoldWithGit` / `writePluginFilesAndCommit` | ✅ |
| `startPluginControlApi` / `handleTempoflowExtras` | ✅ `startPluginControlApi` / `handlePluginControlExtras` (+ alias `handleBrandExtras`) |
| types git (`PluginGitCommit`, …) | ✅ |
| `runPluginAcceptCheck` / `runPluginTests` | ✅ |
| `buildTempoflowControlPlaneAdapters` | ✅ `buildPluginControlPlaneAdapters` |
| `configurePluginHost` | ✅ *(injection obligatoire)* |

Bridge env token+ctx (Phase E) reste `getPluginControlBridgeEnv(ctx)` ;
bridge API running (TF gold) → `getPluginControlApiBridgeEnv()`.

`PLUGIN_VERTICAL_REMAINING` : retiré git/data/accept-check/test-runner/crm-key ;
reste wiring marque + UI admin (N1p / N6).

---

## Pattern injection

```ts
configurePluginHost({
  envPrefix: "TEMPOFLOW",       // primaire `${envPrefix}_*`
  legacyEnvAliases: ["TF2"],    // aliases documentés TempoFlow
  productName, brandId,
  userDataDir, isPackaged, nodeBinary, nodeScript, gitBinary, n8nHomeDir,
  ensureDesktopNode, nodeMinForEmbeds, getN8nBridgeEnv, n8nDesktopPort,
  getLlmKeys, hostRuntimeContext, manifest,
  buildControlPlaneAdapters, createControlPlaneAcl,
  ensureProductHubStore, closeProductHubStore,
  apiKeyPrefix: "tf2_live_",
  // optionnel : handleBrandExtras pour métier marque
});
```

---

## Exclu (N1p / suite)

- Cutover TF / Certivan / Fidu (imports marques inchangés)
- UI Admin Plugins
- Suppression jumeaux `electron/plugin-*.ts` marques

---

## Gates

```bash
cd /opt/docker/creezio
npm run build -w @creezio/electron-shell
npm test   # incl. test-phase-n1
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Modules sous `host/plugins/` (runtime, launcher, git, control-extras, brand-bindings) | ✅ |
| Exports index + build dist | ✅ |
| `PLUGIN_VERTICAL_REMAINING` mis à jour | ✅ |
| Absence paperclipApi / startPaperclip dans kit plugins | ✅ |
| Gate `test-phase-n1` | ✅ |
| Marques TF/CV/Fidu non modifiées | ✅ |

---

## Suite

**N1p** — Cutover plugins runtime (TF → Certivan → Fidu) — ✅ [PHASE-N1p.md](PHASE-N1p.md).
