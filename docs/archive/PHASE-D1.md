# Phase D1 — TempoFlow : une seule stack MCP runtime

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-D0.md](PHASE-D0.md), TF **0.10.30** |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** — packing non requis pour preuve (proxy + tests offline) |

---

## Objectif

Éliminer la dualité **Hono `/mcp`** + **façade Electron** comme deux
exécuteurs : **une** implémentation produit = Hono ; façade = adaptateur
brand-mounts + **proxy** vers Hono (moindre risque OAuth / TempoFlow gold).

## Décision

| Option | Choix |
|--------|-------|
| Façade → proxy Hono | ✅ **retenu** |
| Hono → délègue façade | ❌ frontière process Next ≠ main ; façade incomplète vs 28 tools |

## Livrables TempoFlow

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Contrat `TEMPOFLOW_MCP_PRODUCT_EXECUTOR = "hono"` | ✅ |
| 2 | Aliases source unique (`electron/modules` ; `src/lib` re-export) | ✅ |
| 3 | `wrapMcpFacadeWithHonoProxy` + `setMcpUpstream` (main) | ✅ |
| 4 | Tools Hono `creezio.*` + `module.dispatch.*` (registry **28**) | ✅ |
| 5 | Docs `docs/MCP.md` architecture D1 | ✅ |
| 6 | Tests `test:phase-d1` + `test:mcp-*` / h4 / h3 / i12 verts | ✅ |

## Preuves tests

```bash
cd /opt/docker/tempoflow2/crm
npm run electron:compile
npm run test:phase-d1
npm run test:phase-h4
npm run test:mcp-admin:p0 && npm run test:mcp-admin:p1
npm run test:mcp-tasks && npm run test:mcp-base-url
npm run test:phase-h3 && npm run test:phase-i12
```

`test:mcp-oauth` = live tunnel (non bloquant hors lab).

## Zéro perte

- Surface publique `/mcp` + OAuth + API key inchangée
- Aliases legacy-preferred conservés
- Façade locale toujours dispo pour smokes offline (`mcpMode: "local-adapter"`)
- Hermes reste client HTTP de Hono

## Verdict

**Phase D1 : TERMINÉE.** Suite : **D2** (unifier stores plateforme TF).
