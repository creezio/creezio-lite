# [ARCHIVE] Matrice de parité TF2 desktop → serveur Docker headless

> **Archivé** (anciennement `docker/server/PARITE-TF2.md`). Le contrat vivant
> est la gate `scripts/test-phase-harness-parity.mjs` (dans `test:kit`) —
> cette matrice est le snapshot du chantier de parité, conservé pour contexte.

Fonctionnalités du runtime desktop TF2 (`brand-desktop-runtime.ts`, phases
post-démarrage Next) et leur statut dans le harness Docker
(`startBrandKernelHarness` + `harness-server-phases.ts`).

Preuves : `scripts/test-phase-harness-parity.mjs` (hermétique, dans
`test:kit`) et `scripts/test-phase-factory-docker-parity.mjs`
(`CREEZIO_FACTORY_DOCKER=1` — app neuve factory, preuve d'héritage).

| # | Capacité TF2 desktop | Docker headless | Où (kit) |
|---|----------------------|-----------------|----------|
| 1 | Import catalogue **après** listen HTTP (`METIER_BASE_URL` posé) | ✅ phase `catalog-import` post-listen | `harness-server-phases.ts` (`runHarnessCatalogImportPhase`), host `ensureCatalogImported` (`types.ts`) |
| 2 | Activation catalogue en prod Docker | ✅ `CREEZIO_CATALOG=1` (posé par `--profile prod`) + `applyBrandCatalogEnvDefaults` | `server-docker-cli.ts`, template harness factory |
| 3 | Clé API CRM Hermes (`ensureHermesCrmApiKey`) | ✅ phase `hermes-bridge` post-warm | `runHarnessHermesBridgePhase` |
| 4 | Seed contexte Hermes (`seedHermesContext`) | ✅ idem | idem |
| 5 | Pont n8n↔Hermes (`reapplyHermesBridge`) | ✅ idem | idem |
| 6 | Webhooks n8n publics (`syncN8nWebhookPublicUrl`) | ✅ `n8nPublicBaseUrl` au warm + resync post-tunnel | `warm-brand-native-hosts.ts`, phase tunnel |
| 7 | `cloudflared` disponible | ✅ binaire embarqué dans l'image (`/opt/creezio/bin/cloudflared`, `CREEZIO_CLOUDFLARED_BINARY`) | `docker/server/Dockerfile`, `tunnel.ts` |
| 8 | Tunnel (reserve / ingress / start cloudflared) | ✅ phase `tunnel` (`CREEZIO_TUNNEL_PROVISION_URL`+`_TOKEN`) | `runHarnessTunnelPhase` |
| 9 | MCP public via URL tunnel (`resolvePublicUrl`) | ✅ `publicBaseUrl` MCP suit le tunnel | `start-brand-kernel-harness.ts` |
| 10 | Secret mails entrants (`ensureInboundEmailSecret`) | ✅ env `EMAIL_INBOUND_SECRET` prime, sinon store persisté | `applyStoredEmailEnv` |
| 11 | Fleet agent + crash endpoint | ✅ phase `fleet` (`CREEZIO_FLEET_ENDPOINT` / `CREEZIO_CRASH_ENDPOINT`, fallback manifest, no-op sinon) | `runHarnessFleetPhase` |
| 12 | Plugins (`startEnabledPlugins` + control API) | ✅ phase `plugins` (défaut ON, kill-switch `CREEZIO_PLUGINS=0`) | `runHarnessPluginsPhase` |

## Hors périmètre Docker (assumé)

- Chrome natif : fenêtres, tray, NSIS, splash graphique (le boot-status HTTP
  remplace le splash).
- Auto-update Electron (l'image Docker se met à jour par rebuild).

## Répartition kit / marque

- **Kit (héritée par toutes les apps factory)** : phases harness, profil
  `--profile prod`, cloudflared dans l'image, template
  `brand-kernel-harness.mjs` (imports optionnels `catalog-sync` /
  `brand-mcp-tools` / `brand-platform-bindings`, `applyBrandCatalogEnvDefaults`).
- **Marque (légitimement TF3-only)** : logique d'import métier
  (`server/src/electron/catalog-sync.ts` — URL snapshot, SHA, projection
  restaurant) exposée au kit via le contrat `BrandCatalogHost`.
