# CHANGELOG — prospects

## 2026-08-06 — PROSP-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-factory-two-repos.mjs (page /prospects → ProspectsKanbanClient prouvée ; pas de gate CRUD dédiée — PROSP-5)
- Spec rétro-documentée depuis `packages/admin/src/index.ts`
  (`admin_prospects`, `createAdminCrudMount`) et
  `ui/prospects-kanban-client.tsx` : kanban 5 colonnes DnD natif,
  positions REAL, double dialecte kit / mount métier généré.
