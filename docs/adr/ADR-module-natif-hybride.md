# ADR — Patron « module natif hybride »

Statut : **accepté** (direction produit, 2026-08).
Instances : `@creezio/landing` (référence), `@creezio/onboarding` (aligné).

> Note 2026-08-10 : les mentions de `vendor/creezio` / sync ci-dessous décrivent le mécanisme de distribution de l'époque — remplacé par les packages npm ([../NPM-DISTRIBUTION.md](../NPM-DISTRIBUTION.md)). Le patron reste en vigueur.

## Contexte

Certains modules doivent être **natifs** (toutes les apps Creezio les ont :
landing page publique, onboarding produit…) tout en étant **entièrement
personnalisables par marque** : structure, textes, images, composants. Sans
patron commun, chaque marque forke le kit (vécu : onboarding TempoFlow3
recopié verbatim dans la marque) et le contenu finit hardcodé dans du TSX.

## Décision — le patron en 6 règles

Un module natif hybride `<module>` se compose ainsi :

### 1. Moteur natif dans le kit

Package `@creezio/<module>` : migrations SQLite (couche **brand**), mount(s)
api-kernel `registerModuleApi("<module>", …)` → `/api/v1/modules/<module>/*`,
et logique pure (merge défauts/overrides, validation). Zéro texte métier,
zéro asset marque (ADR-no-brand-domain-in-native-packages).

### 2. Contenu en base, jamais en dur

Tout ce qui est éditable (textes, ordre/activation des sections ou étapes,
références médias) vit dans `brand.db` (tables `<module>_*`). Le kit fournit
un **seed générique** paramétré par la marque (`default<Module>Seed(...)`) ;
la marque déclare ses **défauts** dans UN fichier explicite
(`server/src/electron/brand-<module>-content.ts` ou options du mount). Le
runtime sert toujours `merge(défauts marque, overrides DB)` : une app neuve a
du contenu jour 1, l'édition ne touche jamais le code.

### 3. Composants préfabriqués + surcharge 100 %

`@creezio/<module>/ui` exporte : des composants préfabriqués par *kind*
(hero, features, pricing… / étapes, interstitiels, mascotte…), un composant
hôte pilotant le rendu depuis le contenu DB, et un **registry**
(`components={{ kind: MonComposant }}`) permettant à la marque de remplacer
n'importe quel préfabriqué — ou d'ajouter ses propres kinds — sans forker le
kit. Design system : primitives `@creezio/shell-ui`.

### 4. Édition dans l'admin OS

Le package exporte un client React d'édition (`<Module>AdminClient`) monté en
page thin dans l'app de la marque (page versionnée repo admin, ou wrapper
os-ui). L'édition parle au mount CRUD ; elle est derrière l'auth OS (posture
ADR-admin-app-os). Les **médias** s'uploadent en JSON base64 via le mount
(l'adaptateur HTTP kernel ne parse pas le multipart) → fichiers sous
`{data}/uploads/<module>/` + métadonnées DB ; le **service binaire** passe par
une route Next thin (helper serveur du package), car le kernel ne stream pas.

### 5. Exposition publique éventuelle

Si le module a un rendu public (landing) : page Next publique (hors session),
sous-domaine dédié via le **tunnel provisioner** (réservation `brand-web`,
ex. `lp.{zone}` → port de l'app qui rend), rewrite host→route dans le
middleware Next de l'app. Lecture publique = endpoints `GET` du mount
explicitement publics ; écriture = admin.

### 6. Naissance factory + gate

Toute marque générée naît avec le module câblé (migrations composées,
`registerModuleApi`, pages, deps vendor, tunnel le cas échéant) et une
landing/contenu par défaut éditable. Une gate `scripts/test-phase-<module>.mjs`
verrouille : exports kit, câblage factory, seed par défaut.

## Grille de conformité (checklist audit)

| Critère | Attendu |
|---|---|
| Moteur générique kit | package `@creezio/<module>`, aucun domaine marque |
| Contenu | en `brand.db`, seedé, éditable via admin — pas de texte en dur kit |
| Défauts marque | UN fichier explicite côté marque |
| Composants | préfabriqués kit + registry de surcharge par kind |
| Données utilisateur | stockées via le mount kit (ex. onboarding → preferences) |
| Factory | marque neuve câblée jour 1 + gate |

## Conséquences

- `@creezio/landing` est l'implémentation de référence (module landing page,
  rendu public `lp.{zone}` sur le plane de l'app admin de marque).
- `@creezio/onboarding` est mis en conformité : contenu (étapes/textes/
  mascotte) en DB surchargeable + réponses dans `onboarding_preferences`.
- Le provisioner tunnel apprend les réservations `brand-web` (hostnames
  zone-level type `lp.{zone}`, sans embeds n8n/hermes).
- Futurs candidats : pages légales/CGU, centre d'aide, emails transactionnels.

## Non-buts

- Pas de CMS générique multi-pages : chaque module hybride garde son modèle
  de données propre et minimal.
- Pas de builder visuel drag-and-drop jour 1 : composer/ordonner/éditer via
  l'admin suffit ; la surcharge fine passe par le registry de composants.
- Le métier vertical (réponses à des questions métier, schéma produit) reste
  dans le repo marque.
