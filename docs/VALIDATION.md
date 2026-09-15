# Validation de la livraison 0.1.0

Vérifications effectuées le 15 septembre 2026 sur Node.js 24 et les dépendances verrouillées du template.

| Vérification | Résultat |
|---|---|
| Suite automatique | 15 tests réussis, aucun échec et aucun test ignoré |
| Backend D1 / R2 | Migration, transactions, invitation, conflit de version et aller-retour binaire vérifiés avec les bindings Cloudflare de Miniflare |
| Contrôles d'accès | Identité obligatoire, isolation des espaces, rôles, invitations liées à l'e-mail et révocations vérifiés |
| Erreurs de stockage | Rollback D1, compensation R2, téléchargement interdit après suppression et reprise du nettoyage vérifiés |
| Générateur | Deux briefs produisent deux projets autonomes ; aucun Site, secret, dépendance installée ou donnée du template transmis |
| Mise à niveau | Intégrité vérifiée, exécution sans changement vérifiée, refus d'écraser un socle modifié vérifié |
| WebMCP | Enregistrement de quatre outils, validation, lecture et écriture via le backend et nettoyage vérifiés dans un registre simulé |
| Atelier, exemple services | Installation selon le lockfile, typecheck, build Worker et doctor réussis |
| Réserve, exemple catalogue | Installation selon le lockfile, typecheck, build Worker et doctor réussis |
| Migration locale Atelier | 15 commandes SQL appliquées, migration réussie |
| Publication Atelier dans Sites | Réussie, statut terminal confirmé par Sites ; application privée du propriétaire |

## Portée

Les exemples sont générés dans des dossiers différents, avec leurs propres sources du socle. Atelier sert à la validation de publication dans Sites ; Réserve sert à la validation locale du second brief. Le dépôt ne contient ni identité Sites de ces exemples ni données d'utilisateur.

Les tests de session utilisent des identités de test côté backend. Ils ne constituent pas un parcours interactif de connexion avec plusieurs comptes ChatGPT réels. Aucune inspection visuelle en navigateur ni validation WebMCP dans un navigateur réel n'est revendiquée par ce rapport. Une publication réussie ne remplace pas les tests métier de chaque future application.

Le workflow GitHub Actions relance les tests et les builds à chaque changement sur main et pour les pull requests. Son statut effectif est consultable dans l'onglet Actions ; les résultats ci-dessus décrivent les vérifications effectuées lors de la livraison.
