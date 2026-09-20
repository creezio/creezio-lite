# Versions de Lite

## 0.15.14 — 2026-09-20

- Corrige les deux expressions `,CASE` de la migration canonique `0003_search_index.sql` afin que Wrangler 4.92.0 conserve chaque trigger comme un statement complet. Le SQL et les objets D1 restent identiques.
- Exécute le contrôle de découpage Wrangler sur toutes les migrations du template dans la CI et couvre les régressions `,CASE` et `*CASE`.
- Les nouvelles applications reçoivent la migration corrigée. Une application existante conserve une migration déjà appliquée ; si `0003_search_index.sql` n'a jamais été appliquée, les deux espaces peuvent être reportés explicitement. Ce contrôle ne prouve pas la compatibilité de l’exécuteur d’hébergement : publication Sites et recette D1/R2 restent nécessaires.

## 0.15.13 — 2026-09-20

- Align administrative Navigation and Activity links with their actual operations. Workspace administrators receive these operations within role and token limits, while explicit denials remain effective. Recovery exceptions are unchanged.
- Render structured navigation API errors as readable text instead of crashing React.
- Add endpoint, mutation, member-denial and UI error regressions.

## 0.15.12 — 2026-09-20

- Preserve a browser tab identity across reload and navigation while distinguishing duplicated/live windows. Conditional release tokens prevent a late pagehide from deleting a renewed lease.
- Keep module record search below the D1 expression-depth limit by applying row permissions once, before counting and pagination. Global search and field visibility retain their existing filters.
- Add browser identity/release regressions and exercise module API and MCP tool search on Miniflare D1.

## 0.15.11

- Les reprises conservent le bail du document : seul le départ de page ou le démontage du provider le libère. Un nettoyage de tentative ou une réponse connect obsolète ne peut plus supprimer le nouveau bail de la même fenêtre.
- Le garde de session intercepte pointerdown directement sur le dialog natif, avant les écouteurs document de Radix. La reprise au pointeur conserve ainsi les modales et leurs brouillons aussi dans les applications hydratées sur document.
- La régression vérifie l’installation et le nettoyage de cet écouteur ; la recette sur WinHub confirme la conservation du formulaire après Escape, pointerdown, pointerup et clic de reprise.

## 0.15.10 — Sessions, analytics essentiels et conflits d’unicité

- Le garde de session navigateur utilise la top layer native, reste actionnable au-dessus d’une modale applicative et conserve le brouillon pendant la reprise de main.
- L’ingestion analytics essentielle reste disponible pour les sessions des rôles autorisés après adoption des profils ; les lectures administratives restent soumises à leurs droits et les jetons restent exclus.
- Les créations et modifications génériques qui perdent une course sur une contrainte SQL d’unicité reçoivent HTTP 409 `unique_conflict`, sans exposer le nom de l’index, la table ni la valeur concurrente.
- La ligne et l’audit du perdant restent annulés atomiquement. Les erreurs de contrainte non reconnues conservent leur réponse générique ; aucune erreur SQL privée n’est renvoyée.
- Aucun changement de schéma ni migration. Après publication de la release, utiliser `lite upgrade`, puis reconstruire l’application.

## 0.15.9 — Analytics sans relance après refus d’accès

- Le buffer d’analytics abandonne les lots refusés avec HTTP 401 ou 403 au lieu de les remettre en file et de répéter les requêtes.
- Les erreurs réseau et les réponses serveur transitoires restent réessayées. Les permissions, les profils d’accès, les données et le schéma ne changent pas.
- Aucune migration ni nouvelle clé n’est requise. Les applications peuvent adopter le runtime par la procédure habituelle après publication de la release.

## 0.15.8 — Outils de chat sélectionnés par profil

- Les applications peuvent définir un ensemble d’outils MCP actif par défaut pour chaque profil d’accès observé côté serveur. Les réglages administrateur enregistrés restent prioritaires ; les permissions et les espaces restent contrôlés à chaque appel.
- Le chat natif reçoit des instructions et une sélection d’outils propres au métier. La recherche et l’appel différés remplacent la troncature silencieuse des catalogues dépassant la limite fournisseur, avec revalidation du schéma final et des droits actuels.
- Sans configuration applicative, les defaults MCP existants restent inchangés. Aucune migration de base ni nouvelle clé n’est requise. Voir docs/ASSISTANT-TOOLS.md.
## 0.15.7 — Assistant adapté à la largeur disponible

