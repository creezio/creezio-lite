# AGENTS.md — @creezio/automations

## Mission

Maintenir le moteur d'automations lifecycle-only du kit : evenements plugins/org/factory/observability, actions simples, API mount et persistance optionnelle. Proteger la frontiere avec `@creezio/database`.

## Ne pas faire

- Ne pas ajouter de logique Admin Database row-level ici.
- Ne pas creer de triggers SQLite metier ni de CRUD de tables applicatives.
- Ne pas hardcoder une marque, un domaine ou un prefixe n8n vertical.
- Ne pas transformer les webhooks lifecycle en worker durable avec retry sans cadrage explicite.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs automations` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : barrel public.
- `src/types.ts` : triggers/actions lifecycle.
- `src/engine.ts` : creation moteur, dispatch, actions.
- `src/match.ts` : filtrage de regles.
- `src/api-mount.ts` : routes API platform automations.
- `src/sqlite-persist.ts` et `src/schema.ts` : persistance SQLite optionnelle.

## Modifier sans casser

- Conserver les triggers lifecycle existants et leur typage litteral.
- Toute nouvelle action doit etre ajoutee dans `AUTOMATION_ACTION_TYPES`, le type union et `runAction`.
- `dispatch()` doit rester tolerant : une action echoue dans son resultat sans faire tomber tout le process.
- Garder la taille des runs bornee en memoire et en SQLite.
- Verifier que les exemples demobrand restent sandbox et non production.

## Config brand

La marque configure uniquement par adapters :

- `emitObservability`
- `postWebhook`
- `defaultWebhookUrl`
- `n8nTagPrefix`
- `log`
- `persist`

Le package ne connait pas les allowlists metier, les tables SQLite applicatives ni les secrets de marque.

## Tests/gates

Avant de valider une modification :

```bash
npm run typecheck -w @creezio/automations
npm run build -w @creezio/automations
```

Ajouter des tests ciblant `ruleMatches`, `dispatch` et `createAutomationsApiMount` si le comportement change.

## Fichiers sensibles

- `src/types.ts` : contrat public.
- `src/engine.ts` : execution actions et semantics de succes/echec.
- `src/api-mount.ts` : surface HTTP.
- `src/sqlite-persist.ts` : format persiste `creezio_automation_*`.
- `src/index.ts` : exports consommes par les marques.

## Liens

- `README.md`
- `docs/FILES.md`
- `packages/database/README.md`
