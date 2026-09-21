# Contrat d’entité D1

Le modèle reprend `EntitySpec` et les hooks du kit Creezio, avec des écritures D1 asynchrones et atomiques. Le même schéma de module décrit les formulaires, les entrées HTTP/MCP et les données stockées.

## Champs

- `fields` : champs présentables. `storage: "stored"` est la valeur par défaut ; `storage: "computed"` désigne une projection de lecture, exclue du stockage, des écritures, du tri SQL et de la recherche.
- `editable: false` : champ stocké alimenté par le serveur. Les formulaires et schémas d’entrée l’excluent. Un ancien client peut renvoyer sa valeur inchangée lors d’un PATCH ; toute modification est refusée.
- `serverFields` : métadonnées et snapshots persistés, validés, absents des formulaires et des entrées. Leur absence reste une absence lorsqu’ils sont optionnels.
- `encoding: "json"` : une valeur JSON structurée ; un éditeur peut envoyer du texte JSON. La validation contrôle la syntaxe et la taille ; la règle métier valide sa structure spécifique (images, paliers, snapshots…).

`prepareEntityWrite(context, {beforeWrite, hooks})` valide l’entrée fermée, conserve les champs serveur, exécute les règles puis valide **systématiquement** la valeur finale. PATCH fusionne les champs éditables fournis avec l’existant. `source: "server"` permet aux commandes de fournir des champs serveur, sans désactiver la validation finale.

`validateStoredData(module, data)` valide une valeur persistée complète. Une commande qui modifie un ancien enregistrement incomplet peut fournir `{previous}` : seuls les champs obligatoires déjà absents et toujours absents sont tolérés ; retirer un champ obligatoire présent reste interdit. Cette compatibilité ne s’applique pas aux créations.

`validateStoredPatch(module, patch, previous)` correspond au PATCH du kit historique : il contrôle tous les champs modifiés, refuse les champs inconnus et la suppression des valeurs obligatoires, puis conserve les valeurs anciennes non concernées. Une commande incrémentant un quota ne réécrit donc pas une ancienne date horodatée en date de calendrier. Cela ne certifie pas la conformité rétroactive de toutes les données historiques.

## Stockage

```ts
const spec = {
  schema: productSchema,
  storage: {kind: 'relational', table: 'brand_products', columns: {name: 'label'}},
  hooks: {beforeCreate, beforeUpdate, afterRead, afterCreate, afterUpdate, afterArchive},
};
```

Le module propriétaire doit déclarer `tables: ['brand_products']`. Les identifiants et correspondances de colonnes sont contrôlés. Une table appartient à une seule entité. Les métadonnées `id`, `org_id`, `version`, `created_by`, `created_at`, `updated_at`, `deleted_at` sont communes. Les champs métier sont de vraies colonnes ; aucun enregistrement miroir n’est écrit dans `lite_records`.

`relationalEntityMigration(spec)` produit les instructions de création de table, d’index et de triggers FTS à enregistrer dans une **nouvelle migration de l’application**. Les contraintes et index métier supplémentaires restent dans cette migration. Aucun DDL n’est exécuté par une requête HTTP. Une table préexistante exige sa migration explicite et un schéma compatible ; changer seulement `storage.kind` ne déplace pas les données.

`entityStorage(schema, spec)` fournit la source de lecture normalisée et les statements paramétrés `insert`/`update`. Les variantes `insertStatement`/`updateStatement` retournent le SQL et ses paramètres pour les transactions métier qui préparent leur propre batch ; `insert`/`update` préparent ces mêmes instructions sur la connexion fournie. Ces statements valident également les données finales. Une commande peut les inclure dans sa propre transaction avec ses gardes métier, son audit, ses écritures annexes et son idempotence. L’adaptateur ne crée aucune transaction imbriquée. Les commandes restent responsables de leur autorisation, de la garde de droits au commit et de faire échouer leur batch si une écriture attendue ne touche aucune ligne (par exemple le `requireChanges` existant de WinHub). Une simple résolution de `db.batch` ne suffit pas à prouver qu’un UPDATE conditionnel a modifié sa cible.

Le CRUD, les comptes, l’audit et la recherche connaissent les deux stockages. L’index D1 est entretenu dans la transaction par triggers ; la réindexation reprend les tables relationnelles. Les droits et l’espace sont filtrés avant résultats, comptes et pagination. Les mises à jour et archives contrôlent la version.

## Après transaction

Les hooks `afterCreate`, `afterUpdate`, `afterArchive` suivent le commit réussi et reçoivent une copie de l’enregistrement de cette écriture. Ils ne se déclenchent pas en cas de validation refusée, rollback ou conflit. `commitWithEffects(commit, effects)` offre la même frontière aux transactions métier existantes ; `runAfterCommit` sert lorsqu’un handler a déjà confirmé son commit.

