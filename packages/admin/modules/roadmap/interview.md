# Interview module roadmap

> **AVERTISSEMENT — document de rétro-ingénierie** (généré par agent,
> commit `8ca1821`, 2026-08-06). Ce fichier décrit le produit **tel
> qu'il est codé** ; ce n'est PAS un brief produit ni un journal de
> décisions. INTERDIT d'y ajouter une « décision » pour justifier du
> code nouveau : toute évolution de comportement exige une validation
> explicite du propriétaire, et ce fichier n'est mis à jour qu'APRÈS
> merge, en miroir du code réel.

## 1. Identité & pages

- id : `roadmap` ; titre : « Roadmap produit ».
- Module natif kit (`@creezio/admin`), monté sous
  `/api/v1/modules/roadmap` par `registerAdminModules`.
- Page : à la charge de l'app admin (TempoFlow : `/roadmap`, nav
  `brand.roadmap`) — aucun client UI exporté par `@creezio/admin/ui` pour
  ce module.
- Permission : session OS admin (kernel).

## 2. Données & migrations

- Table `admin_roadmap_items` — migration historique
  `admin_001_native_modules` (**intouchable**). Schéma complet : prd.md.
- Nouvelle migration éventuelle : `mod_roadmap_00N_<slug>`.

## 3. API

- Mount générique du package `createAdminCrudMount("roadmap")` — même
  moteur que prospects/billing-customers/billing-subscriptions ; bascule
  EntitySpec = dette (ROAD-1). Pas de hooks/extraRoutes.
- Tri liste : `position ASC, created_at DESC` (la table a `position`).

## 4. UI, nav & permissions — kit graphique imposé

- Aucune page kit. Référence d'implémentation marque (TempoFlow Admin,
  page /roadmap) : `EntityTable` (composant partagé app) construit sur
  `DataTable` de `@creezio/shell-ui/ui` — conforme au standard
  (data-table pour toute liste tabulaire).

## 5. Tools MCP & policies

Aucun.

## 6. Rôles & permissions

Session OS de l'app admin, pas de granularité par rôle.

## 7. Meili / n8n / plugins

Aucun.

## 8. Seeds & onboarding

Aucun.

## 9. Gates de validation

- Pas de gate kit dédiée (dette ROAD-4) ; le wiring `roadmap` du scaffold
  admin est couvert par `scripts/test-phase-factory-two-repos.mjs`
  (présence des fichiers d'app), le mount marque par la gate
  `test:metier-parcours` du repo admin.

## 10. i18n

Libellés en français côté apps ; `statut` stocké en identifiant technique
(défaut `idee`).
