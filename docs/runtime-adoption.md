# Adoption des runtimes ingress et profils d’accès

Statut : guide de la candidate 0.15.0, disponible comme version seulement après publication du tag validé ; la présence de code sur une branche d’intégration ne prouve ni sa publication ni son adoption. Les interfaces décrites viennent des contrats public-ingress/access-profiles et du runtime examinés. La publication doit fixer un tag immuable, son SHA, les migrations distribuées et les preuves de CI correspondantes.

## Choisir les capacités nécessaires

Ingress et profils d’accès sont des opt-ins distincts. Une application n’active que ce dont elle a besoin. L’absence de `AppExtensions.access` conserve le mode legacy ; ajouter cette déclaration active immédiatement les contrôles de profils et peut placer l’espace en état incomplete tant que son reçu n’est pas valide. Ne pas activer des routes publiques pour contourner des permissions privées.

### Ingress signé ou accès invité

Déclarer les entrées dans `AppExtensions.publicIngress`, en utilisant `PublicIngressDeclaration` : `entries`, `resolveTenant(entry)` et `createRequestScope(services)`. Chaque entrée possède notamment id, method, path, admission, tenantId, maxBytes, contentTypes, timeoutMs et abuse. Le tenant vient exclusivement de la configuration serveur ; ni corps, ni query, ni cookie ne le déterminent.

- `admission: signed` : événement machine vérifié par `verify`, avec identifiant d’événement stable et `claimStore` persistant. Le kit fournit `createD1ClaimStore`; sa table exige la migration ingress. Les octets reçus restent intacts jusqu’à la vérification. Si `vaultRef` est déclaré, le coffre est résolu pour ce tenant avant la preuve ; une intégration absente, désactivée ou illisible bloque. Le protocole de signature du fournisseur reste dans l’adaptateur applicatif.
- `admission: guest` : `admitGuest` borne une consultation ou un accusé, sans identité d’espace, sans autorité de paiement et sans ClaimStore. Pour un GET de lecture : `maxBytes: 0`, `contentTypes: []`, aucun corps JSON exigé. La connaissance d’un jeton de chemin ne vaut pas appartenance à l’espace.

La factory alloue des bindings propres à la requête ; pas de singleton ni d’effets métier lors de la validation. Passer le catalogue privé complet à la validation des extensions : un catalogue omis ou vide ne prouve pas l’absence de collision. Préserver l’entrée mail native et les routes privées. Déclarer les dépendances d’abus réellement disponibles ; un `limiter` requis doit être fourni. Dépendance indisponible : refus avant handler, jamais faux succès.

Le ClaimStore protège la réception et le rejeu d’un résultat ; il n’englobe pas automatiquement la transaction métier. Un timeout n’annule pas un effet déjà commis. L’application conserve ses garanties d’idempotence et son traitement des effets externes.

### Profils d’accès, reçu et récupération

Déclarer `AppExtensions.access` avec `AccessDeclaration` : `catalogRevision`, `profiles` et `capabilities`. Les capacités citent de véritables opérations du catalogue. Les profils fixent revision, capabilities, receivableBy, assignableBy et `assignmentApproval: owner`. Les rôles des opérations restent un plafond. Aucun profil n’est déduit des groupes natifs `role:*`.

Préparer les groupes personnalisés et leurs membres dans l’espace concerné. Le reçu `AccessAdoptionReceipt` contient la même catalogRevision, des bindings `{groupId, profileId, profileRevision}` et éventuellement validUntil. Lire l’état/version par `GET /api/v1/access/catalog`, puis utiliser les routes natives, avec la session administrative et les contrôles de délégation :

- `PUT /api/v1/access/receipt` : `{receipt, version}` ; adoption initiale puis remplacement contrôlé.
- `POST /api/v1/access/bind` : `{groupId, profileId, profileRevision, version}`.
- `POST /api/v1/access/unbind` : `{groupId, profileId, version}`.

La version est celle effectivement lue du reçu, sans substitution silencieuse après conflit. Révision périmée, reçu expiré/absent ou liaisons invalides maintiennent l’état incomplete et le refus des opérations métier. Les routes natives de récupération restent soumises au rôle et à la délégation ; elles ne donnent aucun bypass métier à owner. Corriger le reçu par ce chemin, jamais par modification directe des tables ou suppression de la déclaration pour rouvrir les accès.

Le snapshot et ses fermetures sont propres à une requête et un espace. Les jobs et les nouvelles requêtes reconstruisent leurs observations. `observedProfileIds` n’est pas une ACL. `allowed` ne donne pas accès aux lignes ni aux champs : le filtre applicatif user/entité reste obligatoire, owner compris. Utiliser les ports `ScopeProvider.recordFilter` et `fileFilter`, avec leur contexte d’accès lorsqu’il est fourni par l’opt-in ; ne pas créer un évaluateur concurrent. Réceptionner aussi les opérations applicatives, fichiers, recherche, compteurs, navigation, catalogue et outils exposés. Ne pas annoncer la couverture d’une surface seulement parce que le helper pur existe.

