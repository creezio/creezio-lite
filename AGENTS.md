# Lite — applications GPT Sites

Lite est un socle autonome. Le code exécutable est dans `runtime/` ; `template/` contient l’application générée. Lire START-HERE.md, docs/MODULES.md et docs/ARCHITECTURE.md.

- Préserver le shell, les onglets, les primitives, le thème et les comportements existants. Étendre leurs composants ; ne pas reconstruire une interface ressemblante.
- Une nouvelle fonctionnalité métier commence par une déclaration de module. Le registre commun doit fournir navigation, recherche, API et outils MCP sans listes manuelles supplémentaires.
- Les modules métier stockent leurs fiches dans `lite_records`. Les déclencheurs D1 maintiennent l’index plein texte dans la transaction d’écriture. Ne jamais remplacer un service durable par de la mémoire ou une fausse réponse de succès.
- Appliquer les droits et `org_id` côté serveur, avant les résultats, comptes et extraits de recherche. Les réglages de recherche ne remplacent pas les permissions de lecture.
- Utiliser les compétences Sites pour les applications. Réutiliser le `project_id` existant et préserver l’audience, les bindings, les données et les migrations déjà appliquées.
- L’identité navigateur vient du dispatcher Sites. Les clés API sont hachées, expirent, appartiennent à un espace et restent soumises aux droits actuels de leur propriétaire. Aucun secret dans Git ou dans les journaux.
- Ne pas ajouter de dépendance à un autre dépôt ou à un runtime desktop. Les imports `@lite/*` désignent des sources locales ; aucune publication npm de ces modules n’est nécessaire.
- Modifier `runtime/`, puis lancer `npm run sync:template`. `template/runtime` est généré.
- Vérifier `npm test`, `npm run check`, le typecheck et le build du template, puis `node scripts/validate-examples.mjs`. Les tests du kit synchronisent le template : les exécuter avant sa compilation, sans chevauchement.
- Vérifier les parcours modifiés dans un navigateur lorsque possible. Distinguer les preuves sur fixtures des parcours du Site authentifié.
- Publier les changements du kit par une branche et une PR ; attendre la CI avant fusion. Augmenter la version après chaque publication. Ne pas modifier la configuration Git globale ou locale.
- Les évolutions de schéma sont additives. Les fichiers SQL et métadonnées déjà appliqués sont immuables. Une migration vers une nouvelle structure d’app demande une fusion explicite des fichiers du template.

## Missions déléguées et passage de relais

- Le standard d’orchestration (Astra orchestre et décide ; Cursor réalise, Fable 5.1 par défaut ; sélection du modèle choisie une fois à l’attribution et vérifiée par préflight ; brief, checkpoints et réception compacts ; déduplication des missions) a une seule source : `.cursor/skills/lite-orchestration/SKILL.md` et son `CONTRACT.md`. Le générateur l’installe dans chaque application ; `node bin/lite.mjs adopt --app <dossier>` l’ajoute à une application existante sans toucher ses règles. Ne pas le recopier dans d’autres documents.
- Un agent délégué livre sa branche et sa PR ; il ne fusionne pas, ne publie pas et ne lance pas un autre agent ou un lot suivant sans attribution. Respecter le brief et ses propriétaires de fichiers ; les versions et raccordements partagés sont pilotés par l’orchestrateur.
- Terminer chaque lot avec mission, agent/run si connus, PR/SHA, tests exécutés et résultat, limites et prochaine action concrète avec responsable. Une fin de run ne prouve pas l’intégration ni le déploiement.
- Le responsable commun de Creezio Lite possède les fusions et publications du kit. Les orchestrateurs applicatifs proposent leurs correctifs par PR et restent responsables de leurs propres mises à jour ; ils ne pilotent plus les fusions du kit. Suivre `docs/MAINTENANCE.md`, reprendre les agents existants et posséder le verrou du dépôt avant mutation.
