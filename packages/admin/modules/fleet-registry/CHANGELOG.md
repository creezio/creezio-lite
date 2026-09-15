# CHANGELOG — fleet-registry

## 2026-08-06 — FREG-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-admin-fleet-registry.mjs + scripts/test-phase-fleet-heartbeat.mjs (vertes)
- Spec rétro-documentée depuis `packages/admin/src/fleet-registry.ts` :
  migration `admin_004_fleet_registry`, endpoints
  servers/events/sync/register/heartbeat/DELETE, dédup self-enroll,
  statut online dérivé, poller de fond + janitor releases, sécurité
  tokens (AES-GCM au repos, serverKey hashée, comparaisons temps constant).
