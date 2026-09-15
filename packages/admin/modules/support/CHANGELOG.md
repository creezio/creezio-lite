# CHANGELOG — support

## 2026-08-06 — SUPP-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-factory-two-repos.mjs (wiring `createSupportAdminMount` prouvé ; pas de gate fonctionnelle dédiée — SUPP-1)
- Spec rétro-documentée depuis `packages/admin/src/index.ts`
  (`createSupportAdminMount`, `supportPathFor`) et
  `ui/tickets-admin-client.tsx` : agrégation pull de la flotte, upsert
  par (host, serveur, remote_id), réponse relayée au serveur marque puis
  copiée localement, statut propagé best-effort.
