---
name: creezio-plugins
description: Créer des plugins utilisables (Product Hub → interview clarifications → PRD étendu validé → grant → gates intent→smoke→proxy→UI→accept-check). Control plane HTTP — pas le workspace Hermes.
version: 6.0.0
metadata:
  hermes:
    tags: [creezio, plugins, extensibility, quality]
---

# creezio-plugins v6 — Product Hub bout en bout

Les plugins sont des sidecars Node sous `userData/plugins/<id>/`.  
**Health seul ≠ done.** Un plugin « livré » doit passer `accept-check`.

Charge d’abord le skill **contexte de la marque** s’il existe (ex. `<brand>-context` : prefs, OpenAPI, glossaire, tokens CSS, styleguide UI).

## Variables d’environnement

Les variables sont préfixées par la marque (`<PREFIX>` = préfixe env de l’app,
ex. `TEMPOFLOW3`). Découvre-les avec `env | grep _PLUGINS_API_`.

| Variable | Rôle |
|----------|------|
| `<PREFIX>_PLUGINS_API_URL` | Control plane, ex. `http://127.0.0.1:18791` |
| `<PREFIX>_PLUGINS_API_TOKEN` | Bearer control plane |
| `<PREFIX>_PLUGINS_DIR` | Chemin `…/plugins` |
| `<PREFIX>_API_URL` / `<PREFIX>_API_KEY` | API CRM de la marque (Bearer) |

## Langage utilisateur (OBLIGATOIRE)

L'utilisateur final n'est pas un développeur. **Jamais** de jargon interne dans
tes réponses : pas de « execution_grant », « PRD », « control plane »,
« machine d'état », « endpoint », ni de codes d'erreur bruts. Dis « projet »,
« questions de cadrage », « validation », « je prépare / je vérifie ». Un
blocage technique se résout en interne ou se reformule en une action simple
côté utilisateur (« valide le projet quand tu es prêt »).

**Première réponse type** à « crée-moi un plugin X » : annoncer que tu explores
l'app et les modules existants, présenter le résultat (créer ou faire évoluer),
puis déposer ton **premier round de questions de cadrage** via l'API
clarifications (voir plus bas). **Jamais** de tentative de création au
premier tour, et **jamais** de questions de cadrage en texte libre dans le
chat : les questions passent par l'API et s'affichent en formulaire dans le
chat de l'utilisateur.

## Encodage des payloads (OBLIGATOIRE)

Les terminaux Windows corrompent les accents (cp1252 → U+FFFD en base). Pour
**tout** payload JSON contenant du texte (PRD, questions, tâches…) :

1. Écrire le JSON dans un fichier encodé **UTF-8** (`payload.json`).
2. L'envoyer avec `curl --data-binary @payload.json` — **jamais** `-d '{…}'`
   inline avec des accents.

Le serveur rejette (400) tout payload contenant des caractères U+FFFD.

## Workspace Hermes vs install (OBLIGATOIRE)

| Zone | Usage |
|------|--------|
| **Workspace Hermes** (`hermes-home/workspace`) | Brouillons seulement |
| Control plane `<PREFIX>_PLUGINS_API_*` | Install / files / restart / accept-check |

**INTERDIT** : tar.gz / dossier dans le workspace Hermes = « installé ».

## Machine d’état Product Hub (obligatoire)

Toute demande utilise une conversation multi-tours (réutilise le
`conversationId` de la conversation en cours) et avance uniquement dans cet
ordre :

`request_received → impact_analysis → clarification_required (boucle interview)
→ prd_draft → awaiting_prd_approval → planning → ready_for_execution →
executing → automated_testing → awaiting_human_qa → released`.

`blocked` et `cancelled` sont des sorties explicites. Pendant G1/G2, rester en
**lecture seule** : ne demander, afficher ou utiliser aucun credential
d’écriture plugin. Le rapport d’impact (manifests, PRD, OpenAPI, MCP, tables et
n8n) doit être présenté avant de recommander **créer** ou **faire évoluer**.

Les transitions sont **gardées côté serveur** : `executing →
automated_testing` exige ≥ 1 tâche kanban `done` ; `automated_testing →
awaiting_human_qa` exige ≥ 1 test-run `passed`. Un refus 409 contient toujours
le `hint` de l'appel API exact à faire — suis-le.

