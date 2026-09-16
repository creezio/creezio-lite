# Planification parallèle des missions — contrat v1

Complète `CONTRACT.md` (rôles, sélection, brief, lancement, réception). Ce contrat fixe **deux fichiers JSON** et la sémantique d’un **outil de lecture seule** qui dit, à chaque cycle, quelles missions peuvent partir, se reprendre, se fusionner ou se publier, et pourquoi les autres attendent. Il ne lance rien : le lancement, la déduplication et la reprise restent ceux de `scripts/cursor-agents.mjs` (registre privé, `agentId` déterministe, sélection choisie une fois).

| Fichier | Visibilité | Schéma | Exemple |
|---|---|---|---|
| **Plan** : ce que le programme doit produire (missions, dépendances par étape, réservations) | public, versionné dans le dépôt de l’application ou du kit | `planning-plan.schema.json` | `examples/planning-plan.json` |
| **État** : ce qui est engagé (statuts, sélection, branche/base/agent/run/PR, jalons, capacité, pauses, preuves) | privé, hors dépôt, à côté du registre `cursor-agents` | `planning-state.schema.json` | `examples/planning-state.json` |

Le plan ne contient jamais de branche, d’agent, de run, de PR, de sélection, de chemin local ni d’identifiant de tâche interne. Les exemples sont génériques ; ils n’implémentent aucune mission réelle.

## 1. Interface de l’outil (implémentation : mission P2)

```
node .cursor/skills/lite-orchestration/scripts/plan-missions.mjs validate --plan <plan.json> --state <state.json>
node .cursor/skills/lite-orchestration/scripts/plan-missions.mjs ready    --plan <plan.json> --state <state.json>
```

- Lecture seule, déterministe (même entrées ⇒ même sortie ; aucune horloge, aucun réseau, aucun POST, daemon ou cron). Une ligne JSON sur stdout ; erreurs d’usage sur stderr.
- Codes : **0** entrée valide (des missions bloquées ou aucune proposition ne sont pas des erreurs) · **2** schéma ou contrat invalide (fichier absent, JSON illisible, référence inconnue, cycle, dépôt/ressource/condition non déclarés, état hors plan) · **3** état ou capacité insuffisant pour une décision fiable (`ready` seulement : `capacity.maxActiveRuns` null, ou une mission en statut `unknown`). En code 3 le rapport est produit avec `reliable:false` et `proposals:[]`.
- `validate` s’arrête après §2–§3 (structure, références, graphe). `ready` enchaîne §4 (décision).

## 2. Plan (public)

Racine : `formatVersion:1`, `plan{id,title,revision?}`, `repos{clé→{url,defaultBase?}}`, `resources{id→description}`, `conditions{id→{check,proof}}`, `missions[]`.

Mission (tous requis sauf `section`, `contracts`) :

| Champ | Sens |
|---|---|
| `id` | Clé stable `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` ; identique à la clé de mission `cursor-agents`. Jamais renommée, même après recadrage. |
| `lot`, `repo` | Regroupement (cible de pause) ; dépôt déclaré dans `repos`. |
| `kind` | `dev` : start → delivered → integrated → published. `review` / `investigation` : start → delivered → closed ; pas d’étape integrate/publish. |
| `title`, `source`, `section`, `deliverable`, `criteria[]`, `owner` | Description publique ; `source` est un chemin du dépôt ; `owner` un rôle, jamais une personne. |
| `priority` | 1 (urgent) à 9 ; ordre des propositions : priorité croissante puis `id`. |
| `contracts[]` | Chemins publics des contrats à respecter. |
| `dependencies{start[],integrate[],publish[]}` | Distinctes par étape (§2.1). Objet requis, listes optionnelles. |
| `reserves{paths[],resources[]}` | Réservations exclusives (§2.2). Objet requis, listes optionnelles. |

### 2.1 Dépendances

Deux formes, sans expression ni DSL :

- `{ "mission": "A01", "step": "delivered" | "integrated" | "published" }` — jalon d’une **autre** mission. Atteint selon le statut de l’état : `delivered` ⇐ statut ∈ {delivered, integrated, published, closed} ; `integrated` ⇐ {integrated, published} ; `published` ⇐ {published}. Une mission `cancelled` n’atteint jamais rien (`dependency_cancelled`, à replanifier) ; `unknown` rend le cycle non fiable (code 3).
- `{ "condition": "ci-green-main" }` — condition déclarée dans `plan.conditions` (quoi vérifier, quelle preuve). Satisfaite seulement si l’état porte `conditions[id].satisfied=true` avec `evidence` et `at`. Absente ⇒ `condition_unverified` ; `satisfied:false` ⇒ `condition_failed`.

