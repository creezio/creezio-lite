# Planification parallèle des missions — contrat v1

Complète `CONTRACT.md` (rôles, sélection, brief, lancement, réception). Ce contrat fixe **deux fichiers JSON** et la sémantique d’un **outil de lecture seule** qui dit, à chaque cycle, quelles missions peuvent partir, se reprendre, se fusionner ou se publier, et pourquoi les autres attendent. Il ne lance rien : le lancement, la déduplication et la reprise restent ceux de `scripts/cursor-agents.mjs` (registre privé, `agentId` déterministe, sélection choisie une fois).

| Fichier | Visibilité | Schéma | Exemple |
|---|---|---|---|
| **Plan** : ce que le programme doit produire (missions, dépendances par étape, réservations) | public, versionné à `docs/planning/plan.json` du dépôt de l’application ou du kit | `planning-plan.schema.json` | `examples/planning-plan.json` |
| **État** : ce qui est engagé (statuts, sélection, branche/base/agent/run/PR, jalons, capacité, pauses, preuves) | privé, **hors dépôt**, à côté du registre `cursor-agents` | `planning-state.schema.json` | `examples/planning-state.json` |

Le plan ne contient jamais de branche, d’agent, de run, de PR, de sélection, de chemin local ni d’identifiant de tâche interne. Les exemples sont génériques ; ils n’implémentent aucune mission réelle. Les cinq ressources de ce contrat (`PLANNING.md`, les deux schémas, les deux exemples) et l’outil `scripts/plan-missions.mjs` sont distribués avec le dossier par `lite create`/`lite adopt` (toute ressource du dossier canonique, via `manifest.json`) ; `check-kit` et les tests du kit vérifient que les exemples valident et que `ready` reproduit le rapport §5. Le renvoi depuis `SKILL.md`/`CONTRACT.md` suit la prochaine mise à jour de ces deux fichiers.

## 1. Interface de l’outil (implémentation : mission P2)

```
node .cursor/skills/lite-orchestration/scripts/plan-missions.mjs validate --plan <plan.json> --state <state.json>
node .cursor/skills/lite-orchestration/scripts/plan-missions.mjs ready    --plan <plan.json> --state <state.json>
```

- Lecture seule, déterministe (même entrées ⇒ même sortie ; aucune horloge, aucun réseau, aucun POST, daemon ou cron). Une ligne JSON sur stdout ; erreurs d’usage sur stderr.
- Codes : **0** entrée valide (des missions bloquées ou aucune proposition ne sont pas des erreurs) · **2** schéma ou contrat invalide (fichier absent, JSON illisible, référence inconnue, cycle, dépôt/ressource/condition non déclarés, état hors plan, état incohérent §3.1) · **3** état ou capacité insuffisant pour une décision fiable (`ready` seulement : `capacity.maxActiveRuns` null, ou une mission en statut `unknown`). En code 3 le rapport est produit avec `reliable:false` et `proposals:[]`.
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