## API Product Hub (CRM — Bearer `<PREFIX>_API_KEY`)

```bash
CRM="$<PREFIX>_API_URL/api/v1"
AUTH_CRM="Authorization: Bearer $<PREFIX>_API_KEY"

# 1. Explorer les demandes existantes (anti-doublon)
curl -sS -H "$AUTH_CRM" "$CRM/plugin-products"

# 2. Créer la demande — la réponse contient le rapport d'impact
#    (recommendation create|evolve, candidatePluginId, evidence)
curl -sS -X POST -H "$AUTH_CRM" -H "Content-Type: application/json" \
  --data-binary @demande.json "$CRM/plugin-products"
# demande.json (UTF-8) : {"name":"…","description":"…","conversationId":"<conversationId>"}
```

## Interview itérative (clarifications — OBLIGATOIRE avant le PRD)

Boucle de cadrage : **déposer un round de questions structurées → attendre les
réponses de l'utilisateur → round suivant si nécessaire**. Continue tant qu'une
section du PRD étendu (voir plus bas) ne peut pas être remplie **avec
certitude**. Détecte et signale les ambiguïtés ou incohérences dans les
réponses (nouveau round ciblé si besoin). Quand tout est clair, **reformule la
synthèse** à l'utilisateur avant de déposer le PRD.

```bash
# Déposer un round de questions (le produit passe en clarification_required)
cat > questions.json <<'EOF'
{
  "questions": [
    {"id": "q1", "label": "Quelles données voulez-vous suivre ?",
     "type": "multi", "options": ["Option A", "Option B", "Option C"], "allowOther": true},
    {"id": "q2", "label": "À quelle fréquence consulterez-vous ce module ?",
     "type": "choice", "options": ["Chaque jour", "Chaque semaine", "Occasionnellement"]},
    {"id": "q3", "label": "Décrivez le résultat idéal en une phrase.",
     "type": "text"}
  ]
}
EOF
curl -sS -X POST -H "$AUTH_CRM" -H "Content-Type: application/json" \
  --data-binary @questions.json "$CRM/plugin-products/<productId>/clarifications"
```

Types de question : `choice` (choix unique, `options` requis), `multi`
(plusieurs choix, `options` requis), `text` (réponse libre). `allowOther: true`
ajoute un champ « Autre ». Les questions s'affichent en **formulaire dans le
chat** ; les réponses te reviennent dans un message « Réponses au cadrage ».
Tu ne peux pas répondre toi-même (session utilisateur requise).

## PRD étendu (sections obligatoires)

Le dépôt du PRD exige **toutes** les sections remplies, sinon le serveur
répond 409 et replace le produit en `clarification_required` :

```bash
cat > prd.json <<'EOF'
{
  "problem": "…",
  "users": "…",
  "scope": "…",
  "outOfScope": "…",
  "acceptanceCriteria": "…",
  "sections": {
    "data_inputs": [
      {"data": "…", "sourceEndpoint": "GET /api/crm/…"}
    ],
    "data_outputs": [
      {"data": "…", "destination": "Panel du module"}
    ],
    "db_schema": [
      {"table": "…", "columns": [
        {"name": "id", "type": "INTEGER", "description": "Clé primaire"}
      ]}
    ],
    "user_stories": [
      "En tant que …, je … pour …"
    ],
    "screens": [
      {"name": "…", "kind": "single", "description": "…"}
    ],
    "wireframes": [
      {"screen": "…", "ascii": "+----+\n|    |\n+----+"}
    ]
  }
}
EOF
curl -sS -X POST -H "$AUTH_CRM" -H "Content-Type: application/json" \
  --data-binary @prd.json "$CRM/plugin-products/<productId>/prd"
# → 201 : produit en awaiting_prd_approval. 409 : sections manquantes, suivre le hint.

# Demander ensuite à l'utilisateur de VALIDER LE PROJET (carte dans le chat
# ou Admin → Plugins). Tu ne peux PAS approuver toi-même (session requise).
```

À la validation du PRD, les user stories sont **automatiquement converties en
tâches kanban** (`status: ready`).

