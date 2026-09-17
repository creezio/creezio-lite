# Mises à jour

Chaque application possède son runtime versionné, son brief, ses migrations, ses données et son identité Sites. Une évolution du kit ne modifie pas automatiquement une application déjà publiée.

1. Choisir un commit du kit et lire son changelog.
2. Vérifier que le projet applicatif est sauvegardé dans Git et que son `project_id` est celui du Site à modifier.
3. Lancer `node bin/lite.mjs upgrade --app /chemin/app` pour obtenir le rapport sans écriture.
4. Utiliser `--apply` lorsque le schéma est compatible et qu’aucun fichier du runtime n’a été modifié localement. Une sauvegarde est conservée dans `.lite-backups/`.
5. Fusionner explicitement les éventuelles évolutions de `app/`, `build/`, des dépendances et des autres fichiers du template. L’upgrade du runtime ne les remplace pas.
6. Vérifier, construire et publier sur le même Site.

Un schéma différent ou un runtime modifié bloque l’upgrade. Analyser la différence ; ne pas falsifier les empreintes pour masquer un conflit.

## Migration d’une application 0.2 vers 0.3

Cette version change la structure du runtime et ajoute trois migrations. Elle exige une migration applicative explicite : conserver `brand.json`, les règles métier, `.openai/hosting.json`, les données et les migrations 0000/0001 avec leurs métadonnées ; ajouter 0002/0003/0004 et leurs nouvelles entrées de journal ; intégrer les nouveaux fichiers du template et le runtime autonome ; produire le verrou 0.3 après contrôle des sources. Ne jamais rejouer une création d’app sur le projet existant.

Les cookies d’espace précédents sont reconnus puis contrôlés par les règles d’appartenance. Le chargement des onglets peut reprendre un état existant de même format. Aucun enregistrement métier n’est supprimé par ces migrations. L’index reprend les données existantes par lots à la première recherche.

## Migration 0.3.1 vers 0.4.0

Fusion applicative explicite nécessaire : préserver le brief, les règles métier, les bindings, l’identité Sites et les migrations 0000 à 0004 à l’octet. Ajouter 0005_admin_operations.sql, son snapshot et l’entrée de journal. Intégrer les nouveaux fichiers du runtime, les pages admin, le provider d’usage et l’alias TypeScript `@lite/core/*`. Régénérer le verrou depuis ces sources après vérification. La migration ajoute les groupes, politiques, journal des requêtes et événements d’usage ; elle ne réécrit aucune donnée métier.

## Migration 0.4.0 vers 0.5.0

Préserver le brief, les règles métier, l’authentification, les bindings, le lockfile de dépendances et les migrations 0000 à 0005 à l’octet. Ajouter 0006_assistant_integrations.sql, son snapshot et l’entrée de journal. Fusionner le runtime, la page Intégrations, le libellé Analytics et BrandChrome (retirer le masquage permanent du chat). Vérifier le verrou avant la migration et le régénérer après cette fusion explicite.

Configurer `LITE_INTEGRATION_SECRET` comme secret serveur Sites aléatoire (au moins 32 octets) uniquement s’il n’existe pas déjà. Ne jamais le changer lors d’une mise à jour : les clés d’intégration déjà chiffrées deviendraient illisibles. Les clés OpenAI et Hermes sont saisies par l’administrateur dans l’application, pas dans Git ni dans le navigateur après enregistrement.

Voir [ASSISTANT.md](ASSISTANT.md) pour les interfaces, validations et limites du raccordement externe.

## Migration 0.5.1 vers 0.6.0

Cette version rétablit le module Mail natif, les connexions SMTP/IMAP complètes et Cloudflare Email. Préserver le brief, les règles métier, les dépendances, l’authentification, les bindings et toutes les migrations 0000 à 0006 avec leurs métadonnées. Après un doctor sans conflit, fusionner explicitement les ajouts de `db/schema.ts`, `app/mails/page.tsx`, le runtime, `0007_mail_native.sql`, son snapshot et son entrée de journal. Régénérer ensuite le verrou depuis ces sources contrôlées. Les quatre nouvelles tables et l’index Mail sont additifs ; aucune donnée existante n’est supprimée. Ne pas remplacer le secret de chiffrement existant.

Les anciennes connexions SMTP/IMAP restent conservées ; compléter leurs paramètres dans Intégrations. Configurer la passerelle HTTPS pour SMTP/IMAP, ou Email Sending et le Worker de réception pour Cloudflare. Voir [MAIL.md](MAIL.md). Aucun compte mail, domaine ou envoi réel n’est configuré par la migration.

