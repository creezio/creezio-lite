# Recherche

La recherche interroge les valeurs des fiches, et non uniquement les libellés du menu. D1 fournit FTS5 avec tokenisation Unicode, suppression des différences d’accents et correspondance sur les préfixes. Plusieurs mots peuvent correspondre à des champs différents de la même fiche.

Sources : modules métier déclaratifs, titres/descriptions/statuts des tâches, tickets et messages support, noms/types des fichiers, collaborateurs et activité. Les deux dernières sources restent réservées aux administrateurs. Les identifiants de connexion, clés API et tokens d’invitation ne sont pas des sources de recherche.

## Mise à jour de l’index

Les écritures déclenchent la mise à jour de `lite_search_documents` puis de `lite_search_fts` dans la transaction D1. La suppression ou l’archivage retire la fiche de l’index. Le retour de succès d’une écriture confirme aussi cette mise à jour.

Les données antérieures à l’installation de l’index sont reprises par lots de 50 éléments par source. `lite_search_progress` conserve l’avancement. Une recherche reprend automatiquement le travail ; la réponse indique `indexing:true` tant que la reprise n’est pas terminée. L’interface attend les lots, avec un message explicite si une nouvelle recherche est nécessaire. L’admin peut poursuivre via « Mettre l’index à jour ».

Les migrations ne contiennent aucun jeu de données ni backfill massif. Les vues par source évitent les limites de requêtes composées du moteur hébergé.

La palette retrouve également les noms des modules accessibles. Au-delà de 100 correspondances, « Voir les résultats » ouvre `/search` pour parcourir toutes les pages. L’API accepte `limit`, `offset` et `module`. La recherche des listes métier utilise les mêmes règles et le même index.

## Administration

`/admin/search` permet d’activer chaque module et de sélectionner ses champs. Un champ désactivé ne contribue plus aux correspondances ni aux extraits, immédiatement. Les changements sont versionnés pour refuser un écrasement concurrent. Les réglages sont propres à l’espace.

Le filtrage par espace, rôle et champ intervient dans la requête avant le comptage, la pagination et la production d’extraits. Une fiche reste soumise aux mêmes autorisations lorsqu’elle est ouverte depuis un résultat.

## Limites

Il s’agit d’une recherche lexicale, sans correction orthographique, synonymes, sémantique ni OCR. La recherche de pièces jointes couvre leurs noms et métadonnées ; le contenu binaire n’est pas extrait. Les textes stockés dans les fiches et les messages sont indexés. Les champs exclus de la recherche peuvent toujours être lisibles dans une fiche autorisée : ce réglage ne constitue pas une permission de confidentialité.

Références techniques : [extensions SQLite de D1](https://developers.cloudflare.com/d1/sql-api/sql-statements/) et [FTS5](https://www.sqlite.org/fts5.html).