Règles de graphe :

- **Auto-dépendance interdite** (`self_dependency`, code 2). L’ordre start < delivered < integrated < published est implicite pour chaque mission ; une dépendance sur son propre jalon antérieur est inutile, sur un jalon postérieur c’est un cycle. On ne la représente donc pas.
- **Cycle** : le graphe a un nœud par (mission, jalon) avec les arêtes implicites start→delivered→integrated→published (dev) ou start→delivered (review/investigation), plus une arête (producteur, jalon) → (mission, étape) par dépendance (`start`→start, `integrate`→integrated, `publish`→published). Tout cycle ⇒ `dependency_cycle` (code 2) avec la liste des nœuds. Ainsi « B.start dépend de A.delivered et A.integrate dépend de B.delivered » est **acyclique et permis** (revue croisée) ; « A.start dépend de B.delivered et B.start dépend de A.delivered » est un cycle.
- Une dépendance vers une mission `review`/`investigation` n’admet que `delivered` ; une mission `review`/`investigation` ne déclare ni `integrate` ni `publish` (`step_not_applicable`, code 2).
- Référence à une mission, un dépôt, une ressource ou une condition non déclarés ⇒ `unknown_reference` (code 2). `id` en double ⇒ `duplicate_mission`.
- **Une dépendance `integrate` ou `publish` ne bloque jamais `start`** : la préparation démarre, seule la fusion ou la release attend.

### 2.2 Réservations

- `paths[]` : chemins POSIX relatifs à la racine du dépôt, normalisés (segments `[A-Za-z0-9._@-]`, ni `.` ni `..`, ni `/` initial ni `./`) ; `/` final = répertoire et tout son contenu. L’outil ne normalise pas : une forme non conforme est invalide.
- `resources[]` : ressources sémantiques exclusives déclarées dans `plan.resources` (`kit:version`, `db:schema`…) pour ce qu’un chemin ne capture pas (version cohérente sur plusieurs manifestes, schéma, contrat partagé).
- **Collision** : deux chemins dont les listes de segments sont préfixes l’une de l’autre (`runtime/core/search/` ⟂ `runtime/core/search/index.ts`), ou une ressource identique. Deux branches différentes ne dispensent pas de la collision : le conflit apparaît à l’intégration.
- **Tenue** : une réservation est tenue de `assignedAt` (lancement) jusqu’à `integratedAt`, `closedAt` ou annulation ; une mission `delivered` la tient encore (corrections et fusion à venir). Les fichiers seulement lus (section `Lecture` du brief) ne se réservent pas.

## 3. État (privé)

Racine : `formatVersion:1`, `plan{id,revision?}` (`id` égal au plan, sinon `plan_mismatch` code 2 ; `revision` différente ⇒ avertissement), `reconciledAt`, `capacity`, `pauses[]`, `conditions{}`, `missions{}`. Une mission du plan absente de `missions` est `pending`. Une clé absente du plan ⇒ `state_mission_unknown` (code 2).

### 3.1 Mission engagée

| Champ | Sens |
|---|---|
| `status` | `pending` · `active` (run CREATING/RUNNING ou POST incertain : **compte dans la capacité**, tient ses réservations) · `delivered` (run terminal, PR, réception ; réservations tenues) · `integrated` · `published` · `closed` (review/investigation terminée) · `cancelled` · `unknown` (l’orchestrateur ne sait pas ⇒ code 3). |
| `selection{key,modelId,params,chosenAt}` | Choisie **une fois** à l’attribution depuis `cursor-model.json`, recopiée du registre ; identique pour toute reprise. L’outil ne propose jamais un `resume` avec une autre sélection ; `selection:null` sur un `start` signifie « à choisir à l’attribution ». |
| `branch`, `base`, `agentId`, `runId`, `runStatus`, `launch`, `prUrl`, `headSha`, `followups` | Recopiés du registre `cursor-agents` et des lectures réconciliées (`launch` ∈ pending/launched/reconciled/uncertain/not_created/failed). `uncertain`/`pending` : mission **réservée**, comptée active, jamais relancée avant `reconcile`. |
| `correction{requested,reason,at}` | Correction demandée après revue : `ready` propose `resume` (même agent, même sélection, run terminal exigé) et retient l’intégration tant que `requested=true`. |
| `readyAt`, `assignedAt`, `deliveredAt`, `integratedAt`, `publishedAt`, `closedAt` | Jalons datés, écrits par l’orchestrateur à partir des rapports et des réceptions. |
| `waiting{code,since,detail}` | Dernière raison d’attente rapportée par `ready`, recopiée pour la traçabilité. |

