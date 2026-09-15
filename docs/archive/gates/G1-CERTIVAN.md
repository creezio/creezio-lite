# Gate G1 — Certivan (Phase G)

> **Statut** : **sign-off G1** (2026-07-29) — Certivan **0.1.11** publié (Client+Serveur).
> **Post-H5/H6 (I16)** : republish **0.1.14** (ACL L3 + shell-ui + SqliteRuntime) — feeds OK.
> Consomme `@creezio/*` via `vendor/creezio` (sync depuis kit). GUIDs / feeds OK.
> Ordre : **G1 Certivan → G2 Fidu → G3 TempoFlow**.

## Cible

| Champ | Valeur |
|-------|--------|
| Marque | Certivan |
| Repo / chemin | `/opt/docker/certivan-app` |
| Manifest kit | `certivanManifest` (`@creezio/brand-config`) |
| envPrefix | `CERTIVAN` |
| Client+Serveur | oui (`buildServerArtifact: true`) |
| Version app (G1) | `0.1.11` (après publish) |

## Prérequis kit

- [x] Kit `creezio/creezio` sur `main` avec Phase F livrée (`dcf9427`+)
- [x] Dual build CJS (`dist-cjs/`) pour require() depuis Electron CommonJS
- [x] `npm run kit:impact -- --package=@creezio/brand-config` passé en revue
- [x] Versions `@creezio/*` ciblées : `0.1.0` (file: local workspace)

## Checklist bascule (Phase G)

### 1. Dépendances

- [x] Ajouter dans `crm/package.json` :
  - `@creezio/brand-config`
  - `@creezio/shell`
  - `@creezio/platform-core`
  - `@creezio/product-hub`
  - `@creezio/electron-shell`
  - `@creezio/desktop-tooling`
- [x] `npm install` dans l'app (`file:../../creezio/packages/...`)
- [x] Commit type : `chore(deps): consume @creezio/* — kit creezio [certivan]`

### 2. Remplacements code (cf. PLATFORM-VS-VERTICAL.md)

- [x] Manifest / builder config → `buildElectronBuilderConfig` + `certivanManifest` (+ host-only Certivan incl. `pdf-renderer`)
- [x] Preload bridge → `exposeDesktopApi` / `CERTIVAN_BRIDGE_NAME` (`window.certivanDesktop`)
- [x] Boot partiel → `applyCertivanDesktopBoot` (twin sync de `prepareDesktopBoot`)
- [x] Product Hub tags → `productHubTokensFromManifest` / `pluginN8nTag` kit
- [ ] Control plane plugins → `startHostPluginControlPlane` *(runtime local encore ; tokens kit prêts)*
- [x] Scripts publish → wrappers `@creezio/desktop-tooling`
- [x] Splash modèle → `@creezio/electron-shell` (HTML `tf-*` local — kit `cz-*` non rétrocompat boutons)
- [x] **Garder** vertical : plugin-git, plugin-data, accept-check, test-runner, UI Admin, seeds VASP, migrations 036+

### 3. Validation Client + Serveur

- [x] `npx tsc --noEmit`
- [x] `npm run electron:compile`
- [x] `npm run build`
- [x] `test:shell` (+ dossiers / pièces / RTI / app-kind / splash / plugin-*)
- [x] Feeds live OK (GUID inchangés) :
  - `https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/latest.yml`
  - `…/server/latest.yml`
- [x] Product Hub : comportement inchangé (tests plugin-* verts) ; service live non re-smoke manuel
- [x] ACL L3/L4 fail-closed inchangé (tests cockpit / plugin-acl)

### 4. Coupure legacy

- [x] Runtime legacy encore disponible (façades locales + modules non basculés)
- [x] Feature flag / branche : bascule par import `@creezio/*` (pas de flag runtime)
- [ ] Seulement après verts publish : retirer modules dupliqués devenus morts (`plugin-control-api` HTML splash full, etc.)
- [x] Tag / note release Certivan 0.1.11 — kit `@creezio/*` 0.1.0 (vendor)

### 5. Sign-off G1

- [x] Feeds Certivan + GUIDs OK
- [x] Aucune régression critique RTI / dossiers (tests verts)
- [x] Publish 0.1.11 vert — **G2 Fidu peut être ouvert** (accord parent / ops)

## Interdits pendant G1

- ❌ Modifier le kit pour hardcoder `CERTIVAN_*` (injection manifest uniquement)
- ❌ Lancer G2/G3 avant sign-off G1
- ❌ Publier un exe sans smoke Client+Serveur

## Références

- [PROPAGATION.md](../PROPAGATION.md)
- [PHASE-F.md](../PHASE-F.md)
- [PHASE-E.md](../PHASE-E.md) (Product Hub)
- [PLATFORM-VS-VERTICAL.md](../PLATFORM-VS-VERTICAL.md)
