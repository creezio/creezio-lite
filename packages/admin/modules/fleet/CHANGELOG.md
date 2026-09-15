# CHANGELOG — fleet

## 2026-08-06 — FLEET-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-factory-two-repos.mjs (wiring `createFleetAdminMount` prouvé ; pas encore de gate proxy dédiée — FLEET-1)
- Spec rétro-documentée depuis `packages/admin/src/index.ts`
  (`createFleetAdminMount`, `fleetFetch`) et `ui/fleet-admin-client.tsx` :
  proxy Basic server-side vers le backend flotte, aucune table, gestes
  `/flotte` inchangés depuis F2 (liste = fleet-registry).