Le schéma exige selon le statut : `active` ⇒ selection, branch, base, agentId, launch, assignedAt ; `delivered` ⇒ + prUrl, headSha, deliveredAt ; `integrated`/`published`/`closed` ⇒ leurs jalons.

### 3.2 Capacité, pauses, conditions

- `capacity.maxActiveRuns` : plafond de runs simultanés, `origin` = `configured` (plafond **local** décidé par l’orchestrateur) ou `observed` (limite **factuelle** constatée chez le fournisseur, `source` datée). `null` = inconnu ⇒ code 3. Un plafond local n’est jamais présenté comme un quota fournisseur : le rapport porte `providerQuotaVerified:false` tant que `origin` n’est pas `observed`.
- Runs actifs = missions `status:"active"` (développements, corrections, revues, `CREATING`, incertains). Les agents historiques d’une mission `delivered`/`integrated`/`closed` (IDLE) ne comptent pas. `observedActiveRuns` (relevé indépendant du compte) : l’outil retient le **maximum** des deux comptages.
- `maxReviewBacklog` : missions `dev` en `delivered` (revue/fusion à faire). Atteint ⇒ aucun nouveau `start` de `dev` (`review_backlog_full`) ; `resume`, `review`, `investigation`, `integrate`, `publish` restent proposables.
- `pauses[]` : `{scope: mission|lot|repo|all, target?, reason, since}`. Aucune proposition `start`/`resume` pour la cible ; les runs actifs ne sont pas interrompus ; `integrate`/`publish` restent proposés (l’orchestrateur décide).
- `conditions{id→{satisfied,evidence,at,by?}}` : preuves des conditions du plan ; jamais un secret.
- `reconciledAt` : l’orchestrateur réconcilie (`cursor-agents reconcile`/`status`) avant d’écrire l’état. L’outil n’a pas d’horloge et ne juge pas la fraîcheur.

## 4. Décision `ready`

Chaque cycle recalcule **tout** le périmètre depuis les deux fichiers ; rien n’est mémorisé entre deux appels.

1. **Valider** (§2–§3) ; code 2 si erreur. Code 3 si `maxActiveRuns` null ou un statut `unknown` (rapport sans proposition).
2. **Réservations tenues** = réservations des missions `active` et `delivered`.
3. **Capacité libre** = `maxActiveRuns` − max(actives comptées, `observedActiveRuns`). Backlog revue = `dev` en `delivered`.
4. **Étape candidate** par mission : `pending` → `start` ; `delivered` avec `correction.requested` → `resume` ; `delivered` sans correction (dev) → `integrate` ; `review`/`investigation` `delivered` → clôture par l’orchestrateur (`outcome:done`, aucune proposition) ; `integrated` → `publish` ; `active` → `active` ; autres → `done`/`cancelled`.
5. **Préconditions** (toutes, sinon `blocked` avec chaque raison) : dépendances de l’étape satisfaites ; pas de pause applicable (start/resume) ; aucune collision avec les réservations tenues (start) ; run terminal et `launch` ∈ launched/reconciled (resume) ; `launch` non incertain. Les missions qui passent sont **`ready`**.
6. **Propositions**, dans cet ordre : `integrate` (au plus **une par dépôt**, fusions séquentielles, priorité puis id), `publish` (au plus une par dépôt ; `covers` = missions intégrées dont les dépendances `publish` sont satisfaites), puis `resume`/`start` par priorité puis id. Chaque `resume`/`start` accepté **consomme une place et ajoute ses réservations** pour les candidats suivants du même cycle : trois missions indépendantes et trois places donnent trois propositions dans le même cycle, sans attendre une « vague ». Un candidat `ready` non proposé est **`waiting`** avec sa raison : `capacity_full`, `review_backlog_full`, `reservation_conflict` (avec une proposition du cycle), `integration_serialized`, `publish_serialized`.
7. Développement et revue se chevauchent librement ; seules fusions et publications sont séquentielles par dépôt.

Raisons (liste fermée ; chaque objet porte `code` et les champs utiles) :

