# CHANGELOG — billing

## 2026-08-06 — BILL-0 — Rétro-documentation initiale
- gate: node --test scripts/test-phase-admin-billing.mjs (verte)
- Spec rétro-documentée depuis `packages/admin/src/index.ts`
  (`createBillingWebhookMount`, `createBillingAdminMount`,
  `verifyStripeSignature`, projections partagées, CRUD
  billing-customers/subscriptions) et `ui/billing-admin-client.tsx` :
  webhook signé idempotent, overview (MRR/actifs/impayées, rapprochement
  client ↔ serveur), réconciliation active paginée sans SDK Stripe.