## Kanban et tests (curl)

```bash
# Lire l'état complet (tasks, tests, tickets, changelog…)
curl -sS -H "$AUTH_CRM" "$CRM/plugin-products/<productId>"

# Ajouter une tâche technique complémentaire
curl -sS -X POST -H "$AUTH_CRM" -H "Content-Type: application/json" \
  --data-binary @task.json "$CRM/plugin-products/<productId>/tasks"

# Avancer une tâche (obligatoire : ≥1 done avant automated_testing)
curl -sS -X PATCH -H "$AUTH_CRM" -H "Content-Type: application/json" \
  -d '{"status":"done"}' "$CRM/plugin-products/<productId>/tasks/<taskId>"

# Historiser un run de tests (obligatoire : ≥1 passed avant awaiting_human_qa ;
# un run ok=true en automated_testing transitionne automatiquement)
curl -sS -X POST -H "$AUTH_CRM" -H "Content-Type: application/json" \
  --data-binary @run.json "$CRM/plugin-products/<productId>/test-runs"
```

## Grant d'exécution (après validation humaine)

```bash
# Jeton d'exécution court (control plane, PAS le CRM)
curl -sS -X POST -H "Authorization: Bearer $<PREFIX>_PLUGINS_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"plugin_id":"mon-plugin"}' \
  "$<PREFIX>_PLUGINS_API_URL/v1/products/<productId>/grant"
# → { ok, execution_grant, expiresAt } — refusé (409) tant que le PRD n'est pas validé.

# Lier le runtime créé au produit
curl -sS -X PATCH -H "$AUTH_CRM" -H "Content-Type: application/json" \
  -d '{"pluginId":"mon-plugin"}' "$CRM/plugin-products/<productId>/runtime-link"
```

La validation du PRD appartient à l’utilisateur. Elle débloque un
`execution_grant` court (10 min), lié au produit, à la révision PRD validée et
au plugin. Le control plane refuse `POST /v1/plugins` et les écritures d’un
plugin Product Hub sans ce grant. Ne jamais inventer, réutiliser après
expiration ou consigner ce token — et ne jamais le mentionner à l'utilisateur.

## Gates (DoD) — ne saute aucune étape

| Gate | Règle | Stop si fail |
|------|-------|--------------|
| **G1 Intent** | Interview clarifications complète + synthèse reformulée ; OK user | Oui |
| **G2 Données** | Nommer endpoints + permissions | Oui |
| **G3 Smoke** | `curl` CRM ou smoke via proxy → JSON OK ou erreur explicite | Oui |
| **G4 Proxy** | Toute lecture métier panel → `/api/crm/*` Node (jamais clé dans HTML) | Oui |
| **G5 UI** | Panel référence `plugin-ui.css` et utilise les classes `tf-` (styleguide) | Oui |
| **G6 IA** | Si génération LLM : permission `llm:use` + modèle choisi ; sinon refuser l’IA | Oui |
| **G7 Accept** | `POST …/accept-check` OK avant todo `done` | Oui |

Message si gate manquant : expliquer clairement à l’utilisateur ce qui bloque (ne pas inventer un succès).

## Permissions

`crm:read` | `crm:write` | `n8n:read` | `n8n:write` | `ui:panel` | `net:loopback` | `llm:use`

- `llm:use` → BYOK injecté dans le sidecar + `POST /api/llm/chat` (ou control plane `POST /v1/llm/chat`). **Jamais** de clé dans le HTML.

## Manifest (+ acceptance)

```json
{
  "id": "mon-plugin",
  "name": "Mon plugin",
  "version": "0.1.0",
  "main": "index.js",
  "permissions": ["crm:read", "net:loopback", "ui:panel"],
  "panel": { "title": "Mon plugin", "path": "/" },
  "acceptance": {
    "smoke": [
      { "method": "GET", "path": "/health", "expectStatus": 200 }
    ]
  },
  "source": "hermes"
}
```

## API control plane

