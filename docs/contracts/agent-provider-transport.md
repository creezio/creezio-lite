# Transports fournisseurs — contrat D03

Contrat accepté le 16/09/2026. Source complète : https://github.com/creezio/certivan-bo/blob/main/docs/contracts/agent-connector.md . Ce lot fournit du code testé sans activation d’un module Agents ni appels payants.

Références primaires : https://cursor.com/docs/cloud-agent/api/endpoints ; https://docs.x.ai/developers/rest-api-reference/inference/responses ; https://docs.x.ai/developers/tools/function-calling . Vérifier les schémas actuels avant implémentation, sans appeler les API payantes.

## 8. Répartition validée et contrat du port D03

### 8.1 Propriétaires et dépendances

| D03 immédiatement, dans de nouveaux fichiers du kit | Missions ultérieures, après convergence avec M01 |
|---|---|
| `runtime/core/agent-providers/{types,catalog,transport,cursor,xai,index}.ts` ; tests dédiés. | Raccordement `integrations.ts`/coffre, providers et UI Intégrations attribués explicitement. |
| Catalogue statique des capacités et validation/normalisation des réponses. | Identités et tokens agents, garde centrale, approbations, portée et outils métier. |
| Transport HTTP à racines fixes et credential injecté, sans persistence ni retry automatique. | Tables `cv_agent_*`, reçus, outbox durable et migrations par un propriétaire unique désigné ; pas de schéma temporaire concurrent. |
| Méthodes xAI/Cursor typées, appels simulés et tests workerd. | Routes §4.1, page Agents, navigation, recherche, tâches et migration `tasks_executor`. |

D03 ne modifie pas `integrations.ts`, les types centraux, le dispatcher, le catalogue d’opérations, les schémas/migrations, le package/lockfile, la navigation, l’UI ou la version du kit. Les imports des nouveaux fichiers restent relatifs. Les tests du kit découvrent les nouveaux `tests/*.test.mjs` ; pas besoin de changer le lanceur. `template/runtime` est synchronisé par le script existant, jamais édité à la main. Les interfaces ci-dessous sont des noms exportés à conserver ; les champs détaillés doivent suivre les schémas officiels cités, sans recopier aveuglément un corps arbitraire.

### 8.2 Port exporté minimal

```ts
export type AgentProviderId = 'cursor' | 'xai';
export type ProviderCredential = {
  provider: AgentProviderId;
  key: string;
  enabled: boolean;
};
export type ProviderClientOptions = {
  // Closure serveur liée à une référence de coffre ET à l’org autorisée.
  // Résolution vivante avant chaque requête ; aucun cache de secret.
  resolveCredential: () => Promise<ProviderCredential>;
  fetch?: typeof globalThis.fetch; // injection de test, fetch serveur par défaut
  timeoutMs?: number;             // défaut 15 s, bornes explicites
  maxResponseBytes?: number;      // défaut 2 Mo, bornes explicites
};
export type ProviderRequestOptions = { signal?: AbortSignal };
export type ProviderFailureCode =
  | 'invalid_request' | 'credential_unavailable' | 'provider_auth'
  | 'provider_quota' | 'provider_rejected' | 'provider_redirect'
  | 'provider_timeout' | 'provider_unreachable' | 'provider_response';
export type DeliveryKnowledge = 'not_sent' | 'unknown' | 'responded';
// ProviderFailure : code, HTTP status éventuel, delivery, code fournisseur
// d’une liste autorisée, Retry-After borné éventuel ; aucun corps/message brut.
export function createCursorProvider(options: ProviderClientOptions): CursorProvider;
export function createXaiProvider(options: ProviderClientOptions): XaiProvider;
export const agentProviderCapabilities: readonly ProviderCapability[];
```

- `CursorProvider` fournit `listModels`, `createAgent`, `getAgent`, `getRun`, `cancelRun`, chacune avec `ProviderRequestOptions`. `createAgent` exige un `agentId` conforme `bc-<uuid>` fourni par le futur orchestrateur durable ; payload limité aux champs documentés nécessaires (prompt, modèle/params, repos/options documentées). Pas de `envVars`, d’inline credentials MCP, de création de routines ou d’API inventée. Réponse normalisée contenant `agentId`, `runId` et état fournisseur vérifié. Les IDs entrants sont validés/encodés avant construction des chemins.
- `409 agent_id_conflict` reste un fait explicite ; le helper ne relance pas et ne choisit pas un nouvel ID. Le futur contrôleur durable lit l’agent/run existant. `cancelRun` n’invente pas une réussite sur timeout ou `409 run_not_cancellable`.
- `XaiProvider` fournit `listModels` et `createResponse` synchrone (`stream:false`, aucun background). Le type d’entrée exige `model`, `input`, un budget de sortie borné et un choix `store:boolean` explicite ; outils et `previous_response_id` sont seulement des champs validés transmis au fournisseur. L’adaptateur ne lance aucun outil et ne transforme pas `completed` en validation métier. Sortie bornée : ID, statut, éléments de résultat/appels d’outils et usage nécessaires, validés selon les schémas officiels.
- Le transport n’exporte pas une primitive permettant au navigateur de choisir une URL arbitraire. Provider et credential doivent correspondre. Racines fixes ; erreurs sans clé, URL secrète, prompt ni corps fournisseur. Délai et abort de l’appelant sont combinés ; lecture du corps bornée en flux.
- Aucun retry, polling, timer durable, callback de fin, D1, R2, UI, logging de corps ou appel à l’import. Si `fetch` a été invoqué et échoue, l’envoi reste `unknown` sauf preuve explicite d’absence d’envoi. Une réponse HTTP est `responded`, pas nécessairement un effet métier accompli.
- Catalogue : capacités documentées, disponibilité du protocole et date/source ; `implemented/active` ne doivent jamais prétendre que le module Agents applicatif est installé. Webhooks/Grok Bot restent différés.

### 8.3 Réception D03 (sans service externe)

Tests nouveaux `tests/agent-providers.test.mjs` et `tests/agent-provider-workers.test.mjs` : racines et auth correctes, credential incorrect/désactivé refusé avant réseau, validation IDs/payloads, conflit déterministe sans seconde création, réponses invalides et états inconnus refusés, 301/302/307/308 sans transfert de clé, délais et annulation, 401/403/429/5xx sans fuite de réponse, limite de taille pendant lecture, xAI sans outil exécuté et sans stockage choisi implicitement. Tests workerd via Miniflare existant pour confirmer les comportements HTTP du runtime cible. Les seuls réseaux autorisés dans les tests sont les services simulés. Puis `npm test`, `npm run check`, typecheck et build du template, `node scripts/validate-examples.mjs`, dans l’ordre d’AGENTS et sans compilation simultanée à la synchronisation.

