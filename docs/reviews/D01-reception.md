# D01 — Réception : registre, opérations et portées du kit

Branche `agents/D01-lite-domain-registry`, base `4c4229a` (contrats approuvés). Contrat de référence : [docs/contracts/domain-extension.md](../contracts/domain-extension.md). Aucun secret, aucun service payant, aucun merge ni déploiement.

## Livré

### Registre (`runtime/core/{types,validation,registry}.ts`)

- `Module` étendu par `ModuleExtension` (`kind`, `parent`, `parentField`, `navigation`). Un module sans `kind` conserve exactement le registre, les cinq opérations CRUD, la navigation et la recherche d’avant (test « a module without kind keeps exactly… »).
- `defineApp` : plafond `MODULE_LIMIT = 64` (64 accepté, 65 refusé) ; motifs d’identifiants et noms réservés conservés ; `kind` ∈ module/entity/collection ; `navigation` booléen ; `parent`/`parentField` interdits hors collection ; une collection exige un `parent` entity déclaré, un `parentField` texte obligatoire présent dans ses champs, ne peut pas être parent (cycle refusé) ni imposer `navigation:true`.
- `moduleRegistry` expose `moduleKind`, `writable`, `navigation`, `parent`, `parentField`. Recherche : règle actuelle pour module/entity, désactivée par défaut pour une collection sauf `search.enabled:true`. `recordHref` d’une collection lit le `parentField` réel et retombe sur la page du parent si l’identifiant est absent ou invalide (jamais `undefined`). `navigableModules` alimente le dashboard.

### Opérations et commandes (`runtime/core/{operations,commands,tools}.ts`)

- `coreOperations` ne génère que `list`/`get` pour entity/collection ; aucune opération d’écriture n’existe donc au catalogue (404 du dispatcher avant handler). `handleApi` refuse aussi directement POST/PATCH/DELETE par `405 command_required`.
- `Operation.source` (`'core'|'native'|'app'`) est le marqueur explicite de transport. `appOperations(app, definitions)` valide chaque `AppOperationDefinition` (ID, méthode, chemins `/api/v1/`, moduleId déclaré pour kind business, descripteur système hors modules métier, rôles jamais supérieurs aux `readRoles` du module, pas de corps sur GET, pas d’`essential`) et marque `source:'app'`. `assertUniqueOperations` refuse les collisions d’ID, de méthode/chemin/alias et de nom d’outil sur tout le catalogue.
- `command()` construit une commande POST sous `/api/v1/modules/<moduleId>/commands/<name>` ou `/records/:id/commands/<name>`, ID `command.<moduleId>.<name>`, corps aplati avec `expectedVersion`/`idempotencyKey`/`reason` réservés (`reason` borné à 500), `additionalProperties:false`, champs `command`/`payload` refusés à la déclaration. Une commande nommée `get` reste POST. `read()` construit une lecture GET déclarée (`read.<moduleId>.<name>`, ex. history). `defineExtensions(app, extensions)` valide l’ensemble à la déclaration.
- `executeAppOperation` est l’unique exécuteur : validation serveur des paramètres de chemin, de la query (coercion vers les types déclarés, propriétés inconnues refusées) et du corps ; GET sans corps métier ; alias `Idempotency-Key` normalisé avant validation, 400 si header et body diffèrent ; contexte fiable (`principal`, `workspace`, `scope`, `defer`) ; réponse `{status, body}` avec les seuls en-têtes dérivés `x-lite-data-changed` (identifiants validés) et `Idempotent-Replayed: true` ; erreur inattendue ⇒ 503 sans détail.
- Outils : les opérations `source:'app'` utilisent `Operation.inputSchema` et la sérialisation générique params/query/body, sans passer par la branche CRUD historique ; les outils CRUD existants sont inchangés.

### Portée et fichiers (`runtime/core/{scope,api,search}.ts`)