## Fusion du schéma et des migrations

1. Figer les commits application/kit, sauvegarder les sources et préparer une copie locale représentative des données. Préserver l’identité du déploiement, les bindings, les secrets, les personnalisations et les dépendances applicatives.
2. Utiliser des checkouts isolés LF à partir des octets Git. Les empreintes du kit sont brutes : une conversion CRLF peut produire des centaines de faux écarts. Vérifier ces écarts ; ne pas changer les empreintes pour les masquer et ne pas écraser de véritables modifications locales.
3. Exécuter `doctor` et le préflight `upgrade` depuis le checkout kit retenu. Un refus de schéma impose la fusion explicite. `upgrade --apply` ne fusionne ni `db/schema.ts`, ni les migrations, ni leurs métadonnées. `adopt --apply` distribue uniquement le standard d’orchestration.
4. Fusionner le runtime et les ajouts de `db/schema.ts` en conservant les tables applicatives. Ajouter les SQL natifs `0011_public_ingress_claims.sql` et `0012_access_profiles.sql` depuis le tag retenu, après contrôle des collisions. Préserver tous les SQL déjà appliqués et les migrations applicatives, quel que soit leur préfixe numérique. Aucune renumérotation, réécriture ou suppression d’historique.
5. Fusionner les nouvelles métadonnées Drizzle dans l’historique applicatif. Ne pas remplacer le journal par celui du kit ni greffer aveuglément une chaîne de snapshots issue d’une autre branche. Les nouvelles entrées ne doivent ni modifier les anciennes, ni perdre les définitions applicatives. Si le moteur réellement utilisé impose un ordre temporel incompatible, résoudre son plan d’application avant toute exécution ; ne pas prétendre que l’ordre des noms suffit universellement.
6. Recette D1 : construire une base neuve avec l’ensemble final, puis migrer une copie au niveau applicatif précédent avec uniquement les migrations manquantes. Le lanceur `migrate` fourni dans `scripts/migrate-local.mjs` utilise les noms de `d1_migrations`, trie les fichiers manquants et garde les blocs `statement-breakpoint` entiers ; contrôler le comportement du lanceur réellement utilisé par l’application. Préserver les corps de triggers.
7. Vérifier tables, colonnes, index, clés étrangères et triggers réellement créés, conservation des lignes/données applicatives, backfill des espaces existants, création d’un nouvel espace, conflits CAS et rollback sans effets partiels. Un deuxième passage doit appliquer zéro migration. Tester la concurrence des claims et les écritures d’accès sur D1, pas seulement sur une imitation de base.
8. Seulement après contrôle des sources finales et du schéma réel local, régénérer `lite.lock.json` par l’export existant `writeLock(app)` du checkout kit exact. Il calcule le hash du schéma fusionné réel et les hashes du runtime présent. Ce helper n’est pas une commande CLI, ne migre rien et ne vérifie pas la base ; son invocation doit être accompagnée des preuves précédentes. Ne jamais copier le hash du template dans le verrou pour débloquer `upgrade`.
9. Relancer doctor, tests applicatifs, typecheck et build ; revue et CI du SHA final. Un schéma applicatif étendu peut légitimement continuer à refuser un futur upgrade automatique. Documenter la fusion au lieu d’altérer son empreinte.

## Recette fonctionnelle et reçu d’adoption

Prouver ingress avec requête valide, signature invalide, autre tenant, coffre désactivé, payload trop grand, dépendance absente, replay identique, collision de digest, run concurrent et fence périmé. Pour guest, prouver refus du jeton invalide et absence de claim ou d’autorité métier implicite. Aucun secret dans les réponses, snapshots ou journaux.

Prouver accès legacy sans déclaration, incomplete avant adoption, récupération autorisée, profil lié valable, refus après révocation/expiration, conflit de version et absence d’effet partiel. Vérifier que deux utilisateurs aux portées différentes restent isolés même si leurs profils autorisent la même opération. Une permission d’outil ne doit pas contourner la permission de son opération interne.

Le reçu d’adoption conserve tag/SHA du kit, SHA applicatif, diff revu, empreintes SQL historiques préservées, état des migrations avant/après, preuves du schéma local et tests/CI. Le pilote applicatif applique ensuite les migrations et déploie dans son mandat, vérifie la base cible et les parcours. Distinguer code préparé, CI réussie, migrations appliquées et application effectivement publiée. Aucun automatisme de déploiement n’est créé par ce guide.