| Code | Sens |
|---|---|
| `dependency_unmet` `{on:{mission,step}}` | Jalon du producteur non atteint. |
| `dependency_cancelled`, `dependency_unknown` | Producteur annulé (replanifier) ; producteur en statut `unknown`. |
| `condition_unverified`, `condition_failed` `{condition}` | Aucune preuve ; preuve négative. |
| `paused` `{scope,target?,since,reason}` | Pause ciblée applicable. |
| `reservation_conflict` `{with,path?|resource?,holderStatus}` | Collision avec une réservation tenue ou proposée dans ce cycle. |
| `capacity_full`, `review_backlog_full` | Aucune place ; backlog de revue à la borne. |
| `integration_serialized`, `publish_serialized` `{after}` | Une autre fusion/publication du même dépôt est proposée ce cycle. |
| `launch_uncertain` `{nextAction:"reconcile"}` | POST incertain ou entrée `pending` : réservée, comptée, jamais relancée. |
| `run_active` `{runStatus}` | Reprise impossible tant que le run n’est pas terminal. |
| `correction_pending` `{step:"integrate"}` | Intégration retenue tant qu’une correction est demandée. |
| `status_unknown` | Mission non fiable ; provoque le code 3. |

## 5. Rapport JSON

`validate` : `{command, formatVersion:1, plan{id,revision}, valid, errors[{code,path,message}], warnings[], summary{missions,byKind,byStatus}}`.

`ready` ajoute : `reliable`, `capacity{maxActiveRuns,origin,source,observedAt,providerQuotaVerified,active,proposed,free,reviewBacklog{count,max}}` (`active` = runs comptés avant le cycle, `proposed` = `resume`/`start` proposés, `free` = places restantes après ces propositions), `active[]`, `ready[]`, `proposals[]`, `blocked[]`, `missions{id→{status,outcome,step,reasons[]}}` avec `outcome` ∈ proposed · waiting · blocked · active · done · cancelled · unknown. **Tout candidat non proposé a au moins une raison.**

Rapport attendu de `ready` sur les deux exemples (code 0) :

