# Phase C2 — Certivan : fermer dualités MCP + stores

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | `certivan-app` (+ doc kit) |
| **Prérequis** | [PHASE-C1.md](PHASE-C1.md), D6 aliases |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Non** — regroupé **C8** |

---

## Objectif

Comme TempoFlow D1/C1 : **un exécuteur MCP produit** (Hono `/mcp` + façade
proxy) et **stores plateforme SoT kit** (plus N/A D6).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `mcp-runtime` + `wrapMcpFacadeWithHonoProxy` | ✅ |
| 2 | `setMcpUpstream` après Next (main) | ✅ |
| 3 | `src/lib/platform-stores/*` cutover | ✅ |
| 4 | Auth kit-first + chat-db façade + bridge tasks/mails | ✅ |
| 5 | `test:phase-c2` (mcp + stores) | ✅ |
| 6 | Vendor sync | ✅ |
| 7 | Ce fichier — D6 supersédé | ✅ |

## Critères done

- [x] Un seul chemin MCP produit exécuté (Hono) ; façade = proxy/adaptateur
- [x] Pas de dual-write / shadow stores actifs (contrat cutover)
- [x] Tests C2 verts
- [x] Doc N/A dualités retirée (→ C2)

## Suite

→ **C3 livrée** : [PHASE-C3.md](PHASE-C3.md) · **C6** RTI API (//) · **C5** Fidu mounts.

## Verdict

**Phase C2 : TERMINÉE.**
