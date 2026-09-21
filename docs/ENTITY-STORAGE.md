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

`entityStorage(schema, spec)` fournit la source de lecture normalisée et les statements paramétrés `insert`/`update`. Ces statements valident également les données finales. Une commande peut les inclure dans sa propre transaction avec ses gardes métier, son audit, ses écritures annexes et son idempotence. L’adaptateur ne crée aucune transaction imbriquée. Les commandes restent responsables de leur autorisation, de la garde de droits au commit et de faire échouer leur batch si une écriture attendue ne touche aucune ligne (par exemple le `requireChanges` existant de WinHub). Une simple résolution de `db.batch` ne suffit pas à prouver qu’un UPDATE conditionnel a modifié sa cible.

Le CRUD, les comptes, l’audit et la recherche connaissent les deux stockages. L’index D1 est entretenu dans la transaction par triggers ; la réindexation reprend les tables relationnelles. Les droits et l’espace sont filtrés avant résultats, comptes et pagination. Les mises à jour et archives contrôlent la version.

## Après transaction

Les hooks `afterCreate`, `afterUpdate`, `afterArchive` suivent le commit réussi et reçoivent une copie de l’enregistrement de cette écriture. Ils ne se déclenchent pas en cas de validation refusée, rollback ou conflit. `commitWithEffects(commit, effects)` offre la même frontière aux transactions métier existantes ; `runAfterCommit` sert lorsqu’un handler a déjà confirmé son commit.

Une erreur de hook est journalisée sans message privé et indiquée dans `effects` pour le CRUD. Elle ne transforme pas le commit en échec d’écriture. Ces callbacks ont la même nature que les hooks historiques : **ils ne constituent pas une file durable**. Pour une notification ou une action externe à reprendre après une interruption, écrire l’intention dans une outbox dans le même batch, puis utiliser le callback pour sa distribution idempotente. WinHub conserve son outbox existante.

## Vérification

`tests/entity-storage.test.mjs` exécute le contrat sur SQLite et sur Cloudflare D1/Miniflare : colonnes réelles, aucun miroir `lite_records`, JSON, champs serveur/calculés, isolation, recherche/réindexation, conflits, archivage et effets. Les tests de scope du kit restent applicables aux deux adaptateurs.
