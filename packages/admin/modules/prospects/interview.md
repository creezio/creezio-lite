# Interview module prospects

> **AVERTISSEMENT — document de rétro-ingénierie** (généré par agent,
> commit `8ca1821`, 2026-08-06). Ce fichier décrit le produit **tel
> qu'il est codé** ; ce n'est PAS un brief produit ni un journal de
> décisions. INTERDIT d'y ajouter une « décision » pour justifier du
> code nouveau : toute évolution de comportement exige une validation
> explicite du propriétaire, et ce fichier n'est mis à jour qu'APRÈS
> merge, en miroir du code réel.

## 1. Identité & pages

- id : `prospects` ; titre : « Prospection kanban ».
- Module natif kit (`@creezio/admin`), monté sous
  `/api/v1/modules/prospects` par `registerAdminModules` (ou à la carte).
- Page : matérialisée par l'app admin (TempoFlow : `/prospects`, nav
  `brand.prospects`) rendant `ProspectsKanbanClient` avec ses labels.
- Permission : session OS admin (kernel).

## 2. Données & migrations

- Table `admin_prospects` — créée par la migration historique
  `admin_001_native_modules` (**intouchable**, partagée avec roadmap,
  support, billing). Schéma complet dans prd.md (copie migration).
- Pas d'index dédié (volumétrie prospection faible, tri en mémoire SQLite).
- Nouvelle migration éventuelle : `mod_prospects_00N_<slug>` — une
  migration ne touche que les tables de ce module.

## 3. API

- Mount **générique du package** `createAdminCrudMount("prospects")` —
  antérieur au moteur `createEntityApiMount` (`@creezio/api-kernel`) ;
  la bascule vers un EntitySpec déclaratif est une dette tracée (PROSP-1).
- Pas de hooks ni d'extraRoutes : CRUD pur (liste triée
  `position ASC, created_at DESC`, POST, GET/PUT/PATCH/DELETE par id).
- Dialecte de réponse : `{ ok, items }` / `{ ok, item }` (le client UI
  accepte aussi le dialecte nu des mounts métier générés).

## 4. UI, nav & permissions — kit graphique imposé

### Page /prospects (matérialisée marque, client `ProspectsKanbanClient`)

- gabarit : layout flex plein largeur (pas de section-view-shell — client
  kit autonome)
- colonnes kanban : `card` (cartes prospect) + `badge` (compteurs)
- toolbar création : `input` ×2 + `button`
- détail : `card` + `button` (ghost/destructive) + `<textarea>` brut
  (écart au kit : pas de primitive textarea — dette PROSP-4)
- DnD : HTML5 natif, aucune lib tierce (conforme aux interdits du
  standard UI)

## 5. Tools MCP & policies

Aucun.

## 6. Rôles & permissions

Session OS de l'app admin ; pas de granularité par rôle dans le module.

## 7. Meili / n8n / plugins

Aucun dans le kit. (Côté TempoFlow Admin, le feed Meili marque indexe
`admin_prospects` — voir `tempoflow3-admin/admin-spec/modules/wiring/`.)

## 8. Seeds & onboarding

Aucun.

## 9. Gates de validation

- Pas de gate kit dédiée (dette PROSP-5). Couverture indirecte :
  `scripts/test-phase-factory-two-repos.mjs` vérifie que la page
  `/prospects` du scaffold admin rend `ProspectsKanbanClient` ;
  la gate `test:metier-parcours` du repo admin marque exerce le mount
  effectivement monté chez elle.

## 10. i18n

Libellés des colonnes kanban et messages en français, codes de colonnes
(`a_contacter`, `contacte`, `rdv`, `client`, `perdu`) en identifiants
techniques stables (ne pas traduire — persistés en DB).
