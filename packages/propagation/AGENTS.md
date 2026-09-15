# AGENTS.md — @creezio/propagation

## Mission

Maintenir les contrats de propagation kit -> marques et terrain -> kit : semver, impact, canaux PR, registre org plugins, extension points, release notes et inventaire.

## Ne pas faire

- Ne pas ecrire dans les repos marques depuis ce package.
- Ne pas ouvrir, merger ou modifier des PRs.
- Ne pas promouvoir automatiquement un plugin en vertical ou kit.
- Ne pas changer l'ordre des gates production sans decision explicite.
- Ne pas traiter les hints npm comme publication reelle tant que le registry prive est hors scope.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs propagation` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/index.ts` : barrel public.
- `src/semver-policy.ts` : Conventional Commits -> bump.
- `src/packages.ts` : catalogue packages et graphe de dependances.
- `src/brand-surfaces.ts` : mapping package -> surfaces marque.
- `src/impact.ts` : rapport d'impact.
- `src/channels.ts` : canaux et payloads PR.
- `src/org-plugin-registry.ts` : registre memoire L3.
- `src/org-plugin-registry-file.ts` : registre JSON persiste.
- `src/extension-points.ts` : bus in-process et chaines propagation.
- `src/release-notes.ts` : changelog.
- `src/kit-inventory.ts` : versions locales.

## Modifier sans casser

- Quand un package `@creezio/*` est ajoute, mettre a jour `CreezioPackageName`, `KIT_PACKAGES` et `PACKAGE_SURFACE_MAP`.
- Garder les mappings d'impact conservateurs : mieux vaut signaler une surface en trop qu'en oublier une.
- Les gates G1/G2/G3 doivent rester lisibles dans `impactForPackageBump`.
- Les APIs registre doivent rester synchrones et simples pour console/dry-run.
- Les extension points doivent conserver leurs ids stables.

## Config brand

Les canaux marque sont DATA-DRIVEN (`configureBrandChannels`, H7) — `brandId`
est un id libre (P3.b), plus le registre kit `BrandId` (H11 : sandbox
`demobrand` seulement). Gates G1–G3 = `ProductionBrandGate` local
(`ImpactBrandId`), pas le registre brand-config. Canaux
legacy par defaut (repos marque, hors kit) :

- `brand-pr-certivan` -> G1
- `brand-pr-fidu` -> G2
- `brand-pr-tempoflow` -> G3
- `brand-pr-demobrand` -> sandbox

**Execution reelle (P3.b)** : `buildAllBrandPrPayloads` est branche sur le
workflow kit `.github/workflows/propagate.yml` (via
`scripts/propagate-brands.mjs` + config `.github/propagate-brands.json`) —
apres chaque Publish release, une PR de bump `@creezio/*` est ouverte chez
chaque marque configuree avec le rapport d'impact en corps. Une marque avec
canal configure est servie des que le bump impacte au moins une marque.

Le registre org stocke `brandId`, `orgId`, `createdByUserId`, `visibility`, `deployedAt` et version plugin.

## Tests/gates

Avant validation :

```bash
npm run typecheck -w @creezio/propagation
npm run build -w @creezio/propagation
```

Scenarios importants :

- `bumpKindFromCommits` choisit le bump maximum ;
- `impactForPackageBump` retourne dependants, surfaces, marques et gates attendus ;
- `buildAllBrandPrPayloads` sert marques impactees + canaux configures, et retourne [] si le bump n'impacte aucune marque ;
- `createFileOrgPluginRegistry` flush apres mutation ;
- `createExtensionHookBus` conserve l'historique borne.

## Fichiers sensibles

- `src/packages.ts` : source de verite packages.
- `src/brand-surfaces.ts` : blast radius marque.
- `src/impact.ts` : checklists gates.
- `src/channels.ts` : payload PR.
- `src/org-plugin-registry-file.ts` : format JSON persiste.

## Liens

- `README.md`
- `docs/FILES.md`
- `docs/PROPAGATION.md`
- `docs/archive/PHASE-F.md`
