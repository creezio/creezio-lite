# Phase D3 — TempoFlow scan + feature gates + republish

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `tempoflow2` tip `a7269bb`+ |
| **Prérequis** | [PHASE-D2.md](PHASE-D2.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Oui** — Client + Serveur **0.10.31** |

---

## Objectif

1. Scan : API métier réelle (resolve/search/add-to-panier) + doc produit figée
2. Feature-parity D3 (D1 MCP + D2 stores + scan)
3. Bump + remote-build publish (runtime D1/D2/D3)

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `createScanMount` resolve/search/add-to-panier | ✅ |
| 2 | MCP `module.scan.search` / `add_to_panier` | ✅ |
| 3 | `SCAN-PRODUCT-D3.md` + `FEATURE-PARITY-TF-D3.md` | ✅ |
| 4 | Tests `test:phase-d3` + gates | ✅ |
| 5 | Bump **0.10.31** | ✅ |
| 6 | `remote-build-win.sh --publish` + SHA feeds | ✅ |

## Feeds 0.10.31

Base : `https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/`

| Artefact | URL | SHA256 |
|----------|-----|--------|
| **Client** | [TempoFlow-Setup-0.10.31.exe](https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/TempoFlow-Setup-0.10.31.exe) | `80dfad195a1bd18f0cc4ae373a6922c9f246e81439a3f9784bed71be42b47bde` |
| **Serveur** | [TempoFlow-Server-Setup-0.10.31.exe](https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/server/TempoFlow-Server-Setup-0.10.31.exe) | `84b3892e20ef0c390a4da692e5b5879c45f7d2d762e19a02d3d4fae1d78f8ad6` |

`latest.yml` client + serveur → version **0.10.31**.

## Verdict

**Phase D3 : TERMINÉE.** Suite : **D4** (Fidu control-plane HTTP).
