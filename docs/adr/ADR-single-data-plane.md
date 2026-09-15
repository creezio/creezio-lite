# ADR — Un seul plan de données métier : `brand.db`

Statut : **accepté** (décision propriétaire, 2026-08).
Gate : `scripts/test-phase-single-data-plane.mjs` (kit + réutilisable marques).

## Contexte

TempoFlow3 a vécu avec **deux plans de données métier** : un snapshot
catalogue distant (`tempoflow2.db`, base SQLite téléchargée au boot) lu
directement par la plupart des écrans, et `brand.db` (migrations des
modules) lu/écrit par les API modules et les agents IA. Conséquences
vécues : compteurs qui se contredisent entre l'écran et le tool MCP, deux
formules de score promotions, deux totaux panier, des écritures d'agents
invisibles à l'écran — et un risque permanent de perte ou d'incohérence de
données. Ce n'est pas un bug local : c'est une classe d'architecture à
interdire au niveau du kit.

## Décision

Toute app de marque Creezio a **UNE source de vérité pour le métier :
`brand.db`** (layout kit `sqlite/{core,brand,plugin/<id>}`).

Les sources externes — catalogue distant, snapshots, imports fichiers,
API tierces — sont des **flux d'alimentation** :

1. elles sont **projetées dans `brand.db` à l'import** (module d'import
   dédié, idempotent, rejouable) ;
2. elles ne sont **jamais lues directement** par les écrans, les API ou
   les tools MCP ;
3. seul le module d'import ouvre le fichier source, en lecture seule.

## Conséquences

- **Un module = ses tables `brand.db`** (migrations `mod_<id>_00N_*`),
  déclarées dans l'interview §2 avec leur provenance (natives ou
  alimentées par projection, et par quel module d'import).
- **Toute donnée affichée existe dans `brand.db`** : si un écran a besoin
  d'un champ du flux source, on étend la migration du module propriétaire
  et la projection de l'import — on ne rouvre pas le fichier source.
- **Les writes des agents IA sont immédiatement visibles à l'écran** :
  écrans, API, tools MCP et recherche (Meili) lisent tous la même base.
- La recherche plein-texte s'indexe depuis `brand.db`, pas depuis le flux
  source.
- Un calcul métier (score, total, agrégat) a **une seule implémentation**,
  côté module — jamais une variante « écran » et une variante « API ».

## Enforcement

- Gate kit `test-phase-single-data-plane` (suite brands) : détecte
  statiquement dans une app de marque les ouvertures SQLite hors layout
  kit (`sqlite/{core,brand,plugin/*}`) depuis `server/ui/**` et les mounts
  modules — fail-closed sur tout nouvel écart, allowlist explicite limitée
  au module d'import.
- Les marques embarquent la gate dans leur `npm test` (même mécanisme que
  `test-ui-kit`).
- Standards : `docs/DOC-STANDARD-MODULE.md` (interview §2 « provenance des
  données »), `docs/agents/CREATE-MODULE.md`, `docs/agents/CREATE-BRAND.md`.

## Non-buts

- Ne dit rien des bases **plateforme** (`core.db`, `plugin/<id>`) : leur
  isolation est déjà couverte (deny cross-layer).
- N'interdit pas les caches purement éphémères (mémoire, fichiers temp)
  qui ne portent aucune donnée affichée.
- Le fichier source d'un flux (snapshot téléchargé) peut rester sur disque
  pour l'idempotence de l'import — il n'est simplement jamais une surface
  de lecture applicative.
