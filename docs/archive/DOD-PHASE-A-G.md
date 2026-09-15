# DoD global Creezio — Phases A → G

> Clôture **2026-07-29** après sign-off **G3 TempoFlow**.  
> Kit = source de vérité plateforme ; marques = vertical + consommation `@creezio/*`.

## Synthèse

| Phase | Livrable | Statut |
|-------|----------|--------|
| **A** | Contrats `AppManifest`, bridges, env brand-agnostic | ✅ |
| **B / B.2** | Runtime plateforme (boot, paths, profile, host embeds) | ✅ |
| **C** | Desktop tooling (publish, remote-build, after-pack, feeds) | ✅ |
| **D** | Factory + demobrand | ✅ |
| **E** | Product Hub / ACL L3–L4 (contrats + tokens) | ✅ |
| **F** | Propagation (semver, impact, console, gates docs) | ✅ |
| **G** | Bascule marques G1→G2→G3 | ✅ **terminé** |

## Kit

| Item | Valeur |
|------|--------|
| Repo | `creezio/creezio` → `/opt/docker/creezio` |
| Packages | `brand-config`, `shell`, `platform-core`, `product-hub`, `electron-shell`, `desktop-tooling`, `factory`, `propagation` |
| Console | `apps/console` (parc + versions kit) |
| Dual CJS | `dist` + `dist-cjs` pour Electron CommonJS |

## Trois marques sur kit

| Gate | Marque | Version | Bridge | Feeds | SHA Client / Serveur |
|------|-------|---------|--------|-------|----------------------|
| **G1** | Certivan | 0.1.11 | `certivanDesktop` | certivan.creez.io/dl-3c94d486… | voir [G1](gates/G1-CERTIVAN.md) |
| **G2** | Fidu | 0.1.52 | `fiduDesktop` | fidu.creez.io/dl-e660352f… | `823e2497…` / `800f0894…` |
| **G3** | TempoFlow | **0.10.27** | `tempoflowDesktop` | crm.tempoflow.fr/dl-e660352f… | `4154e0f6…` / `25abd61b…` |

### TempoFlow 0.10.27 (G3)

- Client : https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/TempoFlow-Setup-0.10.27.exe  
  SHA256 `4154e0f648397bb636a30bf2046c88fb630c22c89bca19f533d4b06cb447c701`
- Serveur : https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/server/TempoFlow-Server-Setup-0.10.27.exe  
  SHA256 `25abd61b478e79d1d57c8b15d58373c09895619783e791602b97b98213800ea7`
- GUID NSIS inchangés : `b0d127b0-…` / `1eada1b2-…`
- Stratégie : `vendor/creezio/*` + façades (`brand`, `creezio-boot`, `app-kind`, `profile`, preload kit)
- Vertical catalogue **non déplacé** (optimiser, panier, dispatch, catalog-sync, scan, marketplaces…)

## Console / factory

- Console ops : inventaire versions + liens gates + parc feeds
- Factory / demobrand : sandbox kit (Phase D)

## Hors scope / dettes assumées

- Product Hub control-plane runtime encore partiellement local (tokens kit prêts)
- Publish TempoFlow : cible NPM = **VPS TempoFlow** (pas le volume NPM Creezio)
- Fidu `clientSlim: false` (stack locale dans les 2 exe) — volontaire G2

## Verdict parent

**Plan Creezio Phases A→G : TERMINÉ** (G3 OK).
