# Contrat d’orchestration Astra ⇄ Cursor Fable 5.1

Version : celle du kit Creezio Lite qui a installé ce dossier (voir `manifest.json`). Propriétaire : le responsable commun du kit. Les applications reçoivent des copies générées ; une divergence locale est un conflit à résoudre, pas une variante.

## 1. Rôles et limites

| | Astra | Cursor Fable 5.1 |
|---|---|---|
| Possède | architecture, priorités, briefs, registre privé, décision finale, fusion, release, déploiement | branche attribuée, PR, tests nouveaux, réception |
| Fait | préflight, lancement, checkpoints, revue ciblée des risques et des preuves | développement, corrections, investigations, préparation d’upgrade, revues mécaniques |
| Ne fait pas | développer localement, déléguer à Codex, substituer un modèle | fusionner, publier, déployer, lancer un agent ou un lot suivant, sortir de ses fichiers |

Les autorisations et verrous existants (`docs/MAINTENANCE.md`, verrou coopératif du dépôt, mandats applicatifs) restent en vigueur. Une fin de run ne prouve ni intégration ni déploiement.

## 2. Modèle épinglé et preuve

- `cursor-model.json` fixe `modelId`, `params` et `effectiveModelName`. Aucune valeur par défaut, aucun alias supposé, aucun repli.
- Préflight avant chaque lancement : `GET /v1/models` doit lister l’identifiant exact ; les paramètres épinglés doivent être acceptés ; si le modèle exige des variantes, la combinaison épinglée doit exister. Sinon : bloqué (code 2). API injoignable, clé refusée, quota : indisponible (code 3). Dans les deux cas, la mission n’est pas lancée et aucun autre modèle n’est essayé.
- Lancement : `model.id` explicite dans `POST /v1/agents`. L’API ne renvoie pas le modèle d’un run : la preuve du modèle effectif est le champ `originalModelName` de l’outil `cursor-cloud run-info` que l’agent relève lui‑même et écrit dans sa réception. Astra le compare à `effectiveModelName` ; toute différence est un blocage.
- Limite connue : Cursor documente un routage automatique vers Claude Opus lorsqu’une requête déclenche ses garde-fous. Ce routage par requête n’est pas observable par l’API ; la preuve porte sur le modèle du run.
- Clé : uniquement `CURSOR_API_KEY` dans l’environnement autorisé de l’orchestrateur. Jamais dans un fichier, un journal, un brief, une PR ou une sortie de script.

## 3. Brief (compact)

Champs obligatoires, dans cet ordre : `Mission` (clé unique, ex. `O01`), `Dépôt`, `Base` (SHA validé), `Branche` (réservée), `Modèle` (`modelId` + référence du préflight), `Rôle` (agent de réalisation, pas orchestrateur), `But`, `Lecture` (fichiers utiles seulement), `Périmètre` (fichiers attribués ; interdits), `Livrables`, `Validation` (tests positifs/négatifs attendus, commandes du kit), `Interdits` (fusion, release, déploiement, autre agent, migrations appliquées, secrets, substitution de modèle), `Prochaine action`. Pas de données privées, de chemins locaux ni d’identifiants de tâches internes.

## 4. Lancement, déduplication, réconciliation

- Registre privé hors dépôt (`--registry`) : une entrée par clé de mission (agent, run, dépôt, branche, PR, état). Une clé déjà `launched`/`reconciled`/`uncertain` n’est jamais relancée ; reprendre l’agent existant (`followup`) ou clôturer avant une nouvelle clé.
- `agentId` déterministe (UUID v5 de `dépôt#mission`) écrit dans le registre avant l’envoi. `409 agent_id_conflict` ⇒ lecture de l’agent existant, aucune création. Appel incertain (délai, réseau après envoi) ⇒ état `uncertain`, puis `reconcile` lit `GET /v1/agents/{id}` : existant ⇒ `reconciled` ; 404 ⇒ `not_created`, relance autorisée sur la même clé.
- Avant de lancer : vérifier qu’aucune PR ouverte ne porte déjà la branche ou la mission ; sinon la reprendre (`prUrl`).

## 5. Checkpoints

- `status` lit `GET /v1/agents/{id}/runs/{runId}` ; polling progressif 15 s → 30 s → 60 s → 120 s → 300 s ; sortie uniquement au changement (statut, branches, PR, fin). Résultat final tronqué ; jamais le flux d’événements ni l’historique complet par défaut.
- Checkpoint écrit par l’agent (au plus quelques lignes) : head SHA, ce qui a changé depuis le dernier checkpoint, tests exécutés, blocage éventuel, prochaine action.

## 6. Réception (compact)

Obligatoire dans la PR et le message final : `Mission`, `Base`/`Head` (SHA), `Agent`/`Run` (identifiants Cursor, URL), `Modèle effectif` (`originalModelName` de `run-info`), `Périmètre` réellement modifié, `Tests` (commandes exactes et résultats ; mocks et fixtures désignés comme tels), `CI` (état réel du head), `Risques`, `Blocage` ou « aucun », `Prochaine action` avec responsable, `Artefacts` (liens vers logs complets, jamais leur contenu). Ne rien affirmer qui n’a pas été exécuté.

## 7. Revue et décision

Revue Cursor indépendante proportionnée au risque (mission distincte, sans droit de fusion), centrée sur droits, données, secrets, migrations et contrats partagés. Astra tranche à partir du diff, des preuves et de la CI du head exact ; la CI seule est insuffisante. Le contrôle des app owners et des releases reste à l’orchestrateur.

## 8. Adoption et copies

- Fichiers gérés : `SKILL.md`, `CONTRACT.md`, `cursor-model.json`, `scripts/cursor-agents.mjs`, `.cursor/rules/lite-orchestration.mdc`. `manifest.json` (formatVersion 1, version du kit, empreintes) appartient au kit.
- `lite adopt --app` inspecte : `current`, `missing`, `outdated` (empreinte du manifeste précédent), `conflict` (modifié localement), `unmanaged` (préservé). `--apply` n’écrit qu’en l’absence de conflit ; second passage sans changement. `AGENTS.md`, règles métier, `lite.lock.json`, migrations et données ne sont jamais touchés.
- Ne crée aucun cron applicatif et ne retire aucun schedule existant.