- `{ "mission": "A01", "step": "delivered" | "integrated" | "published" }` — jalon d’une **autre** mission. Atteint selon le statut de l’état : `delivered` ⇐ statut ∈ {delivered, integrated, published, closed} ; `integrated` ⇐ {integrated, published} ; `published` ⇐ {published}. Une mission `historical` atteint `historical.step` et les jalons qui le précèdent (`published` ⇒ les trois ; `integrated` ⇒ delivered et integrated ; `closed` ⇒ delivered seulement). Une mission `cancelled` n’atteint jamais rien (`dependency_cancelled`, à replanifier) ; `unknown` rend le cycle non fiable (code 3).
- **`delivered` n’est pas une acceptation** : c’est l’artefact produit (run terminal, PR, réception), susceptible de correction. Un consommateur qui a besoin d’un contrat **stable** dépend en plus d’une **condition d’acceptation sourcée** (`{condition}` avec preuve dans l’état) ; dépendre de `delivered` seul convient aux fixtures et travaux réalignables. Une correction ouverte sur le producteur (`correction.requested=true`) laisse `delivered` atteint mais la condition d’acceptation non prouvée : le consommateur exigeant reste bloqué (`condition_unverified`), le consommateur réalignable démarre.
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
- **Collision** : deux chemins du **même dépôt** (`mission.repo`) dont les listes de segments sont préfixes l’une de l’autre (`runtime/core/search/` ⟂ `runtime/core/search/index.ts`), ou une **ressource identique quels que soient les dépôts** (les ressources sémantiques sont globales au plan). Un chemin identique dans deux dépôts distincts n’est pas une collision. Deux branches différentes du même dépôt ne dispensent pas de la collision : le conflit apparaît à l’intégration.
- **Tenue** : une réservation est tenue de `assignedAt` (lancement) jusqu’à `integratedAt`, `closedAt` ou annulation ; une mission `delivered` la tient encore (corrections et fusion à venir). Décision v1 définitive : aucune libération anticipée à `delivered`, ni option par mission. Une mission `unknown` tient prudemment ses réservations (le cycle n’est de toute façon pas fiable, §4). Les statuts `integrated`, `published`, `closed`, `cancelled` et `historical` ne tiennent rien. Les fichiers seulement lus (section `Lecture` du brief) ne se réservent pas.
- **Transfert explicite borné de propriété (composition)** : quand plusieurs lots `delivered` doivent être composés dans une PR unique, l’orchestrateur peut transférer leurs réservations à une mission de composition — jamais automatiquement à `delivered`, toujours par décision écrite dans le brief de la mission réceptrice (missions sources, heads reçus et figés, raccordements attendus). Le transfert se matérialise dans le plan (nouvelle `revision`) : les chemins et ressources transférés passent des `reserves` des producteurs à celles de la mission de composition ; chaque producteur reçoit une `note` dans l’état (« réservations transférées à P4 pour composition, head figé »). Les producteurs restent `delivered` : leurs auteurs sont terminaux, aucune reprise concurrente, toute correction passe par la mission de composition ou par un transfert inverse explicite. Leur jalon `integrated` n’est atteint qu’après fusion de la PR composée les incluant (SHA prouvés) ; un lot dont la propriété n’est pas transférée garde ses réservations et bloque la composition sur ses chemins.

## 3. État (privé)

Racine : `formatVersion:1`, `plan{id,revision?}` (`id` égal au plan, sinon `plan_mismatch` code 2 ; `revision` différente ⇒ avertissement), `reconciledAt`, `capacity`, `pauses[]`, `conditions{}`, `missions{}`. Une mission du plan absente de `missions` est `pending`. Une clé absente du plan ⇒ `state_mission_unknown` (code 2).

### 3.1 Mission engagée

| Champ | Sens |
|---|---|
| `status` | `pending` (rien de lancé) · `active` (run CREATING/RUNNING, POST en cours ou incertain, ou run terminal pas encore reclassé : **compte dans la capacité**, tient ses réservations) · `delivered` (run terminal, PR, réception ; réservations tenues ; **artefact produit, non accepté**) · `integrated` · `published` · `closed` (review/investigation terminée) · `cancelled` · `historical` (jalon reçu avant la tenue de l’état, §3.1.1) · `unknown` (l’orchestrateur ne sait pas ⇒ code 3 ; réservations tenues par prudence). |
| `selection{key,modelId,params,chosenAt}` | Choisie **une fois** à l’attribution depuis `cursor-model.json`, recopiée du registre ; identique pour toute reprise. L’outil ne propose jamais un `resume` avec une autre sélection ; `selection:null` sur un `start` signifie « à choisir à l’attribution ». |
| `legacySelection{reason:"model_omitted",requestedAt,evidence}` | **Alternative exclusive à `selection`** pour un lot lancé avant le standard (création sans champ `model`) dont la sélection effective est inconnue : on ne reconstitue rien, **un ancien payload sans `model` ne devient jamais `modelId` par défaut**. Admise seulement sur un jalon terminal prouvé : `delivered`, `integrated`, `published` (dev) ou `delivered`, `closed` (review/investigation) ; `delivered` exige toujours run terminal et `launch` ∈ launched/reconciled. Jamais sur `pending`, `active` ni `historical` ; jamais de `start` ni de `resume` avec cette provenance (`selection_unknown`). La mission tient ses réservations et compte dans le backlog de revue jusqu’à sa fusion, n’occupe aucune place active et ne rend pas le cycle non fiable ; son intégration puis sa publication restent proposables. Toute correction est une mission corrective distincte, sélection choisie à l’attribution. |
| `branch`, `base`, `agentId`, `runId`, `runStatus`, `launch`, `prUrl`, `headSha`, `followups` | Recopiés du registre `cursor-agents` et des lectures réconciliées (`launch` ∈ pending/launched/reconciled/uncertain/not_created/failed). `launch` `uncertain`/`pending` : mission **réservée**, comptée active, jamais relancée avant `reconcile`. |
| `historical{step,evidence,at}` | Seulement avec `status:"historical"` (§3.1.1). |
| `correction{requested,reason,at}` | Correction demandée après revue : `ready` propose `resume` (même agent, même sélection, run terminal exigé) et retient l’intégration tant que `requested=true`. |
| `readyAt`, `assignedAt`, `deliveredAt`, `integratedAt`, `publishedAt`, `closedAt` | Jalons datés, écrits par l’orchestrateur à partir des rapports et des réceptions. |
| `waiting{code,since,detail}` | Dernière raison d’attente rapportée par `ready`, recopiée pour la traçabilité. |

