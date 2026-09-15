# Créer une application avec Creezio Lite dans ChatGPT

Ce document est le point d'entrée destiné à l'agent qui reçoit le dépôt.

## Résultat attendu

Créer une application métier indépendante à partir de ce kit, puis la publier dans **Sites**. Le dépôt Creezio Lite reste le socle partagé. Une application client n'est jamais développée en écrasant le kit.

1. Lire `AGENTS.md`, `docs/COMPATIBILITY.md` et le README. Vérifier l'accès au dépôt et la présence des capacités Sites et d'exécution de code. Ne pas promettre de publication si ces capacités sont absentes.
2. Comprendre l'objectif, les utilisateurs, les entités, les données à mémoriser et les parcours. Poser uniquement les questions métier indispensables. Le produit doit être défini avant de choisir les modules ; les exemples ne sont pas le produit par défaut.
3. Cloner ou récupérer ce dépôt et relever son commit. Ne pas chercher de token npm Creezio : le générateur n'en a pas besoin.
4. Transformer le brief en un JSON conforme à `examples/services.json` et aux types de `packages/core/src/types.ts`. Les identifiants de modules sont stables ; les champs de sélection portent leurs options métier.
5. Exécuter `node bin/creezio-lite.mjs create --spec /chemin/brief.json --out /chemin/application-vide`. Le générateur refuse les écrasements et produit une application sans identifiant Sites, données, clés ni Git du kit.
6. Lire le `AGENTS.md` de l'application générée. À partir de là, travailler dans cette application. Utiliser la version **actuellement installée** du workflow Sites pour configurer l'environnement et installer le projet existant. Préserver son architecture, ses dépendances et son lockfile ; ne pas recouvrir le projet avec un starter générique.
7. Adapter `brand.json`, les pages, `app/business-rules.ts` et, si nécessaire, créer des tables D1 et routes métier dédiées. Le CRUD déclaratif ne remplace pas une logique de facturation, de stock ou de réservation transactionnelle.
8. Pour de nouveaux schémas, utiliser `db:generate`, examiner la migration et garder les migrations déjà appliquées immuables. Vérifier les permissions sur chaque route, la séparation des espaces et les erreurs de stockage.
9. Exécuter le doctor depuis le kit, le typecheck et le build de l'application. Tester les parcours réels demandés et les accès refusés. Pour les fonctionnalités non disponibles dans Sites, annoncer la limite et proposer une intégration compatible sans l'inventer.
10. Publier via Sites, avec l'audience autorisée par l'utilisateur. Réutiliser `.openai/hosting.json.project_id` s'il existe ; sinon enregistrer un nouveau Site une seule fois et conserver son ID exact. Le Git de l'application doit être indépendant du dépôt du kit. Vérifier le statut final de publication avant de remettre l'URL.

## Connexion et partage

La version 0.1 utilise Sign in with ChatGPT, pas les mots de passe du Creezio original. Le partage Sites et les membres d'un espace applicatif sont deux contrôles complémentaires. Une invitation applicative ne modifie jamais le partage Sites. Une app client publique avec un autre fournisseur d'identité nécessite une adaptation validée avec les capacités Sites du moment.

## Brief minimal

« Une app pour [public] qui permet [activité]. Les utilisateurs gèrent [entités], avec [champs/règles]. Les rôles sont [rôles]. Les données doivent être conservées. Je veux la publier dans Sites. »

Si la personne dit seulement « Crée une app à partir de Creezio Lite », commencer par lui demander ce que l'app doit permettre de faire. Aucun module métier arbitraire ne doit être présenté comme son application terminée.