```json
{
  "command": "ready", "formatVersion": 1, "plan": { "id": "example-program", "revision": "2026-09-16" },
  "valid": true, "errors": [], "warnings": [], "reliable": true,
  "capacity": { "maxActiveRuns": 5, "origin": "configured", "source": "Plafond local décidé par l’orchestrateur ; aucun quota fournisseur vérifié", "observedAt": "2026-09-16T18:40:00Z", "providerQuotaVerified": false, "active": 1, "proposed": 4, "free": 0, "reviewBacklog": { "count": 2, "max": 3 } },
  "active": [ { "mission": "B01", "kind": "dev", "runStatus": "UNKNOWN", "launch": "uncertain", "counted": true } ],
  "ready": [
    { "mission": "J01", "step": "integrate" }, { "mission": "Z00", "step": "publish" }, { "mission": "A01", "step": "resume" },
    { "mission": "C01", "step": "start" }, { "mission": "D01", "step": "start" }, { "mission": "G01", "step": "start" }, { "mission": "H01", "step": "start" }
  ],
  "proposals": [
    { "order": 1, "mission": "J01", "step": "integrate", "repo": "kit", "prUrl": "https://github.com/example/kit/pull/42", "headSha": "5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d", "consumesCapacity": false },
    { "order": 2, "mission": "Z00", "step": "publish", "repo": "kit", "covers": ["Z00"], "consumesCapacity": false },
    { "order": 3, "mission": "A01", "step": "resume", "repo": "kit", "priority": 1, "agentId": "bc-example-a01", "selection": { "key": "fable", "modelId": "claude-fable-5-1", "params": [ { "id": "thinking", "value": "true" }, { "id": "context", "value": "300k" }, { "id": "effort", "value": "high" } ], "chosenAt": "2026-09-15T10:00:00Z" }, "reason": "Revue R01 : test négatif d’accès croisé org_id manquant", "consumesCapacity": true, "holds": { "paths": ["runtime/core/search/", "docs/SEARCH.md"], "resources": [] } },
    { "order": 4, "mission": "C01", "step": "start", "repo": "kit", "priority": 1, "selection": null, "consumesCapacity": true, "holds": { "paths": ["template/app/search/"], "resources": [] } },
    { "order": 5, "mission": "D01", "step": "start", "repo": "kit", "priority": 2, "selection": null, "consumesCapacity": true, "holds": { "paths": ["runtime/core/records/"], "resources": [] } },
    { "order": 6, "mission": "G01", "step": "start", "repo": "kit", "priority": 3, "selection": null, "consumesCapacity": true, "holds": { "paths": ["CHANGELOG.md"], "resources": ["kit:version"] } }
  ],
  "blocked": [
    { "mission": "E01", "step": "start", "reasons": [ { "code": "reservation_conflict", "with": "A01", "path": "runtime/core/search/", "holderStatus": "delivered" } ] },
    { "mission": "F01", "step": "start", "reasons": [ { "code": "paused", "scope": "mission", "target": "F01", "since": "2026-09-16T17:00:00Z", "reason": "Attente d’arbitrage sur le connecteur mail" } ] },
    { "mission": "I01", "step": "start", "reasons": [ { "code": "condition_unverified", "condition": "upstream-schema-frozen" } ] }
  ],
  "missions": {
    "A01": { "status": "delivered", "outcome": "proposed", "step": "resume", "reasons": [ { "code": "correction_pending", "step": "integrate" } ] },
    "B01": { "status": "active", "outcome": "active", "step": null, "reasons": [ { "code": "launch_uncertain", "nextAction": "reconcile" } ] },
    "C01": { "status": "pending", "outcome": "proposed", "step": "start", "reasons": [] },
    "D01": { "status": "pending", "outcome": "proposed", "step": "start", "reasons": [] },
    "E01": { "status": "pending", "outcome": "blocked", "step": "start", "reasons": [ { "code": "reservation_conflict", "with": "A01", "path": "runtime/core/search/", "holderStatus": "delivered" } ] },
    "F01": { "status": "pending", "outcome": "blocked", "step": "start", "reasons": [ { "code": "paused", "scope": "mission", "target": "F01", "since": "2026-09-16T17:00:00Z", "reason": "Attente d’arbitrage sur le connecteur mail" } ] },
    "G01": { "status": "pending", "outcome": "proposed", "step": "start", "reasons": [] },
    "H01": { "status": "pending", "outcome": "waiting", "step": "start", "reasons": [ { "code": "capacity_full" } ] },
    "I01": { "status": "pending", "outcome": "blocked", "step": "start", "reasons": [ { "code": "condition_unverified", "condition": "upstream-schema-frozen" } ] },
    "J01": { "status": "delivered", "outcome": "proposed", "step": "integrate", "reasons": [] },
    "R01": { "status": "closed", "outcome": "done", "step": null, "reasons": [] },
    "Z00": { "status": "integrated", "outcome": "proposed", "step": "publish", "reasons": [] }
  }
}
```

Lecture : la fin de A01 (`delivered`) débloque C01 sans attendre B01 ; D01 démarre bien que sa dépendance `integrate` sur A01 ne soit pas atteinte ; la réservation `kit:version` de Z00 est libérée par son intégration, G01 la reprend ; A01 tient `runtime/core/search/` jusqu’à sa fusion et bloque E01 malgré des branches distinctes ; B01 incertain est réservé, compté, non relancé ; la correction de A01 consomme une place ; H01 attend avec une raison.

## 6. Boucle de l’orchestrateur

À chaque reprise ou transition (fin de run, réception, fusion, release, pause, nouvelle mission approuvée) :

1. **Réconcilier** : `cursor-agents reconcile`/`status` sur chaque mission engagée ; recopier `launch`, `runId`, `runStatus`, PR, head, jalons dans l’état ; `reconciledAt`. Un POST incertain devient `active` + `launch:"uncertain"` : réservé, compté, jamais dupliqué. Une lecture impossible devient `unknown` (conservateur : le cycle rend 3 et ne propose rien).
2. `validate` puis `ready` sur **tout le périmètre approuvé**.
3. Exécuter les propositions dans l’ordre : fusion séquentielle (SHA de tête attendu), publication, puis chaque `resume`/`start` — **toutes** celles du cycle, sans attendre une vague. Pour un `start` : choisir la sélection une fois (`preflight`), brief §3 du contrat, `launch --mission <id>` (dédup, `agentId` déterministe) ; écrire `selection`, `branch`, `base`, `agentId`, `assignedAt`, `status:"active"`. Pour un `resume` : `followup --mission <id>` sans champ `model` ; incrémenter `followups`, effacer `correction.requested`.
4. Recopier `readyAt` à la première apparition dans `ready`, `waiting` pour les candidats non proposés ; les `blocked` gardent leur cause explicable. Une absence de capacité locale n’est jamais annoncée comme un quota fournisseur vérifié.
5. Pause ciblée : ajouter une entrée `pauses` ; la lever la retire. Ne pas interrompre un run pour cela.

