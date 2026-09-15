# Phase B.2 — Launchers embeds + local-config + tunnel (livré)

## Objectif

Porter **tout** le runtime platform encore resté dans TempoFlow2 **v0.10.26**
(Hermes / n8n / tunnel / local-config safeStorage / plugins host / façades main),
sans brancher les apps marques (Phase G) et sans toucher Fidu / Certivan / tempoflow2.

## Inventaire porté (exhaustif)

### `@creezio/platform-core` (purs / testables Node)

| Module kit | Source TF2 0.10.26 | Notes |
|------------|-------------------|-------|
| `embeds/embed-stack-hooks.ts` | `embed-stack-hooks.ts` | IPC canoniques, site IDs, gate spawn |
| `embeds/embed-env-catalog.ts` | `embed-env-catalog.ts` | Catalogues + merge locked keys |
| `embeds/hermes-embed.ts` | `hermes-embed.ts` | Ports, sanitize, status, env home/Next ; `tunnelRootDomain` + `envPrefix` |
| `embeds/n8n-embed.ts` | `n8n-embed.ts` | Idem n8n |
| `recovery-key.ts` | `recovery-key.ts` | scrypt + AES-GCM |
| `disk-space.ts` | `disk-space.ts` | ENOSPC ; cache npm `desktop-npm` |
| `plugins/plugin-events.ts` | `plugin-events.ts` | runtime.json + siteId FNV |
| `plugins/plugin-execution-grant.ts` | `plugin-execution-grant.ts` | product-hub grants (prefix paramétrable) |
| `plugins/plugin-manifest.ts` | `plugin-runtime.ts` (parse/discover) | Manifest + découverte |
| `local-config-schema.ts` | champs `local-config.ts` | Schéma V1 enrichi (recovery, embedEnv, profiles…) |
| `tunnel-urls.ts` | déjà B | inchangé (paramétré `tunnelRootDomain`) |

### `@creezio/electron-shell` (runtime)

| Module kit | Source TF2 0.10.26 | Notes |
|------------|-------------------|-------|
| `host/context.ts` | — | `HostRuntimeContext` (manifest, paths, provision, hooks verticaux) |
| `host/safe-storage.ts` | seal/open de `local-config.ts` | Abstraction `safeStorage` + fallback plain |
| `host/local-config.ts` | `local-config.ts` | `createLocalConfigStore` factory complète |
| `host/tunnel/tunnel.ts` | `tunnel.ts` | Provision injecté (`tunnelProvision`), URLs multi-niveau |
| `host/sandbox/os-sandbox.ts` | `os-sandbox.ts` | PATH confiné, binaires OS |
| `host/sandbox/embed-sandbox.ts` | `embed-sandbox.ts` | HOME/APPDATA/npm/git confinés |
| `host/node-runtime.ts` | `node-runtime.ts` | Node marque (`{brandId}-node`), pin 22.22.2 |
| `host/npm-cli.ts` | `npm-cli.ts` | npm-cli.js sans PATH Windows |
| `host/hermes/runtime-bootstrap.ts` | `hermes-runtime-bootstrap.ts` | Download-on-first-run agent + WebUI |
| `host/hermes/launcher.ts` | `hermes-launcher.ts` | `createHermesHost` start/stop/status/env |
| `host/n8n/runtime-bootstrap.ts` | `n8n-runtime-bootstrap.ts` | `npm install n8n@pin` |
| `host/n8n/launcher.ts` | `n8n-launcher.ts` | `createN8nHost` start/stop/status/env |
| `host/plugins/control-token.ts` | `plugin-control-token.ts` | Token brandé `{prefix}_plug_` |
| `host/plugins/host.ts` | `plugin-launcher` + runtime | Découverte + spawn sidecars |
| `host/host-stack.ts` | `host-stack.ts` | `createHostStack` lazy-friendly |
| `main-facade.ts` | découpe `main.ts` | `createHostRuntime` / `prepareHostDesktop` |
| `boot.ts` + preload (B) | déjà B | inchangé |

## Vertical volontairement hors kit (documenté, pas « plus tard »)

Ces modules TF2 restent **dans l’app marque** (métier / ABI / product-hub) :

| Module TF2 | Raison |
|------------|--------|
| `hermes-skills-seed.ts` / `hermes-context-seed.ts` | Skills & contexte marque → hook `seedHermesSkills` |
| `hermes-crm-key.ts` + `ensure-hermes-crm-key-db.ts` | Clé API CRM + better-sqlite3 sous-process → hook `getHermesBridgeEnv` |
| `n8n-api-key.ts` / `agent-isolation.ts` | Provision clés n8n ↔ Hermes (DB/API n8n métier) |
| `plugin-control-api.ts` | HTTP control plane product-hub (CRUD PRD) |
| `plugin-git.ts` / `plugin-data.ts` | Git versions + migrations SQLite better-sqlite3 |
| `plugin-accept-check.ts` / `plugin-test-runner.ts` | Smokes acceptation produit |
| `plugin-crm-key.ts` | Clé CRM plugins |
| `fleet-*` | Télémétrie flotte (opt-in produit) |
| `catalog-sync.ts` / `supplier-*` | Métier catalogue TempoFlow |
| `main.ts` monolithe | Orchestration verticale (Phase G découpe progressive) |
| Paperclip | Retiré (plus aucune marque) |

Export kit : `PLUGIN_VERTICAL_REMAINING` liste les modules plugins non portés.

## Consommation (Phase G)

```ts
import { certivanManifest } from "@creezio/brand-config";
import {
  prepareDesktopBoot,
  createHostRuntime,
  createHostStack,
} from "@creezio/electron-shell";

const boot = await prepareDesktopBoot(certivanManifest);
const { ctx, store } = await createHostRuntime({
  boot,
  tunnelProvision: {
    baseUrl: process.env.CERTIVAN_TUNNEL_PROVISION_URL!,
    token: process.env.CERTIVAN_TUNNEL_PROVISION_TOKEN!,
  },
  seedHermesSkills: (home) => { /* vertical */ },
});

if (boot.bootBehavior.allowLocalStack) {
  const host = createHostStack({ ctx, store });
  await host.hermes.startHermes("local", { crmPort: 3000 });
  await host.n8n.startN8n("local");
  await host.tunnel.startCloudflared();
}
```

## Vérification

```bash
cd /opt/docker/creezio
npm install
npm run build
npm test
```

## Suite

| Phase | Contenu |
|-------|---------|
| **C** | Tooling publish / after-pack / remote-build génériques |
| **D** | Factory new-app + sandbox DemoBrand |
| **E** | Plugins / Product Hub généralisés (`@creezio/product-hub`) |
| **F** | Propagation kit → apps marques |
| **G** | Branchement runtime Fidu / Certivan / TF2 |

## Contraintes respectées

1. Aucune modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`, ni push `creezio/tempoflow2`
2. Client+Serveur = modèle standard
3. Zéro skip platform listé B.2 : tout porté ou classé vertical avec justification