- `ScopeProvider`, `Principal`, `FileDeletionContext/Result` selon le contrat. `openScope` retourne `1=1` ; `recordScope`/`fileScope` valident alias et colonnes comme identifiants, exigent un fragment unique et bindent toutes les valeurs. `principalOf` dérive l’acteur de l’identité vérifiée et de l’appartenance vivante (`credential` session/token/oauth fourni par le dispatcher).
- Filtre `read` appliqué dans l’instruction avant résultat : liste générique (avec `q` et filtre de champ), détail, compteurs du dashboard (modules navigables seulement), `matches` de la recherche avant COUNT et extraits, fichiers liste/métadonnées/téléchargement (tombstones exclus). Filtre `write` sur PATCH/DELETE des modules natifs (précondition et prédicat de l’UPDATE) : un grant read ne suffit jamais.
- Suppression de fichier : rôle puis `fileFilter write` puis, si `scope.deleteFile` est configuré, délégation complète (ni tombstone ni `bucket.delete` du kit, ni en parallèle ni en repli) avec réponse `{ok:true, cleanup:'queued'|'complete'}` ; sans provider, chemin natif inchangé (`cleanup:'complete'`).

### Surfaces (`runtime/modules/sites-adapter/src/{catalog,dispatch,nav}.ts`, `runtime/ui/module-view.tsx`)

- `operationCatalog(c, app, extensions)` ajoute les opérations applicatives avant la détection de doublons ; HTTP, `admin/endpoints`, OpenAPI, matrice d’accès, MCP HTTP, WebMCP et outils assistant (avec relecture des droits) consomment ce même catalogue.
- `dispatchRequest(request, context, options: AppExtensions)` exécute le handler applicatif après identité, espace, rôle, politiques, jeton et origine, avant le noyau natif ; une route absente reste 404. Le dispatcher transmet `credential` et `scope` à `handleApi`.
- Navigation : seuls les modules `navigation` créent une entrée ; la permission `module.<id>.read` reste explicite pour entity et collection.
- Page générique : boutons créer/modifier/archiver masqués pour entity/collection ; le détail d’une collection lie son `parentField` vers la fiche parente.

### Exports étendus (justification)

`runtime/core/index.ts` exporte désormais `command`, `read`, `defineExtensions`, `openScope` et les types du contrat (`Principal`, `ScopeProvider`, `AppOperationDefinition`, `AppExtensions`, …). Le dispatcher les importe via `@lite/core`, et l’application consommatrice n’a pas d’autre point d’entrée public. Aucun autre export existant n’a changé de signature ; `handleApi` et `dispatchRequest` acceptent `AppExtensions`, sur-ensemble compatible de `{beforeWrite}`.

## Contrôles réellement exécutés

Environnement : Node 24.21.0 (installé via nvm, le VM fournissait 22.14), pnpm 11.25.0, dépendances figées du template installées avec `--frozen-lockfile`.

| Contrôle | Résultat |
|---|---|
| `npm test` (synchronise le template puis 23 fichiers) | 63 tests, 0 échec (51 existants + 12 nouveaux) |
| `npm run check` | `ok:true`, version 0.9.0, 2 exemples |
| `pnpm typecheck` dans `template/` | exit 0 |
| `pnpm build` dans `template/` | exit 0 (vinext) |
| `node scripts/validate-examples.mjs` | `Atelier` et `Réserve` : install, typecheck, build validés |
| Navigateur sur fixture | Application créée par `node bin/lite.mjs create` avec entity + collection, servie par `wrangler dev --local` (workerd + D1 locale) derrière un proxy local injectant l’identité Sites ; vérifié : dashboard sans compteur de collection, navigation sans « Pièces », page Dossiers sans « Nouveau »/Actions/Modifier, page Clients inchangée, lien du champ parent d’une pièce vers `/dossiers?record=dossier-1` |

Tests indispensables du brief et fichier qui les couvre :

