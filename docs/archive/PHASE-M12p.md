# Phase M12p — `main.ts` marques via façade kit

| | |
|--|--|
| **Statut** | ✅ **Certivan + Fidu** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `certivan-app` + `fidu` |
| **Prérequis** | [PHASE-M12.md](PHASE-M12.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Fidu packing : retrait Paperclip `extraResources` (publish si verts) |

---

## Objectif

Même façade `installBrandDesktopRuntime` que M12 (TF) sur Certivan puis Fidu :
`electron/main.ts` = composition marque ≤ **800 LOC** ; runtime plateforme SoT kit.

**Paperclip n’existe plus dans aucune marque** — aucun hook kit, aucune surface Fidu/TF/Certivan.

---

## Résultats

| Marque | `main.ts` | SHA |
|--------|----------:|-----|
| Certivan | **320** LOC | `15ae995` |
| Fidu | **303** LOC | `61b153c` (+ fix scripts / assert) |
| TempoFlow (M12) | **309** LOC | `3565524` (deps) |

## Kit

| Livrable | Note |
|----------|------|
| `BrandDesktopDeps` | pluginsDir / fid / apiKey / nodeLabel |
| Paperclip | **absent** du runtime (pas de `paperclipApi`) |
| Gates | `scripts/test-phase-m12p.mjs` |

## Suite

**M13** — Audit TF métier-only.
