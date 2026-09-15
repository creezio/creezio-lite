# @creezio/os-ui

## Rôle

`@creezio/os-ui` contient les **surfaces Next de l'OS** (pages non métier) :
mails, tâches, setup, login, onboarding, MCP, cockpit/server-cockpit,
paramètres, admin (analytics, database, plugins, request-logs)… Ces pages ne
vivent **pas** dans le repo marque : elles sont **matérialisées** dans l'app
Next de la marque au build, dans le groupe App Router `(creezio-os)`
(gitignoré côté marque).

## Contenu

| Zone | Contenu |
|------|---------|
| `routes/` | Pages Next OS (wrappers minces sur `@creezio/<pkg>/ui`) — dont `/admin/nav` |
| `src/index.ts` | `OS_UI_ROUTE_SEGMENTS`, `OS_PRIMARY_NAV_SEGMENTS`, `OS_UI_HORS_NAV_JUSTIFICATIONS`, `OS_UI_ROUTE_GROUP`, export `CreezioUiBoot` |
| `src/boot.tsx` | `CreezioUiBoot` — boot client OS (identité desktop + tokens shell-ui + `InteractiveDemoRoot` natif) |
| `scripts/materialize.mjs` | CLI `creezio-materialize-os-ui` — copie `routes/` → `ui/app/(creezio-os)/` de la marque |

## Usage côté marque

```bash
# copie les pages OS dans l'app Next de la marque (dossier gitignoré)
creezio-materialize-os-ui --app-root <brandRoot>
# ou : node node_modules/@creezio/os-ui/scripts/materialize.mjs --app-root .
```

Le layout racine de la marque enveloppe l'app avec `CreezioUiBoot`
(import `@creezio/os-ui/boot`) :

```tsx
<CreezioUiBoot desktopApiGlobal="maMarqueDesktop" productName="Ma Marque"
  publicHostSuffix=".mamarque.example">
  {children}
</CreezioUiBoot>
```

## Règles

- La marque ne réécrit **jamais** une page OS : elle rematérialise. Les
  segments `OS_UI_ROUTE_SEGMENTS` sont interdits dans le `ui/app` versionné
  d'une marque (gates kit).
- Une page OS de ce package est un wrapper mince : la logique vit dans le
  package plateforme correspondant (`@creezio/mails/ui`, `@creezio/tasks/ui`,
  `@creezio/onboarding/ui`, `@creezio/nav/ui`, …).

## Liens

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
- [../../docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
