# packages/nav — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs nav` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/admin-entry.ts`](../src/admin-entry.ts) | Entrée catalogue `os.admin.nav` (`/admin/nav`, group admin) via `registerOsNavEntry`. Câblé en prod (auto-register kernel). |
| [`src/index.ts`](../src/index.ts) | Surface publique `@creezio/nav` : migrations, mount, store, map, entrée admin. |
| [`src/map.ts`](../src/map.ts) | `brandNavItemsToCatalog` — projette les items métier (`collectNavItems`) vers `NavCatalogEntry` (source `module`). |
| [`src/migrations.ts`](../src/migrations.ts) | `navMigrations()` — table `nav_overrides` en brand.db. Câblé en prod (createBrandKernel). |
| [`src/mount.ts`](../src/mount.ts) | `createNavMount` → `/api/v1/modules/nav/*` (GET session, GET catalog / PUT overrides admin). Câblé en prod. |
| [`src/store.ts`](../src/store.ts) | CRUD overrides (`list` / `upsert` partiel / `reorder` / `delete`). Jamais le catalogue entier. |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/index.ts`](../ui/index.ts) | Export `NavAdminClient` + re-export `NavCatalogLoader` (`@creezio/shell-ui/ui`). |
| [`ui/nav-admin-client.tsx`](../ui/nav-admin-client.tsx) | Écran admin masquer / réordonner / renommer (primitives kit, pas de DnD). Wrapper os-ui `/admin/nav`. |
