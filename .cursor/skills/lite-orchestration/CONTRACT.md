# Contrat d’orchestration Astra ⇄ Cursor

Version : celle du kit Creezio Lite qui a installé ce dossier (voir `manifest.json`). Propriétaire : le responsable commun du kit. Les applications reçoivent des copies générées ; une divergence locale est un conflit à résoudre, pas une variante.

## 1. Rôles et limites

| | Astra | Cursor (agent de réalisation) |
|---|---|---|
| Possède | architecture, priorités, briefs, sélection du modèle à l’attribution, registre privé, décision finale, fusion, release, déploiement | branche attribuée, PR, tests nouveaux, réception |
| Fait | préflight, lancement, checkpoints, revue ciblée des risques et des preuves | tout développement délégable : développement, corrections, investigations, préparation d’upgrade, revues mécaniques |
| Ne fait pas | développer localement, déléguer à Codex, changer de modèle en cours de mission | fusionner, publier, déployer, lancer un agent ou un lot suivant, sortir de ses fichiers |

Les autorisations et verrous existants (`docs/MAINTENANCE.md`, verrou coopératif du dépôt, mandats applicatifs) restent en vigueur. Une fin de run ne prouve ni intégration ni déploiement.

## 2. Sélection du modèle

- `cursor-model.json` liste les sélections autorisées : `fable` (Fable 5.1, défaut) pour la majorité des missions ; `opus` (dernière Claude Opus) ou `grok` (Grok 4.6) seulement pour une mission clairement plus simple et bornée dès l’attribution. Chaque sélection porte sa combinaison complète de paramètres, relevée dans le catalogue authentifié du compte (date dans `catalogCheckedAt`) : contexte et effort raisonnables, `fast` et `cyber` à `false` là où le modèle les expose, aucun paramètre inventé (Grok n’expose pas de contexte).
- La sélection est choisie **une fois** à l’attribution et conservée toute la mission, corrections et reprises comprises. Pas de reclassement au fil des messages, de changement automatique, de successeur ou transfert pour changer de modèle, de moteur adaptatif, de métriques spéculatives ni d’escalade. Si le périmètre déborde, Astra recadre la mission.
- Préflight (`GET /v1/models`, catalogue authentifié et daté) : l’identifiant exact doit être listé et la combinaison complète de paramètres doit être égale à une variante du catalogue, sans complétion ni variante voisine. Sinon : bloqué (code 2) ; le rapport liste les variantes du catalogue pour correction par PR du kit. API injoignable, clé refusée, quota : indisponible (code 3). Dans les deux cas, la mission n’est pas lancée et aucun autre modèle n’est essayé.
- `POST /v1/agents` documente `model` (identifiant et paramètres complets). `POST /v1/agents/{id}/runs` (reprise) ne porte aucun champ `model` : la sélection initiale s’applique telle quelle. Un POST accepté ne prouve ni la sélection effective ni un changement.
- Reçu de sélection dans les sorties `launch`, `status`, `followup` : `requested` (choix demandé), `catalog` (validation datée), `createAccepted`/`runAccepted` (requêtes acceptées), `modelObserved` = `null` tant que l’API publique n’expose pas le modèle d’un run. La sélection acceptée à la création et la requête de reprise acceptée sont deux faits distincts. Le nom de modèle qu’un agent déclare lui-même (par exemple `originalModelName` de `run-info`) n’encode pas le contexte et ne prouve pas l’absence de repli fournisseur : le rapporter comme déclaration de l’agent, jamais comme télémétrie indépendante. Un routage interne du fournisseur, distinct de notre sélection, reste possible ; aucune promesse ni contournement à ce sujet.
- Clé : uniquement `CURSOR_API_KEY` dans l’environnement autorisé de l’orchestrateur. Jamais dans un fichier, un journal, un brief, une PR ou une sortie de script.

## 3. Brief (compact)

Champs obligatoires, dans cet ordre : `Mission` (clé unique, ex. `O01`), `Dépôt`, `Base` (SHA validé), `Branche` (réservée), `Sélection` (clé de `cursor-model.json` et date du préflight), `Rôle` (agent de réalisation, pas orchestrateur), `But`, `Lecture` (fichiers utiles seulement), `Périmètre` (fichiers attribués ; interdits), `Livrables`, `Validation` (tests positifs/négatifs attendus, commandes du kit), `Interdits` (fusion, release, déploiement, autre agent, migrations appliquées, secrets, changement de modèle), `Prochaine action`. Pas de données privées, de chemins locaux ni d’identifiants de tâches internes.

## 4. Lancement, déduplication, réconciliation

