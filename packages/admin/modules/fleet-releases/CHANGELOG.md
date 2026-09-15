# CHANGELOG — fleet-releases

## 2026-08-06 — FREL-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-fleet-releases.mjs + scripts/test-phase-fleet-rollout.mjs (vertes)
- Spec rétro-documentée depuis `packages/admin/src/fleet-releases.ts` :
  migration `admin_005_fleet_releases`, plan agents (next/slots/report,
  Bearer hostId:agentToken vérifié backend + cache), plan admin (CRUD
  releases idempotent publish, rollout pin/hold/channel), vagues
  monotones `hash(server_id) mod 100 < wave_pct`, leases TTL 15 min,
  kill-switch avec révocation de leases, auto-pause ≥ 2 échecs, janitor
  maintenance.
