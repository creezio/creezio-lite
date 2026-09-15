# Phase I14 — Feature-parity + republish TempoFlow Client+Serveur

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` tip `51ac5e5`+fix Set |
| **Prérequis** | [PHASE-I13.md](PHASE-I13.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Oui** — Client + Serveur **0.10.30** |

---

## Objectif

Clôturer le chemin TF I9–I13 : checklist parity → tests verts → bump →
`remote-build-win.sh --publish` (feeds Client + Serveur).

## Checklist

- [x] Feature-parity TF (`crm/docs/FEATURE-PARITY-TF-I14.md`)
- [x] Tests verts (h3/h4/i12/i13/acl-l3/graph/control-api + `npm run build`)
- [x] Bump patch `0.10.29` → `0.10.30`
- [x] `bash crm/scripts/electron/remote-build-win.sh --publish`
- [x] Feeds documentés ci-dessous

## Feeds 0.10.30

Base : `https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/`

| Artefact | URL | SHA256 |
|----------|-----|--------|
| **Client** | [TempoFlow-Setup-0.10.30.exe](https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/TempoFlow-Setup-0.10.30.exe) | `2528745bd6b274d34310ad53a7f304e576b34def12cbbc93c9805c1e61ab5cc9` |
| **Serveur** | [TempoFlow-Server-Setup-0.10.30.exe](https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/server/TempoFlow-Server-Setup-0.10.30.exe) | `0cff13647aa4ff5b30b5b21869f19af7a0869efc15c1dfb3b050cbd5947022cf` |

`latest.yml` client + serveur → version **0.10.30**.

## Fix build

`unified-catalog.ts` : `Array.from(TEMPOFLOW_MCP_CANONICAL_HIDDEN)` (next build
sans `downlevelIteration`).

## Verdict

**Phase I14 : TERMINÉE.** Suite : **I15** (Certivan foundation).
