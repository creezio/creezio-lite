# AGENTS — @creezio/nav

## Mission

Maintenir le module natif hybride « nav catalog » : persist des overrides
sidebar en `brand.db`, mount `/api/v1/modules/nav`, écran admin. Le merge
pur et les types (`NavCatalogEntry`, `resolveNavCatalog`, registre OS)
restent dans `@creezio/shell-ui` (NAV-1).

## Décision owner

**Owner voit tout ce qui est `available` ; `hidden` s'applique quand même.**

- Feature-off (`available === false`) : jamais listé dans `GET /`, même si
  un override force visible.
- Override `hidden: true` : retiré de `GET /` pour **tous** les acteurs,
  y compris l'owner non impersonné. L'admin (`GET /catalog`) continue de
  voir l'entrée pour pouvoir la réafficher.
- L'owner n'est pas filtré par `entry.permission` (comportement
  access-control). Un collaborateur sans la permission de l'entrée ne la
  voit pas dans `GET /`.

Ne pas inverser sans mettre à jour ce fichier **et** la gate
`test-phase-nav-module`.

## Ne pas faire

- Ne pas recopier la matrice access-control ni écrire dans `core.db`.
- Ne pas persister le catalogue entier (dual-write code ↔ rows).
- Ne pas importer `zod`. Imports `@creezio/api-kernel` /
  `@creezio/platform-core` **type-only**.
- Ne pas ajouter de vocabulaire marque (`tempoflow`, `foove`, …).
- Ne pas casser `GET /api/v1/access/*`.
- Ne pas inventer un 3ᵉ `ADMIN_NAV` hardcodé : l'entrée admin est
  `registerOsNavEntry` id `os.admin.nav` **et** `defaultOsAdminNavItems()`.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs nav`.

## Points d'entrée

- `src/index.ts` : surface publique.
- `src/migrations.ts` : `navMigrations()` → table `nav_overrides`.
- `src/store.ts` : CRUD overrides (upsert partiel, reorder, delete).
- `src/mount.ts` : `createNavMount` → `/api/v1/modules/nav/*`.
- `src/admin-entry.ts` : `registerOsNavAdminEntry` (`os.admin.nav`).
- `src/map.ts` : `brandNavItemsToCatalog` (métier → catalogue).
- `ui/nav-admin-client.tsx` : `NavAdminClient`.
- `ui/index.ts` : re-export `<NavCatalogLoader />` depuis
  `@creezio/shell-ui/ui` (le chrome factory n'importe **pas** `@creezio/nav`
  tant que le package n'est pas publié).

## Câblage (prod)

Auto-register dans `@creezio/app-runtime` `create-brand-kernel` (appelé
par `startBrandDesktop` / harness) :

- compose `navMigrations()` dans les migrations brand ;
- `api.registerModuleApi("nav", createNavMount(…))` si la marque n'a pas
  déjà monté `nav` (Foove owned-by-brand gagne jusqu'à Phase C).

## Modifier sans casser

- `GET /` doit rester `{ items: [{ id, href, label, order, group?, permission?, icon }] }`
  (contrat chrome / futur loader NAV-3).
- Permission admin = `platform.access.manage` (déjà access-control).
- Icône = **nom lucide** (`icon: string`), jamais un composant React
  dans le mount Node.

## Tests/gates

```bash
npm run build -w @creezio/nav
node --test scripts/test-phase-nav-module.mjs
```

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- Plan : `../../docs/plans/PLAN-NAV-CATALOG.md`
- Brief NAV-2 : `../../docs/agents/BRIEFS-NAV-GRANOLA-GROKBOT.md`
