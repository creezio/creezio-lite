# @creezio/grokbot

Module natif **GrokBot** : pilotage d'agents cloud via l'**API Cursor v1**
(`https://api.cursor.com`) depuis une app Creezio — le token Cursor est
stocké côté serveur (jamais renvoyé en clair), les agents lancés sont
mirrorés en `brand.db`.

## Architecture (ADR-module-natif-hybride)

- **Mount hybride** `grokbot` — enregistré **par la marque**
  (`api.registerModuleApi("grokbot", createGrokbotMount({ defaults }))`) →
  HTTP `/api/v1/modules/grokbot/*`, données en `brand.db`
  (`grokbot_settings`, `grokbot_agents`).
- **Token** : clé API Cursor (Dashboard → API Keys ou service account),
  posée à chaud via `PUT config` — masquée en `GET config`.
- **Miroir local** : chaque agent vu (create/list/get) est upserté dans
  `grokbot_agents` (prompt, repo, branche, PR, statut) — lecture hors-ligne
  via `GET agents?source=local`.
- **MCP** : les opérations clés (`list-agents`, `create-agent`, `get-agent`,
  `create-run`, `get-run`) sont déclarées `mcpPublishDefault: true` →
  l'assistant peut piloter les agents via les tools générés.
- **UI** : `@creezio/grokbot/ui` → `GrokbotClient` compose
  `grokbot-launch-form` (Select repos/modèles/mode, refresh cache 1 h),
  `grokbot-usage-artifacts` (usage + download présigné) et
  `grokbot-agent-runs` (liste + timeline, poll ciblé, unarchive). Token
  jamais affiché en clair. SSE (`GET …/runs/{runId}/stream`) hors scope
  v1 — le suivi est un poll HTTP de l'agent ouvert.

## API mount (câblé par la marque)

| Méthode | Chemin | Rôle |
|---------|--------|------|
| GET/PUT/DELETE | `config` | token Cursor + défauts (masqué en GET) |
| GET | `status` | vérifie la clé (`GET /v1/me`) |
| GET | `models` | modèles disponibles (`GET /v1/models`) |
| GET | `repositories[?refresh=1]` | repos GitHub — cache DB 1 h (rate limit amont 1 req/min) |
| GET | `agents[?source=local]` | liste distante + miroir local |
| POST | `agents` | lance un agent `{ text, repoUrl?, ref?, prUrl?, modelId?, autoCreatePR?, mode?, … }` |
| GET/DELETE | `agents/<id>` | métadonnées / suppression définitive |
| POST | `agents/<id>/archive` · `unarchive` | soft delete réversible |
| GET/POST | `agents/<id>/runs` | runs / prompt de suivi `{ text, mode? }` |
| GET | `agents/<id>/runs/<runId>` | état du run (résultat, durée, branches) |
| POST | `agents/<id>/runs/<runId>/cancel` | annule le run actif |
| GET | `agents/<id>/usage[?runId=]` | usage tokens par run |
| GET | `agents/<id>/artifacts[/download?path=]` | artefacts (URL présignée 15 min) |

## Câblage marque (3 gestes)

```ts
// 1. server/src/electron/brand-grokbot-content.ts (défauts, optionnel)
export const brandGrokbotDefaults = {
  defaultRepoUrl: "https://github.com/mon-org/mon-repo",
};

// 2. brand-migrations.ts
...grokbotMigrations(),

// 3. brand-module-api.ts
api.registerModuleApi(
  "grokbot",
  createGrokbotMount({ defaults: brandGrokbotDefaults, permission: "nav.grokbot" }),
);
```

`permission` est recommandé : le token Cursor pilote des agents qui
poussent du code sur vos dépôts.

## Client API

`createCursorAgentsClient({ apiKey, baseUrl?, fetchImpl? })` couvre toute
la surface documentée de l'API Cloud Agents v1 : agents (create/list/get/
delete/archive/unarchive), runs (create/list/get/cancel), usage,
artifacts (+ download présigné), `me`, `models`, `repositories`. Le
streaming SSE (`GET …/runs/{runId}/stream`) n'est pas couvert — l'état
terminal se lit via Get A Run.