Invariants : IDs de mission stables ; sélection par mission inchangée aux reprises ; transport, déduplication et registre existants ; aucun lancement, fusion ou release par l’outil ; pas de métrique spéculative de coût.

## 7. Cas que P2 doit couvrir (fixtures et tests de l’outil)

1. Trois missions indépendantes, trois places ⇒ trois propositions `start` dans le même cycle (réservations ajoutées au fil des propositions).
2. Fin de A (`delivered`) débloque C dont `start` dépend de A ; B actif n’est pas attendu.
3. Dépendance seulement sur `integrate` ⇒ `start` proposé ; `integrate` retenu avec `dependency_unmet`.
4. Cycle ⇒ code 2 `dependency_cycle` (nœuds listés) ; auto-dépendance ⇒ `self_dependency` ; référence inconnue ⇒ `unknown_reference` ; fichier plan/état absent ou sans `formatVersion:1` ⇒ code 2 avec cause ; revue croisée A.integrate←B.delivered / B.start←A.delivered ⇒ valide.
5. Collision de chemins préfixes et de ressource sémantique ⇒ `reservation_conflict` avec la mission détentrice, même sur des branches distinctes ; libération après `integrated`/`closed`.
6. POST incertain (`launch:"uncertain"`, `runId:null`) ⇒ compté actif, réservé, non proposé, `launch_uncertain`.
7. Correction demandée ⇒ `resume` proposé (même `agentId`, même `selection`, run terminal exigé, `run_active` sinon) et `integrate` retenu ; revues actives comptent ; backlog de revue à la borne ⇒ `review_backlog_full` pour les `start` dev seulement.
8. Pause ciblée par mission, lot, dépôt, tout ⇒ `paused` ; `integrate`/`publish` inchangés.
9. Reprise du cycle avec le même état ⇒ mêmes IDs, même sélection, même rapport (déterminisme).
10. `maxActiveRuns:null` ou statut `unknown` ⇒ code 3, `reliable:false`, aucune proposition, causes listées.
11. Chaque candidat non proposé apparaît dans `blocked` ou `waiting` avec au moins une raison ; `observedActiveRuns` supérieur au comptage ⇒ maximum retenu.

## 8. Décisions à arbitrer avant P2/P3

- Fraîcheur : l’outil n’a pas d’horloge. Faut-il une option `--now` (hors interface actuelle) pour refuser un `reconciledAt` trop ancien en code 3, ou laisser l’orchestrateur seul juge ?
- Libération des réservations à `delivered` plutôt qu’à `integrated` pour certaines missions (option par mission) : non prévu en v1, la tenue jusqu’à la fusion est la règle.
- Distribution : le dossier est copié tel quel par `lite adopt` (`orchestrationSources` glob le dossier) ; P3 décide si `examples/` et `PLANNING.md` sont référencés depuis `SKILL.md`/`CONTRACT.md` et distribués aux applications.
- Emplacement recommandé du plan public dans une application (`docs/missions/plan.json` ou autre) : à fixer par P3.

## 9. Validation des fichiers de ce contrat

```
node -e "for (const f of process.argv.slice(1)) JSON.parse(require('node:fs').readFileSync(f, 'utf8')); console.log('JSON ok')" \
  .cursor/skills/lite-orchestration/planning-plan.schema.json .cursor/skills/lite-orchestration/planning-state.schema.json \
  .cursor/skills/lite-orchestration/examples/planning-plan.json .cursor/skills/lite-orchestration/examples/planning-state.json
npx --yes --package ajv-cli@5 --package ajv-formats@3 ajv validate --spec=draft2020 -c ajv-formats \
  -s .cursor/skills/lite-orchestration/planning-plan.schema.json -d .cursor/skills/lite-orchestration/examples/planning-plan.json
npx --yes --package ajv-cli@5 --package ajv-formats@3 ajv validate --spec=draft2020 -c ajv-formats \
  -s .cursor/skills/lite-orchestration/planning-state.schema.json -d .cursor/skills/lite-orchestration/examples/planning-state.json
npm run check
```

Les schémas sont en JSON Schema 2020-12 ; `ajv` est utilisé ici comme validateur externe et n’est pas une dépendance du kit. `npm run check` vérifie que le dossier ne contient ni identifiant d’agent/run réel ni chemin local.
