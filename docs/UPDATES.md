# Mettre à jour le socle d'une application

Le profil Sites utilise un snapshot versionné de sources. Aucune publication npm de Creezio Lite n'est requise pour un nouveau créateur. Le lockfile applicatif enregistre les empreintes des sources communes ; une copie brute de nouveaux fichiers n'est pas une mise à niveau contrôlée.

1. Récupérer la version souhaitée du dépôt Creezio Lite. Lire son CHANGELOG et relever son commit. Préférer une version figée pour un déploiement reproductible.
2. Vérifier que les changements de l'app sont commités et que son `.openai/hosting.json` désigne le bon Site.
3. Exécuter `node bin/creezio-lite.mjs upgrade --app /chemin/app` depuis le kit. Le mode par défaut n'écrit rien.
4. Si le rapport est compatible, utiliser `--apply`. Le runtime et le lock sont sauvegardés sous `.creezio-backups/`, puis remplacés. Le code métier, les dépendances, les secrets et l'identité du Site restent ceux de l'application.
5. Exécuter le doctor, les tests métier, le typecheck, le build et publier une nouvelle version via Sites.

Un fichier du socle modifié localement bloque l'upgrade : analyser la différence et porter le correctif dans le kit ou dans une extension métier. Ne pas changer les empreintes pour cacher un conflit.

Si le schéma commun change, l'upgrade automatique s'arrête avant toute modification. Écrire une migration additive pour l'application et suivre une montée de version documentée. Les migrations déjà appliquées ne doivent jamais être remplacées par celles d'un template neuf. De même, un changement de dépendances ou de structure de pages du template exige une adaptation explicite : `upgrade` met à jour le runtime commun, pas l'ensemble du projet applicatif.

Pour récupérer une amélioration du Creezio original, comparer le commit enregistré dans UPSTREAM.json avec la source actuelle, porter les changements compatibles et refaire les tests. Une mise à jour de Creezio ne met pas automatiquement à jour Lite.

Après la première publication, ne pas modifier une version diffusée sans augmenter son numéro. Les anciens projets restent sur leur version jusqu'à une mise à jour explicite.


## Passage de 0.1 à 0.2

Ce changement remplace le shell et ajoute une migration D1. Il demande la mise à jour du template applicatif, des dépendances, des pages et de la configuration TypeScript/Vite, en préservant l’identité Sites, le brief métier, la migration 0000 et les données. Le simple `upgrade --apply` des sources est volontairement refusé par le contrôle de schéma. Effectuer cette migration sur une copie contrôlée, construire puis publier sur le même Site.
