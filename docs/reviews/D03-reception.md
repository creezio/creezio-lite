# Réception D03 — Transports fournisseurs Cursor et xAI

Mission : docs/missions/D03-agent-provider-transports.md. Contrat : docs/contracts/agent-provider-transport.md (§8). Branche `agents/D03-agent-provider-transports`, base 4c4229aa. Aucun secret réel, aucun appel payant, aucun agent lancé, aucun déploiement.

## Livrables

| Fichier | Rôle |
|---|---|
| `runtime/core/agent-providers/types.ts` | Port §8.2 (`AgentProviderId`, `ProviderCredential`, `ProviderClientOptions`, `ProviderRequestOptions`, `ProviderFailureCode`, `DeliveryKnowledge`), classe `ProviderFailure`, types Cursor/xAI et `ProviderCapability`. |
| `runtime/core/agent-providers/transport.ts` | Transport interne à racines fixes (`https://api.cursor.com`, `https://api.x.ai`), credential relu à chaque appel, délai + abort combinés, `redirect:'manual'`, lecture bornée en flux, mapping fermé des statuts HTTP. Non réexporté par `index.ts`. |
| `runtime/core/agent-providers/cursor.ts` | `createCursorProvider` : `listModels`, `createAgent`, `getAgent`, `getRun`, `cancelRun`. |
| `runtime/core/agent-providers/xai.ts` | `createXaiProvider` : `listModels`, `createResponse` synchrone. |
| `runtime/core/agent-providers/catalog.ts` | `agentProviderCapabilities` gelé, avec protocole, date et source ; `transport: 'implemented' | 'deferred'` et `requiresApplicationModule: true` sur chaque entrée. |
| `runtime/core/agent-providers/index.ts` | Réexports du port, sans effet à l'import. |
| `tests/agent-providers.test.mjs` | 15 tests avec fetch simulé. |
| `tests/agent-provider-workers.test.mjs` | 1 test workerd (Miniflare + esbuild déjà présents dans le template) avec service sortant simulé. |

Fichiers hors périmètre non touchés : `integrations.ts`, types centraux, registre, dispatcher, UI, `package.json`/lockfiles, schéma/migrations, version du kit, `CHANGELOG.md`, autres tests. `template/runtime` est régénéré par `npm run sync:template` (non versionné).

## Documentation vérifiée (16/09/2026, sans appel authentifié)

- Cursor Cloud Agents API v1 : `POST /v1/agents` (champs `prompt.text`, `model.id/params`, `name`, `repos[].url/startingRef/prUrl`, `env.type/name`, `workOnCurrentBranch`, `autoCreatePR`, `skipReviewerRequest`, `mode`, `agentId` client `bc-<uuid>` incompatible avec `envVars` ; `409 agent_id_conflict`), `GET /v1/agents/{id}` (statuts `ACTIVE|IDLE|ARCHIVED`), `GET /v1/agents/{id}/runs/{runId}` (statuts `CREATING|RUNNING|FINISHED|ERROR|CANCELLED|EXPIRED`, `durationMs`, `result`, `git.branches[]`), `POST …/cancel` (`{id}`, `409 run_not_cancellable`), `GET /v1/models` (`items[]` avec `parameters`/`variants`). Webhooks annoncés « coming soon » en v1 : catalogués `deferred`, rien d'inventé.
- xAI Responses API : `POST /v1/responses` (`model`, `input` chaîne ou éléments, `max_output_tokens`, `store`, `stream`, `previous_response_id` incompatible avec `instructions`, `tools` fonction avec racine objet, `tool_choice`, `parallel_tool_calls`, `reasoning.effort`, `background` documenté non pris en charge) ; réponse `object:'response'`, `status` `completed|in_progress|incomplete`, `output[]` (`message`, `function_call`, `reasoning`), `usage`. `GET /v1/models` (`object:'list'`, `data[]`). Aucune API Grok Bot officielle trouvée : cataloguée `deferred`.
- Codes d'erreur Cursor relayés (`providerCode`) : liste fermée issue de la spécification OpenAPI publiée (`agent_id_conflict`, `run_not_cancellable`, `rate_limit_exceeded`, …). Pour xAI la liste est courte et prudente ; tout autre code ou message est ignoré.

