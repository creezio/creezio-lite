# packages/access-control — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs access-control` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/config.ts`](../src/config.ts) | configureAccessControl + validation (roles, defaultRole, groupes, adaptateurs SoT metier) |
| [`src/hono-routes.ts`](../src/hono-routes.ts) | Routes /api/v1/access/* (matrix, users/:id/role, audit) + garde platform.access.manage |
| [`src/index.ts`](../src/index.ts) | Exports publics du package |
| [`src/resolve.ts`](../src/resolve.ts) | resolvePermissions / resolveUserRole / resolveRoleEffectivePermissions + cache 30 s et invalidation |
| [`src/store.ts`](../src/store.ts) | Tables access_role_overrides / access_user_roles / access_audit_log + CRUD + audit + slot runtime |
| [`src/types.ts`](../src/types.ts) | Types publics (roles, overrides, audit, utilisateur de route) |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/access-admin-client.tsx`](../ui/access-admin-client.tsx) | Ecran Roles & acces (matrice toggles, comptes, journal) |
| [`ui/index.ts`](../ui/index.ts) | Export UI (AccessAdminClient) |
