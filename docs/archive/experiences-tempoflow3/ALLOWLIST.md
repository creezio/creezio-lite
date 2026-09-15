# Allowlist `tempoflow3` — ce qui a le droit d’exister

Tout fichier hors de cette liste doit être **justifié** (gap kit) ou **supprimé**.

## Racine repo

- `README.md`, `AGENTS.md`, `docs/**` (expérience, métier, parity)
- `.gitignore`, `.env.example`, `requirements.txt` (si utile)
- `data/` (gitignore DB locales)
- `scripts/` racine minces (ops) — pas de runtime natif

## `crm/` config

- `package.json`, lockfile, `tsconfig*`, `next.config.mjs`, `tailwind*`, `postcss*`
- `electron-tsconfig.json`, `electron-builder.yml` (+ variants)
- `Dockerfile*`, `docker-compose.yml`, `deploy/**`
- `public/**`, `resources/**` (icônes, assets marque)
- `CHANGELOG.md`, `PLAN-ELECTRON.md` (optionnel)

## `crm/electron/` — wiring + métier seulement

**Wiring (mince)**  
`main.ts`, `brand.ts`, `brand-runtime.ts`, `host-stack.ts`, `host-runtime-ctx.ts`,
`host-n2-bindings.ts`, `plugin-host-bindings.ts`, `plugin-hub-store.ts`,
`creezio-boot.ts`, `paths.ts`, `preload-app.ts`, `profile.ts`, `app-kind.ts`,
`local-config-store.ts`, `ua.ts`, `window-chrome-html.ts` (si brand tokens seulement),
`connection-profile.ts`, seeds marque (`hermes-*-seed.ts`) **si** contenus métier.

**Métier**  
`modules/**` (catalogue, panier, dispatch, optimiser, relevés, scan, stack, statut…),
`register-brand-api.ts`, `nav.ts` / `nav-shell.ts`, `mcp-aliases.ts`, `mcp-tools.ts`
métier, `brand-migrations.ts`, `brand-mcp.ts`, indexers **métier** seulement
si non fournis par le kit.

**Interdit**  
Recopier launchers génériques : `hermes-launcher`, `n8n-launcher`, `meili-launcher`,
`plugin-control-api`, `plugin-accept-check`, `fleet-agent` générique, `updater`,
`tray`, `splash` génériques, `crash-reporter` générique, etc. → kit.

## `crm/src/`

**Wiring**  
`lib/configure-*.ts`, `lib/assistant/configure-brand*.ts`, `lib/creezio-nav-shell.ts`,
`lib/brand-host.ts`, `lib/brand-module-api.ts`, `lib/platform-stores/**` (adapters),
`server/app.ts` (montage), wrappers auth/mcp minces.

**Métier**  
`lib/*-queries.ts` métier, `lib/dispatch-*`, `lib/optimiser-*`, `lib/nav-config.ts`
métier, `app/**` pages métier, `server/routes/{catalog,fournisseurs,panier,commandes,…}.ts`.

**Interdit**  
Réimplémenter `chat-db`, kanban tasks store, mail inbox store, mcp oauth server
complet, admin database engine, shell chrome générique.

## `crm/scripts/`

- Tests métier + gates OS **adaptés** (assert chemins kit)
- Sync vendor, release, email-worker config marque, fleet-collector **si**
  simple wrapper du bin kit

## `crm/vendor/creezio/`

- Uniquement via sync — jamais édité à la main

## Mesure (P12)

Compter LOC approximatif :

- `métier` = modules + routes + queries + pages métier + migrations brand  
- `wiring` = electron bindings + configure* + adapters  
- `vendor` = exclu du ratio  

Cible indicative expérience : wiring << métier ; wiring ne doit pas contenir
de launchers OS.