Le schéma exige selon le statut : `active` ⇒ selection, branch, base, agentId, launch, assignedAt ; `delivered` ⇒ + prUrl, headSha, deliveredAt, `launch` ∈ launched/reconciled et `runStatus` terminal (FINISHED/ERROR/CANCELLED/EXPIRED) ; `integrated`/`published`/`closed` ⇒ leurs jalons. Sur `delivered`, `integrated`, `published` et `closed`, exactement une des deux provenances `selection` ou `legacySelection` (`oneOf`) ; `legacySelection` est refusée sur tout autre statut.

Invariants de cohérence (schéma, puis contrat pour ce que le schéma ne voit pas ; toute violation ⇒ code 2 `state_inconsistent {mission, field}`) :

- **`pending` sans lancement** : avant tout POST l’orchestrateur écrit `status:"active"` + `launch:"pending"` ; une entrée `pending` portant `launch` pending/uncertain **ou** `runStatus` CREATING/RUNNING/UNKNOWN est incohérente et **rejetée** : elle sous-compterait la capacité et provoquerait une seconde création. On ne la normalise jamais en effaçant l’incertitude (ni en supprimant `launch`, ni en la passant `pending` propre) : on la corrige en `active` puis on réconcilie.
- **Statuts libérés** (`integrated`, `published`, `closed`, `cancelled`, `historical`) : jamais `launch` pending/uncertain, jamais `runStatus` CREATING/RUNNING/UNKNOWN, jamais `correction.requested=true`.
- **`delivered`** : jamais de POST incertain ni de run non terminal (sinon la mission est encore `active`).
- **`active` avec run terminal** : l’orchestrateur n’a pas encore reclassé (vers `delivered` après réception, ou `pending` après échec) ; la mission reste comptée et réservée, rapportée `run_terminal_unreconciled` avec `nextAction: reconcile` — jamais présentée comme un run en cours.
- L’incertitude ne se perd pas : un `launch:"uncertain"` ne disparaît que par `reconcile` (→ `launched`/`reconciled`/`not_created`/`failed`), jamais par réécriture manuelle. Cela vaut pour la reprise comme pour le lancement : une tentative de `followup` sans réponse exploitable laisse la mission `active` + `launch:"uncertain"` jusqu’à `reconcile` ; `followups` n’est incrémenté et `correction.requested` effacé qu’après une reprise **acceptée** (réponse ou réconciliation), jamais avant.

#### 3.1.1 `historical` : jalon reçu sans sélection ni agent

Pour un lot **réellement reçu avant la tenue de l’état** (sélection, agent, run inconnus), on n’invente rien : `status:"historical"` et `historical:{step,evidence,at}` avec `step` ∈ `integrated` | `published` (mission `dev` seulement) | `closed` (`review`/`investigation` seulement ; le plan porte `kind`, l’outil vérifie : `historical_step_not_applicable`, code 2), `evidence` publique (SHA de fusion, PR fusionnée, tag, réception close ; jamais un secret), `at`. Interdits : `selection`, `agentId`, `runId`, `runStatus`, `launch`, `correction`, `waiting`, `readyAt`, `assignedAt`. Une mission `historical` n’occupe **aucune place**, ne tient **aucune réservation**, ne reçoit **aucune proposition** (`outcome:done`) ; elle satisfait les dépendances selon `historical.step` (§2.1). Toute reprise est une **mission corrective distincte** du plan.

### 3.2 Capacité, pauses, conditions

