# Module prospects — CRM prospection kanban

## Vision

Un pipeline de prospection **kanban générique** pour l'app admin de toute
marque : la marque nomme les prospects (« restaurants » pour TempoFlow…)
via des labels, le kit fournit la table, le CRUD et le client drag & drop.
Zéro domaine marque dans le code (ADR-no-brand-domain-in-native-packages).

## Utilisateurs & parcours

- **Commercial / opérateur de la marque** : ajoute un prospect (nom +
  ville), le fait glisser entre colonnes du pipeline, ouvre une carte pour
  éditer les notes, archive un prospect perdu ou converti.

## Capacités (fonctionnel)

- CRUD complet des prospects (liste ordonnée kanban, création, lecture,
  mise à jour partielle, suppression).
- Kanban 5 colonnes fixes avec drag & drop HTML5 natif (aucune dépendance
  DnD).
- Positionnement persistant des cartes (`position` REAL).
- Notes libres par prospect.

## Modèle de données

Table `admin_prospects` — migration `admin_001_native_modules`
(`ADMIN_SCHEMA_SQL`, `src/index.ts`), copie exacte :

```sql
CREATE TABLE IF NOT EXISTS admin_prospects (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  nom TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  telephone TEXT,
  ville TEXT,
  site_web TEXT,
  notes TEXT,
  colonne TEXT NOT NULL DEFAULT 'a_contacter',
  position REAL NOT NULL DEFAULT 0
);
```

## API

Mount : `createAdminCrudMount("prospects")` (CRUD générique SQLite du
package, `dbLayer: "brand"`), monté sous `/api/v1/modules/prospects`.
Colonnes écrivables : `nom`, `contact`, `email`, `telephone`, `ville`,
`site_web`, `notes`, `colonne`, `position`.

| Méthode | Chemin | Comportement |
|---|---|---|
| GET | `` | Liste complète, `ORDER BY position ASC, created_at DESC` (la table a `position`) → `{ ok, items }` |
| POST | `` | Création : `id` du body ou généré (`Date.now().toString(36)+random`), `created_at`/`updated_at` = now ISO, seules les colonnes writables présentes dans le body sont insérées → `201 { ok, item }` |
| GET | `<id>` | `{ ok, item }` ou 404 |
| PUT/PATCH | `<id>` | Patch partiel des colonnes writables + `updated_at` ; 404 si 0 changement → `{ ok, item }` |
| DELETE | `<id>` | 200 `{ ok:true }` ou 404 |

Remarque : `archived_at` n'est **pas** dans les colonnes writables du CRUD
kit — le client kit archive via DELETE (voir Cas limites).

## UI

Client `ProspectsKanbanClient` (`ui/prospects-kanban-client.tsx`), exporté
par `@creezio/admin/ui`, matérialisé par l'app admin (TempoFlow :
`/prospects`). Props : `labels?: { title?, subtitle?, addPlaceholder? }`
(défauts : « Prospection », « Glissez-déposez… », « Nom du prospect »).

- Colonnes fixes : `a_contacter` (À contacter), `contacte` (Contacté),
  `rdv` (RDV / démo), `client` (Client 🎉), `perdu` (Perdu) — une carte
  avec une `colonne` inconnue est affichée dans la première colonne.
- Toolbar : deux `Input` (nom, ville — Entrée valide) + `Button` Ajouter →
  `POST { nom, ville, colonne: "a_contacter", position: Date.now() }`.
- Drag & drop HTML5 natif (`draggable`, `dataTransfer text/plain` = id) ;
  drop → mise à jour **optimiste** locale puis
  `PATCH { colonne, position }` avec `position = max(position colonne
  cible) + 1` (ou 1 si vide), puis refresh.
- Carte cliquée → panneau détail (`Card`) : `<textarea>` notes
  (`PATCH { notes }`), bouton « Archiver » (destructive).
- Filtrage : les items avec `archived_at` non nul sont masqués.
- Compteur par colonne (`Badge secondary`), zone « Déposez ici » si vide.
- **Deux dialectes de réponse acceptés** : `{ ok:true, items }` (mount
  kit) et `{ items }` nu (mount métier généré `--from-prd`) — le client
  est volontairement compatible avec les deux.
- **Deux dialectes d'archivage** : `DELETE /<id>` (mount kit) ; si non-OK,
  fallback `POST /<id>/archive` (mount métier archivable).

Composants kit : `Badge`, `Button`, `Card`, `Input`
(`@creezio/shell-ui/ui/kit`).

## Tools MCP

Aucun.

## Logique métier non triviale

- Tri kanban côté client : `position ASC` puis `created_at ASC` en
  tie-break.
- Position d'insertion en fin de colonne : `max(positions) + 1` ;
  positions initiales à la création : `Date.now()` (croissant naturel).
- Déplacement optimiste avant confirmation serveur, refresh derrière.

## Seeds & données initiales

Aucun.

## Cas limites & règles de gestion

- La colonne d'une carte est validée côté client seulement (une valeur
  inconnue retombe dans « À contacter ») — le serveur accepte toute
  chaîne.
- Archivage : sur le mount kit, « Archiver » **supprime** la row (DELETE) ;
  la colonne `archived_at` n'est réellement utilisée que par les mounts
  métier générés (dialecte 2) — écart tracé en dette PROSP-2.
- Création sans `nom` bloquée côté client (bouton désactivé) ; le mount
  kit n'impose pas `nom` (pas de validation serveur) — dette PROSP-3.
- Réponse non-ok du POST/PATCH : le client refresh quand même (état
  serveur = vérité).

## Hors périmètre

- Le naming métier (« restaurants ») : labels de l'app admin.
- Import/scraping de prospects, scoring, relances automatiques.
- Le mount métier `--from-prd` des apps admin générées (table brand
  `prospects`) : documenté côté repo marque (ex.
  `tempoflow3-admin/admin-spec/modules/entites-fromprd/`).
