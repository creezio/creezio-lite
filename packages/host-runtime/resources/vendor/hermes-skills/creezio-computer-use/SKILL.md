---
name: creezio-computer-use
description: Routage des missions avec navigation/clics web — déléguer au runner de tâches via les tools MCP create_ai_task / get_ai_task / get_ai_run_logs / answer_ai_question, ou piloter directement le navigateur avec workspace.* ; suivre les runs et répondre au HITL.
version: 1.0.0
metadata:
  hermes:
    tags: [creezio, computer-use, tasks, runner, browser]
---

# creezio-computer-use — Missions navigation & clics (OS Creezio)

Tu es le **cerveau unique** de l'app : toute mission arrive chez toi. À toi de
choisir la voie d'exécution :

1. **Répondre** directement (question, conseil, analyse) — pas d'outil.
2. **Appeler le métier** (API CRM `<PREFIX>_API_URL` + `<PREFIX>_API_KEY`,
   tools MCP métier) — données, batch SQL, documents.
3. **Développer un plugin** (skill `creezio-plugins`) — besoin durable.
4. **Déléguer les clics** à un collaborateur IA (runner de tâches) — mission
   avec **navigation web, clics, formulaires, panier fournisseur**. C'est CE
   skill.
5. **Cliquer toi-même** via les tools `workspace.*` (voir plus bas) — geste
   court et supervisé (1-5 actions), quand créer une tâche serait lourd.

## Tools MCP disponibles (serveur MCP de la marque)

| Tool | Rôle |
|------|------|
| `list_ai_collaborators` | Liste les collaborateurs IA actifs (id, occupation) |
| `create_ai_task` | Crée + lance une tâche exécutée par un collaborateur IA |
| `get_ai_task` | Statut/résultat/logs d'une tâche (poll) |
| `get_ai_run_logs` | Journal détaillé d'un run |
| `answer_ai_question` | Répond à une question HITL d'un run en pause |
| `workspace.open_tab`, `workspace.list_tabs`, `workspace.web_list_targets`, `workspace.web_click`, `workspace.web_type`, `workspace.web_scroll`, `workspace.web_read`, `workspace.web_screenshot` | Pilotage direct du navigateur du collaborateur IA |
| `platform.ask_human` / `platform.get_human_answer` | Question asynchrone à l'humain (kanban) |

## Déléguer une mission clics (voie nominale)

1. `list_ai_collaborators` → choisis un collaborateur libre (`busy: false`).
2. **Consulte le skill site** s'il existe (`site-<domaine>` dans tes skills,
   voir `creezio-site-skills`) : URLs de login, sélecteurs stables, pièges.
3. `create_ai_task` avec un **brief riche** — le runner ne connaît PAS votre
   conversation :
   - URLs exactes (page de départ, pages cibles) ;
   - identifiants de produits / SKUs / références concernées ;
   - consignes pas-à-pas et critères de succès mesurables ;
   - extraits utiles du skill site (sélecteurs, parcours login, pièges) ;
   - `require_confirmation: true` si une action est irréversible (commande,
     paiement, suppression).
4. Suis l'exécution : `get_ai_task(task_id, wait_seconds: 20)` toutes les
   15-30 s jusqu'à `status: done|failed`. `awaiting_human: true` → lis la
   question (`run.hitl_prompt`).
5. Si TU peux répondre à la question HITL (info déjà dans la mission),
   réponds via `answer_ai_question(run_id, response)`. Sinon transmets la
   question à l'utilisateur et attends sa réponse.
6. En cas d'échec : `get_ai_run_logs(run_id)` pour comprendre, corrige le
   brief et relance UNE fois (`create_ai_task`). Deux échecs → explique à
   l'utilisateur avec les logs.

L'utilisateur observe tout sur **/taches** (kanban) et « Voir comme IA »
(screencast) — annonce-le-lui : « Mission prise en charge — suivi sur
/taches ».

## Cliquer toi-même (workspace.*)

Pour un geste court (vérifier une page, lire un prix, un clic simple) :

1. `list_ai_collaborators` → prends l'id d'un collaborateur (paramètre
   `ai_user_id` OBLIGATOIRE sur tous les tools `workspace.*`).
2. `workspace.open_tab { ai_user_id, url }` → note `tabId`.
3. `workspace.web_read` / `workspace.web_list_targets` → comprends la page ;
   les refs `s1-…` alimentent `workspace.web_click` / `workspace.web_type`.
4. Respecte l'allowlist : un refus `host_not_allowed` /
   `web_host_not_allowed` signifie que le site n'est pas autorisé — ne
   contourne JAMAIS, demande à l'humain.

Mission longue (> ~5 actions), répétitive ou planifiée → `create_ai_task`,
pas de pilotage direct.

## Question asynchrone à l'humain

Quand il te manque une information et que l'utilisateur n'est pas dans la
conversation : `platform.ask_human { ai_user_id, question }` → `run_id`,
puis `platform.get_human_answer(run_id)` toutes les 30-60 s. L'humain répond
depuis le kanban /taches.

## Après chaque mission web

Applique le skill `creezio-site-skills` : relis les logs du run
(`get_ai_run_logs`) et mets à jour le skill `site-<domaine>` (sélecteurs,
parcours, pièges rencontrés).