```bash
AUTH="Authorization: Bearer $<PREFIX>_PLUGINS_API_TOKEN"
BASE="$<PREFIX>_PLUGINS_API_URL"

curl -sS -H "$AUTH" "$BASE/v1/plugins"

curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"id":"mon-plugin","name":"Mon plugin","execution_grant":"<grant court>"}' \
  "$BASE/v1/plugins"

curl -sS -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  --data-binary @files.json "$BASE/v1/plugins/mon-plugin/files"
# files.json (UTF-8) : {"execution_grant":"<grant court>","message":"feat: …","files":{"index.js":"…","manifest.json":"…"}}
# ↑ commit Git auto + bump manifest.version

curl -sS -X POST -H "$AUTH" "$BASE/v1/plugins/mon-plugin/restart"

# Historique / rollback
curl -sS -H "$AUTH" "$BASE/v1/plugins/mon-plugin/versions"
curl -sS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"action":"restore","ref":"<sha>"}' \
  "$BASE/v1/plugins/mon-plugin/versions"

# OBLIGATOIRE avant done
curl -sS -X POST -H "$AUTH" "$BASE/v1/plugins/mon-plugin/accept-check"

# Supprimer définitivement (aucune trace)
curl -sS -X DELETE -H "$AUTH" "$BASE/v1/plugins/mon-plugin"
```

Réponse accept-check : `{ ok, checks[], hint }`. Si `ok: false` → **ne pas** marquer done.  
Chaque `PUT …/files` versionne le plugin (Git local sous `plugins/<id>/.git`).  
Git est **embarqué** dans l’app (MinGit sous Windows) — pas d’install Git système requise.

## Workflow Work

1. **Explorer** : `GET /v1/plugins` (control plane) + `GET $CRM/plugin-products`, puis créer la demande (`POST $CRM/plugin-products` avec `conversationId`) → rapport d’impact.
2. **G1** — Présenter la recommandation (créer vs faire évoluer) en termes simples, puis **boucle d'interview** : rounds de questions via `POST …/clarifications`, attendre chaque « Réponses au cadrage », questionner tant qu'une section du PRD ne peut pas être remplie avec certitude, signaler les incohérences, reformuler la synthèse. Lecture seule.
3. **G2** — Endpoints + permissions (+ `llm:use` si IA), lecture seule.
4. Lire `hermes-home/context/` si présent (bootstrap, glossary, openapi, styleguide).
5. Déposer le **PRD étendu complet** (`POST …/prd` avec `sections`) et demander à l’utilisateur de **valider le projet** (carte dans le chat ou Admin → Plugins). Attendre.
6. À la validation : tâches kanban auto-créées depuis les user stories. Compléter avec les tâches techniques (`POST …/tasks`) ; les avancer (`PATCH …/tasks/<taskId>`).
7. Après validation : `POST $BASE/v1/products/<id>/grant` → `execution_grant`, puis `POST /v1/plugins` + `PATCH …/runtime-link`.
8. Adapter le code → `PUT …/files` avec grant + message clair → commit Git auto + bump version → restart.
9. **G3** — Smoke CRM, puis tests déclarés `tests/*.test.mjs` → historiser via `POST …/test-runs` (≥1 `passed` requis pour la QA).
10. **G7** — `accept-check` OK → l'utilisateur reçoit la carte « testez et validez » dans le chat → QA humaine → changelog → release.
11. Todo kanban `done` uniquement après QA humaine (+ id, panelUrl, version, sha).

## Endpoints sidecar (scaffold)

| Path | Rôle |
|------|------|
| `GET /` | Panel (kit CSS `tf-`) |
| `GET /health` | Santé |
| `GET/POST /api/crm/*` | Proxy → `$<PREFIX>_API_URL/api/v1/*` (Bearer serveur) |
| `POST /api/llm/chat` | Proxy LLM si `llm:use` |
| `POST /hooks/<event>` | Hooks CRM |
| `POST /webhooks/n8n` | Bus n8n |

## Règles

1. Ne jamais modifier `resources/` / bundle app.
2. Pas de fetch CRM depuis le navigateur du panel avec une clé.
3. Pas de React de l’app — kit CSS `tf-` uniquement (voir styleguide du context pack si présent) : fond clair crème, jamais de fond sombre.
4. Loopback only.
5. Automation lourde → **creezio-n8n**.
