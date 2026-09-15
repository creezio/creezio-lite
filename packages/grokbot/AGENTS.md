# AGENTS — @creezio/grokbot

## Mission

Module natif de pilotage d'agents cloud via l'API Cursor v1 : client REST
complet (agents, runs, usage, artefacts, modèles, repos), mount
`/api/v1/modules/grokbot/*` avec miroir local en `brand.db` et token
stocké côté serveur. Générique : zéro domaine marque.

## Frontières

- Patron **module natif hybride** (comme `onboarding`) : le kit fournit le
  moteur, la marque enregistre `createGrokbotMount({ defaults })` sous
  l'id `grokbot` et compose `grokbotMigrations()` — **pas** de montage
  automatique dans `app-runtime`.
- Le token Cursor ne sort **jamais en clair** de `GET config`
  (`maskToken`). Ne pas le logger, ne pas l'embarquer côté client.
- `options.permission` est le chemin recommandé pour restreindre le mount
  (les agents poussent du code) ; sans permission, l'`accessJustification`
  par défaut documente la garde session de bordure.
- `GET repositories` est **caché en DB 1 h** (rate limit officiel amont :
  1 req/min/user, 30 req/h) — ne pas retirer le cache ; en cas d'erreur
  amont, le cache périmé est servi (`stale: true`).
- Imports `@creezio/api-kernel` / `@creezio/platform-core` **type-only**
  (pas d'import runtime — cycle). Aucun autre import runtime.
- Pas de `zod`, pas d'Electron, `fetchImpl` injectable (tests/proxy).

## Points d'entrée

- `src/index.ts` : surface publique.
- `src/config.ts` : `GrokbotModuleConfig`, `grokbotMigrations()`
  (tables `grokbot_settings` / `grokbot_agents`), `mergeGrokbotConfig`,
  `maskToken`.
- `src/client.ts` : `createCursorAgentsClient` — surface complète Cloud
  Agents v1 (hors streaming SSE).
- `src/mount.ts` : `createGrokbotMount` → `/api/v1/modules/grokbot/*`
  (config, status, models, repositories, agents, runs, usage, artifacts).
- `ui/grokbot-client.tsx` : compose la page (`GrokbotClient`) + poll ciblé.
- `ui/grokbot-launch-form.tsx` : lancer un agent (Select modèle / repo /
  mode, refresh repos `?refresh=1`, checkbox PR). **GROKBOT-1**.
- `ui/grokbot-usage-artifacts.tsx` : usage tokens + artefacts + download
  présigné + lien PR. **GROKBOT-1**.
- `ui/grokbot-agent-runs.tsx` : liste agents (filtre archivés, unarchive)
  + timeline runs (durée, result, PR, follow-up, cancel confirm).
  **GROKBOT-2**.

`GET /models` et `GET /repositories` se chargent **une fois** dans le
formulaire de lancement, jamais depuis le poll. Poll **uniquement**
l'agent ouvert : `GET agents/:id` + `GET …/runs` toutes les 4 s si un
run est `RUNNING`/`CREATING`, sinon 15 s.

Hors scope v1 : streaming SSE (`GET …/runs/{runId}/stream`). Le suivi
est un poll HTTP ciblé — ne pas ajouter d'`EventSource` ni de route
stream dans cette surface.

## Modifier sans casser

- Statuts agent (`ACTIVE`/`IDLE`/`ARCHIVED`) et run
  (`CREATING`/`RUNNING`/`FINISHED`/`ERROR`/`CANCELLED`/`EXPIRED`) = contrat
  amont ; l'UI en dépend (`statusVariant`).
- `POST agents` accepte les deux formes de prompt (`{ text }` plat ou
  `{ prompt: { text } }` API brute) — préserver la normalisation.
- Le miroir `grokbot_agents` fait `COALESCE` sur prompt/repo/model pour ne
  pas perdre les infos posées à la création lors des refreshes de liste.
- Erreurs amont : passthrough du status HTTP + `error: "cursor_api_error"` ;
  409 `agent_busy` / `run_not_cancellable` doivent remonter tels quels.

## Tests/gates

```bash
npm run build -w @creezio/grokbot
node --test scripts/test-phase-grokbot.mjs
```

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- Doc API : https://cursor.com/docs/cloud-agent/api/endpoints