- `capacity.scope` : identifiant du **périmètre compté** (`kit`, `app-x`, identifiant du plan). `maxActiveRuns` et `observedActiveRuns` portent **exactement** sur ce périmètre : on ne soustrait jamais les runs d’un compte entier à un plafond local d’un périmètre plus étroit ; un relevé plus large n’a pas sa place ici (il reste dans le registre de l’orchestrateur).
- `capacity.maxActiveRuns` : plafond de runs simultanés sur `scope`, `origin` = `configured` (plafond **local** décidé par l’orchestrateur) ou `observed` (limite **factuelle** constatée chez le fournisseur pour ce même périmètre, `source` datée). `null` = inconnu ⇒ code 3. **`0` est valide** : plan exploitable, tout `start`/`resume` en `waiting capacity_full`. Un quota fournisseur inconnu ou non exposé **ne rend pas la valeur nulle** : un plafond local connu suffit à décider. Un plafond local n’est jamais présenté comme un quota fournisseur : le rapport porte `providerQuotaVerified:false` tant que `origin` n’est pas `observed`.
- Runs actifs = missions `status:"active"` (développements, corrections, revues, `CREATING`, POST en cours ou incertains). Les agents historiques d’une mission `delivered`/`integrated`/`published`/`closed`/`historical` (IDLE ou inconnus) ne comptent pas. `observedActiveRuns` (relevé indépendant, même `scope`) : l’outil retient le **maximum** des deux comptages.
- `maxReviewBacklog` : missions `dev` en `delivered` (revue/fusion à faire). Atteint ⇒ aucun nouveau `start` de `dev` (`review_backlog_full`) ; `resume`, `review`, `investigation`, `integrate`, `publish` restent proposables.
- `pauses[]` : `{scope: mission|lot|repo|all, target?, reason, since}`. Aucune proposition `start`/`resume` pour la cible ; les runs actifs ne sont pas interrompus ; `integrate`/`publish` restent proposés (l’orchestrateur décide).
- `conditions{id→{satisfied,evidence,at,by?}}` : preuves des conditions du plan ; jamais un secret.
- `reconciledAt` : l’orchestrateur réconcilie (`cursor-agents reconcile`/`status`) avant d’écrire l’état. Décision v1 définitive : **pas d’option `--now`**, l’outil n’a pas d’horloge et ne juge pas la fraîcheur ; l’orchestrateur est seul juge et ne joue jamais un rapport calculé sur un état antérieur à sa dernière mutation (§6).

## 4. Décision `ready`

Chaque cycle recalcule **tout** le périmètre depuis les deux fichiers ; rien n’est mémorisé entre deux appels.

1. **Valider** (§2–§3, invariants §3.1 compris : une entrée `pending` avec `launch` pending/uncertain ou run CREATING/RUNNING/UNKNOWN est un code 2, pas une mission à compter) ; code 2 si erreur. Code 3 si `maxActiveRuns` null ou un statut `unknown` (rapport sans proposition).
2. **Réservations tenues** = réservations des missions `active`, `delivered` et, par prudence, `unknown` (jamais `historical`, ni les statuts libérés).
3. **Capacité libre** = `maxActiveRuns` − max(actives comptées, `observedActiveRuns`). Backlog revue = `dev` en `delivered` (provenance `selection` ou `legacySelection` indifféremment).
4. **Étape candidate** par mission : `pending` → `start` ; `delivered` avec `correction.requested` → `resume` ; `delivered` sans correction (dev) → `integrate` ; `review`/`investigation` `delivered` → clôture par l’orchestrateur (`outcome:done`, aucune proposition) ; `integrated` → `publish` ; `active` → `active` ; `published`/`closed`/`historical` → `done` ; `cancelled` → `cancelled`.
5. **Préconditions** (toutes, sinon `blocked` avec chaque raison) : dépendances de l’étape satisfaites ; pas de pause applicable (start/resume) ; aucune collision avec les réservations tenues (start) ; sélection connue, run terminal et `launch` ∈ launched/reconciled (resume — une provenance `legacySelection` donne `selection_unknown`, même sans pause) ; `launch` non incertain. Les missions qui passent sont **`ready`**.
6. **Propositions**, dans cet ordre : `integrate` (au plus **une par dépôt**, fusions séquentielles, priorité puis id ; les autres candidats du dépôt sont `waiting integration_serialized {after}`), `publish` (au plus **une par dépôt** : la proposition porte `covers` = toutes les missions `integrated` du dépôt dont les dépendances `publish` sont satisfaites ; ces missions couvertes ont `outcome:proposed` sans proposition propre — une publication publie l’état intégré du dépôt, il n’y a donc pas de raison `publish_serialized`), puis `resume`/`start` par priorité puis id. Chaque `resume`/`start` accepté **consomme une place et ajoute ses réservations** pour les candidats suivants du même cycle : trois missions indépendantes et trois places donnent trois propositions dans le même cycle, sans attendre une « vague ». Un candidat `ready` non proposé est **`waiting`** avec sa raison : `capacity_full`, `review_backlog_full`, `reservation_conflict` (avec une proposition du cycle), `integration_serialized`.
7. Développement et revue se chevauchent librement ; seules fusions et publications sont séquentielles par dépôt.
8. Les propositions sont **consultatives** : l’orchestrateur les exécute dans l’ordre, puis **réconcilie et recalcule après chaque mutation** de l’état (§6) ; il ne joue jamais la suite d’une liste devenue périmée.

