# Architecture

## Séparation des responsabilités

| Couche | Propriétaire | Contenu |
|---|---|---|
| Kit | Creezio Lite | Validation, API, contrôles d'accès, composants et générateur |
| Application | Créateur de l'app | Identité, modules, pages et règles métier |
| Hébergement | Sites | Publication, identité des visiteurs, ressources D1/R2 et secrets |

Le serveur reçoit une requête via le dispatcher Sites. La route Next/Vinext résout l'identité avec le helper officiel, puis appelle `handleApi`. Le backend vérifie l'origine des mutations, l'appartenance à l'espace et le rôle avant toute opération.

Chaque opération métier utilise un `org_id` issu d'une appartenance vérifiée, jamais un rôle choisi par le client. Les données structurées sont dans D1 ; les fichiers sont dans R2 avec leurs métadonnées et propriétaires dans D1. Une autre application dispose d'un autre projet Sites et d'autres ressources.

## Modèle de données

- `lite_users` : identités stables transmises pour ce Site.
- `lite_orgs` : espaces de travail.
- `lite_members` : relation utilisateur/espace et rôle.
- `lite_records` : documents des modules déclaratifs, données JSON validées, version et archivage.
- `lite_files` : métadonnées, clé d'objet privée et suppression logique.
- `lite_audit` : journal transactionnel des modifications.
- `lite_invites` : invitations liées à l'e-mail, jeton haché, expiration et révocation.

Les tables métier dédiées doivent porter une clé d'espace et les contraintes nécessaires. Les champs texte nommés « client » dans l'exemple sont du texte libre, pas une relation garantie vers un client. Ne pas les utiliser comme une clé étrangère implicite.

## Version du socle

Le générateur copie les sources de `packages/*/src` dans le dossier `creezio/` de la nouvelle application. `creezio-lite.lock.json` enregistre la version, le commit Creezio d'origine et le SHA-256 de chaque fichier du socle. Ce snapshot est autonome et committé avec l'application. Il ne requiert aucun registre npm Creezio.

L'upgrade compare le contenu réel avec les empreintes enregistrées, prépare le nouveau runtime et le remplace avec sauvegarde. Il ne réécrit pas `brand.json`, les pages métier, les secrets ni l'identité Sites. Les changements de schéma commun ne passent pas automatiquement : une migration doit être conçue et appliquée.

Les contrats D1/R2 et l'authentification Sites sont accessibles via de petites interfaces. Les fonctions système Creezio ne sont jamais chargées puis désactivées : elles sont absentes du runtime Lite.
