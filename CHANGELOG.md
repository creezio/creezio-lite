# Versions de Lite

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
