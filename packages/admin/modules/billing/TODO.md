# TODO — billing

### [todo] BILL-2 — MRR : normaliser les abonnements non mensuels
- scope: BUG — dysfonctionnement réel, correctif autorisé (aucun changement de comportement au-delà du fix)
- priorite: P3
- depends: aucune
- fichiers: packages/admin/src/index.ts
- criteres:
  - [ ] `montant_mensuel` est pris tel quel depuis `unit_amount` (un plan annuel gonfle le MRR ×12) : lire `price.recurring.interval` et normaliser
  - [ ] gate admin-billing étendue (cas plan annuel)

### [todo] BILL-4 — Réconciliation : dépasser le cap 10 pages × 100 objets
- scope: BUG — dysfonctionnement réel, correctif autorisé (aucun changement de comportement au-delà du fix)
- priorite: P3
- depends: aucune
- fichiers: packages/admin/src/index.ts
- criteres:
  - [ ] au-delà de 1000 customers/subscriptions/invoices la resync est silencieusement partielle : lever le cap ou remonter `truncated:true` dans la réponse
