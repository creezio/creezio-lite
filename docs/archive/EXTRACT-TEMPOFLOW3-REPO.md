# Extract `apps/tempoflow3` → `creezio/tempoflow3`

> Dépendances kit P1 : **mergées** (#26–#29).  
> Repo cible : https://github.com/creezio/tempoflow3 @ **`2c59fb8`** (import app `044002a` + vendor)  
> Source freeze : tag `archive/tf3-probe-65b9273` (`65b9273`).  
> Vendor pin : `kitSha=60ce0f5` (creezio `main` post PR #31 ; sync TF3 aligné).

## Statut P2.1 — DONE (2026-08-02)

| Critère | Preuve |
|---------|--------|
| 113 fichiers app importés | `SOURCE.json` + sha256-identical vs tag |
| Docs expérience tip | `docs/experiences/tempoflow3/**` dans le repo TF3 |
| Vendor `@creezio/*` | `npm run electron:sync-vendor` → `vendor/creezio` (+ brand-spec, app-runtime) |
| Smoke | `typecheck` / `build:electron` / `build:ui` **PASS** — voir `docs/SMOKE-IMPORT.md` (TF3) |
| Push `main` | app `044002a` ; vendor sync `2c59fb8` (`kitSha=60ce0f5`) |
| Clone local | `/opt/docker/tempoflow3` |
| Branche `cursor/tempoflow3-create-457d` | **gardée** (tag archive) |
| PR #25 | fermée « app extracted » |
| PR #31 kit gates | **mergée** — OS gates + demobrand sur creezio `main` @ `27430d2` |

## Étapes (réalisées)

1. Worktree / archive lecture seule sur le tag (pas de merge #25).
2. Export :
   ```bash
   git archive archive/tf3-probe-65b9273 apps/tempoflow3 | tar -x -C /tmp/tf3-export
   # contenu → racine creezio/tempoflow3
   ```
3. `npm run build:packages` côté kit ; sync vendor TF3 (`scripts/sync-creezio-vendor.sh` marque) ; kit sync accepte packages ESM-only (pas de `dist-cjs`).
4. CI Linux / proofs complets : **pas encore verts** (half-state — allowlist/meili/harness) ; build tsc+Next OK.
5. **Ne pas** modifier tempoflow2 gold (pas de resync TF2 requis pour ce sync ESM-only).
6. PR #25 fermée superseded-by-extract ; tag archive conservé.

## Reste tip — checklist « remaining on tag only » (post P3 kit gates)

Freeze : `archive/tf3-probe-65b9273`. Branche `cursor/tempoflow3-create-457d` **gardée**.

| Zone tip (vs `main` au moment de l’extract) | Destination | Statut |
|---------------------------------------------|-------------|--------|
| `apps/tempoflow3/**` (113) | repo `tempoflow3` | **DONE** @ `044002a` |
| Docs expérience tip-only + HANDOFF | repo `tempoflow3` `docs/` | **DONE** (volontairement absents du kit `main`) |
| `scripts/test-os-*.mjs` + `lib/resolve-probe-brand.mjs` | creezio `main` (PR extract/os-gates) | **PORTÉ** — chemins TF3 → `CREEZIO_TEMPOFLOW3_ROOT` / sibling |
| `scripts/test-phase-create-brand.mjs` + wire `npm test` | creezio `main` | **PORTÉ** |
| `scripts/reset-tempoflow3.mjs` | creezio kit (résout probe externe) | **PORTÉ** |
| Tweaks `apps/demobrand` (`startBrandDesktop`) | creezio `main` | **PORTÉ** |
| `brand-config` `ensureKitOsVendorExtraResources` | creezio `main` | **PORTÉ** |
| `.gitignore` bins kit + `ARCHITECTURE-INTENTION` façade | creezio `main` | **PORTÉ** |
| Gates `test-phase-d` / `h2` / `meili-feed` asserts tip | creezio `main` | **PORTÉ** (sans régresser gates sandbox P1) |
| Diffs tip packages P1 déjà mergés | — | SoT = `main` ; tip = historique |
| Docs expérience **divergées** tip vs #23 sur kit | TF3 repo / #23 | **Justifié tip-only côté kit** (SoT expérience = TF3 + protocole #23) |

### Résiduel justifié encore « seulement sur tag » (kit)

Aucun fichier **kit légitime** attendu uniquement sur le tag après merge de `extract/os-gates-demobrand`.  
Résiduels tip-only restants = **docs expérience** déjà dans `creezio/tempoflow3` (pas à réintroduire dans le monorepo kit) + historique packages P1 divergés (SoT main).

## Hors scope immédiat

- Windows shippable
- Remplacement TF2
- Delete branches `cursor/*` mortes (P3, après sign-off) — **ne pas** delete `cursor/tempoflow3-create-457d` avant relecture OK