- Le shell et le widget partagent les modes docké, superposé et plein écran. Un panneau docké conserve au moins 640px de contenu après la sidebar ; sinon il se superpose sans padding droit.
- Superposition modale avec focus et fermeture natifs Radix ; conversation et saisie conservées au redimensionnement. Aucun changement de transport, de secret ou de schéma. Voir docs/ASSISTANT-PANEL.md.

## 0.15.6 — Erreurs de connexion navigateur explicites

- Les erreurs non JSON de la session affichent un message de connexion adapté tout en conservant le statut HTTP ; les réponses invalides ne sont plus interprétées comme un conflit de fenêtre.
- Après une erreur, la reconnexion manuelle ne force pas la prise de contrôle d'une autre fenêtre. Les règles de bail et de reprise explicite restent inchangées ; aucune écriture métier n'est rejouée.
- Aucune migration ni modification de secret. Utiliser `lite upgrade`, puis compiler. Ce correctif ne résout pas une panne réseau sous-jacente de workerd.

## 0.15.5 — Diagnostic Resend à accès limité

- Le diagnostic reconnaît une clé Resend limitée à l’envoi lorsque la lecture des domaines répond avec l’erreur structurée `restricted_api_key`. Les autres refus restent signalés.
- Le résultat précise que le domaine et l’envoi effectif ne sont pas vérifiés ; aucun message de test n’est envoyé. Aucun changement de données ni migration.
- Mise à jour applicative : utiliser `lite upgrade`, puis compiler le runtime distribué.

## 0.15.4 — Navigation fiable vers les fiches

- Les liens de titre utilisent une navigation navigateur complète, exclue de l’intercepteur d’onglets. Cela évite un chargement permanent lors d’une transition ne changeant que la query sous Vinext.
- Liens clavier, ouverture dans un nouvel onglet et contrôles d’accès conservés. Aucun changement de données ni migration ; utiliser `lite upgrade` puis compiler.


## 0.15.3 — Ouverture des fiches depuis les listes

- Les titres des lignes ouvrent leur fiche native, avec lien accessible au clavier et identifiants encodés.
- Recherche, filtres, actions et contrôles serveur inchangés. Aucun changement de données ni migration.
- Mise à jour applicative : utiliser `lite upgrade`, puis compiler le runtime distribué.


## 0.15.2 — Accès natifs, recherche D1 et validation Windows

- Gardes transactionnelles natives et publication durable des documents générés.
- Recherche avec scopes complexes : jointures audit bornées et paramètres D1 sous la limite, sans élargir les droits.
- Validation Windows : URLs ESM, jonctions et fins de ligne ; erreurs de commande préservées.
- Synchronisation du template sérialisée, avec sauvegarde et restauration en cas d’échec. Les compilations et lectures doivent rester séquentielles avec la synchronisation.


## 0.15.1 — Recherche D1 avec scopes complexes

- Corrige l'erreur D1 de profondeur d'expression en recherche avec profils d'acces actifs et filtres applicatifs complexes. Des ensembles de visibilite materialises separent les scopes des expressions FTS/audit.
- Permissions, filtrage avant comptes/extraits/pagination, classement et refus des ressources hors scope conserves ; parcours legacy inchange. Aucun changement de schema ni migration.
- Regression reproduite sur D1 local reel ; equivalence verifiee avec scopes profonds, fichiers, audit, isolation entre espaces, termes multiples et pagination. La limite intrinseque D1 reste applicable aux predicats applicatifs.


## 0.15.0 — Entrées publiques et profils d’accès natifs

- Candidate : publication seulement après revue et CI du commit exact de main, puis tag immuable.
- Ingress opt-in signed/guest, factory par requête, coffre avant preuve et intégrations désactivées refusées ; ClaimStore D1 avec fences et rejeu borné. Le timeout ne compense pas les effets métier déjà commis.
- Profils/capacités opt-in, reçus et liaisons natifs, récupération incomplete et mutations avec CAS ; contrôles communs sur opérations, découverte, fichiers, recherche et contextes applicatifs. Les filtres de portée applicatifs restent obligatoires, owner compris.
- Migrations additives 0011_public_ingress_claims et 0012_access_profiles. Fusion applicative explicite du schéma, des métadonnées et du runtime : voir [le guide d’adoption](docs/runtime-adoption.md). Aucun upgrade forcé ni déploiement applicatif automatique.
- Conserve le correctif de lecture Cursor 0.14.2. Les tests du kit utilisent des fixtures et des recettes locales ; ils ne prouvent pas un déploiement ni les permissions réelles d’une application.
- Hors livraison : transactions métier K02, invitations à portée ressource K05 et création durable de fichiers de jobs. Les adaptateurs de signature, jetons guest et liens métier restent applicatifs.

