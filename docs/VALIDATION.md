# Validation de Lite 0.3

Vérification locale du 15 septembre 2026 : 21 tests réussis, contrôle du kit réussi, typecheck et compilation du template réussis. Deux applications distinctes, Atelier et Réserve, ont été générées dans des dossiers vides puis installées avec le verrou de dépendances, typées et compilées.

Les tests exécutent les migrations et le SQL sur le moteur D1 local de Cloudflare (Miniflare/workerd), ainsi que le dispatcher réel de l’API et du MCP.

Parcours couverts :

- Client « Réda » créé avant les migrations de recherche, retrouvé par « reda » et par préfixe ; recherche de plusieurs mots dans des champs différents.
- Reprise de plus de 50 anciennes fiches en plusieurs lots, pagination et absence de doublons ; requête de sept mots compatible avec D1.
- Tâches, messages support, collaborateurs, activité et noms de fichiers recherchables.
- Désactivation d’un module ou d’un champ, cohérence avec la recherche d’une liste, conflits de réglages, espaces séparés et droits de lecture.
- Mise à jour et archivage d’une fiche reflétés dans l’index ; nouveau module inscrit dans la navigation, l’API, la recherche et le catalogue MCP.
- Clés en lecture seule, écritures MCP, refus des origines étrangères, révocation, retrait d’un membre et absence de clés stockées en clair.
- Aucun résultat ni historique de recherche métier conservé dans le navigateur entre sessions.
- Onglets conservant chacun leur page, titre et saisie avec les véritables contextes de navigation du framework.
- R2, invitations, validation des données, protection des rôles et erreurs de transaction.

La migration de l’application existante a été comparée à son verrou : aucun runtime personnalisé n’a été écrasé. Son identité Sites, son brief et les migrations déjà appliquées sont conservés. Aucune copie des données de production n’a été utilisée dans les tests.

Ces preuves ne remplacent pas un parcours interactif connecté au compte de l’utilisateur. La saisie, la recherche et l’administration sur le Site authentifié n’ont pas été contrôlées dans un navigateur pendant cette évolution. Le contenu des pièces jointes n’est pas extrait ; l’authentification OAuth d’un connecteur MCP distant n’est pas fournie.

## Correctif 0.3.1 — latence

Les journaux de production du 15 septembre 2026 à 10:51 UTC montraient deux recherches de 5 147 ms et 2 582 ms côté Worker, pour seulement 24 ms et 13 ms de CPU. Le code 0.3.0 effectuait 17 appels D1 par recherche sur un index prêt, dont six écritures d’initialisation inutiles. Treize appels étaient consacrés au seul contrôle de l’avancement.

Le correctif ramène ce parcours à trois échanges et zéro écriture ; la première reprise d’une base de petite taille nécessite cinq échanges. Le nouveau test utilise Miniflare/workerd et compte les appels réels au binding. Il contrôle aussi les changements de réglages, la mise à jour d’une fiche et la réindexation explicite. Les 22 tests passent. Les timings observés en production avant correctif ne sont pas une mesure du délai final chez l’utilisateur après publication.

## 0.7.0 — Curseur natif de l’assistant

43 tests réussis, contrôle du kit, typecheck et compilation du template réussis. Les deux applications Atelier et Réserve ont été générées, installées avec leur verrou, typées et compilées. Les nouveaux tests couvrent les boucles OpenAI/Hermes avec confirmations navigateur, l’isolation des utilisateurs et espaces, les refus CSRF, le rejeu, l’expiration et l’annulation. Un test du moteur workerd utilise le véritable D1 et des requêtes distinctes pour réserver et confirmer l’action pendant le flux.

La fixture DOM exécute le pilote et le curseur originaux : déplacement, halo, clic sur Mail, refus d’une référence disparue et arrêt avant le clic. Ses rectangles et fins d’animation sont simulés ; aucun test visuel du Site authentifié ni appel utilisant les clés du compte n’est revendiqué.