Erreurs de contrat (code 2, en plus des erreurs de graphe §2.1) : `plan_mismatch`, `state_mission_unknown`, `state_inconsistent {mission, field}` (invariants §3.1), `historical_step_not_applicable {mission, step, kind}`.

Raisons (liste fermée ; chaque objet porte `code` et les champs utiles) :

| Code | Sens |
|---|---|
| `dependency_unmet` `{on:{mission,step}}` | Jalon du producteur non atteint. |
| `dependency_cancelled`, `dependency_unknown` | Producteur annulé (replanifier) ; producteur en statut `unknown`. |
| `condition_unverified`, `condition_failed` `{condition}` | Aucune preuve ; preuve négative. |
| `paused` `{scope,target?,since,reason}` | Pause ciblée applicable. |
| `reservation_conflict` `{with,path?|resource?,holderStatus}` | Collision avec une réservation tenue ou proposée dans ce cycle. |
| `capacity_full`, `review_backlog_full` | Aucune place ; backlog de revue à la borne. |
| `integration_serialized` `{after}` | Une autre fusion du même dépôt est proposée ce cycle (les publications d’un dépôt sont couvertes par une seule proposition `covers`, sans raison propre). |
| `launch_uncertain` `{nextAction:"reconcile"}` | Mission `active` avec `launch` uncertain ou pending (POST incertain ou en cours) : réservée, comptée, jamais relancée. |
| `run_active` `{runStatus}` | Mission `active` dont le run est en cours (CREATING/RUNNING) ; sur un `resume`, reprise impossible tant que le run n’est pas terminal. |
| `run_terminal_unreconciled` `{runStatus,nextAction:"reconcile"}` | Mission `active` dont le dernier run lu est déjà terminal mais non reclassé par l’orchestrateur : toujours comptée et réservée, à réconcilier (vers `delivered` ou `pending`), jamais annoncée comme un run en cours. |
| `selection_unknown` `{provenance,nextAction:"corrective_mission"}` | Reprise demandée sur une mission sans `selection` (provenance `legacySelection`) : aucun modèle n’est inventé, aucun `resume` ; ouvrir une mission corrective distincte. |
| `correction_pending` `{step:"integrate"}` | Intégration retenue tant qu’une correction est demandée. |
| `status_unknown` | Mission non fiable ; provoque le code 3. |

## 5. Rapport JSON

`validate` : `{command, formatVersion:1, plan{id,revision}, valid, errors[{code,path,message}], warnings[], summary{missions,byKind,byStatus}}`.

`ready` ajoute : `reliable`, `capacity{maxActiveRuns,origin,source,observedAt,providerQuotaVerified,active,proposed,free,reviewBacklog{count,max}}` (`active` = runs comptés avant le cycle, `proposed` = `resume`/`start` proposés, `free` = places restantes après ces propositions), `active[]`, `ready[]`, `proposals[]`, `blocked[]`, `missions{id→{status,outcome,step,reasons[]}}` avec `outcome` ∈ proposed · waiting · blocked · active · done · cancelled · unknown. **Tout candidat non proposé a au moins une raison.**

Rapport attendu de `ready` sur les deux exemples (code 0) :

