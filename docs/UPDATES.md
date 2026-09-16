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

Le responsable du kit publie une release GitHub après revue et CI réussie sur le commit exact de main. Le workflow de chaque application vérifie les releases stables toutes les 30 minutes, à la demande et lorsque `lite.lock.json` change sur main. GitHub peut retarder un horaire : ce délai est une cadence de contrôle, pas une garantie de livraison.

Les nouvelles applications reçoivent `.github/workflows/lite-update.yml` et `scripts/check-lite-update.mjs`. Dans une application existante, intégrer explicitement ces deux fichiers depuis la version validée du kit, activer Actions et Issues et adapter le nom de branche si nécessaire. Aucun jeton personnel ou secret inter-dépôts n’est requis : `GITHUB_TOKEN` lit le kit public et écrit seulement les issues de l’application. Aucun code applicatif ni installation de dépendance n’est exécuté par la veille.

Une issue persistante par version contient le SHA exact, les changements et la recette. Les relances ne créent pas de doublon. La veille ne fusionne ni ne déploie et ne clôture jamais sur la seule version du verrou : le pilote de l’application confirme tests, intégration et publication. Une issue close comme « non prévue » reste différée ; une clôture prématurée sans version intégrée est rouverte.

Pour un Site sans dépôt GitHub applicatif, enregistrer la source et le responsable dans le registre privé du mainteneur ; notifier sa tâche et y suivre explicitement la mise à jour. Ne pas publier les noms ou chemins des applications privées dans le dépôt public du kit. Voir [MAINTENANCE.md](MAINTENANCE.md).