## Correction 0.6.1

Remplacer le runtime par l’upgrade habituel, puis reconstruire l’application. Aucune migration ni modification des intégrations enregistrées n’est nécessaire. Les appels OpenAI, Hermes et Mail utilisent désormais le mode de redirection compatible avec workerd et refusent explicitement les redirections sans transmettre les identifiants à une autre adresse. Mettre aussi à jour le Worker de réception Cloudflare s’il est installé.

## Migration 0.6.1 vers 0.7.0

Fusion explicite requise pour le relais du curseur. Après un doctor sans conflit, préserver le brief, les règles métier, l’identité Sites, les dépendances et toutes les migrations 0000 à 0007 avec leurs métadonnées. Fusionner le runtime et `db/schema.ts`, ajouter `0008_assistant_ui_cursor.sql`, son snapshot et son entrée de journal, puis régénérer le verrou après contrôle des sources. La nouvelle table ne contient que les confirmations temporaires des actions du navigateur ; aucun enregistrement métier ni secret d’intégration n’est modifié.

## Migration 0.7.0 vers 0.8.0

Fusion explicite après un doctor sans conflit. Préserver le brief, les règles métier, les bindings, le `project_id`, l’authentification Sites, les dépendances et les migrations 0000 à 0008 à l’octet, avec leurs métadonnées. Ajouter 0009_mcp_oauth.sql, son snapshot, son entrée de journal et les tables OAuth de db/schema.ts. Fusionner le runtime, les routes app/.well-known/[...path], app/oauth/[action], la page app/oauth/consent, OPTIONS dans app/api/mcp, et l’exception de BrandChrome pour la page de consentement. Cette page utilise l’identité Sites et ses composants natifs sans charger les onglets de l’application pendant le retour OAuth. Régénérer le verrou après comparaison des sources. Aucun secret d’environnement nouveau ni modification des clés OpenAI/Hermes n’est nécessaire.

## Correction 0.8.1

Appliquer la mise à jour du runtime puis fusionner explicitement les métadonnées `referrer: 'same-origin'` de `app/oauth/consent/page.tsx`. L’upgrade du runtime seul ne modifie pas les pages applicatives. Reconstruire et publier sur le même Site. Les migrations, les identifiants clients OAuth et les secrets d’intégration restent inchangés.

## Passage à 0.9.0

Appliquer la mise à jour du runtime et la migration additive `0010_browser_relay.sql`. Fusionner explicitement `worker.ts` et le changement `main` dans `vite.config.ts` : les routes assistant sont servies directement par le Worker. Préserver les autres adaptations locales. Recharger les fenêtres après publication. Voir [l’audit et le fonctionnement du relais](BROWSER-RELAY.md).

## Passage à 0.9.1 — Journal des requêtes minimisé

