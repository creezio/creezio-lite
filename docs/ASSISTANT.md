# Assistant et intégrations

Le widget, le panneau, les conversations, l’affichage des actions et la page Intégrations utilisent les composants natifs. Le serveur Sites fournit le stockage D1 et les appels réseau ; aucun processus Hermes local n’est nécessaire.

## Configurer l’assistant

Dans **Admin → Intégrations → Ajouter** :

- OpenAI : saisir uniquement la clé. Le libellé et la référence `integration://openai` sont automatiques.
- Hermes : saisir l’URL HTTPS publique de la passerelle et sa clé serveur. Le libellé et la référence `integration://hermes` sont automatiques.
- Autre : choisir librement le libellé, la référence et le header HTTP, puis saisir la clé. Ces champs restent modifiables.

Un service natif possède une clé par espace. Les intégrations déjà présentes conservent leurs identifiants, références et secrets ; les anciennes métadonnées de modèle sont ignorées. La désactivation retire la connexion du chat. Les autres fournisseurs restent des secrets référencés, consommables par un module serveur.

Dans le **chat**, choisir le modèle à chaque conversation ou changer de modèle en cours de conversation. Le catalogue est demandé au service connecté via `/v1/models`, avec la clé côté serveur. Les familles OpenAI connues comme non conversationnelles sont filtrées ; la présence dans le catalogue ne garantit pas la compatibilité avec Chat Completions et les outils. « Autre modèle… » permet de saisir un identifiant exact, notamment si une passerelle Hermes ne publie pas de catalogue. Le serveur transmet le modèle choisi à chaque tour, sans modifier la clé ni imposer un modèle au niveau de l’intégration. Les erreurs de catalogue restent visibles, et un bouton permet de réessayer.

Le bouton Tester vérifie l’authentification OpenAI via `/v1/models`, ou la santé Hermes via `/health` ; il ne garantit pas qu’un modèle ou tous les outils distants sont disponibles. Une passerelle Hermes doit respecter le champ `model` de Chat Completions pour permettre le changement effectif du LLM. Lite ne modifie pas les réglages globaux d’une WebUI Hermes distincte.

## Contrats et protections

- Les clés ne figurent jamais dans le listing, le journal, les traces ou le stockage navigateur. AES-GCM utilise `LITE_INTEGRATION_SECRET` et lie chaque clé à son espace et son identifiant. La modification d’une intégration exige sa version courante.
- Le serveur conserve les conversations par utilisateur et espace. Il utilise son historique enregistré, pas un historique fourni par le client. L’administrateur n’a pas accès aux conversations d’un autre utilisateur.
- Le chat utilise `POST /v1/chat/completions` et traduit le flux fournisseur en événements natifs `meta`, `token`, `tool_start`, `tool_result`, `error`, `done`. Un serveur Hermes renvoyant du JSON est aussi accepté. Aucun appel n’est relancé automatiquement en cas d’échec.
- Les outils métier viennent du registre API/MCP. Les restrictions, les désactivations et l’appartenance sont revérifiées avant leur exécution. Les API de secrets et de conversations ne sont jamais des outils du modèle.
- Hermes reçoit les en-têtes `X-Hermes-Session-Id` et `X-Hermes-User-Id` isolés par espace/utilisateur/conversation. Sa passerelle doit être accessible depuis Sites. Les outils propres au serveur Hermes dépendent de sa configuration ; les droits Lite s’appliquent aux appels exécutés par Lite.
- La dictée native utilise la transcription OpenAI si une intégration OpenAI est active.
- Limites d’un tour : 4 minutes, 8 rounds, 40 messages / 64 000 caractères de contexte, 128 outils transmis, 2 Mo par réponse fournisseur. Les messages sont persistés ; l’arrêt conserve la réponse partielle et libère le verrou du fil.

Le raccordement n’installe pas de démon Hermes, de bureau distant, de moteur n8n ou de runner de plugins dans Sites. Les cartes d’approbation de plugins et les réglages globaux de reasoning Hermes restent conditionnés aux capacités du backend. Le chat et les tâches de suivi restent disponibles avec les capacités décrites ci-dessus.

Documentation du protocole : [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Modèles](https://developers.openai.com/api/reference/resources/models/methods/list), [Function calling](https://developers.openai.com/api/docs/guides/function-calling).

Les tests du transport s’exécutent aussi dans workerd : chargement des modèles, requête de chat diffusée, conservation des réponses 401/429 et refus des redirections. Le mode `manual` conserve la requête à son adresse initiale ; toute réponse 3xx est refusée. Cette protection suit les [précautions Cloudflare sur les redirections](https://developers.cloudflare.com/workers/runtime-apis/request/#properties). Les tests utilisent des réponses de fournisseur simulées, sans clé de production.

## Computer use dans l’application (0.7.0)

Le chat natif annonce son pilote avec `uiDriver:true`. OpenAI et Hermes reçoivent alors `ui_list_targets`, `ui_click`, `ui_type` et `ui_scroll`, en complément des outils métier autorisés. Une demande « clique sur Mail » doit repérer le lien visible puis utiliser sa référence. Le curseur, son badge IA, son animation et le halo de clic sont les composants originaux. Les quatre outils sont propres au navigateur du chat, sans dépendance à Electron ni contrôle du bureau.

L’événement SSE `ui_action` est traité par UiDriver. Avant de déplacer le curseur, le navigateur réserve l’action via `POST /api/v1/assistant/ui-actions/:id/claim`, puis confirme son résultat via `/result`. Les deux routes sont déclarées dans le catalogue commun, réservées aux sessions et exclues de MCP. Le relais D1 associe l’action à son utilisateur, son espace, sa conversation et son tour actif : il fonctionne même si les callbacks atteignent une autre instance Worker. La réservation est unique et les réponses expirées, rejouées ou issues d’un autre espace sont refusées.

Le bouton Arrêter interrompt le flux et les prochaines interactions du pilote. Une action déjà effectuée reste effectuée. Sans confirmation sous 30 secondes, le chat signale l’incertitude, sans inventer de réussite ni répéter automatiquement un clic. Chaque saisie remplace le champ et est limitée à 1000 caractères. Les mots de passe, champs de secrets et fichiers sont exclus ; la trace masque le texte saisi. Le pilote conserve les validations et permissions des actions de l’interface. Un clic réussi ne garantit pas le succès métier : celui-ci doit être observé ou vérifié par les outils de données.

Validation : échanges OpenAI/Hermes simulés à travers le dispatcher réel, confirmations D1 dans workerd, refus d’accès/rejeu/expiration et annulation. Une fixture DOM vérifie l’ordre déplacement → halo → événement de clic sur Mail avec le code natif. Ce test ne remplace pas une vérification visuelle du Site connecté ; aucune clé de production n’est utilisée.