## 0.14.2 — Lecture de secours Cursor pour les missions connues

- En cas de timeout, erreur réseau ou 5xx sur la lecture agent, le transport peut retrouver le dernier run via la liste ordonnée du même compte, puis relire ce run exact. Le run déjà connu doit être présent ; identités, dates et ordre sont vérifiés. Aucun changement de compte ou de modèle.
- Une liste inchangée ne résout pas une reprise dont le POST est incertain. Les créations sans run connu restent en attente de réconciliation. Aucun POST répété automatiquement.
- Tests de régression sur fixtures : réponses incohérentes, run actif, liste périmée, clé refusée et POST incertain. Cette correction ne rétablit pas le service Cursor et ne livre pas les runtimes natifs en préparation.
- Version candidate jusqu’à publication de la release GitHub au SHA validé.

## 0.14.1 — Contrats C01 et ACCESS, propositions acceptées

- Reprend `0.14.0` déjà publié (`92e557e26c2d0ab2251965efbe7d416831d2fb90`). Transport Cursor **identique** à `main` 0.14.0. Aucun runtime livré (ingress ou accès). **Pas d’upgrade forcé.**
- Deux contrats **acceptés** comme spécification pour de futures implémentations :
  - C01 `docs/contracts/public-ingress.md` et `docs/contracts/public-ingress-tests.md` : factory request-scope serveur (`createRequestScope` après `resolveTenant` config), `AppExtensions.publicIngress`, bindings `db`/`env`/`requestId`/`tenant` pour les fermetures ; pas d’Identity simulée ; `db`/`env`/secret jamais sérialisés.
  - ACCESS `docs/contracts/access-profiles.md` et `docs/contracts/access-profiles-tests.md`, blobs identiques à `06f227b6942fa9b2712414825f630eb04151df01`.
- Chaînes de version package/lock/template API/MCP alignées ; assertions de version des tests existants alignées. Pas de tests exécutables nouveaux. Pas de modification du transport.
- Version **candidate** jusqu’à la release GitHub `v0.14.1` au SHA de `main` ; cette note n’est pas une publication.

## 0.14.0 — Références secondaires explicites dans le transport Cursor

- Reprend `0.13.2` déjà publié (`ec0f7d93`, boucle active et fermeture de cycle). Pas de modification fonctionnelle du transport par rapport à `4f01e642`.
- `cursor-agents.mjs` : `--references-file` JSON strict `[{url,sha}]` (SHA 40 hex immuable, ≤19 sources, URL GitHub HTTPS sans userinfo/query/fragment). La cible unique reste `--repo`/`--ref` ou `--pr-url`. Doublons normalisés et source = cible refusés. Pas de branche/tag mouvant ni de `prUrl` source.
- Avant POST, `GET /v1/repositories` paginé du compte sélectionné doit lister la cible et chaque source ; un manquant bloque sans POST. Le reçu sépare `demanded` / `visible` / `submitted` / `accepted` / `checkoutObserved` : 400 ⇒ `accepted` null ; 201 ⇒ repos exposés par la réponse sinon null, jamais un écho du payload. Un mismatch demandé/exposé conserve les deux preuves et bloque l’exploitation avant le pod. Lecture seule des sources : consigne d’orchestration, pas une ACL fournisseur.
- Références immuables persistées (ordre canonique) et validées à l’idempotence ; entrée ancienne sans `references` inchangée. Input différent sur une mission existante ⇒ `input_changed`. `followup` conserve l’ensemble initial ; `successor` recopie les SHA et revalide le catalogue du compte cible. 404/timeout/409/uncertain inchangés. Tests sur mocks ; pas de sonde API réelle. Aucun changement du pool DPAPI, du runtime métier, du schéma ni de `docs/contracts/public-ingress*`.
- Réception utile : deux dépôts, SHA source déjà intégré à la default d’une source catalogue. POST 201 : deux `repos` exposés identiques au payload ; les deux HEAD extraits observés concordent avec la requête puis la réponse (`9b3bf63b1ebf8e5b0e8f7f0c44bae60a048c18e5` cible kit, `354155e25c0a7948db73087f872d1ae3970c41b5` source). Pas de clone ni de repli. Une revue de contrat a relevé des défauts contractuels sans invalider cette extraction.
- Limites : la cause de l’ancien `400 validation_error` (source SHA, catalogue visible, puis GET 404 `not_created`) **n’est pas établie**. Ce n’est pas une promesse que tout SHA est accessible. Pas de remplacement automatique SHA→branche, pas d’omission de source, pas de nouvelle référence autorisée par le kit. Contrôler les refs (catalogue, payload, réponse, HEAD) **avant chaque consommation**, à chaque mission. Échec visible ≠ crédits épuisés.
- Version **candidate** jusqu’à la release GitHub `v0.14.0` au SHA de `main` ; cette note n’est pas une publication.

