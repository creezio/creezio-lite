# Phase F — Propagation (livré)

## Objectif

Mettre en place, **dans le kit + console uniquement**, le contrat de
propagation des évolutions (Notion architecture §3 descente / §4 remontée) :

1. Semver + policy de bump `@creezio/*`
2. Canaux « kit bump → PR automatisable par marque »
3. Registre plugins org (contrat L3) + hooks console versions
4. Points d'extension descente / remontée
5. Console enrichie (versions kit + liens gates G1/G2/G3)
6. Runbooks + checklists de bascule (prêtes, **non exécutées**)
7. Script dry-run d'impact (`kit:impact`)

**Phase F ≠ bascule des apps** — la bascule runtime est **Phase G**
(G1 Certivan d'abord, gated).

## Livrables

| Item | Emplacement |
|------|-------------|
| Package propagation | `@creezio/propagation` |
| Semver + release notes | `semver-policy.ts`, `release-notes.ts`, `CHANGELOG.md` |
| CLI bump | `scripts/kit-version.mjs` → `npm run kit:version` |
| Dry-run impacts | `scripts/propagation-impact.mjs` → `npm run kit:impact` |
| Canaux + templates PR | `channels.ts`, `.github/PULL_REQUEST_TEMPLATE/kit-bump.md` |
| Registre L3 | `org-plugin-registry.ts` |
| Extension points | `extension-points.ts` (`DOWNWARD_CHAIN` / `UPWARD_CHAIN`) |
| Console | `apps/console` — panel versions + gates ; `GET /api/kit-versions` |
| Runbook | [PROPAGATION.md](PROPAGATION.md) |
| Gates (docs seules) | [G1](gates/G1-CERTIVAN.md) [G2](gates/G2-FIDU.md) [G3](gates/G3-TEMPOFLOW.md) |
| Tests | `scripts/test-phase-f.mjs` |

## Package `@creezio/propagation`

```ts
import {
  impactForPackageBump,
  formatImpactReport,
  buildAllBrandPrPayloads,
  collectKitInventory,
  createMemoryOrgPluginRegistry,
  createExtensionHookBus,
  PHASE_G_GATES,
} from "@creezio/propagation";

const impact = impactForPackageBump({
  packageName: "@creezio/platform-core",
  bumpKind: "minor",
});
console.log(formatImpactReport(impact));
// rebuild: @creezio/electron-shell
// marques: certivan, fidu, tempoflow
// gates: G1, G2, G3
```

### Inventaire packages

`brand-config`, `shell`, `platform-core`, `product-hub`, `electron-shell`,
`desktop-tooling`, `factory`, `propagation`.

## Console

- Header : versions kit locales + canal `workspace-local`
- Section gates G1→G2→G3 avec liens docs
- Parc desktop Phase C inchangé (feeds / dry-run remote-build)

## Vérification

```bash
cd /opt/docker/creezio
npm install
npm run build
npm test   # inclut scripts/test-phase-f.mjs

npm run kit:impact -- --package=@creezio/platform-core
npm run kit:version -- --package=@creezio/shell --bump=patch   # dry-run
```

Couverture Phase F :

1. Policy semver Conventional Commits
2. Impact `platform-core` → electron-shell + G1/G2/G3
3. Impact `factory` → demobrand seul
4. Canaux PR payload
5. Registre L3 remontée jusqu'à `promoted_kit`
6. Extension hooks descente + remontée
7. Inventaire versions locales
8. Docs gates + PROPAGATION + template PR présents
9. CLI dry-run verts
10. Console page / API kit-versions

## Contraintes respectées

1. **Aucune** modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`,
   ni tempoflow2
2. Push uniquement `creezio/creezio`
3. Pas d'exécution des gates G1–G3
4. Client+Serveur = modèle standard inchangé

## Hors scope Phase F

- Branchement runtime apps → **Phase G**
- Publish npm registry `@creezio/*`
- Automation GitHub Actions dans les repos marques
- Persistance SQLite registre org en prod

## Suite — Phase G (bascule gated)

Ordre obligatoire :

1. **G1 Certivan** — [docs/gates/G1-CERTIVAN.md](gates/G1-CERTIVAN.md)
2. **G2 Fidu** — [docs/gates/G2-FIDU.md](gates/G2-FIDU.md)
3. **G3 TempoFlow** — [docs/gates/G3-TEMPOFLOW.md](gates/G3-TEMPOFLOW.md)

Chaque gate : bump deps kit → remplacement modules dupliqués → build + smoke
Client+Serveur → validation feed → seulement alors coupure progressive du
runtime legacy.
