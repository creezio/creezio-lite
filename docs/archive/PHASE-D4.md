# Phase D4 — Fidu control-plane HTTP plugins

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `fidu` tip `7fffe37`+ |
| **Prérequis** | [PHASE-I18.md](PHASE-I18.md), [PHASE-D3.md](PHASE-D3.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Oui** — Client + Serveur **0.1.56** |

---

## Objectif

Lever le N/A I18 : brancher un control-plane HTTP **minimal viable**
(`startPluginControlPlane` + `createFiduControlPlaneAcl`) — pas de stub vide,
pas de sidecars spawn (GED).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `electron/plugin-control-api.ts` minimal + ACL L3 | ✅ |
| 2 | Boot `main.ts` → `startFiduPluginControlApi` | ✅ |
| 3 | E2E `test:plugin-control-api-d4` (deny/allow install) | ✅ |
| 4 | `test:plugin-acl-l3` + `test:phase-h3` + `test:fidu` verts | ✅ |
| 5 | Bump **0.1.56** + standing ship republish | ✅ |

## Feeds 0.1.56

Base : `https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/`

| Artefact | URL | SHA256 |
|----------|-----|--------|
| **Client** | [Fidu-Setup-0.1.56.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.56.exe) | `90a87751d9fd458d6ff217f09125191dddbf4db139d717f12deb93c02c48b60f` |
| **Serveur** | [Fidu-Server-Setup-0.1.56.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/server/Fidu-Server-Setup-0.1.56.exe) | `17472b139dbb6b0c99ab98561ecb3768f91cf43c496950018ed7a01a1bbf332f` |

`latest.yml` client + serveur → version **0.1.56**.

## Verdict

**Phase D4 : TERMINÉE.** Suite : **D5** (ADR clientSlim).
