# Phase M10 — Un seul arbre métier TF

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `tempoflow2` (+ doc kit) |
| **Prérequis** | [PHASE-M9.md](PHASE-M9.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non |

---

## Objectif

Une seule arborescence métier TF : pas de doublon fichiers
`crm/modules/<métier>` vs `crm/electron/modules/<métier>`.

---

## État

| Élément | Preuve |
|---------|--------|
| `crm/modules` | **symlink** → `electron/modules` (inode unique) |
| SoT compilé | `electron/modules/` (`electron-tsconfig`) |
| Mounts métier | `panier`, `dispatch`, `releves`, `catalogue`, `stack`, `scan` |
| Aliases / tools MCP brand | `mcp-aliases.ts`, `mcp-tools.ts` (métier, post-M9) |
| Plateforme MCP | absente des modules (M9) |

Aucun second arbre physique à supprimer : la discoverabilité `crm/modules`
reste le symlink (pas une copie).

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Pas de couple fichiers métier distincts modules↔electron/modules | ✅ même inode |
| `modules` = symlink vers `electron/modules` | ✅ |
| Gates H3 / panier-sku / dispatch | ✅ |
| PHASE-M10.md | ✅ |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m10
cd /opt/docker/tempoflow2/crm
npm run electron:compile \
  && npm run test:phase-h3 \
  && npm run test:panier-sku \
  && npm run test:dispatch \
  && npm run electron:compile
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `0a1716c` |
| TF `tempoflow2` | `d323bc2` |

---

## Suite

**M11** — SQLite core layout / migrations cœur.
