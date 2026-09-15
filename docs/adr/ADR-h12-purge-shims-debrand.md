# ADR — H12 : purge des shims electron-shell + dé-brandage workspace

Statut : accepté. Bump `ARCHITECTURE_VERSION` H11 → **H12**
(`packages/platform-core/src/architecture-version.ts`) — codemods
`scripts/codemods/H12/`. Changeset **minor** (convention 0.x du kit :
H10 et H11 sont parties en minor, pas en major).

## Contexte

P1.b (0.11.x) a extrait le host Node pur vers `@creezio/host-runtime` et
le sous-domaine Meili vers `@creezio/search`, en laissant
`@creezio/electron-shell` **ré-exporter** toute la surface historique
(`@deprecated`, snapshot `scripts/electron-shell-frozen-exports.json`).
Cette surface gelée n'avait plus d'autre rôle que de protéger des
imports de compat : tout nouveau symbole host s'exporte déjà depuis son
package SoT.

En parallèle, le module workspace de `@creezio/shell-ui` exportait encore
du domaine métier en dur (`TF_LEGACY_PANIER_PATH` / `TF_LEGACY_OPTIMISER_PATH`,
`PANIER_PATH` / `OPTIMISER_PATH`, `fournisseurIdFromHref` /
`createSupplierTab` / `isOptimiserCanvasHref`…). Violation de la
frontière n°1 (ADR-no-brand-domain-in-native-packages), ratchetée dans
`scripts/no-brand-vocab-allowlist.json` au lieu d'être éliminée.

## Décision

Un seul bump d'architecture, deux purges simultanées — **sans** alias
de compat, **sans** nouveau fichier de compat, **sans** kill-switch env.

### A. electron-shell — shims P1.b retirés

1. Le barrel `packages/electron-shell/src/index.ts` n'exporte plus que
   le desktop natif. Les ~450 ré-exports `@deprecated` vers
   host-runtime / search / platform-core sont **supprimés**.
2. Le subpath `@creezio/electron-shell/meili` (`src/meili.ts` + export
   `package.json`) est **supprimé**. SoT = `@creezio/search`.
3. Les alias host nommés marque dans `@creezio/host-runtime` sont
   **supprimés** : `ensureTempoflowNode` → `ensureDesktopNode`,
   `resolveTempoflowNodeBinary` → `resolveDesktopNodeBinary`,
   `TF2_NODE_PIN` / `TF2_NODE_MIN_FOR_EMBEDS` / `TF2_NPM_PIN` →
   `DESKTOP_*`, `tempoflowSandboxPaths` → `desktopSandboxPaths`.
   `nodeEnsure` n'accepte plus que `"desktop"`.
4. La gate `test-phase-electron-shell-frozen-exports` et son snapshot
   sont **retirés** : plus rien n'est gelé — le barrel n'a plus de
   surface de compat à protéger. Un nouveau symbole host s'exporte
   depuis son package SoT, jamais via electron-shell.

Les imports internes du kit (app-runtime, factory) passent par les
packages SoT.

### B. shell-ui — workspace neutre

1. `configureFullscreenPaths({ panierPath, optimiserPath })` devient
   `configureWorkspacePaths({ fullscreenPaths, canvases })` :
   préfixes plein écran + canvas conditionnels (`path` +
   `requiredQuery` optionnel).
2. `isOptimiserCanvasHref` → `isCanvasHref`.
3. Alias métier du workspace **supprimés** (plus de miroir
   `supplier` / `fournisseurId`) : `SupplierTabMeta`,
   `createSupplierTab`, `isSupplierHref`, `fournisseurIdFromHref`,
   `supplierHref`, `openSupplierSite`, `patchSupplierTab`,
   `OpenSupplierSiteOpts`.
4. `PANIER_PATH` / `OPTIMISER_PATH` / `TF_LEGACY_*` ne sont plus
   exportés par le kit. La marque pose ses propres constantes et
   appelle `configureWorkspacePaths`.

L'allowlist `no-brand-vocab` n'a plus **aucune** entrée
`shell-ui/ui/workspace/*` (ratchet décroissant uniquement).

## Migration marque

Deux scripts, ordre du `manifest.json` (`since: 0.24.0`) :

1. `h12-electron-shell-imports.mjs` — reclasse les imports
   `@creezio/electron-shell` (barrel + `./meili`) vers
   host-runtime / search / platform-core ; renomme les alias host
   nommés marque ; `nodeEnsure: "tempoflow"` → `"desktop"`.
2. `h12-workspace-debrand.mjs` — renommages workspace +
   `configureFullscreenPaths` → `configureWorkspacePaths` (un canvas
   hérite du query param historique `commande` pour rester
   iso-comportement) ; les constantes `PANIER_PATH` / `OPTIMISER_PATH`
   deviennent des constantes de marque (valeurs lues dans l'ancien
   appel littéral). Fail-closed si les valeurs ne sont pas des
   littéraux.

Idempotents, appliqués par `creezio upgrade`.

## Comportements inchangés

Meili reste fail-closed. Le desktop (`installBrandDesktopRuntime`,
splash, tray, updater, browser-tabs) ne change pas de contrat. Les
URLs métier (`/panier`, `/optimiser`, `/site/<id>`) restent celles
que la marque configure — le kit n'en impose plus.
