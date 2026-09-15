# @creezio/nav

Module natif hybride du **catalogue de navigation** (sidebar) : overrides
persistés en `brand.db`, mount `/api/v1/modules/nav`, écran admin pour
masquer / réordonner / renommer. Les types catalogue (`NavCatalogEntry`,
`resolveNavCatalog`) vivent dans `@creezio/shell-ui` (NAV-1) — ce package
les consomme, il ne les duplique pas.

**Câblé en prod** : `startBrandDesktop` / harness (`@creezio/app-runtime`)
auto-enregistre les migrations + le mount `nav` (chrome OS). L'écran
`/admin/nav` est un wrapper `@creezio/os-ui`.

## API

`api.registerModuleApi("nav", createNavMount(opts))` → `/api/v1/modules/nav/*`

| Route | Auth | Rôle |
|---|---|---|
| `GET /` | session | Catalogue résolu `{ items: [{ id, href, label, order, group?, permission?, icon }] }` |
| `GET /catalog` | `platform.access.manage` | Catalogue brut + overrides |
| `PUT /overrides` | `platform.access.manage` | Upsert partiel `{ entryId, hidden?, order?, label?, … }` |
| `PUT /overrides/reorder` | `platform.access.manage` | `{ ids: string[] }` |
| `DELETE /overrides/:entryId` | `platform.access.manage` | Retour défaut |

`createNavMount({ collectModuleEntries, features, osEntries })` —
`osEntries` défaut = `listOsNavEntries()` (seed `defaultOsCatalogEntries()`).

## Store

Table `nav_overrides` dans **`brand.db`** (jamais `core.db`). Le catalogue
entier n'est **pas** persisté — seulement les overrides admin.

## Owner

L'owner voit tout ce qui est `available`. Un override `hidden` s'applique
**quand même** (y compris pour l'owner). Feature-off (`available === false`)
gagne toujours.

## UI

```tsx
import { NavAdminClient } from "@creezio/nav/ui";
```

Primitives kit uniquement. Réorder = boutons haut/bas + champ `order`.

## Build

```bash
npm run build -w @creezio/nav
npm run typecheck -w @creezio/nav
```

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- Plan : `docs/plans/PLAN-NAV-CATALOG.md` (Phase B)
- ADR : `docs/adr/ADR-module-natif-hybride.md`


## Profil Creezio Lite / Sites

createNavMount accepte persistence pour un dépôt asynchrone. Sans ce paramètre, le store SQLite existant reste le défaut.