## Garanties implémentées

- Racines fixes ; chemins construits par les adaptateurs, identifiants validés (`bc-<uuid>`, `run-<uuid>`) puis encodés ; `assertPath` refuse requête, fragment, segments vides ou relatifs.
- Credential : `resolveCredential()` appelé avant chaque requête ; provider différent, `enabled:false`, clé vide/malformée/trop longue ou résolution en échec (rejet ou exception synchrone) → `credential_unavailable`, `delivery:'not_sent'`, aucun `fetch`.
- Délai (défaut 15 s, bornes 1–120 s) et `signal` de l'appelant combinés, démarrés **avant** la résolution du credential : le budget couvre toute l'opération. Résolution bloquée jusqu'à expiration → `credential_unavailable`, `reason:'timeout'`, `delivery:'not_sent'` ; abort de l'appelant avant ou pendant la résolution → `provider_timeout`, `reason:'caller_abort'`, `delivery:'not_sent'` (le résolveur n'est même pas appelé si le signal est déjà annulé). Une résolution qui aboutit après expiration ou annulation est ignorée et n'entraîne aucun `fetch`. Interruption après envoi → `provider_timeout` avec `reason` `timeout` ou `caller_abort` et `delivery:'unknown'`. Le timer est toujours nettoyé.
- Échec sans recopie de données : `field` ne contient que des libellés fixes (`prompt`, `repos[0]`, `tools[0]`, `toolChoice`, …). Une clé inconnue, à tout niveau d'imbrication, produit `reason:'unknown_field'` avec le nom du conteneur connu ; la clé rejetée n'apparaît ni dans `field`, ni dans le message, ni dans la pile, ni dans la sérialisation JSON.
- `redirect:'manual'` ; tout 3xx → `provider_redirect`, corps annulé, aucun appel vers la cible.
- Statuts : 401/403 → `provider_auth` ; 429 → `provider_quota` avec `Retry-After` borné à 1 h ; autres 4xx → `provider_rejected` ; 5xx → `provider_unreachable` ; `delivery:'responded'`. Le corps d'erreur est lu borné (64 Ko max) uniquement pour extraire un code autorisé ; jamais de message ni de corps dans l'échec.
- Corps de succès : type JSON requis, `content-length` puis lecture en flux bornée (défaut 2 Mo, bornes 1 Ko–16 Mo) avec annulation du lecteur ; JSON invalide ou schéma inconnu → `provider_response`.
- `createAgent` : refus explicite de `envVars`, `mcpServers`, `customSubagents`, `prompt.images` et de toute clé inconnue ; URL GitHub HTTPS sans identifiants ni paramètres ; réponse refusée si `agent.id`/`run.agentId` ≠ `agentId` demandé ; 409 remonté tel quel, aucun second envoi ni nouvel identifiant.
- `cancelRun` : réussite uniquement si le fournisseur renvoie `{id}` égal au run demandé ; délai ou 409 → échec typé.
- xAI : `store:boolean` et `maxOutputTokens` (1–131 072) obligatoires ; `stream:false` imposé ; `background`, `stream` ou toute clé non prévue refusés ; `instructions` + `previousResponseId` refusés ; outils fonction validés (nom unique, description, racine objet ou union d'objets) et relayés sans exécution ; statut inconnu → `provider_response` ; éléments de sortie non pris en charge comptés dans `omittedOutputItems`.
- Aucun retry, polling, timer durable, stockage, D1/R2, UI ni journalisation de corps. Aucun effet à l'import.

## Contrôles réellement exécutés

Environnement : Node 24.21.0, pnpm 11.25.0 via Corepack, `pnpm --dir template install --frozen-lockfile`. Ordre d'AGENTS.md, sans chevauchement.

| Commande | Résultat |
|---|---|
| `npm test` (synchronise le template puis lance `tests/*.test.mjs`) | 69 tests, 0 échec ; dont les 17 tests fetch simulé et le test workerd de ce lot (relancé après les correctifs de revue, head a0d7a72 + rapport). |
| `npm run check` | `ok:true`, version 0.9.0, 2 exemples. |
| `pnpm --dir template run typecheck` | 0 erreur (`tsc --noEmit` après `prepare-lite`). |
| `pnpm --dir template run build` | « Build complete ». |
| `node scripts/validate-examples.mjs` | Deux applications indépendantes générées et validées. |

Couverture des tests du lot : racines et en-têtes (Bearer, `accept`, `redirect:'manual'`), credential incorrect/désactivé/révoqué avant réseau et relecture à chaque appel, bornes des options, validation des identifiants et payloads (32 cas Cursor, 33 cas xAI), payload exact envoyé, réponses invalides / identités divergentes / statuts inconnus, 409 déterministe sans seconde création, 401/403/429/5xx sans fuite (clé, corps, prompt et « Bearer » recherchés dans l'échec sérialisé et la pile), redirections 301/302/303/307/308, délai, annulation avant et pendant l'appel, erreur réseau, corps trop grand (flux annulé, `content-length` déclaré), non JSON, 204, xAI synchrone avec outil relayé sans second appel, `store` explicite, réponse `incomplete` sans fuite. Le test workerd rejoue racines, auth, payloads, credential mismatch, redirection, 401/403/409/429/500/503 avec `Retry-After`, délai, annulation, corps trop grand et non JSON avec le `fetch` réel de workerd.

Ajouts de la revue du 16/09/2026 (head relu 47dbb49) :

- Clés inconnues imbriquées : 12 cas (Cursor : racine, `prompt`, `model`, `repos[0]`, `env`, clé composée `prompt.<marqueur>` ; xAI : racine, `input[0]` message et `function_call_output`, `input[0].content[0]`, `tools[0]`, `toolChoice`) avec le marqueur `PRIVATE_FAKE_CLIENT_DATA@example.test` recherché dans la sérialisation JSON, le message, la pile, `field` et toutes les propriétés de l'échec : absent partout, `reason:'unknown_field'`, `field` = conteneur connu, aucun fetch.
- Budget étendu à la résolution du credential (fetch simulé) : résolution bloquée avec `timeoutMs:1000` → échec `credential_unavailable`/`timeout`/`not_sent` mesuré entre 950 et 1150 ms ; résolution tardive (1300 ms) → échec à l'expiration puis, 450 ms après la fin de la résolution, toujours aucun fetch ; abort de l'appelant pendant l'attente (30 ms) → `provider_timeout`/`caller_abort`/`not_sent` en moins de 500 ms ; abort préalable → résolveur jamais appelé ; exception synchrone du résolveur → `credential_unavailable` ; un client sain sur le même fetch simulé passe ensuite normalement.
- Même scénarios dans workerd : credential retardé de 2,5 s avec `timeoutMs:1000` → `credential_unavailable`/`timeout`/`not_sent` en moins de 1,4 s ; credential retardé avec abort à 50 ms → `provider_timeout`/`caller_abort`/`not_sent` ; après 2,6 s d'attente, aucun appel sortant supplémentaire ; clé inconnue imbriquée dans `prompt` → `field:'prompt'`, marqueur absent de la réponse.

## Limites et raccordement

- Aucun appel réel à Cursor ni xAI n'a été effectué : les schémas suivent la documentation publique du jour ; une divergence de production (par exemple le format d'erreur réel de Cursor, signalé comme incohérent avec sa spécification) se traduirait par `providerCode` absent, jamais par une fuite.
- Le port `resolveCredential` est injecté ; le raccordement au coffre `integrations.ts`, aux identités, aux tables `cv_agent_*`, aux approbations, à l'UI Intégrations et à la page Agents appartient aux missions ultérieures. Ce lot n'installe aucun module applicatif et le catalogue le déclare (`requiresApplicationModule: true`).
- `createRun` (prompt de suivi), le flux SSE, les webhooks Cursor, `background` xAI et toute API Grok Bot restent `deferred` dans le catalogue.
- Le code fournisseur xAI relayé repose sur une liste courte faute de référence officielle des codes d'erreur ; elle peut être étendue sans changer le port.
- Les tests de délai imposent ~1 s (bornes minimales du transport) et ~2,6 s d'attente dans le test workerd pour laisser terminer le service simulé lent.
