# AGENTS — @creezio/product-hub

## Mission

Maintenir le Product Hub kit : lifecycle plugins, ACL L3/L4, store core SQLite, routes Hono, control plane loopback, n8n provisioning, fabrique conversationnelle et UI admin. Le package doit rester brand-agnostic et utilisable par plusieurs marques sans imports `@/`, sans noms TempoFlow/Certivan/Fidu hardcodes et sans dependance a une DB concrete non injectee.

Objectif principal : fournir un SoT commun pour les flux plugins natifs tout en laissant aux marques leurs secrets, chemins, sessions, ACL de navigation, migrations et integrations metier.

## Ne pas faire / frontières

- Ne pas ajouter de logique metier marque (panier, GED, VASP, catalogue specifique, libelles produit).
- Ne pas hardcoder de chemins locaux, variables `TEMPOFLOW_*`, `CERTIVAN_*`, `FIDU_*`, noms de cookies ou prefixes API key.
- H11 : plus de dual-read `TEMPOFLOW_*` — tokens / routes plugins = `envKey` du manifest uniquement.
- Ne pas importer `better-sqlite3` directement dans le kit ; passer par `OpenSqliteDatabase`.
- Ne pas deplacer les modules encore verticaux de `PRODUCT_HUB_VERTICAL_REMAINING` sans plan explicite.
- Ne pas rendre l'auth interne aux routes `/plugin-products` : la marque protege le prefixe et injecte `getActor` / `getSession`.
- Ne pas ouvrir l'ACL fail-open par confort. Le modele par defaut est fail-closed.
- Ne pas confondre plugin natif Product Hub avec feature metier d'une marque ; `features.plugins=false` est un choix d'integration, pas une suppression de capacite kit.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs product-hub` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

Exports package root :

- `src/index.ts` : surface publique.
- `src/lifecycle.ts` : etats et transitions.
- `src/acl.ts` : decisions L3/L4, headers acteur, capabilities.
- `src/store/types.ts` : contrat `ProductHubStore`.
- `src/store/sqlite-store.ts` et `src/store/memory-store.ts` : implementations store.
- `src/schema-sql.ts` : DDL core/ACL/runtime.
- `src/http/plugin-products-routes.ts` : routes Hono `/plugin-products`.
- `src/http/plugin-factory-routes.ts` : routes Hono `/plugin-factory`.
- `src/control-plane/*` : handler/serveur loopback et ACL control plane.
- `src/factory/*` : fabrique conversationnelle, PRD drafter, scaffold.
- `src/n8n-provisioning.ts` et `src/n8n-tags.ts` : integration n8n generique.
- `src/host-api.ts` : host Product Hub cote app.
- `src/admin/plugin-acl-admin.ts` : CRUD admin ACL.

Exports UI :

- `ui/index.ts` : `AdminPluginsList`, `AdminPluginDetail`, `HostManagedNotice`, shim workspace.
- `ui/plugins-list.tsx`, `ui/plugin-detail.tsx` : surfaces admin principales.

Docs :

- `README.md` : guide humain.
- `docs/FILES.md` : inventaire par fichier.

## Modifier sans casser

- Commencer par lire `src/index.ts` et `docs/FILES.md` pour verifier si l'API est publique.
- Si une nouvelle fonction devient publique, l'exporter depuis `src/index.ts` et verifier le dual build ESM/CJS.
- Garder les contrats purs dans `src/acl.ts`, `src/lifecycle.ts`, `src/prd.ts`, `src/impact.ts` sans effet de bord reseau/FS.
- Ajouter les champs optionnels avec prudence : les stores memoire et SQLite doivent rester coherents.
- Toute nouvelle route Hono doit garder l'auth externe et recevoir ses dependances par `PluginProductsRouteDeps` ou `PluginFactoryRouteDeps`.
- Respecter les transitions via `assertPluginLifecycleTransition`.
- Pour l'ACL, verifier les trois actions `see`, `install`, `execute`; `install` doit rester explicite.
- Pour le control plane, garder le bind loopback et l'auth Bearer ; ne pas exposer de handler sans token.
- Pour n8n, deriver les prefixes des tokens marque et respecter `N8N_TAG_MAX_LENGTH`.
- Pour l'UI, ne pas importer d'alias app (`@/`) ; passer par props, hooks configures ou adapters.

## Config brand

La marque doit injecter :

- manifeste `@creezio/brand-config` pour `productHubTokensFromManifest`;
- `coreDbPath` et opener SQLite ;
- `pluginsDir`, `documentsDir`, `hermesContextDir` ;
- `getActor(c): PluginAclActor` depuis session, owner, org, API key ;
- `getSession(c): { sub } | null` ;
- middleware `requireSessionOrApiKey` autour des routes ;
- `createPluginN8nProvisioning` avec `getDb`, credentials et labels ;
- `hermesCreateTask` si la sync Hermes est active ;
- `openReadonlyPluginDb` si les routes data tables sont exposees ;
- control plane adapters `listStatus`, `createPlugin`, `writeFiles`, `pluginDir`, etc. ;
- pages admin qui importent `@creezio/product-hub/ui`.

Ne pas stocker ces valeurs dans le package. Les defaults kit ne doivent servir qu'aux tests ou sandboxes.

## Tests / gates

Commandes utiles :

```bash
npm run build -w @creezio/product-hub
npm run typecheck -w @creezio/product-hub
node --test scripts/test-phase-h5.mjs
node --test scripts/test-phase-p25.mjs
```

Selon la zone touchee, lancer aussi les tests de phase lies a Product Hub / plugins / n8n / factory presents dans `package.json`. Pour une modification documentaire seule, un build n'est normalement pas requis, mais verifier le diff et les liens relatifs.

Gates logiques a garder :

- ACL fail-closed sans grant ;
- owner non impersonne et service key gardent le bypass admin ;
- deny cross-org avant capability ;
- routes `/visible` avant `/:id` ;
- PRD valide avant approval/execution ;
- control plane authentifie par Bearer.

## Fichiers sensibles

- `src/acl.ts` : securite L3/L4 commune API/MCP/control plane.
- `src/http/plugin-products-routes.ts` : grande surface HTTP ; risque de regression endpoints.
- `src/control-plane/handler.ts` : execution locale et creation fichiers plugins.
- `src/schema-sql.ts` : compat migrations core.db.
- `src/store/sqlite-store.ts` : persistance et coherence avec `ProductHubStore`.
- `src/factory/session.ts` : orchestration multi-etapes.
- `src/n8n-provisioning.ts` : credentials/tags/workflows n8n.
- `ui/plugin-detail.tsx` et `ui/plugins-list.tsx` : UI admin dense.
- `package.json` exports : impact direct sur apps consommatrices.

## Liens

- [`README.md`](./README.md)
- [`docs/FILES.md`](./docs/FILES.md)
- Packages lies : `@creezio/auth`, `@creezio/mcp-facade`, `@creezio/shell-ui`, `@creezio/brand-config`, `@creezio/platform-core`
