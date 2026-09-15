# Module roadmap — roadmap produit de la marque

## Vision

Une roadmap produit minimaliste dans l'app admin : des items (titre,
description, statut, jalon) ordonnables, en CRUD pur. Le kit fournit table
et API ; la présentation est laissée à l'app admin (aucun client UI kit
dédié à ce jour).

## Utilisateurs & parcours

- **Équipe produit / fondateur de la marque** : liste les items de
  roadmap, en crée, met à jour statut et jalon, supprime.

## Capacités (fonctionnel)

- CRUD complet des items de roadmap.
- Ordonnancement persistant (`position` REAL) — liste triée position puis
  date.
- Cycle de statut libre (défaut `idee`) — aucune machine à états imposée.

## Modèle de données

Table `admin_roadmap_items` — migration `admin_001_native_modules`
(`ADMIN_SCHEMA_SQL`, `src/index.ts`), copie exacte :

```sql
CREATE TABLE IF NOT EXISTS admin_roadmap_items (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  titre TEXT NOT NULL,
  description TEXT,
  statut TEXT NOT NULL DEFAULT 'idee',
  jalon TEXT,
  position REAL NOT NULL DEFAULT 0
);
```

## API

Mount : `createAdminCrudMount("roadmap")` (CRUD générique SQLite,
`dbLayer: "brand"`), monté sous `/api/v1/modules/roadmap`. Colonnes
écrivables : `titre`, `description`, `statut`, `jalon`, `position`.

| Méthode | Chemin | Comportement |
|---|---|---|
| GET | `` | Liste, `ORDER BY position ASC, created_at DESC` → `{ ok, items }` |
| POST | `` | Création (id fourni ou généré, timestamps ISO) → `201 { ok, item }` |
| GET | `<id>` | `{ ok, item }` ou 404 |
| PUT/PATCH | `<id>` | Patch partiel + `updated_at` ; 404 si inconnu |
| DELETE | `<id>` | 200 `{ ok:true }` ou 404 |

## UI

Aucun client kit dédié (contrairement à prospects/support/billing). Les
apps admin rendent la liste avec leurs composants (TempoFlow Admin :
`/roadmap` avec `EntityTable` → `DataTable` kit, sur son propre mount
métier). Dette tracée ROAD-2 (client kit roadmap).

## Tools MCP

Aucun.

## Logique métier non triviale

Aucune (CRUD pur). Le statut est une chaîne libre — les valeurs (`idee`,
etc.) sont une convention d'app, seul le défaut `idee` est imposé par le
schéma.

## Seeds & données initiales

Aucun.

## Cas limites & règles de gestion

- `titre` NOT NULL en schéma mais non validé par le mount (POST sans titre
  → erreur SQLite non normalisée) — dette ROAD-3.
- PUT/PATCH d'un id inconnu → 404 (0 changement).
- Aucun archivage : DELETE définitif.

## Hors périmètre

- Votes/feedback clients, liens vers tickets support, priorisation
  automatique.
- La page de rendu (choix de l'app admin consommatrice).
- Le mount métier `--from-prd` homonyme des apps générées (table brand
  `roadmap`, sans `position`) : documenté côté repo marque.