## 0.13.2 — Boucle active d’orchestration et fermeture de cycle

- `SKILL.md` : section boucle active (rester dans le tour, outils existants, polling progressif borné ; `RUNNING`/CI pending n’est pas une fin). `status --follow` émet au changement et continue tant que non terminal. Frontières kit/app. Renvoi court `CONTRACT.md` §10. Pas de moteur ni de daemon.
- `docs/MAINTENANCE.md` : fermeture de cycle réception → revue → CI de la tête exacte → fusion → CI de `main` → release → notification → suppression de branche, avec preuves SHA/PR. Pas de suppression d’une branche active ou non fusionnée ; `delete_branch_on_merge` est configuré. Aucune routine/cron pour cette boucle ; pas de processus autonome après fin de session.
- Pas de `--references-file`, pas de nouveau runtime métier. Chaînes de version API/MCP alignées. Le skill se met à jour par `lite adopt` ; pas d’upgrade runtime forcé pour cette documentation. Copies personnelles de compétence non écrasées.

## 0.13.1 — Frontmatter de compétence LF et CRLF dans le CLI (`create`/`adopt` seulement)

- `skillFrontmatter` dans `bin/lite.mjs` accepte les délimiteurs `---` et les fins de ligne LF ou CRLF ; `name` et `description` restent exigés sur une seule ligne, le frontmatter malformé est toujours refusé sans écriture partielle.
- `create` et `adopt` (inspect, `--apply`, second `current`) fonctionnent sur un checkout kit `core.autocrlf=true` **via le même checkout source** ; une édition locale réelle d’un fichier géré reste un conflit.
- Ce n’est pas une compatibilité globale CRLF : empreintes brutes, `doctor` croisé kit LF / copies CRLF, clone d’app converti (faux conflits 12 copies + runtime vs verrou), `check-kit` et le test canonique LF-stricts restent hors lot. Recette kit : octets LF. Réception fiable : checkout isolé `git -c core.autocrlf=false` et `core.eol=lf`, sans config globale. Ne pas falsifier lock/manifest ni forcer `adopt` sur un clone déjà converti.
- Ressources distribuées inchangées : une adoption 0.13 valide n’exige ni ré-adoption ni upgrade runtime pour W01. Pas de normalisation globale des empreintes (lot distinct). Aucun changement du transport Cursor, du pool, de la planification, du runtime métier, du schéma, des migrations ni de la politique Git.

## 0.13.0 — Planification parallèle des missions, pool commun de comptes et distribution complète du standard

