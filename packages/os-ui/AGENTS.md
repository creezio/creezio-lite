# AGENTS — @creezio/os-ui

## Mission

Maintenir les pages Next OS (non métier) matérialisées dans les marques :
wrappers minces sur les UI des packages plateforme, boot client
(`CreezioUiBoot`), script de matérialisation.

## Ne pas faire

- Pas de métier marque ni de vocabulaire marque dans `routes/`.
- Pas de logique applicative dans les pages : un wrapper importe
  `@creezio/<pkg>/ui` et rend — la logique se corrige dans le package source.
- Ne pas retirer un segment de `OS_UI_ROUTE_SEGMENTS` sans vérifier les gates
  kit et les marques (le segment redeviendrait « autorisé » côté marque).
- Ne pas faire dépendre `materialize.mjs` de node_modules (script autonome).

## Points d'entrée

- `src/index.ts` : `OS_UI_ROUTE_SEGMENTS`, `OS_PRIMARY_NAV_SEGMENTS`,
  `OS_UI_HORS_NAV_JUSTIFICATIONS`, `OS_UI_ROUTE_GROUP`, exports.
- `src/boot.tsx` : `CreezioUiBoot` (configureShellUiBrand + `InteractiveDemoRoot`
  natif — une app sans démo est invalide ; le chrome marque ne peut pas l'oublier).
- `scripts/materialize.mjs` : copie `routes/` → `ui/app/(creezio-os)/`.
- `routes/<segment>/page.tsx` : une page OS = un wrapper.

## Modifier sans casser

- Nouvelle page OS : ajouter le wrapper dans `routes/`, le segment dans
  `OS_UI_ROUTE_SEGMENTS`, **et** une entrée `registerOsNavEntry` **ou**
  une `horsNavJustification` (gate `test-phase-os-nav-catalog`), puis
  rematérialiser dans les marques.
- Changement de contrat d'une UI plateforme : corriger le package source,
  puis vérifier que le wrapper compile dans une marque (`npm test` marque).

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