```json
{
  "command": "ready", "formatVersion": 1, "plan": { "id": "example-program", "revision": "2026-09-16" },
  "valid": true, "errors": [], "warnings": [],
  "summary": { "missions": 15, "byKind": { "dev": 14, "review": 1 }, "byStatus": { "active": 1, "closed": 1, "delivered": 2, "historical": 1, "integrated": 1, "pending": 9 } },
  "reliable": true,
  "capacity": { "maxActiveRuns": 5, "origin": "configured", "source": "Plafond local décidé par l’orchestrateur pour le périmètre example-program (dépôts kit et app) ; aucun quota fournisseur vérifié, le quota global du compte reste inconnu", "observedAt": "2026-09-16T18:40:00Z", "providerQuotaVerified": false, "active": 1, "proposed": 4, "free": 0, "reviewBacklog": { "count": 2, "max": 3 } },
  "active": [ { "mission": "B01", "kind": "dev", "runStatus": "UNKNOWN", "launch": "uncertain", "counted": true } ],
  "ready": [
    { "mission": "J01", "step": "integrate" }, { "mission": "Z00", "step": "publish" }, { "mission": "A01", "step": "resume" },
    { "mission": "C01", "step": "start" }, { "mission": "D01", "step": "start" }, { "mission": "G01", "step": "start" }, { "mission": "H01", "step": "start" }, { "mission": "L01", "step": "start" }
  ],
  "proposals": [
    { "order": 1, "mission": "J01", "step": "integrate", "repo": "kit", "prUrl": "https://github.com/example/kit/pull/42", "headSha": "5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d", "consumesCapacity": false },
    { "order": 2, "mission": "Z00", "step": "publish", "repo": "kit", "covers": ["Z00"], "consumesCapacity": false },
    { "order": 3, "mission": "A01", "step": "resume", "repo": "kit", "priority": 1, "agentId": "bc-example-a01", "selection": { "key": "fable", "modelId": "claude-fable-5-1", "params": [ { "id": "thinking", "value": "true" }, { "id": "context", "value": "300k" }, { "id": "effort", "value": "high" } ], "chosenAt": "2026-09-15T10:00:00Z" }, "reason": "Revue R01 : test négatif d’accès croisé org_id manquant", "consumesCapacity": true, "holds": { "paths": ["runtime/core/search/", "docs/SEARCH.md"], "resources": [] } },
    { "order": 4, "mission": "C01", "step": "start", "repo": "kit", "priority": 1, "selection": null, "consumesCapacity": true, "holds": { "paths": ["template/app/search/fixtures/"], "resources": [] } },
    { "order": 5, "mission": "D01", "step": "start", "repo": "kit", "priority": 2, "selection": null, "consumesCapacity": true, "holds": { "paths": ["runtime/core/records/"], "resources": [] } },
    { "order": 6, "mission": "G01", "step": "start", "repo": "kit", "priority": 3, "selection": null, "consumesCapacity": true, "holds": { "paths": ["CHANGELOG.md"], "resources": ["kit:version"] } }
  ],
  "blocked": [
    { "mission": "E01", "step": "start", "reasons": [ { "code": "reservation_conflict", "with": "A01", "path": "runtime/core/search/", "holderStatus": "delivered" } ] },
    { "mission": "F01", "step": "start", "reasons": [ { "code": "paused", "scope": "mission", "target": "F01", "since": "2026-09-16T17:00:00Z", "reason": "Attente d’arbitrage sur le connecteur mail" } ] },
    { "mission": "I01", "step": "start", "reasons": [ { "code": "condition_unverified", "condition": "upstream-schema-frozen" } ] },
    { "mission": "K01", "step": "start", "reasons": [ { "code": "condition_unverified", "condition": "a01-ranking-contract-accepted" } ] }
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
    "K01": { "status": "pending", "outcome": "blocked", "step": "start", "reasons": [ { "code": "condition_unverified", "condition": "a01-ranking-contract-accepted" } ] },
    "L01": { "status": "pending", "outcome": "waiting", "step": "start", "reasons": [ { "code": "capacity_full" } ] },
    "R01": { "status": "closed", "outcome": "done", "step": null, "reasons": [] },
    "X00": { "status": "historical", "outcome": "done", "step": null, "reasons": [] },
    "Z00": { "status": "integrated", "outcome": "proposed", "step": "publish", "reasons": [] }
  }
}
```

Lecture : la fin de A01 (`delivered`) débloque C01 sans attendre B01 ; D01 démarre bien que sa dépendance `integrate` sur A01 ne soit pas atteinte ; la réservation `kit:version` de Z00 est libérée par son intégration, G01 la reprend ; A01 tient `runtime/core/search/` jusqu’à sa fusion et bloque E01 malgré des branches distinctes ; B01 incertain est réservé, compté, non relancé ; la correction de A01 consomme une place ; H01 et L01 attendent avec une raison. X00 (`historical`, `published`) satisfait la dépendance `integrated` de E01 sans place ni réservation : `runtime/core/` n’est pas tenu, D01 et A01 ne sont pas gênés. K01 dépend de `delivered` **et** de la condition d’acceptation : A01 livré mais en correction ⇒ `condition_unverified`, alors que C01, réalignable, démarre. L01 réserve `runtime/core/search/` dans le dépôt `app` : aucune collision avec A01 (dépôt `kit`), seule la capacité l’arrête.

