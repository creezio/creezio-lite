# @creezio/app-runtime

## Rôle

`@creezio/app-runtime` est la **façade n°1 des marques** : elle orchestre le
boot complet d'un OS Creezio, en desktop Electron (`startBrandDesktop`) comme
en serveur headless (`startBrandKernelHarness`). La marque fournit son
manifest, ses migrations, son API métier, éventuellement un feed Meili et une
nav — tout le reste (paths, SQLite, embeds, auth, API `/api/v1`, MCP, splash,
updater, crash-reporter, sidecar navigateur) est composé ici.

## API publique

| Export | Rôle |
|--------|------|
| `startBrandDesktop(config)` | Boot desktop Electron complet (main mince côté marque) |
| `startBrandKernelHarness(config)` | Boot OS sans GUI (serveur Docker, smokes) |
| `composeBrandOs` | Composition de l'OS natif (kernel, stores, surfaces) |
| `listenBrandOsHttp` / `listenBrandBootHttp` | Serveurs HTTP OS + endpoint boot précoce |
| `createBootProgress` (`boot-progress.ts`) | Progression de boot headless : `GET /api/v1/os/boot-status`, JSONL stdout, journal ops |
| `warmBrandNativeHosts` | Préchauffage embeds (n8n, Hermes) |
| `wireBrandBrowserSidecar` | Sidecar navigateur IA (Chromium CDP, `CREEZIO_BROWSER_PROXY`) |
| `mountBrandEmailSurface` / `mountBrandMcpSurface` / `mountBrandPlatformSurface` | Surfaces optionnelles |
| `createBrandModuleRegistry` | Collecteurs du registre (`collectEntitySpecs`, `collectAssistantSources`, `collectOnboardingContent`, …) — SoT `BrandModuleDef` (P2.c / F3.4) |

## Consommation marque

```ts
import { startBrandDesktop } from "@creezio/app-runtime";

await startBrandDesktop({
  manifest,
  electronDirname: __dirname,
  brandMigrations: brandMigrations(),
  registerModuleApi: registerBrandModuleApi,
  meiliFeed: brandMeiliFeed,
  navItems: verticalSlot.items,
});
```

## Comportements clés

- **Crash early writer** : `installEarlyCrashWriter()` est posé dès l'entrée
  de `startBrandDesktop`, avant toute résolution de chemins — un crash au
  tout début du boot laisse un `early-*.json` à côté de l'exécutable.
- **Data layout packagé** : toutes les données vivent sous
  `{installDir}/data/` (voir `resolvePackagedDataDir`, `@creezio/platform-core`).
- **Fleet** : sans `CREEZIO_FLEET_ENDPOINT`, l'endpoint par défaut est la
  sentinelle `…/ingest-disabled` — l'agent fleet ne fait alors **aucun**
  appel réseau.
- **Env utiles** : `CREEZIO_HTTP_HOST=0.0.0.0` (Docker), `CREEZIO_NATIVE_WARM` / `_N8N` / `_HERMES` (n8n et Hermes découplés en local ; VPS create/update force les deux ON),
  `CREEZIO_DESKTOP_SHELL=window`, `CREEZIO_BROWSER_PROXY`.

## Hermes « cerveau unique » — endpoint `/mcp` (câblé prod)

Le endpoint `/mcp` servi par `listen-brand-os-http.ts` accepte **deux
transports** sur la même URL (desktop ET harness Docker) :

- transport JSON simple historique (`{ok, tools}` / `{name, arguments}`)
  — conservé pour les clients existants ;
- **JSON-RPC 2.0 stateless** (`mcp-jsonrpc.ts`) : seuls les corps portant
  `jsonrpc:"2.0"` passent par ce pont (`initialize`, `tools/list`,
  `tools/call`, `ping`) — c'est ce que parle le client MCP natif de Hermes
  (Streamable HTTP, `skip_preflight: true`).

`hermes-mcp-host-tools.ts` branche sur la façade MCP les tools host tasks
(`create_ai_task`, `get_ai_run_logs`…) + workspace (`workspace.*`,
`platform.ask_human` — `@creezio/tasks`). Décision d'acteur : façade
`allowUnauthenticated`, les tools qui agissent portent leur gate ; la clé
CRM service Hermes (`user_id NULL` + scopes `full`) est vérifiée contre la
table `api_keys` et **mappée owner** — une clé restreinte n'est PAS mappée
(fail-closed). Gate : `scripts/test-phase-hermes-mcp.mjs`.

## Plugins (câblé prod — desktop et harness)

- `plugin-seed.ts` : seed des plugins embarqués marque
  (`<appRoot>/plugins/` → `<userData>/plugins/`, idempotent) ;
- `plugin-proxy-mount.ts` : `/api/v1/plugins/<id>/*` → sidecar loopback ;
- `plugin-tools-discovery.ts` : tools MCP `plugin.<id>.*` ;
- `plugin-acl-wiring.ts` : ACL Product Hub fail-closed sur la façade.

Guide auteur : [CREATE-PLUGIN](../../docs/agents/CREATE-PLUGIN.md).

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
