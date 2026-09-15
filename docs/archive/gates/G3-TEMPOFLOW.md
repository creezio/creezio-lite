# Gate G3 — TempoFlow (Phase G)

> **Statut** : **sign-off G3** (2026-07-29) — TempoFlow **0.10.27** publié (Client+Serveur).
> Consomme `@creezio/*` via `vendor/creezio` (sync depuis kit). GUIDs / feeds OK.
> Ordre : **G1 Certivan → G2 Fidu → G3 TempoFlow** — **Phase G terminée**.

## Cible

| Champ | Valeur |
|-------|--------|
| Marque | TempoFlow |
| Repo | `creezio/tempoflow2` (VPS : `/opt/docker/tempoflow2`) |
| Manifest kit | `tempoflowManifest` (`@creezio/brand-config`) |
| envPrefix | `TF2` |
| bridgeName | `tempoflowDesktop` (**inchangé**) |
| Client+Serveur | oui (`buildServerArtifact: true`, `clientSlim: true`) |
| Version app (G3) | `0.10.27` (après publish) |
| userData client | `tempoflow2-crm` (continuité installs 0.9.x) |

## Prérequis

- [x] G1 + G2 sign-off
- [x] Matrice [PLATFORM-VS-VERTICAL.md](../PLATFORM-VS-VERTICAL.md) revue (vertical catalogue non remonté)
- [x] Vendor `file:vendor/creezio/*` (même stratégie Certivan/Fidu)

## Checklist bascule (Phase G)

### 1. Dépendances

- [x] Ajouter dans `crm/package.json` les 6 packages `@creezio/*`
- [x] Vendor `crm/vendor/creezio/*` + `sync-creezio-vendor.sh`
- [x] Scripts publish / remote-build → wrappers `@creezio/desktop-tooling`
- [x] Commit : `chore(deps): consume @creezio/* — kit creezio [tempoflow] (0.10.27)`

### 2. Remplacements code

- [x] Manifest / builder → `buildElectronBuilderConfig` + `tempoflowManifest` (`clientSlim: true` + host-only)
- [x] Preload → `exposeDesktopApi` / `TEMPOFLOW_BRIDGE_NAME` (`window.tempoflowDesktop`)
- [x] Boot → `applyTempoflowDesktopBoot` (avant `requestSingleInstanceLock`) + profil join/ai vertical
- [x] app-kind / profile façades kit (`--tf2-profile=*` via `envPrefix`)
- [x] **Vertical intact** : catalogue-sync, optimiser, panier, dispatch, supplier-tabs, plugins, fleet, MCP, mails, tâches
- [ ] Product Hub / control plane runtime *(tokens prêts via `tempoflowProductHubTokens`)*

### 3. Validation Client + Serveur

- [x] `npx tsc --noEmit` / `npm run electron:compile`
- [x] `npm run build`
- [x] `test:shell` + `test:app-kind` + `test:panier-sku` + `test:dispatch*` + `test:optimiser-*` (guard/score/graph/filters) + suppliers + email/tasks
- [x] Feeds live OK (GUID inchangés) :
  - Client : `https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/latest.yml` → **0.10.27**
  - Serveur : `…/server/latest.yml` → **0.10.27**
- [x] Build Windows distant OK ; publish feed sur **VPS TempoFlow** NPM (`/data/dl-tempoflow`) — le dossier n’existe pas sur le NPM Creezio

### 4. Coupure legacy

- [x] Runtime legacy encore dispo (façades + modules non basculés)
- [x] Publish après verts uniquement
- [x] Sign-off G3 — **Phase G clôturée** (3 marques sur kit)
- [x] TempoFlow SHA `40b0657` ; kit commit gate G3

### 5. Sign-off G3

- [x] Feeds Client + Serveur TempoFlow OK
  - Client GUID `b0d127b0-d522-5ccc-9432-f74bc07821b9`
  - Serveur GUID `1eada1b2-84e4-5bc4-9615-9317aa380c2b`
- [x] Exe publiés 0.10.27
  - Client SHA256 `4154e0f648397bb636a30bf2046c88fb630c22c89bca19f533d4b06cb447c701`
  - Serveur SHA256 `25abd61b478e79d1d57c8b15d58373c09895619783e791602b97b98213800ea7`
- [x] Liens directs :
  - https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/TempoFlow-Setup-0.10.27.exe
  - https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/server/TempoFlow-Server-Setup-0.10.27.exe

## Notes ops

- **Node** : AGENTS.md TF mentionne 22.22.2 ; VPS Creezio = **22.22.1** (≥ `TF2_NODE_MIN_FOR_EMBEDS` 22.22.0) — OK pour embeds/tests.
- **Publish path** : feed prod = NPM du VPS TempoFlow (`deploy@<vps-build>`), pas `/data/dl-*` du NPM Creezio. `remote-build-win.sh --publish` build OK ; copie feed faite via `docker cp` distant.
- **optimiser-snapshot** (#72) : smoke data-dépendant (catalogue seed) — non bloquant ; logique optimiser/guard/panier/dispatch verts.

## Interdits pendant G3

- ❌ Skip G1/G2
- ❌ Remonter du métier catalogue dans le kit
- ❌ Hardcoder `TEMPOFLOW_` dans `@creezio/*`
- ❌ Publier sans tests verts
- ❌ Modifier GUID / feed token `dl-e660352f…`

## Références

- [PROPAGATION.md](../PROPAGATION.md)
- [PLATFORM-VS-VERTICAL.md](../PLATFORM-VS-VERTICAL.md)
- [DoD A→G](../DOD-PHASE-A-G.md)