## 6. Boucle de l’orchestrateur

À chaque reprise ou transition (fin de run, réception, fusion, release, pause, nouvelle mission approuvée) :

1. **Réconcilier** : `cursor-agents reconcile`/`status` sur chaque mission engagée ; recopier `launch`, `runId`, `runStatus`, PR, head, jalons dans l’état ; `reconciledAt`. Un POST incertain devient `active` + `launch:"uncertain"` : réservé, compté, jamais dupliqué. Une lecture impossible devient `unknown` (conservateur : le cycle rend 3 et ne propose rien).
2. `validate` puis `ready` sur **tout le périmètre approuvé**.
3. Exécuter les propositions dans l’ordre, **une mutation à la fois** : fusion séquentielle (SHA de tête attendu), publication, puis chaque `resume`/`start` — **toutes** celles du cycle, sans attendre une vague. Pour un `start` : choisir la sélection une fois (`preflight`), brief §3 du contrat ; **avant le POST** écrire `status:"active"`, `launch:"pending"`, `selection`, `branch`, `base`, `agentId` (déterministe), `assignedAt` ; puis `launch --mission <id>` (dédup) et recopier `launch`/`runId`/`runStatus` réconciliés (`launched`/`reconciled`, ou `uncertain` conservé tel quel). Pour un `resume` : de même, **avant le POST** écrire `status:"active"`, `launch:"pending"` (sélection, branche, base, agent et jalons inchangés) ; puis `followup --mission <id>` sans champ `model` ; recopier le résultat réconcilié — reprise acceptée ⇒ `launch` launched/reconciled, nouveau `runId`, `followups` incrémenté, `correction.requested` effacé ; rejetée ⇒ retour à `delivered` avec la correction toujours ouverte ; réponse perdue ⇒ `launch:"uncertain"` conservé jusqu’à `reconcile`. La reprise n’est jamais déclarée acceptée, ni la correction effacée, avant la réponse ou la réconciliation.
4. **Réconcilier et recalculer après chaque mutation** : les propositions sont consultatives et valent pour l’état qui les a produites. Après une fusion, réécrire `integratedAt`/`status` puis relancer `ready` **avant** la publication (la fusion a pu libérer des réservations, changer la base attendue ou invalider `covers`) ; après un `start`, l’état porte la place consommée avant le suivant. Ne pas jouer la suite d’une liste périmée.
5. Recopier `readyAt` à la première apparition dans `ready`, `waiting` pour les candidats non proposés ; les `blocked` gardent leur cause explicable. Une absence de capacité locale n’est jamais annoncée comme un quota fournisseur vérifié.
6. Pause ciblée : ajouter une entrée `pauses` ; la lever la retire. Ne pas interrompre un run pour cela.
7. Lot reçu avant la tenue de l’état : écrire `status:"historical"` avec la seule preuve publique du jalon ; ne jamais reconstituer sélection, agent ou run. Lot lancé sans champ `model` mais réellement livré (run terminal, PR, réception connus) : `legacySelection{reason:"model_omitted",requestedAt,evidence}` à la place de `selection`, jamais un `modelId` par défaut ; intégration et publication normales, aucune reprise.
8. Composition de lots livrés : transfert explicite et borné des réservations (§2.2) par révision du plan et brief de la mission de composition ; les producteurs restent `delivered`, heads figés, jusqu’à la fusion prouvée de la PR composée.