Appliquer la mise à jour du runtime seul : aucune migration, aucun secret et aucune page applicative ne changent. Le journal `lite_request_logs` cesse de copier les corps, paramètres, arguments d’outils et messages ; il ne conserve que des métadonnées à vocabulaire fermé (voir [API.md](API.md#journal-des-requêtes)). Chaque réponse porte désormais l’en-tête `x-lite-request-id`, valeur du champ `correlationId` de la ligne correspondante.

Les lignes écrites avant la mise à jour restent en base : la lecture les renvoie avec `legacy:true`, sans leur `detail_json` stocké, avec leur chemin re-résolu par le catalogue ; la recherche `q` ne les parcourt pas. Elles sont supprimées par la rétention de 30 jours à la prochaine écriture de l’espace, ou immédiatement par « Vider » dans l’écran Activité. Aucune fiche, aucun fichier et aucune conversation ne sont modifiés. Un nettoyage immédiat des anciennes lignes par migration reste possible sur demande, sous forme d’une instruction additive `DELETE`/`UPDATE` ciblant `lite_request_logs` ; il n’est pas inclus ici.

## Passage à 0.10.0

Ajoute les transports purs Cursor/xAI, sans raccordement applicatif automatique. L’upgrade du runtime conserve les changements 0.9.1 ; aucune migration ni rotation de secret. L’activation des commandes, des droits, des tables et des vues Agents reste un lot d’intégration distinct. Relire les capacités et erreurs typées du contrat `docs/contracts/agent-provider-transport.md` avant raccordement.

## Notifications de nouvelles versions (depuis 0.10.1)

Le responsable du kit publie une release GitHub après revue et CI réussie sur le commit exact de main. Le responsable du kit notifie les pilotes et déclenche leur workflow lors de la réception d’une nouvelle release. Le workflow est aussi exécutable à la demande et lorsque le verrou change sur main. Aucun schedule/cron n’est installé dans les applications.

Les nouvelles applications reçoivent `.github/workflows/lite-update.yml` et `scripts/check-lite-update.mjs`. Dans une application existante, intégrer explicitement ces deux fichiers depuis la version validée du kit, activer Actions et Issues et adapter le nom de branche si nécessaire. Aucun jeton personnel ou secret inter-dépôts n’est requis : `GITHUB_TOKEN` lit le kit public et écrit seulement les issues de l’application. Aucun code applicatif ni installation de dépendance n’est exécuté par la veille.

Une issue persistante par version contient le SHA exact, les changements et la recette. Les relances ne créent pas de doublon. La veille ne fusionne ni ne déploie et ne clôture jamais sur la seule version du verrou : le pilote de l’application confirme tests, intégration et publication. Une issue close comme « non prévue » reste différée ; une clôture prématurée sans version intégrée est rouverte.

Pour un Site sans dépôt GitHub applicatif, enregistrer la source et le responsable dans le registre privé du mainteneur ; notifier sa tâche et y suivre explicitement la mise à jour. Ne pas publier les noms ou chemins des applications privées dans le dépôt public du kit. Voir [MAINTENANCE.md](MAINTENANCE.md).

## Correction 0.10.2 — Migrations locales

Après la mise à jour habituelle du runtime, intégrer explicitement `template/scripts/migrate-local.mjs` du kit dans `scripts/migrate-local.mjs` de l’application. L’upgrade du runtime ne copie pas ce script. Conserver les adaptations métier et tous les fichiers SQL déjà appliqués à l’octet.

Construire l’application, puis exécuter `pnpm db:local` pour valider la base locale. Les triggers restent des instructions complètes ; chaque migration et son marqueur sont appliqués ensemble. Les marqueurs existants sont conservés : les migrations déjà appliquées ne rejouent pas. Ce correctif utilise Miniflare fourni par Wrangler déjà verrouillé, sans nouvelle dépendance. Il ne modifie ni les migrations ni la base du Site publié.

## Migration 0.10.2 vers 0.11.0 — opérations et portée

Le runtime ajoute le registre module/entity/collection, les déclarations command/read et le ScopeProvider. Un module sans kind conserve son CRUD. Les entity/collection exposent des lectures ; leurs mutations doivent passer par des commandes déclarées. Aucun schéma ni migration SQL n'est ajouté par cette version.

Pour une application qui adopte ces ports, définir ses extensions avec le catalogue complet de @lite/sites-adapter/catalog, puis transmettre ces extensions au dispatcher existant. Lire docs/contracts/domain-extension.md et les exemples/tests D01. Les politiques métier restent propres à l'application ; l'absence de provider conserve la portée native de l'espace et ne remplace pas une politique obligatoire.

Vérifier les schémas déclarés au démarrage : les contraintes non supportées sont maintenant refusées plutôt qu'ignorées. Les schémas des commandes sont stricts ; les dates facultatives du CRUD natif restent effaçables. Adapter le traitement des erreurs structurées (code, message, requestId, details facultatif), sans utiliser les erreurs inconnues comme détails publics.

Tester sessions, clés lecture/écriture, OAuth, révocations, recherche/fichiers et les refus sans écriture. Les références credential sont un instantané vérifié, pas une garde de commit. Cette release ne livre pas encore un moteur générique d'idempotence, de relations, d'outbox ou de grants par ressource.

## Passage à 0.12.0 — Standard d’orchestration

Le runtime, le schéma, les migrations, les secrets et les providers IA métier ne changent pas ; l’upgrade habituel du runtime ne modifie que la version du verrou. La nouveauté est hors runtime : la compétence `.cursor/skills/lite-orchestration/` (SKILL.md, CONTRACT.md, cursor-model.json, scripts/cursor-agents.mjs, manifest.json) et la règle `.cursor/rules/lite-orchestration.mdc`.

Adoption dans une application existante, depuis un checkout du commit validé du kit (l’application ne contient pas `bin/lite.mjs`) : `node bin/lite.mjs adopt --app /chemin/application` affiche l’état de chaque fichier géré (`missing`, `current`, `outdated`, `conflict`) et les fichiers non gérés préservés ; `--apply` n’écrit que les fichiers manquants ou issus d’une version précédente du kit, puis le manifeste. Un fichier modifié localement est un conflit : la commande refuse toute écriture et le signale ; restaurer la copie du kit ou consigner le report. Un lien symbolique ou une jonction sur un chemin géré ou un de ses parents (`.cursor/rules`, `.cursor/skills/lite-orchestration`, un fichier géré) est refusé avant toute écriture ; un manifeste JSON invalide donne une erreur claire sans modification. `AGENTS.md`, les règles métier, `lite.lock.json`, les migrations et les données ne sont jamais touchés ; ajouter soi-même la mention du standard à `AGENTS.md` de l’application (le doctor l’indique dans `orchestration`). Aucun cron n’est créé et aucun schedule existant n’est retiré.

La sélection du modèle (`fable` = `claude-fable-5-1` thinking/300k/high par défaut ; `opus` = `claude-opus-5` ou `grok` = `grok-4.6` pour une mission clairement plus simple et bornée) est choisie une fois à l’attribution, validée contre une variante complète du catalogue puis conservée toute la mission ; les reprises n’envoient aucun champ `model`. La clé `CURSOR_API_KEY` n’est lue que dans l’environnement de l’orchestrateur ; elle n’est stockée ni dans l’application ni dans ses journaux.

## Passage à 0.13.0 — Planification parallèle, pool de comptes et distribution complète du standard

Le runtime métier, le schéma, les migrations, les secrets et les providers IA ne changent pas ; l’upgrade habituel du runtime ne modifie que la version du verrou et les chaînes de version API/MCP. La nouveauté est hors runtime : douze fichiers gérés — **onze dans le dossier** `.cursor/skills/lite-orchestration/` : le transport O01 (`SKILL.md`, `CONTRACT.md`, `cursor-model.json`, `scripts/cursor-agents.mjs`), le contrat de planification (`PLANNING.md`, `planning-plan.schema.json`, `planning-state.schema.json`, `examples/planning-plan.json`, `examples/planning-state.json`), l’outil `scripts/plan-missions.mjs` et l’adaptateur du pool de comptes `scripts/cursor-account-pool.mjs` — **plus la règle** `.cursor/rules/lite-orchestration.mdc` ; et le point d’entrée de découverte généré `.agents/skills/lite-orchestration/SKILL.md` (empreinte dans `manifest.generated`, hors décompte).

Adoption depuis un checkout du commit validé du kit : `node bin/lite.mjs adopt --app /chemin/application` liste les ressources manquantes ou périmées et signale la découverte à régénérer ; `--apply` copie exactement les nouveaux fichiers, régénère le point d’entrée et réécrit le manifeste ; un second passage ne change rien. Les compétences locales de `.agents/skills/` et `.cursor/skills/`, `AGENTS.md`, les règles métier, `lite.lock.json`, les migrations et les données ne sont jamais touchés ; toute modification locale d’un fichier géré (y compris `PLANNING.md` ou un exemple) est un conflit qui bloque l’écriture. Le template `tsconfig.json` expose l’alias `@lite/sites-adapter/catalog` ; une application existante l’ajoute elle-même si elle consomme le catalogue par ce chemin.

L’outil de planification s’exécute depuis la racine de l’application, en lecture seule : `node .cursor/skills/lite-orchestration/scripts/plan-missions.mjs validate|ready --plan docs/planning/plan.json --state <état privé hors dépôt>`. Le plan public est versionné dans l’application ; l’état privé (sélections, agents, runs, PR) reste à côté du registre `cursor-agents`, jamais dans le dépôt. Un lot livré avant le standard sans champ `model` se déclare par `legacySelection {reason:"model_omitted"}` : aucun modèle n’est reconstitué, aucune reprise n’est proposée, son intégration puis sa publication restent possibles. `SKILL.md` et `CONTRACT.md` §10 décrivent le cycle : pour chaque plan approuvé, décomposition exhaustive en missions indépendantes, `validate`/`ready` après chaque transition, remplissage de toutes les places libres sans vagues ; le seuil local de revue (`maxReviewBacklog`) peut bloquer une intégration dépendante — le rapport le montre (`{count,max}`) et le pilote le réévalue explicitement avec une raison dans `capacity.note`, sans contournement automatique.

Le pool commun de comptes (`CONTRACT.md` §9) est optionnel et ne change rien pour une application qui fournit `CURSOR_API_KEY` : le transport garde ce mode à un compte. Sans clé en environnement, `cursor-agents.mjs` lit le coffre `credentials.json` (DPAPI CurrentUser, Windows) et l’état partagé `pool-state.json` de l’utilisateur — jamais de l’application ni du dépôt — par l’adaptateur distribué à côté de lui ; recette locale sans secret : `node .cursor/skills/lite-orchestration/scripts/cursor-account-pool.mjs selftest` puis `vault-check`. Une création dont la livraison est inconnue (délai, réseau, 5xx) reste `uncertain` : un 404 ne prouve pas l’absence, `launch` déduplique sans second POST, et seule l’attestation humaine `reconcile --mission K --confirm-absent`, après vérification du tableau de bord, conclut « non créé » (`attestedBy: human` est une déclaration écrite par le code, non une signature : conserver la référence et la raison avant de l’utiliser). Un 409 puis 404 reste `conflict_unreadable`, jamais une absence. Un `startBlock` `hard_limit_start_refused` avéré compte dans l’indisponibilité de départ (repli Grok possible sur une autre cible prouvée) sans convertir `custom` ni réactiver le compte bloqué ; la sélection initiale Grok automatique exige une preuve d’accès, l’amorçage unique est `--select grok --account <id>`. Aucun daemon, aucune routine de crédit, aucun quota supposé ; le support DPAPI réel se vérifie sur le poste, hors des tests du kit (fixtures fictives).

## Correction 0.13.1 — Frontmatter CRLF du CLI kit uniquement

Cette version corrige **seulement** la lecture du frontmatter de `SKILL.md` par `create` et `adopt` (`skillFrontmatter` dans `bin/lite.mjs`) : délimiteurs `---` et fins de ligne LF ou CRLF, `name`/`description` toujours exigés sur une ligne, frontmatter malformé toujours refusé sans écriture partielle. Ce n’est **pas** une compatibilité globale CRLF du kit, des empreintes, de `doctor`, de `check-kit` ni des clones d’application.

Revue Git réelle avec `core.autocrlf=true` **sur le checkout du kit** : `create` et `adopt` (inspect, `--apply`, second passage `current`) fonctionnent via **le même checkout source** ; une vraie édition locale de `PLANNING.md` reste un conflit refusé sans écriture. Ces parcours ferment W01.

Hors périmètre (empreintes brutes **préexistantes**, pas le parser corrigé) :

- une application créée en LF, versionnée, puis clonée avec `core.autocrlf=true` : faux conflits sur les **12 copies** du standard et `doctor` qui voit ~350 fichiers runtime divergents du verrou ;
- `doctor` via un CLI kit LF sur une app adoptée depuis un checkout kit CRLF : les 12 copies sont `outdated` ;
- `scripts/check-kit.mjs` (l.11) et le test canonique d’orchestration (l.60) restent **LF-stricts** : la recette du kit doit partir des octets LF. Cette release ne corrige pas ces autres lectures.

Réception fiable : checkout isolé exact en LF, sans changer la configuration Git globale — `git -c core.autocrlf=false` et `core.eol=lf` à la création ou au checkout. Ne jamais falsifier `lite.lock.json` ni `manifest.json`, ni écraser de vraies modifications locales. Un clone d’application déjà converti en CRLF exige une réception explicite depuis les octets Git, pas un `adopt --apply` forcé et silencieux.

Les ressources distribuées du standard sont **inchangées** par rapport à 0.13.0. Le CLI 0.13.1 suffit au parser ; une adoption 0.13 déjà valide n’a **ni ré-adoption ni upgrade runtime** à faire pour fermer W01. La normalisation globale des empreintes CRLF reste un lot distinct. Aucune migration, aucun secret, aucune fusion de pages applicatives.

## Correction 0.13.2 — Boucle active et fermeture de cycle (skill / maintenance)

Documentation seulement : `SKILL.md` décrit la boucle active d’orchestration (rester dans le tour, outils existants, polling progressif ; `status --follow` émet au changement et continue tant que non terminal). `CONTRACT.md` §10 renvoie à cette compétence, sans moteur ni daemon. `docs/MAINTENANCE.md` fixe la fermeture de cycle (réception → revue → CI exacte → fusion → CI `main` → release → notification → suppression de branche, preuves SHA/PR) et interdit de supprimer une branche active ou non fusionnée (`delete_branch_on_merge` déjà configuré).

Ce n’est **pas** `--references-file`, pas une capacité multi-dépôts, pas un nouveau runtime métier. Aucun cron, aucune routine nouvelle, aucune promesse de processus autonome après la fin de session. Les applications conservent leur mandat. Une copie personnelle de compétence n’est pas écrasée.

Mise à jour du skill : `node <checkout-kit>/bin/lite.mjs adopt --app <dossier>` puis `--apply` depuis un checkout de cette version. **Pas d’upgrade runtime forcé** pour cette documentation ; l’upgrade habituel, s’il est lancé, n’aligne que le verrou et les chaînes de version API/MCP. Aucune migration, aucun secret.
