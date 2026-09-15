# Phase E — Plugins / Product Hub généralisés (livré)

## Objectif

Rendre le cycle **plugins / Product Hub** brand-agnostic dans le kit
`@creezio/*`, en portant depuis TempoFlow2 **v0.10.26** et Certivan (lecture
seule) tout le platform encore hardcodé marque — sans brancher les apps prod
(Phase G) et sans toucher Fidu / Certivan / tempoflow2.

## Livrables

| Item | Emplacement |
|------|-------------|
| Package Product Hub | `@creezio/product-hub` |
| Control plane host | `@creezio/electron-shell` → `startHostPluginControlPlane` |
| Bridge env brandé | `getPluginControlBridgeEnv` (plus de `TEMPOFLOW_*` hardcodé) |
| Stub sandbox | `apps/demobrand` + factory `product-hub-stub.ts` |
| Tests | `scripts/test-phase-e.mjs` |
| Doc | ce fichier + `PLATFORM-VS-VERTICAL.md` |

## Package `@creezio/product-hub`

### Jetons marque (`productHubTokensFromManifest`)

Tout dérive de `AppManifest.brandId` + `envPrefix` :

| Jeton | Formule | Ex. Certivan | Ex. DemoBrand |
|-------|---------|--------------|---------------|
| Tag n8n | `{brandId}-plugin:` | `certivan-plugin:` | `demobrand-plugin:` |
| Grant token | `{envPrefix.lower}_exec_` | `certivan_exec_` | `demobrand_exec_` |
| Control token | `{envPrefix.lower}_plug_` | (déjà B.2) | idem |
| Header grant | `x-{brandId}-execution-grant` | `x-certivan-execution-grant` | … |
| Header bypass | `x-{brandId}-grant-bypass` | + env `{ENV}_PLUGIN_GRANT_BYPASS` | … |
| Service health | `{brandId}-plugins-api` | `certivan-plugins-api` | … |
| Env bridge | `PLUGINS_*` + `{ENV}_PLUGINS_*` | `CERTIVAN_PLUGINS_DIR` | `DEMOBRAND_…` |

**Interdit** dans le kit : hardcode `TEMPOFLOW_PLUGINS_*`, `CERTIVAN_*`,
`tempoflow-plugin:` / `certivan-plugin:` en littéral applicatif.

### Contrats purs

| Module | Contenu |
|--------|---------|
| `lifecycle.ts` | États + transitions (`request_received` → … → `released`) |
| `prd.ts` | Sections obligatoires, `missingPrdSections`, UTF-8 replacement |
| `clarifications.ts` | Questions structurées (choice/multi/text) |
| `impact.ts` | Rapport d'impact **pur** (evidence injectée) |
| `n8n-tags.ts` | `pluginN8nTag` + limite 24 car. n8n (suffixe SHA-256) |
| `acl.ts` | **L3 org** + **L4 user**, fail-closed, admin/service key |
| `grants-flow.ts` | Émission grant post-validation PRD + require/bypass |
| `schema-sql.ts` | DDL core + ACL user + ACL org (apps exécutent) |
| `store/memory-store.ts` | Implémentation mémoire (tests + sandbox) |
| `control-plane/*` | Handler HTTP loopback générique |

### Control plane HTTP (patterns portés)

- `GET /v1/health` → `{ service: "{brandId}-plugins-api" }`
- `GET /v1/plugins` (Bearer)
- `POST /v1/products/:id/grant` — uniquement si PRD validé
- `POST /v1/plugins` — exige `execution_grant` (header brandé ou body)
- `PUT /v1/plugins/:id/files` — grant si `.product-hub-managed`
- enable / disable / restart / delete (adapters)

Adapters injectés : scaffold, writeFiles, fetchProductDetails, etc.
Le scaffold **stub** vit dans electron-shell ; git / accept-check / test-runner
restent verticaux.

### ACL L3 / L4

