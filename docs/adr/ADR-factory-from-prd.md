# ADR — Factory `new-app --from-prd`

**Statut** : accepté — implémenté  
**Date** : 2026-08-01  
**Lié** : `ADR-no-brand-domain-in-native-packages.md`, expérience `docs/experiences/tempoflow3/`

## Contexte

Le brief produit non technique (restaurateurs / fournisseurs / panier / commandes)
ne pouvait pas produire une app : la factory ne gérait que des flags techniques
et un squelette OS sans métier.

## Décision

1. **`creezio new-app --from-prd <prd.md>`** parse un brief → `ProductModel`
   (entities, pages, flows, platformNeeds) puis scaffold une app marque.
2. **Les générateurs** (`packages/factory/src/generators/*`) sont **génériques**
   (CRUD + wiring OS depuis le modèle). Pas de dossier
   `templates/chr` contenant un clone TempoFlow (API/SPA/oracle).
3. **Le code métier généré** (SQL brand, API, pages, nav) est écrit **dans le
   repo / dossier marque**, jamais dans `@creezio/platform-core` ni autre package
   natif (ADR no-brand-domain).
4. Les ids réservés (`tempoflow`, `certivan`, `fidu`) sont suffixés (`tempoflow3`)
   pour les sandboxes issues d’un PRD.
5. Pour un PRD « fournisseurs / prix / panier / commandes », le parseur n’émet
   que le **cœur achats** (5 entités). Les modules bonus (optimiser, scan…)
   sont ajoutés **par l’agent** via mini-PRDs — c’est ce qui prouve que creezio
   + sa doc suffisent, sans triche par template produit.
6. Le scaffold branche l’**OS natif** : `brand-migrations` + `bootBrandKernel`
   (`createSqliteRuntime` + `createApiKernel` + mounts SQL). Les smokes
   utilisent `brand-kernel-harness.mjs` (même stack, sans Electron). Un serveur
   JSON fichier n’est **pas** le chemin nominal.
7. Recherche : générer `meili-feed.ts` (`BrandMeiliFeed`, UIDs `catalog_*`) +
   mount `/api/v1/modules/search` (Meili si `MEILI_HOST`, sinon SQL). Pas de
   `tf2_*` dans le feed marque.

## Conséquences

- Un agent peut bootstrapper avec `PROMPT-PRODUIT.md` + `--from-prd`, puis
  enrichir module par module.
- Versionner un monolithe TempoFlow sous `templates/` invalide l’expérience.
- DemoBrand reste la sandbox OS « notes » ; TempoFlow3 = sonde from-scratch.
