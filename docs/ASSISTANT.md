# Assistant et intégrations

Le widget, le panneau, les conversations, l’affichage des actions et la page Intégrations utilisent les composants natifs. Le serveur Sites fournit le stockage D1 et les appels réseau ; aucun processus Hermes local n’est nécessaire.

## Configurer l’assistant

Dans **Admin → Intégrations → Ajouter** :

- OpenAI : saisir une clé, un libellé et le modèle autorisé par le compte (défaut `gpt-4.1-mini`). L’option apparaît dans le mode Chat.
- Hermes : saisir l’URL HTTPS publique de la passerelle, sa clé serveur et le modèle (`hermes-agent` par défaut). L’option apparaît dans le mode Work.

Plusieurs intégrations sont possibles. Le sélecteur de modèle indique le libellé de l’intégration. Le bouton Tester vérifie l’authentification OpenAI via `/v1/models`, ou la santé Hermes via `/health` ; il ne garantit pas qu’un modèle ou tous les outils distants sont disponibles. La désactivation retire le profil du chat. Les autres fournisseurs restent des secrets référencés, consommables par un module serveur.

## Contrats et protections

- Les clés ne figurent jamais dans le listing, le journal, les traces ou le stockage navigateur. AES-GCM utilise `LITE_INTEGRATION_SECRET` et lie chaque clé à son espace et son identifiant. La modification d’une intégration exige sa version courante.
- Le serveur conserve les conversations par utilisateur et espace. Il utilise son historique enregistré, pas un historique fourni par le client. L’administrateur n’a pas accès aux conversations d’un autre utilisateur.
- Le chat utilise `POST /v1/chat/completions` et traduit le flux fournisseur en événements natifs `meta`, `token`, `tool_start`, `tool_result`, `error`, `done`. Un serveur Hermes renvoyant du JSON est aussi accepté. Aucun appel n’est relancé automatiquement en cas d’échec.
- Les outils viennent du registre API/MCP. Les restrictions, les désactivations et l’appartenance sont revérifiées avant leur exécution. Les API de secrets et de conversations ne sont jamais des outils du modèle.
- Hermes reçoit les en-têtes `X-Hermes-Session-Id` et `X-Hermes-User-Id` isolés par espace/utilisateur/conversation. Sa passerelle doit être accessible depuis Sites. Les outils propres au serveur Hermes dépendent de sa configuration ; les droits Lite s’appliquent aux appels exécutés par Lite.
- La dictée native utilise la transcription OpenAI si une intégration OpenAI est active.
- Limites d’un tour : 4 minutes, 8 rounds, 40 messages / 64 000 caractères de contexte, 128 outils transmis, 2 Mo par réponse fournisseur. Les messages sont persistés ; l’arrêt conserve la réponse partielle et libère le verrou du fil.

Le raccordement n’installe pas de démon Hermes, de bureau distant, de moteur n8n ou de runner de plugins dans Sites. Les cartes d’approbation de plugins et les réglages globaux de reasoning Hermes restent conditionnés aux capacités du backend. Le chat et les tâches de suivi restent disponibles avec les capacités décrites ci-dessus.

Documentation du protocole : [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Function calling](https://developers.openai.com/api/docs/guides/function-calling).
