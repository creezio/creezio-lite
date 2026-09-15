# TODO — roadmap

### [done] ROAD-3 — Validation serveur `titre` requis
- done: 2026-08-06
- priorite: P3
- depends: aucune
- fichiers: packages/admin/src/index.ts
- criteres:
  - [x] POST sans `titre` non vide → 400 `titre_required`

### [done] ROAD-4 — Gate kit dédiée au CRUD roadmap
- done: 2026-08-06
- priorite: P3
- depends: aucune
- fichiers: scripts/test-phase-admin-roadmap.mjs
- criteres:
  - [x] gate node --test : CRUD + tri position + validation titre
