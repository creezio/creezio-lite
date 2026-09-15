# Gate G2 — Fidu (Phase G)

> **Statut** : **sign-off G2** (2026-07-29) — Fidu **0.1.52** publié (Client+Serveur).
> Consomme `@creezio/*` via `vendor/creezio` (sync depuis kit). GUIDs / feeds OK.
> Ordre : **G1 Certivan → G2 Fidu → G3 TempoFlow**.

## Cible

| Champ | Valeur |
|-------|--------|
| Marque | Fidu |
| Repo / chemin | `/opt/docker/fidu` (`crm/`) |
| Manifest kit | `fiduManifest` (`@creezio/brand-config`) |
| envPrefix | `FIDU` |
| Client+Serveur | oui (`buildServerArtifact: true`) |
| Version app (G2) | `0.1.52` (après publish) |
| userData client | `Fidu` (continuité `%APPDATA%/Fidu`) |
| clientSlim | **false** (pas encore host-stack lazy — stack locale dans les 2 exe) |

## Prérequis

- [x] G1 Certivan sign-off
- [x] Kit Phase F/G + dual CJS + `clientSlim` option + `fiduManifest` dual
- [x] Pipeline ship Fidu respectée (`fidu-desktop-ship-pipeline`) **après** verts

## Checklist bascule (Phase G)

### 1. Dépendances

- [x] Ajouter dans `crm/package.json` les 6 packages `@creezio/*`
- [x] Vendor `crm/vendor/creezio/*` + `sync-creezio-vendor.sh`
- [x] Scripts npm → wrappers `desktop-tooling`
- [x] Commit : `chore(deps): consume @creezio/* — kit creezio [fidu] (0.1.52)` (`538aa6a`)

### 2. Remplacements code

- [x] Manifest / builder → `buildElectronBuilderConfig` + `fiduManifest` (`clientSlim: false`)
- [x] Preload → `exposeDesktopApi` / `FIDU_BRIDGE_NAME` (`window.fiduDesktop`)
- [x] Boot → `applyFiduDesktopBoot` (avant `requestSingleInstanceLock`)
- [x] app-kind / profile façades kit
- [x] Dual `electron:build:win` + `electron:build:win:server`
- [x] **Vertical conservé** : GED, seeds cabinet, Pennylane, UI CRM (Paperclip **retiré** — M12p)
- [x] **Pas de purge** catalogue TF orphelin
- [x] Product Hub store + ACL L3 (I18) — HTTP control-plane **N/A** GED ; tokens `fiduProductHubTokens`

### 3. Validation Client + Serveur

- [x] `npm run build` + `npm run electron:compile`
- [x] `npm run test:app-kind` + `npm run test:shell`
- [x] `npm run test:fidu` (GED, dépôt, Meili, Pennylane, users, …)
- [x] Feeds live OK :
  - Client : `https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/latest.yml` → **0.1.52**
  - Serveur : `…/server/latest.yml` → **0.1.52** (première publication)
- [x] `remote-build-win.sh --publish` vert (Client + Serveur)

### 4. Coupure legacy

- [x] Runtime legacy encore dispo (façades + `clientSlim: false`)
- [x] Publish après verts uniquement
- [x] Sign-off G2 — **G3 TempoFlow peut être ouvert** (accord parent / ops)

### 5. Sign-off G2

- [x] Feeds Client + Serveur Fidu OK (GUID client inchangé `f124e69d-…`)
- [x] Exe publiés 0.1.52
  - Client SHA256 `823e2497ca7b897cea7f367e54a5f404cb68708dc5398433a1a4a7a20571b819`
  - Serveur SHA256 `800f0894b58d3d8ea02fb119e03319ed090dc175ce18cd5b7a99a596b7356f0d`
- [x] Kit SHA `45c811e` ; Fidu SHA `538aa6a`

## Interdits pendant G2

- ❌ Skip G1
- ❌ Publish sans tests verts
- ❌ Modifier tempoflow2 / certivan pendant G2 sauf hotfix hors kit
- ❌ Purger métier cabinet / catalogue TF orphelin « pour nettoyer »

## Références

- [PROPAGATION.md](../PROPAGATION.md)
- [PHASE-C.md](../PHASE-C.md)
- Pipeline : `crm/docs/REMOTE-BUILD.md` (repo fidu)
