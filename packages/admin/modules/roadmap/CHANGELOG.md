# CHANGELOG — roadmap

## 2026-08-06 — ROAD-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-factory-two-repos.mjs (scaffold app admin ; pas de gate CRUD dédiée — ROAD-4)
- Spec rétro-documentée depuis `packages/admin/src/index.ts`
  (`admin_roadmap_items`, `createAdminCrudMount("roadmap")`) : CRUD pur
  ordonnable, aucun client UI kit (rendu à la charge des apps admin).
