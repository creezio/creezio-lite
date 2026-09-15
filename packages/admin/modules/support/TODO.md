# TODO — support

### [todo] SUPP-2 — Doublon d'affichage de la réponse admin après re-sync
- scope: BUG — dysfonctionnement réel, correctif autorisé (aucun changement de comportement au-delà du fix)
- priorite: P2
- depends: aucune
- fichiers: packages/admin/src/index.ts
- criteres:
  - [ ] la copie locale (`remote_id = NULL`) et le même message revenu de l'export marque (remote_id distant) ne s'affichent plus en double
  - [ ] stratégie choisie documentée en commentaire de code (rapprochement corps+auteur+fenêtre temporelle, ou remote_id retourné par le relais) — interview.md mis à jour seulement APRÈS merge, en miroir du code