- ancien module sans kind identique — `domain-registry`
- entity/collection CRUD refusé en HTTP (404) et appel direct (405 `command_required`) — `domain-registry`
- GET history et POST commande au catalogue, OpenAPI (paramètres de chemin/query, `requestBody` avec `required` et `additionalProperties:false`), matrice d’accès, MCP `tools/list`, WebMCP — `domain-operations`
- commande nommée `get` reste POST (GET ⇒ 404, PUT ⇒ 404) — `domain-operations`
- collisions routes/IDs/outils refusées — `domain-registry`
- droits vivants session / clé API read et write / OAuth (`principal.credential`) / politiques de groupe par opération et `module:<id>` / membre retiré ⇒ 401 — `domain-operations`
- read grant insuffisant pour write (commande et PATCH/DELETE natifs) — `domain-operations`
- filtres avant liste/count/dashboard/recherche/extraits — `domain-operations`
- fichiers download et delete ; `deleteFile` traite toute suppression sans fallback R2 (aucun `bucket.delete`, aucun audit natif, téléchargement refusé sur tombstone, 409 classé par le provider) — `domain-operations`
- owner/admin/member/viewer et espaces croisés — `domain-registry`, `domain-operations`
- module absent / parentField absent / cycle / 65 modules invalides — `domain-registry`

## Limites et raccordement

- Les preuves sont sur fixtures (SQLite `node:sqlite` pour les tests, workerd + D1 locale pour le parcours navigateur). Aucun parcours du Site authentifié n’a été exécuté : pas de `project_id`, de dispatcher Sites ni de déploiement dans cette mission.
- Le ScopeProvider et la politique `deleteFile` de test lisent des tables `fx_*` créées dans le test ; aucune table `cv_*` ni politique métier Certivan n’existe dans le kit. La politique « owner/admin voient tout l’espace » est une constante de la fixture, pas du mécanisme.
- Le chat assistant n’a pas été exercé de bout en bout avec un fournisseur ; il reçoit le même catalogue (`operationCatalog(..., options.operations)` dans `assistantRoute`) et les mêmes `dataTools` que MCP/WebMCP, qui sont testés.
- `wrangler d1 migrations apply --local` échoue sur `0003_search_index.sql` (« incomplete input ») indépendamment de D01 ; les migrations ont été appliquées via Miniflare avec le découpage `--> statement-breakpoint` déjà utilisé par `tests/miniflare.test.mjs`. À signaler séparément.
- Les politiques `module:<id>` sont honorées par `operationAllowed` mais l’API `access/policies` n’accepte que des identifiants d’opération existants ; le test insère la ligne directement. Comportement existant, hors périmètre.
- `docs/MODULES.md` mentionne encore « 32 modules » et les CRUD systématiques ; non modifié (doc globale hors fichiers attribués). À aligner lors de l’intégration.
- Version du kit, CHANGELOG, package/lockfile, migrations et fichiers `agent-providers`/`observability.ts` non touchés. `dispatch.ts` a été modifié sans toucher aux lignes de traces ni aux corps de requêtes du correctif B00 ; `origin/main` était à `a9e9413` au moment de la livraison, sans fusion de PR14.

### Imports à raccorder dans Certivan

```ts
import { command, read, defineExtensions, type AppExtensions, type ScopeProvider, type AppOperationContext } from '@lite/core';
import { operation, objectSchema } from '@lite/core/operations';        // descripteur système jobs.*, schémas
import { dispatchRequest } from '@lite/sites-adapter/dispatch';
```

- Déclarer `const extensions = defineExtensions(appDefinition, { beforeWrite, scope: certivanScope, operations: [...] })` puis passer `extensions` en troisième argument de `dispatchRequest` dans `app/api/v1/[...path]/route.ts`, `app/api/mcp/route.ts` et `worker.ts` (à la place de `{beforeWrite}`).
- `certivanScope: ScopeProvider` implémente `recordFilter`/`fileFilter` sur `cv_record_scopes`/`cv_*` (alias et colonnes fournis par le kit : `r.id`/`r.module_id`, `d.record_id`/`d.module_id`, `f.id`) et `deleteFile` selon §4.3.
- Commandes : `command({ moduleId, name, fields, required, expectedVersion, idempotencyKey, reason, handle })` ; history : `read({ moduleId, name:'history', querySchema, handle })` ; jobs : `{ operation: operation({ kind:'system', moduleId:'certivan-jobs', ... }), handle }`.
- Dans `brand.json`, déclarer `kind:'entity'` / `kind:'collection'` avec `parent` et `parentField` réels ; Clients reste sans `kind`.
