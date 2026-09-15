# Audit et plan — pilotage navigateur et chat mobile

## Incident du 15 septembre 2026

Les traces D1 des essais de 17:29 et 17:30 UTC confirment des réponses OpenAI HTTP 200 et deux échecs `ui_list_targets` après environ 31 secondes. Le journal Worker de cette période ne contient aucun appel `ui-actions/.../claim` ou `result` correspondant. Cela localise l’incident avant la réservation serveur, sans permettre d’attribuer rétrospectivement la perte à un seul composant navigateur ou au transport.

La version précédente livrait les paramètres exclusivement par le flux SSE du chat. Elle ne conservait ni la livraison, ni les erreurs de l’exécuteur ; ses lignes de commandes étaient supprimées après attente. Un événement perdu ou retardé suffisait à bloquer le tour. Son contrôle d’expiration comparait également l’heure du PC à celle du serveur, et rejetait silencieusement les durées supérieures à 30 secondes, notamment avec une horloge en retard.

## Plan appliqué

1. Livrer les commandes depuis une file D1 adressée à la fenêtre de travail, indépendamment de la lecture du SSE. Retourner une durée restante calculée côté serveur.
2. Servir les routes de l’assistant et les upgrades WebSocket directement à la frontière Worker. Conserver l’identité vérifiée Sites et le dispatcher commun d’autorisations, d’origine et de journalisation.
3. Réserver atomiquement deux emplacements par utilisateur et espace : une fenêtre `desktop` et un chat `controller`. Une fenêtre supplémentaire est bloquée et propose une reprise explicite. Le téléphone ne remplace pas l’ordinateur.
4. Détecter les téléphones et afficher le chat existant en plein écran, sans shell métier ni exécuteur DOM. Ses commandes sont affectées à l’ordinateur actif ; toute la séquence reste attachée à cette même fenêtre.
5. Journaliser les étapes et les refus en D1 ; sauvegarder également les traces IA en cours de tour.
6. Vérifier le transport sur le Worker compilé et les interactions du curseur sur une fixture DOM, puis publier le kit et l’application.

## Fonctionnement livré

La connexion WebSocket privée traite une impulsion client toutes les 1,5 secondes. Le coordinateur durable reste D1, partagé entre Workers, et ne repose pas sur une liste de sockets en mémoire. Le secours HTTP interroge la même file toutes les 2 secondes ; il s’active automatiquement si l’upgrade échoue ou si la connexion se ferme. Une connexion WebSocket est renouvelable après fermeture, avec secours HTTP immédiat. Aucun binding Durable Object supplémentaire n’est requis.

Le bail serveur dure 20 secondes. Un heartbeat ne peut ressusciter un bail expiré ou reprendre une autre fenêtre. Après perte du signal pendant 8 secondes, l’interface suspend le pilotage. Revenir à une fenêtre expirée demande « Continuer dans cette fenêtre ». Les navigateurs peuvent suspendre les onglets ou appareils en veille ; ils sont alors considérés indisponibles.

La réservation d’une action est atomique et liée à l’utilisateur, l’espace, la conversation, le tour et la fenêtre active. Avant un clic ou une saisie, une vérification supplémentaire confirme que le tour et la fenêtre sont encore actifs. Une fenêtre remplacée ne reçoit pas les anciennes commandes. Un clic déjà émis ne peut pas être annulé : sans accusé, le modèle reçoit un résultat incertain et ne doit pas répéter automatiquement l’action.

L’unicité concerne la fenêtre de travail, pas les onglets internes du shell, qui restent utilisables. Elle est appliquée pour un même compte dans un même espace. Le téléphone dispose de son emplacement de chat distinct. La mise en pause des autres fenêtres apparaît à la prochaine impulsion.

## Journaux conservés

- `lite_assistant_runs` : fournisseur, modèle, tours, outils et résultats expurgés, sauvegardés progressivement puis finalisés.
- `lite_assistant_ui_actions` : affectation, type, création, réservation, confirmation et résultat ; les paramètres à exécuter sont effacés à la fin du tour.
- `lite_browser_events` : connexions, blocages, reprises, transport, réception, exécution, accusés, erreurs et refus, avec identifiants de corrélation.
- `lite_request_logs` : journal API/MCP existant, avec son plafond existant de 1000 requêtes par espace.

Les nouveaux événements de pilotage sont conservés en base. Ils n’enregistrent pas les mots de passe, clés, cookies, en-têtes, champs saisis ou contenu complet du DOM. Les erreurs JavaScript enregistrent leur classe et l’étape du protocole, pas un message arbitraire pouvant contenir un secret. Les journaux ne capturent pas tous les messages de console des bibliothèques.

Consultation : « Diagnostics » dans le chat pour la connexion, et traces de conversation → « Pilotage navigateur » pour les événements liés au tour. Les lectures sont limitées à l’utilisateur et à son espace ; aucune clé API/MCP ne peut revendiquer une fenêtre.

## Vérification et retest

Le test `verify-browser-relay.mjs` charge le Worker compilé dans workerd avec une identité et un fournisseur locaux de test. Il ouvre un WebSocket réel, vérifie le refus d’une origine tierce, démarre un chat depuis le téléphone et termine le repérage puis le clic via une seconde connexion sans lire le flux SSE. Il contrôle les accusés et les traces persistées. Le test DOM monte le véritable exécuteur, vérifie son curseur, le clic Mail, la protection contre les doublons et les horloges décalées, et l’absence d’exécuteur mobile/inactif. Ces preuves ne sont pas un test réalisé sur le téléphone et le compte de production.

Retest après publication : recharger le Site sur ordinateur, demander « Clique sur Mail », ouvrir une seconde fenêtre et vérifier la reprise, puis ouvrir le même Site avec le même compte sur téléphone. Le téléphone doit montrer seulement le chat et « Ordinateur connecté ». La même demande doit déplacer le curseur dans la fenêtre d’ordinateur active. Fermer l’ordinateur et attendre l’expiration du bail : une nouvelle demande doit signaler son indisponibilité. Si un essai échoue, les événements conservés permettent d’identifier sa dernière étape confirmée.