- Registre privé hors dépôt (`--registry`) : une entrée par clé de mission (agent, run, dépôt, branche, PR, sélection, état). Une clé déjà `launched`/`reconciled`/`uncertain` n’est jamais relancée ; reprendre l’agent existant (`followup`) ou clôturer avant une nouvelle clé.
- `agentId` déterministe (UUID v5 de `dépôt#mission`) écrit dans le registre avant l’envoi. `409 agent_id_conflict` ⇒ lecture de l’agent existant, aucune création. Appel incertain (délai, réseau après envoi) ⇒ état `uncertain` ; entrée restée `pending` (processus interrompu pendant le POST) ⇒ même traitement. Dans les deux cas `launch` et `followup` refusent et renvoient à `reconcile`, qui lit `GET /v1/agents/{id}` : existant ⇒ `reconciled` ; 404 ⇒ `not_created`, relance autorisée sur la même clé.
- Reprise (`followup --mission --registry`) : même agent. Avant tout envoi, lire l’agent réel (`GET /v1/agents/{id}`) et son `latestRunId`, puis ce run ; le `runId` du registre ne fait pas foi. Terminal exigé (`FINISHED`, `ERROR`, `CANCELLED`, `EXPIRED`) ; run actif, dernier run inconnu ou lecture en échec (403, 404, réseau) ⇒ refus sans POST, jamais une permission de créer ou rejouer. La tentative est persistée (`followup: {state: pending, priorRunId}`) avant le POST, puis `accepted` (nouveau `runId`), `rejected` ou `uncertain`. Livraison inconnue ⇒ toute réémission est refusée jusqu’à `reconcile`, qui compare `latestRunId` de l’agent au `priorRunId` : différent ⇒ suite acceptée (même si ce run est déjà terminé), identique ⇒ `not_created` et réémission autorisée. Aucune répétition automatique ; le `409 agent_busy` du serveur est une garde complémentaire, pas la preuve du contrôle client. `followup --agent` sans registre : mêmes lectures préalables, mais aucune idempotence ni réconciliation ; en cas de livraison inconnue, lire l’agent soi-même. Les missions utilisent la forme `--mission`.
- Avant de lancer : vérifier qu’aucune PR ouverte ne porte déjà la branche ou la mission ; sinon la reprendre (`prUrl`).

## 5. Checkpoints

- `status` lit `GET /v1/agents/{id}/runs/{runId}` ; polling progressif 15 s → 30 s → 60 s → 120 s → 300 s ; sortie uniquement au changement (statut, branches, PR, fin), sélection initiale rappelée telle quelle. Résultat final tronqué ; jamais le flux d’événements ni l’historique complet par défaut. Une lecture indisponible (réseau, 5xx, quota) termine `status --follow` par une sortie explicite (code 3) ; l’orchestrateur relance la même commande, le fichier d’état conserve le dernier relevé pour le diff. Aucune veille active simulée.
- Checkpoint écrit par l’agent (au plus quelques lignes) : head SHA, ce qui a changé depuis le dernier checkpoint, tests exécutés, blocage éventuel, prochaine action.

## 6. Réception (compact)

Obligatoire dans la PR et le message final : `Mission`, `Base`/`Head` (SHA), `Agent`/`Run` (identifiants Cursor, URL), `Sélection` (clé et paramètres demandés ; `modelObserved: null` ; le nom que l’agent déclare, s’il en a un, est indiqué comme déclaration de l’agent), `Périmètre` réellement modifié, `Tests` (commandes exactes et résultats ; mocks et fixtures désignés comme tels), `CI` (état réel du head), `Risques`, `Blocage` ou « aucun », `Prochaine action` avec responsable, `Artefacts` (liens vers logs complets, jamais leur contenu). Ne rien affirmer qui n’a pas été exécuté.

## 7. Revue et décision

Revue Cursor indépendante proportionnée au risque (mission distincte, sans droit de fusion), centrée sur droits, données, secrets, migrations et contrats partagés. Astra tranche à partir du diff, des preuves et de la CI du head exact ; la CI seule est insuffisante. Le contrôle des app owners et des releases reste à l’orchestrateur.

## 8. Adoption et copies

- Fichiers gérés : `SKILL.md`, `CONTRACT.md`, `cursor-model.json`, `scripts/cursor-agents.mjs`, `.cursor/rules/lite-orchestration.mdc`. `manifest.json` (formatVersion 1, version du kit, empreintes) appartient au kit.
- `lite adopt --app` inspecte : `current`, `missing`, `outdated` (empreinte du manifeste précédent), `conflict` (modifié localement), `unmanaged` (préservé). Avant toute écriture, chaque chemin géré et ses parents existants sont contrôlés par `lstat` : lien symbolique ou jonction ⇒ refus, aucune écriture partielle ; manifeste JSON invalide ⇒ erreur claire sans modification. `--apply` n’écrit qu’en l’absence de conflit ; second passage sans changement. Commande à lancer depuis un checkout du kit : `node <checkout-kit>/bin/lite.mjs adopt --app <dossier> [--apply]`. `AGENTS.md`, règles métier, `lite.lock.json`, migrations et données ne sont jamais touchés.
- Ne crée aucun cron applicatif et ne retire aucun schedule existant.
