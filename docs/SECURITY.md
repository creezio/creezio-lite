# Sécurité et limites de confiance

## Identité et espaces

En production, l'application fait confiance uniquement aux informations transmises par le dispatcher Sites. Elle doit être déployée derrière ce dispatcher ; exposer le même Worker directement sur un autre hébergement sans vérification d'identité créerait une faille. Le serveur ne prend ni le rôle ni l'utilisateur depuis le corps d'une requête.

La simulation locale d'identité est limitée au serveur de développement portable du starter. Elle supprime les faux en-têtes entrants et ne fait pas partie du bundle de production. Aucun compte de démonstration partagé ne remplace l'authentification.

Chaque requête vérifie l'appartenance de l'utilisateur à l'espace. Les requêtes de données sont filtrées par l'espace et le module. Les autorisations ne sont pas mises en cache dans le backend ; un retrait de membre prend effet sur la requête suivante. Les seules restrictions de navigation ne constituent pas une protection.

Les rôles propriétaires sont protégés. Un administrateur peut inviter des collaborateurs et lecteurs ; seul le propriétaire peut inviter un autre administrateur ou modifier/retirer un membre. Une invitation utilise un jeton aléatoire de 256 bits, haché en base, lié à l'e-mail authentifié et valable sept jours. L'invitation n'envoie aucun message ni ne modifie le partage du Site.

## Écritures

Les mutations nécessitent l'Origin exact. Le backend refuse les champs inconnus et les données invalides, borne la taille du JSON et utilise des paramètres SQL. Un PATCH remplace les champs métier validés et exige la version lue. L'écriture et son journal sont dans le même batch transactionnel D1.

Les règles entre plusieurs enregistrements doivent utiliser une contrainte ou une transaction spécialisée. Un callback de validation seul n'élimine pas une course concurrente. Les compteurs et la recherche générique ne sont pas conçus pour un traitement analytique massif.

## Fichiers

Les fichiers sont stockés sous une clé opaque préfixée par l'espace. Aucun bucket public ni lien d'objet direct n'est exposé. Tous les téléchargements sont authentifiés, filtrés par espace et forcés comme pièces jointes avec `nosniff`. Le type déclaré par l'utilisateur n'est pas utilisé pour exécuter du contenu dans l'origine du Site.

La limite de 10 Mo est contrôlée pendant la lecture, même sans Content-Length. D1 et R2 n'ont pas de transaction commune : l'upload compense une erreur de métadonnées par une suppression R2 ; si cette compensation échoue, l'objet sans métadonnées reste inaccessible. Les suppressions révoquent d'abord les métadonnées. Un échec de nettoyage physique doit être repris par l'opération de suppression ou un outil de maintenance.

Pas d'antivirus ni de classification des fichiers inclus : ajouter ces traitements si le produit l'exige. Les limites et quotas Sites s'appliquent ; aucun mécanisme de facturation, de limitation de débit par client ni de sauvegarde/export automatique n'est présenté comme livré.

## Configuration et logs

Aucun secret n'est requis pour utiliser l'identité et le stockage gérés par Sites. Les intégrations externes doivent stocker leurs clés dans les paramètres Sites, jamais dans `brand.json` ou le navigateur. Les erreurs de stockage renvoient un identifiant de requête sans SQL, données métier ni jeton d'invitation.

Les migrations appliquées sont immuables. Une modification du code ne doit pas réinitialiser les bases. Les fichiers originaux Creezio repris et les adaptations sont référencés dans UPSTREAM.json ; maintenir les mises à jour des dépendances et les contrôles du socle avant une diffusion à de nouveaux clients.