- Contrat de planification v1 `PLANNING.md` (P1) : plan public (`docs/planning/plan.json`) et état privé hors dépôt, schémas JSON 2020-12 `planning-plan.schema.json` / `planning-state.schema.json`, exemples génériques ; dépendances par étape (`start`/`integrate`/`publish`), conditions d’acceptation sourcées distinctes de `delivered`, réservations de chemins par dépôt et de ressources sémantiques tenues jusqu’à l’intégration, statut `historical`, capacité par périmètre (`0` valide, `null` non fiable), invariants d’état refusant toute incertitude effacée.
- Outil `scripts/plan-missions.mjs` (P2) : `validate` et `ready` en lecture seule, déterministes, sans réseau ni horloge ; graphe (mission, jalon) avec cycles nommés, propositions incrémentales `integrate`/`publish`/`resume`/`start` avec raisons fermées, codes 0/2/3/4 ; données lues par propriété propre, instants vérifiés calendairement.
- Composition (P4) : provenance `legacySelection {reason:"model_omitted"}` exclusive de `selection` sur un jalon terminal (aucun `modelId` par défaut, jamais `start`/`resume` : `selection_unknown`), libellé `run_terminal_unreconciled` pour une mission active dont le run est déjà terminal, `unknown` tenant prudemment ses réservations, `covers` de publication sans `publish_serialized`, `start` et `resume` écrivant `active`/`launch:pending` avant tout POST, transfert explicite borné de propriété pour composer des lots livrés. Oracle §5 égal à la sortie réelle, vérifié par `check-kit` et les tests. Revues et investigations : livraison sur branche + `headSha` réels sans PR (`prUrl` exigée par le validateur croisé pour un `dev` livré), reprise sur le même agent via `correction.requested` sans agent créé, réouverture explicite `closed` → `delivered` tracée par l’événement `reopened` avec preuve terminale conservée (`closed` exige désormais cette preuve : branche, base, agent, run terminal, lancement réconcilié, `headSha`) ; les validations du pilotage sont des conditions sourcées, pas des missions. Lancement accepté sans lecture de run rapporté `run_status_unread` (compté, réservé, jamais `run_active`) ; `review_backlog_full {count,max}` et réévaluation explicite tracée du seuil local de revue par le pilote (`capacity.note`), sans exception automatique ; limite v1 assumée : le lien revue / nouveau head de l’auteur n’est pas vérifié par l’outil (`correction.requested` = décision prouvée du pilote). `SKILL.md` et `CONTRACT.md` (§3, §4, §6, §8, §10) renvoient au contrat de planification pour chaque plan approuvé.
- Pool commun de comptes Cursor (P5, `CONTRACT.md` §9) : adaptateur distribué `scripts/cursor-account-pool.mjs` (coffre `credentials.json` DPAPI CurrentUser déchiffré par PowerShell via l’entrée standard, état partagé `pool-state.json` sous verrou exclusif et remplacement atomique, classification exacte des refus fournisseur, décision déterministe, aucun repli Composer) ; transport `cursor-agents.mjs` : `CURSOR_API_KEY` en compatibilité sinon pool, clé du propriétaire pour toutes les lectures et reprises, `successor --checkpoint` sur compte suivant avec chaîne conservée, `accounts` ; exception Grok 4.6 seulement sur preuve datée d’accès standard, `selection` initiale et `currentSelection` distinctes dans les reçus ; livraison persistée (`delivery`) : après délai/réseau/5xx un 404 ne prouve jamais l’absence, l’entrée reste `uncertain` sans second POST et seule l’attestation humaine `reconcile --confirm-absent` conclut (`attestedBy: human` = déclaration non vérifiée, pas une signature) ; `delivery.conflict` (409 puis 404) reste `conflict_unreadable`, jamais `not_created` automatique ; `startBlock` après refus de plafond (deux messages `usage_limit_exceeded` exacts, dont « Usage-based pricing required… ») jusqu’à validation explicite `--account` ; un `hard_limit_start_refused` avéré compte dans l’indisponibilité de départ sans convertir `custom` ; sélection initiale Grok automatique exige une preuve, amorçage `--account` distinct ; reprise de prédécesseur `recheck_required`/inactif sans POST automatique. Aucun daemon, aucune routine de crédit, aucun quota supposé ; tests sur fixtures fictives et déchiffreur simulé (le support DPAPI réel se vérifie hors kit ; le code DPAPI reste inchangé par rapport à `7ee5afbe`).
- Distribution et découverte (P3) : toute ressource du dossier canonique `.cursor/skills/lite-orchestration/` est copiée par `create`/`adopt` via `manifest.json` (douze fichiers gérés : onze dans le dossier de la compétence, dont l’adaptateur du pool, plus la règle) ; point d’entrée Codex/Cursor `.agents/skills/lite-orchestration/SKILL.md` généré depuis le frontmatter canonique (`manifest.generated`), confinement `lstat`, conflits refusés sans écriture partielle, compétences locales préservées ; `check-kit` contrôle la découverte, l’autonomie des scripts et la validité des exemples.
- Template : alias public `@lite/sites-adapter/catalog` dans `tsconfig.json` (F01) avec test de build.
- Aucun changement du runtime métier, du schéma, des migrations ni des secrets ; seules les chaînes de version API/MCP sont alignées.

## 0.12.0 — Standard d’orchestration Astra ⇄ Cursor

