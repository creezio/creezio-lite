# TODO — prospects

### [done] PROSP-3 — Validation serveur `nom` requis à la création
- done: 2026-08-06
- priorite: P3
- depends: aucune
- fichiers: packages/admin/src/index.ts
- criteres:
  - [x] POST sans `nom` non vide → 400 `nom_required`

### [done] PROSP-5 — Gate kit dédiée au CRUD prospects
- done: 2026-08-06
- priorite: P3
- depends: aucune
- fichiers: scripts/test-phase-admin-prospects.mjs
- criteres:
  - [x] gate node --test : CRUD + tri kanban + validation nom