Une erreur de hook est journalisée sans message privé et indiquée dans `effects` pour le CRUD. Elle ne transforme pas le commit en échec d’écriture. Ces callbacks ont la même nature que les hooks historiques : **ils ne constituent pas une file durable**. Pour une notification ou une action externe à reprendre après une interruption, écrire l’intention dans une outbox dans le même batch, puis utiliser le callback pour sa distribution idempotente. WinHub conserve son outbox existante.

## Vérification

`tests/entity-storage.test.mjs` exécute le contrat sur SQLite et sur Cloudflare D1/Miniflare : colonnes réelles, aucun miroir `lite_records`, JSON, champs serveur/calculés, isolation, recherche/réindexation, conflits, archivage et effets. Les tests de scope du kit restent applicables aux deux adaptateurs.

## Génération et portage

`lite create` et `lite module` génèrent des tables relationnelles par entité. Chaque module possède `db-schema.ts`, sa déclaration `tables` et une migration SQL. Le journal et un nouveau snapshot Drizzle sont ajoutés ; aucun ancien SQL/snapshot n’est réécrit. Le `drizzle.config.ts` collecte les schémas de modules. Un `db:generate` sans changement de contrat ne doit proposer ni création en double ni suppression de table.

L’adaptateur `records` reste disponible pour lire une application existante pendant son portage. Ce n’est pas le modèle cible pour convertir une application Creezio : reprendre ses tables, relations et contraintes, puis adapter ses transactions à D1. Le générateur n’applique aucune migration sur une base distante.

Les colonnes NULL des métadonnées serveur optionnelles sont projetées comme absentes ; éditer un autre champ ne doit pas fabriquer une valeur false pour un état serveur non renseigné.

`patchStatement` reprend la sémantique PATCH métier de Creezio : seuls les champs modifiés sont validés et écrits, les colonnes historiques non concernées restent intactes. Il contrôle la version, l’espace et le scope comme les autres écritures ; un patch vide peut prendre une nouvelle version pour une transaction de stock. Il ne remplace pas les règles métier ni les gardes du batch.

### Contexte des hooks de lecture et des effets

`afterRead`, `afterList`, `beforeArchive` et les effets `afterCreate`/`afterUpdate`/`afterArchive` reçoivent `db`, la base D1 de la requête, avec l’espace et l’identité autorisés. Les modules peuvent ainsi reprendre leurs compteurs et projections relationnelles historiques. Toute requête ajoutée par un hook doit filtrer l’espace et respecter les droits métier ; la présence de `db` ne confère aucun droit. Les champs retournés par une projection ne sont pas réécrits en stockage. Les effets restent exécutés après commit.

Les écritures serveur valident sans normaliser les textes : une chaîne vide de type text/textarea reste vide, les espaces et retours de ligne sont conservés, et un booléen optionnel null ne devient pas false. Les champs obligatoires vides et les valeurs trop longues restent refusés. La normalisation des formulaires demeure dans `validateEntityInput`, avant les règles métier.

### Limites physiques D1

D1 limite une table à 100 colonnes, soit 93 champs stockés avec les 7 métadonnées communes ; les champs calculés ne comptent pas. Le contrat relationnel et le générateur refusent un schéma trop large avant toute modification des fichiers. Au-delà, modéliser des entités liées explicitement, comme dans une architecture relationnelle classique. Aucun basculement automatique vers `lite_records`.

Les mises à jour larges restent atomiques et paramétrées : quand les valeurs et le scope dépasseraient 100 paramètres, les valeurs transitent dans un paramètre JSON temporaire puis sont affectées à leurs colonnes SQL respectives. Ce transport ne crée ni colonne JSON globale ni stockage miroir. Les paramètres du scope restent séparés ; un scope qui dépasse lui-même la capacité est refusé. Les appels JSON générés restent sous 32 arguments. Les migrations déjà publiées sont immuables. Voir les [limites D1](https://developers.cloudflare.com/d1/platform/limits/).

### Noms publics et colonnes

Les noms de propriétés d'un contrat existant peuvent utiliser camelCase (`orderId`, `createdAt`) : les conserver évite de casser les consommateurs pendant un portage. Les noms SQL restent strictement snake_case. Déclarer explicitement `storage.columns`, par exemple `{orderId: "order_id", createdAt: "source_created_at"}` ; aucune déduction ni renommage silencieux. Les noms réservés aux métadonnées et les collisions restent refusés. `scaffoldModuleStorage(app, schema, {table, columns})` génère les mêmes noms physiques dans SQL, Drizzle et son nouveau snapshot. Le générateur ordinaire continue d'utiliser directement les noms snake_case du schéma.

Un champ structuré `encoding: json` conserve la distinction entre absence (SQL NULL, champ serveur omis) et remise à zéro explicite (texte JSON `null`, propriété restituée à `null`). Les insertions, remplacements et patchs suivent cette règle, ainsi que leurs projections et index. Une migration de données existantes doit utiliser `data -> path` pour conserver le `null` JSON explicite.