- Source canonique `.cursor/skills/lite-orchestration/` : compétence à chargement progressif, contrat compact (rôles, sélection, brief, checkpoints, réception, revue), sélections autorisées `cursor-model.json` (`fable` = `claude-fable-5-1` par défaut, `opus` = `claude-opus-5`, `grok` = `grok-4.6`, chacune avec sa combinaison complète relevée dans le catalogue, `fast`/`cyber` à `false` ; aucun repli).
- `scripts/cursor-agents.mjs` : préflight du catalogue daté (identifiant exact, combinaison strictement égale à une variante ; aucune complétion ni repli), sélection choisie une fois au lancement et conservée dans le registre, lancement dédupliqué par identifiant d’agent déterministe, réconciliation des 409 et des appels incertains, checkpoints à polling progressif rappelant la sélection sans journaux complets, reprise du même agent après terminal sans champ `model`, reçu `requested/catalog/createAccepted/runAccepted/modelObserved`. Clé uniquement en environnement ; sorties sans secret.
- Générateur : installation automatique dans les nouvelles applications ; `lite adopt --app [--apply]` pour les applications existantes, avec manifeste, idempotence, refus explicite des conflits locaux et des liens symboliques sur les chemins gérés (contrôle `lstat` avant toute écriture) ; information `orchestration` dans le doctor.
- Documents et règles renvoient à la source unique. Aucun changement du runtime, des migrations, des secrets ni des providers IA métier ; versions API/MCP alignées.

## 0.11.0 — Registre de domaine et opérations applicatives

- Ajoute les modules entity/collection, commandes et lectures déclarées, avec un catalogue commun HTTP/MCP/WebMCP et assistant.
- Applique les filtres de portée aux fiches, comptes, recherche et fichiers ; délègue la suppression de fichiers à la politique configurée.
- Propage les références de credential vérifiées et la corrélation ; borne les détails publics des erreurs à 2 Kio UTF-8.
- Refuse les collisions et contraintes non supportées ; vérifie les formats et champs propres sans casser les dates facultatives du CRUD natif.
- Aucun SQL nouveau ; les transactions métier, l’idempotence durable et les invitations par ressource restent à raccorder explicitement.

## 0.10.2 — Migrations D1 locales fiables

- Le script local conserve les triggers SQL complets et applique chaque migration avec son marqueur dans une même transaction D1.
- Une migration échouée est annulée ; une migration déjà appliquée ne rejoue pas, y compris après redémarrage de la base locale persistée.
- Utilise Miniflare fourni par la version verrouillée de Wrangler ; aucune dépendance ou migration SQL nouvelle.
- Les applications existantes doivent intégrer explicitement `scripts/migrate-local.mjs`, hors du runtime mis à jour automatiquement.

## 0.10.1 — Publication et suivi des applications

- Release GitHub stable au SHA exact de main après CI réussie ; aucun déplacement de tag.
- Veille livrée avec les applications : une issue par version, sans secret inter-dépôts ni mise à jour aveugle.
- Responsable commun du kit, suivi distinct des tests, intégrations et déploiements applicatifs.
- Chargeur de tests natifs compatible avec les chemins Windows pour permettre la revue locale.

## 0.10.0 — Transports des agents

- Transports Cursor et xAI injectables, avec états et capacités explicites ; aucune activation d’agent ou dépense automatique.
- Validation fermée des requêtes, erreurs minimisées, expiration et annulation couvrant aussi la résolution des identifiants.
- Tests sur transports simulés et Worker ; pas de nouvelle table, migration, UI ou secret.
- Conserve le correctif de journaux 0.9.1. Les applications adoptent le runtime par l’upgrade vérifié.

## 0.9.1 — Journal des requêtes minimisé

- Journal limité aux métadonnées et codes d’erreur à vocabulaire fermé ; corps, paramètres et arguments exclus.
- Anciennes lignes projetées et recherchées uniquement après filtrage, sans exposition de leurs détails historiques.
- Identifiant de corrélation de requête et rétention bornée conservés ; aucune migration ni rotation de secret.
- Versions des diagnostics API et MCP alignées avec celle du kit.

## 0.9.0 — Pilotage fiable et chat mobile

- File de commandes D1 indépendante du SSE, connexion WebSocket et secours HTTP.
- Une fenêtre de travail active par utilisateur et espace, reprise explicite et chat mobile plein écran pilotant l’ordinateur.
- Traces persistantes du navigateur et sauvegarde progressive des tours IA.
- Vérification du transport sur le Worker compilé et du curseur natif.

