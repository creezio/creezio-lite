# Phase N2 — Jumeaux hosts → kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-N1p.md](PHASE-N1p.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N1p SHA** | `16b61f7` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

SoT utilitaires host / ai-workspace / meili-indexer (+ suite cohérence) dans
`@creezio/electron-shell` — extraction TF gold, injection marque via bindings.
Embeds / sandbox / hermes·n8n launchers déjà SoT (B2) — documentés, non
re-dupliqués. **Sans cutover marques** (→ N2p).

**Paperclip = mort** — aucun artefact introduit.

---

## Inventaire fichiers (kit)

### Nouveaux / portés — `@creezio/electron-shell`

| Module kit | Source TF | LOC (`wc -l`) | Notes |
|------------|-----------|---------------|-------|
| `host/crash-reporter.ts` | `crash-reporter.ts` | 236 | `configureCrashReporter` endpoint/env/fleet hook |
| `host/web-telemetry.ts` | `web-telemetry.ts` | 107 | instrumentWebContents |
| `host/bridge-client.ts` | `bridge-client.ts` | 183 | `sessionCookieName` injectable |
| `host/server-launcher.ts` | `server-launcher.ts` | 92 | `startBrandNextServer` → `startNextServerCore` |
| `host/ai-workspace/bindings.ts` | *(nouveau)* | 98 | `configureAiWorkspaceHost` |
| `host/ai-workspace/types.ts` | *(nouveau)* | 43 | contrats supplier-tabs mince |
| `host/ai-workspace/manager.ts` | `ai-workspace-manager.ts` | 611 | partitions/cookie via bindings |
| `host/ai-workspace/actions.ts` | `ai-workspace-actions.ts` | 266 | hooks marque ensure/supplier |
| `host/ai-workspace/screencast.ts` | `ai-screencast.ts` | 288 | |
| `host/ai-workspace/profile-window.ts` | `ai-profile-window.ts` | 122 | titre `productName` |
| `host/meili/index-schema.ts` | `meili-index-schema.ts` | 81 | catalogue TF gold |
| `host/meili/coherence-db.ts` | `meili-coherence-db.ts` | 162 | better-sqlite3 via cwd |
| `host/meili/coherence.ts` | `meili-coherence.ts` | 171 | `configureMeiliCoherencePaths` |
| `host/meili/coherence-query.ts` | `meili-coherence-query.ts` | 20 | CLI spawn |
| `host/meili/indexer.ts` | `meili-indexer.ts` | 818 | indexeur catalogue TF gold |

**Total modules N2 portés** : ~3384 LOC (hors barrels index).

### Déjà SoT (B2) — non re-extraits

| Module kit | Source TF historique |
|------------|----------------------|
| `platform-core/embeds/hermes-embed.ts` | `hermes-embed.ts` |
| `platform-core/embeds/n8n-embed.ts` | `n8n-embed.ts` |
| `platform-core/embeds/embed-env-catalog.ts` | `embed-env-catalog.ts` |
| `platform-core/embeds/embed-stack-hooks.ts` | `embed-stack-hooks.ts` |
| `electron-shell/host/sandbox/*` | `os-sandbox` / `embed-sandbox` |
| `electron-shell/host/hermes/*` + `n8n/*` | launchers / bootstraps |
| `shell/create-desktop-api.ts` + `ipc-channels` | preload noyau (+ canaux `aiWorkspace` N2) |

⚠️ Preload packagé (extraResources) : ne pas `require` le kit depuis
`preload-app.js` non bundlé — cutover preload = N2p (+ esbuild si besoin).

---

## Pattern injection

```ts
configureCrashReporter({
  defaultEndpoint: "https://…/crash-…",
  endpointEnvKey: "TF2_CRASH_ENDPOINT",
});

configureAiWorkspaceHost({
  productName: "TempoFlow",
  sessionCookieName: "tempoflow2_crm_session",
  aiPartitionSlug: "tempoflow-ai",
  shareWebSessionsEnvKey: "TF2_AI_SHARE_WEB_SESSIONS",
  sessionStoragePrefix: "tempoflow-ai-workspace",
  preloadPath, createSupplierTabs, reportCrash, instrumentWebContents,
  onWorkspaceEnsured, executeSupplierAction,
});

configureMeiliCoherencePaths({
  dbPath, nodeBinary, nodeScript, nodeModulesPathForScripts,
});
```

---

## Exclu (N2p / suite)

- Cutover TF / Certivan / Fidu (delete jumeaux + imports kit)
- Seeds Hermes / n8n-api-key / agent-isolation
- `supplier-tabs` / `supplier-driver` (métier)
- Assistant UI / Admin Plugins
- Indexeurs Meili métier CV (dossiers/véhicules) et Fidu GED — restent marque
  jusqu'à adaptation N2p (kit = catalogue TF gold + cohérence générique)

---

## Gates

```bash
cd /opt/docker/creezio
npm run build -w @creezio/electron-shell && npm run build:cjs
npm test   # incl. test-phase-n2
```

### Gate `test-phase-n2`

- Modules host listés présents + exports `index.ts`
- `configureAiWorkspaceHost` / `configureMeiliCoherencePaths` / `configureCrashReporter`
- Embeds B2 toujours exportés platform-core
- Paperclip mort
- PLAN-N N2 marqué livré

---

## Done

| Critère | Preuve |
|---------|--------|
| Extraction kit + build ESM/CJS | ✅ |
| Gate `test-phase-n2` | ✅ |
| Cutover marques | Non (N2p) |
| Republish packing | Non |

---

## Suite

**N2p** — Cutover hosts (TF → Certivan → Fidu) — ✅ [PHASE-N2p.md](PHASE-N2p.md).