Invariants : IDs de mission stables ; sélection par mission inchangée aux reprises ; transport, déduplication et registre existants ; aucun lancement, fusion ou release par l’outil ; pas de métrique spéculative de coût ; aucune incertitude effacée hors `reconcile` ; aucun modèle reconstitué.

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
11. Chaque candidat non proposé apparaît dans `blocked` ou `waiting` avec au moins une raison ; `observedActiveRuns` supérieur au comptage ⇒ maximum retenu ; `maxActiveRuns:0` ⇒ valide, tout `start`/`resume` en `capacity_full`.
12. `historical` : satisfait les dépendances selon `historical.step` (published ⇒ integrated ⇒ delivered ; closed ⇒ delivered), aucune place, aucune réservation, aucune proposition ; `closed` sur une mission `dev` ou `integrated`/`published` sur une `review` ⇒ code 2 `historical_step_not_applicable` ; toute clé interdite (`selection`, `agentId`, `launch`…) ⇒ schéma invalide.
13. Invariants d’état : `pending` avec `launch` pending/uncertain, ou avec `runStatus` CREATING/RUNNING/UNKNOWN ⇒ code 2 `state_inconsistent`, jamais compté ni normalisé ; statut libéré avec `launch` uncertain, run non terminal ou correction ouverte ⇒ code 2 ; `delivered` avec `launch:"uncertain"` ou run non terminal ⇒ code 2.
14. Acceptation distincte de `delivered` : consommateur sur `{mission, step:delivered}` seul ⇒ démarre dès la livraison même en correction ; consommateur ajoutant `{condition}` d’acceptation sans preuve ⇒ `condition_unverified`.
15. Même chemin dans deux dépôts ⇒ aucune collision ; même ressource sémantique dans deux dépôts ⇒ `reservation_conflict`.
16. `legacySelection` : `delivered` (run terminal, `launch` launched/reconciled) sans correction ⇒ `integrate` proposé, réservations tenues, backlog compté, zéro place active, `reliable:true` ; avec correction ⇒ `blocked selection_unknown` même sans pause, jamais `resume` ni sélection inventée ; `integrated` ⇒ `publish` proposé ; `published`/`closed` ⇒ `done`. Schéma : `selection` **et** `legacySelection` ⇒ invalide ; ni l’une ni l’autre sur un statut terminal ⇒ invalide (aucun `modelId` par défaut) ; `legacySelection` sur `pending`, `active` ou `historical` ⇒ invalide ; `reason` ≠ `model_omitted` ⇒ invalide.
17. `active` avec `runStatus` terminal ⇒ comptée et réservée, raison `run_terminal_unreconciled {runStatus, nextAction:"reconcile"}` ; `run_active` réservé aux runs CREATING/RUNNING.

## 8. Décisions v1 (définitives)

- **Fraîcheur** : pas d’option `--now` ; l’outil reste sans horloge, déterministe. L’orchestrateur réconcilie avant chaque cycle, recalcule après chaque mutation et est seul juge de la fraîcheur de `reconciledAt`.
- **Emplacements** : plan public versionné à `docs/planning/plan.json` (dépôt de l’application ou du kit) ; état privé **hors dépôt**, à côté du registre `cursor-agents`, jamais commité.
- **Distribution** : les cinq ressources (`PLANNING.md`, `planning-plan.schema.json`, `planning-state.schema.json`, `examples/planning-plan.json`, `examples/planning-state.json`) et `scripts/plan-missions.mjs` sont distribués avec le dossier par `lite create`/`lite adopt` ; `check-kit` et les tests du kit les vérifient (exemples valides, rapport §5 reproduit, copies exactes dans une application générée). Le référencement depuis `SKILL.md`/`CONTRACT.md` suit la prochaine mise à jour de ces fichiers.
- **Réservations** : tenues jusqu’à l’intégration (ou clôture/annulation) ; aucune libération à `delivered`, aucune option par mission.
- **Collisions** : chemins par dépôt (`mission.repo`), ressources sémantiques globales au plan.
- **Historique** : `status:"historical"` avec le seul jalon prouvé ; aucun modèle, agent, run, place, réservation ni proposition inventés.
- **Provenance sans modèle** : `legacySelection{reason:"model_omitted",requestedAt,evidence}` exclusive de `selection`, sur jalon terminal seulement ; jamais `active`, `start` ni `resume` ; aucun `modelId` par défaut ; correction = mission distincte.
- **Composition** : transfert explicite et borné des réservations de lots livrés vers une mission de composition (brief + révision du plan) ; aucune libération automatique à `delivered` ; `integrated` seulement après fusion prouvée de la PR composée.
- **`delivered`** : artefact produit, pas acceptation ; un contrat stable s’exige par condition sourcée.
- **Capacité** : `scope` identique pour le plafond et le relevé ; un quota fournisseur inconnu ne bloque pas un plafond local connu ; `0` valide ; `null` seul rend le cycle non fiable.
- **Propositions** : consultatives ; réconcilier et recalculer après chaque mutation, notamment après la fusion et avant la publication.

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