## 0.8.1 — Validation du consentement OAuth

- Corrige la politique de référent de la seule page de consentement : les formulaires natifs transmettent l’origine du Site.
- Conserve les refus des origines absentes, nulles ou étrangères, le contrôle du nonce et les droits serveur.
- Aucun changement des données, des secrets, des migrations ni des autres pages.

## 0.8.0 — OAuth MCP

- Raccorde OAuth 2.1 au MCP existant : découverte publique, inscription des clients, PKCE S256, consentement via le compte Sites, renouvellement et révocation.
- Chaque connexion reste liée à un utilisateur, un espace et aux droits actuels ; les codes sont à usage unique et les jetons sont hachés dans D1.
- L’administration MCP affiche les connexions OAuth avec leur révocation ; les clés personnelles, le chat, Mail et le curseur natif sont conservés.
- Migration additive 0009 et nouvelles routes OAuth, sans nouveau secret d’environnement ni fournisseur d’identité.

## 0.7.0 — Curseur de l’assistant rétabli

- Relie OpenAI et Hermes aux actions UI natives : repérage, clic visible, saisie et défilement dans l’application.
- Conserve le curseur animé original et ses événements de clic ; le modèle attend le résultat du navigateur.
- Migration additive 0008 : relais D1 privé, réservation unique, expiration, arrêt et refus des réponses rejouées.
- Un résultat UI négatif apparaît en erreur ; les champs de secrets sont exclus et les saisies sont masquées dans les traces.

## 0.5.0 — Intégrations et assistant restaurés

- Restaure le chat flottant et son panneau natif : historique privé dans D1, flux de réponse, arrêt, actions et traces.
- Porte la page Intégrations d’origine : secrets AES-GCM, références, versions, activation et test ; profils OpenAI et Hermes configurables.
- Relie le chat aux API OpenAI et Hermes avec les outils issus du registre MCP, droits et désactivations revérifiés pendant chaque tour.
- Rétablit le nom Analytics dans le menu et la page. Ajoute la migration additive 0006 et la configuration serveur du coffre.
- Corrige l’adaptateur de test SQLite pour exécuter les batches atomiquement comme D1, y compris pendant un flux de réponse.


## 0.4.0

- Restauration des composants Creezio de journal des requêtes, statistiques d’usage, catalogue API et administration MCP, raccordés à D1.
- Catalogue unique des opérations réellement montées : routes natives et métier, alias, OpenAPI, outils MCP et matrice des accès.
- Groupes personnalisés, membres et restrictions par API, avec concurrence optimiste, isolation des espaces et propriétaire protégé.
- Activation/désactivation persistante des outils ; création d’outils nommés depuis une API ; exécution HTTP MCP et WebMCP soumise aux mêmes contrôles.
- Journal des requêtes conservé par espace (1 000 entrées) et collecte d’usage avec identité contrôlée côté serveur.
- Migration 0005 additive ; conservation des modules, de la recherche et du comportement des onglets.

## 0.3.1

- Réduction des échanges D1 d’une recherche sur un index prêt : 17 vers 3, sans écriture. Les réglages restent lus à chaque requête.
- Reprise de l’index par lots regroupés, limitée aux sources encore incomplètes. Une première recherche sur une petite base nécessite cinq échanges, sans série d’initialisations par source.
- Regroupement des résultats et du comptage dans une transaction de lecture, y compris dans les listes métier.
- Mesure du temps applicatif dans l’en-tête Server-Timing, sans texte recherché ni donnée personnelle.
- Test de performance structurelle sur D1 réel : limite des échanges, absence d’écriture à chaud, changements immédiats des champs, des données et réindexation.

## 0.3.0

- Socle autonome consacré à GPT Sites, avec sources locales, générateur et documentation propres.
- Recherche des données sur D1/FTS5, reprise des données existantes et indexation transactionnelle des écritures.
- Administration de la recherche par module et par champ, avec isolation par espace et permissions serveur.
- Registre commun pour les modules métier, leur navigation, leurs routes API et leurs outils MCP.
- Serveur MCP HTTP et clés personnelles avec expiration, droits limités et révocation.
- Ouverture des fiches depuis les résultats ; préservation du shell, du centrage de la recherche et de l’isolation des onglets.
- Migrations additives et procédure de mise à jour des applications existantes.

Les versions précédentes restent consultables dans l’historique Git.