| Niveau | Scope | Table SQL kit | Comportement |
|--------|-------|---------------|--------------|
| **L3** | organisation / tenant | `plugin_acl_org` | org listée → visible |
| **L4** | utilisateur | `plugin_acl` (TF2/Certivan) | user listé → visible |

Fail-closed : sans entrée ACL, seul **owner** (non impersoné) ou **clé service**
(sans `user_id`) voit le plugin. Contrats purs dans le kit ; persistance =
vertical (Phase G).

## Intégration `@creezio/electron-shell`

```ts
import {
  createPluginsHost,
  startHostPluginControlPlane,
  getPluginControlBridgeEnv,
} from "@creezio/electron-shell";
import {
  createMemoryProductHubStore,
  productHubTokensFromManifest,
} from "@creezio/product-hub";

const plugins = createPluginsHost({ ctx });
const store = createMemoryProductHubStore(); // ou SQLite vertical
const plane = await startHostPluginControlPlane({
  ctx,
  pluginsHost: plugins,
  productHubStore: store,
});
const env = getPluginControlBridgeEnv(ctx, { controlPort: plane.port });
// env.PLUGINS_API_URL + env.{ENV_PREFIX}_PLUGINS_API_URL
```

### Vertical restant (`PLUGIN_VERTICAL_REMAINING`)

- `plugin-git` / versions / restore
- `plugin-data` (better-sqlite3)
- `plugin-accept-check` / `plugin-test-runner`
- `plugin-crm-key`
- store SQLite Product Hub + UI Admin Plugins (apps)

`plugin-control-api` **n'est plus** dans cette liste : patterns dans
`@creezio/product-hub` + façade host.

## DemoBrand / factory

- `apps/demobrand/src/electron/product-hub-stub.ts`
- `verticalSlot.productHub` (tokens + store + createRequest)
- `creezio new-app` génère le même stub pour chaque marque sandbox

## Vérification

```bash
cd /opt/docker/creezio
npm install
npm run build
npm test   # inclut scripts/test-phase-e.mjs
```

Couverture Phase E :

1. Jetons distincts TF / Certivan / DemoBrand (pas de TEMPOFLOW_ hardcodé)
2. Tags n8n + troncature 24 car.
3. Lifecycle / PRD / impact
4. Store mémoire → validate → grant HMAC
5. ACL L3/L4 fail-closed
6. Control plane HTTP (health, grant, create 403/201)
7. Bridge env + `startHostPluginControlPlane`
8. Fichiers demobrand + vertical remaining

## Consommation future (Phase G)

Les apps (`certivan-app`, `tempoflow2`, éventuellement Fidu) :

1. Dépendent de `@creezio/product-hub` + `@creezio/electron-shell`
2. Remplacent les littéraux `certivan-plugin:` / `TF2_PLUGIN_GRANT_BYPASS` par
   `productHubTokensFromManifest(manifest)`
3. Implémentent `ProductHubStore` sur SQLite (migrations existantes 028/030/032
   + optionnel `plugin_acl_org`)
4. Passent leurs adapters git/accept/test au control plane kit
5. Gardent UI Admin / routes Next métier en vertical

## Hors scope Phase E

- Branchement runtime Fidu / Certivan / TF2 → **Phase F / G**
- Publish npm registry des packages `@creezio/*`
- UI Admin Plugins Next
- Provisioning n8n HTTP réel (seul le contrat tag est kit)

## Suite — Phase F (Propagation)

Livré : voir [PHASE-F.md](PHASE-F.md) et [PROPAGATION.md](PROPAGATION.md) —
semver, canaux PR, registre L3, extension points, console versions, checklists
gates G1–G3 (sans bascule runtime ; bascule = Phase G).

## Contraintes respectées

1. Aucune modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`, ni
   push `creezio/tempoflow2`
2. Zéro hardcode `TEMPOFLOW_` / `CERTIVAN_` dans le kit (injection manifest)
3. Client+Serveur = modèle standard inchangé
4. Push uniquement `creezio/creezio`
