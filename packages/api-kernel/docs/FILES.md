# packages/api-kernel — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs api-kernel` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/db-scope.ts`](../src/db-scope.ts) | Accès DB scopé par couche (H2.2) — deny-by-default cross-layer write. Un mount module (brand) ou plugin ne reçoit qu'un handle sur sa couche. Platform → couche core. Toute tentative d'écriture core depuis brand/plugin → CrossLayerWriteDeniedError. |
| [`src/entity-mount.ts`](../src/entity-mount.ts) | Moteur CRUD déclaratif : `createEntityApiMount(spec)` génère un `ApiMount` complet depuis un `EntitySpec` (colonnes, enums, recherche, archivage, hooks métier, extraRoutes) + ops CRUD auto (`operationsFromEntitySpec`) ; `registerEntityMounts` pour un lot. Liste : Meili d'abord si `configureEntityMeili` (q vide OK), SQL = fallback visible ou hydratation `?ids=`. Gates `test-phase-api-entity-mount` + `test-phase-meili-browse`. |
| [`src/hono.ts`](../src/hono.ts) | Adaptateur Hono officiel — délègue les espaces façade au kernel. Usage typique (app marque avec `.basePath("/api/v1")`) |
| [`src/index.ts`](../src/index.ts) | @creezio/api-kernel — façade HTTP unique (Phase H1.1 / isolation H2 / P17). |
| [`src/kernel.ts`](../src/kernel.ts) | Façade API Creezio — registre + routes cœur + deny-by-default cross-write. H2 : ScopedDbAccess injecté quand `sqliteRuntime` est fourni. P17 : espaces core / platform / modules / plugins. `listMounts()` expose `operations` ; `listOperations()` aplatit id mount + op. |
| [`src/meili-browse.ts`](../src/meili-browse.ts) | Browse paginé Meili (`q` vide OK) + `configureEntityMeili` / `configureEntityMeiliFromFeed`. `null` = KO / index vide / filtre rejeté → SQL. Interdit pour le browse : `searchMeiliIndexes`. |
| [`src/operations.ts`](../src/operations.ts) | SoT opérations de module — matching, chemins HTTP, collecte catalogue (`collectKernelOperationRoutes` / `collectListedOperationRoutes`). |
| [`src/register.ts`](../src/register.ts) | Helpers DX — enregistrement batch de mounts + factory marque documentée. Pattern recommandé (Electron + Next, une seule SoT) |
| [`src/types.ts`](../src/types.ts) | Contrats HTTP façade Creezio — indépendants d'Express/Fastify/Next. |
