# Phase O8 — Gates anti-façade permanents

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (gates) |
| **Prérequis** | [PHASE-O7.md](PHASE-O7.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O7** | kit `4faefa7` / tip `a964f17` · TF `9934848` · CV `54bb924` · Fidu `c3ccbdd` |
| **Kit tip O8** | `8b7f0ef` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

N8 autorisait façades ≤40 LOC — **O8 les interdit**. Plafonds O7
permanents. **Façades / stubs / jumeaux = NON done.** Paperclip = mort.

**Exclu** : rewrite métier TF supplier ; cutover jumeaux lib/UI (O9/O9p).

---

## Gates `test-phase-o8`

| Check | Règle |
|-------|--------|
| Ceilings O7 | `host-stack` ≤80 · `host-runtime-ctx` ≤100 · `preload-app` ≤120 ×3 |
| Forbidden | `brand-chat-tools`, jumeaux N8, anciens `brand-*-host`, supplier CV/Fidu |
| Re-export | 0 fichier ≤40 LOC à ≥70 % `export … from` sous `src/lib` + `electron` |
| MCP SoT | `modules/brand-mcp.ts` + `create*BrandMcp` ; bridge sans chat-tools |
| Paperclip | mort sur `main.ts` ×3 |

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-o8
```

---

## Done

| Critère | Preuve |
|---------|--------|
| `test-phase-o8` | ✅ |
| PLAN-O O8 | ✅ |
| npm test | ✅ |

---

## Suite

**O9** — Jumeaux lib/UI plateforme restants → kit.
