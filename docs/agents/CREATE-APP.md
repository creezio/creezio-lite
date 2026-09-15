# CREATE-APP — créer une app marque (happy path)

Guide pour un **agent créateur** qui pose une marque Creezio propre :
**zéro module notes**, **zéro `server/crm/`**, registre vide + démo native
dès le jour 1. Aussi clair que [CREATE-MODULE.md](./CREATE-MODULE.md).

**Une commande.** Pas `demo-app`. Pas `init` + `apply` pour naître.

```bash
creezio brand create --id acme --name Acme --domain acme.local
# local uniquement — aucun repo GitHub

creezio brand create --id acme --name Acme --domain acme.local --push
# crée creezio/acme + creezio/acme-admin (token GITHUB_TOKEN requis)
```

Pose :

- monorepo `<out>/` (`server/` métier, `client/` thin, `brand-spec/`) ;
- repo frère `<out>-admin` (flotte — **jamais** de `admin/` dans la marque) ;
- registre `server/src/electron/modules/` **vide** (marqueurs) ;
- mount `createInteractiveDemoMount({ defaults: collectDemoScenarios() })`
  + migrations `interactiveDemoMigrations` ;
- `AGENTS.md` marque + contrat secrets VPS (CF + owner).

Ensuite **un module à la fois** : [CREATE-MODULE.md](./CREATE-MODULE.md).

## 0. Interdit

| Interdit | Pourquoi |
|----------|----------|
| `creezio demo-app` | Déprécié, **exit 1**. Génère encore l'ancien réflexe notes. |
| Module `notes` par défaut | L'agent ne peut plus « créer une app notes ». |
| `server/crm/` | Hors contrat. Schéma = `brand.db` + registre modules. |
| Fallback notes si PRD vide | `parseProductPrd` / doctor **error** (`PRODUCT_MD_STUB`). |
| `vertical: chr` implicite | CHR seulement si `vertical: chr` **explicite** (markdown ou `--vertical`). |
| Glue OS (`src/lib/host-stack.ts`, `listenBrandKernelHttp`, Hono parallèle) | Contourne la façade kit. |
| Sidecar `metier-api.mjs` / `store.json` | Hors contrat SQLite. |

## 1. Happy path — app vide (recommandé)

```bash
# Depuis le kit (ou npx creezio une fois le package factory installé)
creezio brand create --id acme --name Acme --domain acme.local \
  --out /tmp/acme --force
# Repos GitHub : ajouter --push (exige GITHUB_TOKEN / CREEZIO_GITHUB_TOKEN
# ou .github-token). Sans --push : zéro appel réseau, même si un token
# est présent dans l'environnement.

cd /tmp/acme
creezio brand module init articles --app .
# Remplir brand-spec/product.md + brand-spec/modules/articles/{prd,interview}.md
# (interdit de laisser « (à remplir) » avant apply métier)
npm run test:modules   # si le runner est posé (après module init)
```

**Doctor fail-closed** sur un livrable : `NO_MODULES`, `PRODUCT_MD_MISSING`,
`PRODUCT_MD_STUB`, `MODULE_PRD_MISSING`, `MODULE_SPEC_STUB`,
`MODULE_MEILI_MISSING` (entité listable sans `meiliIndexes` ni
`horsIndexJustification` — Meili = composant core, 0.10.13+), leftover
`notes` hors allowlist = **error**. `brand create` naît volontairement
sans module — le doctor devient vert après `module init` + specs remplies.

**Meili = composant core fail-closed** : toute app dont le feed déclare des
index exige le binaire Meili au boot (image Docker :
`/opt/creezio/bin/meilisearch`, desktop : `ensure-kit-binaries`) — sinon
échec de boot explicite. Meili KO en runtime = browse catalogue en
**503 `meili_unavailable`**, jamais de LIKE SQL de secours
([CREATE-MODULE.md](./CREATE-MODULE.md) §4).

## 2. Legacy — brief produit TempoFlow3 (`--from-prd`)

Toujours supporté, **pas** le happy path. Exige un PRD qui extrait des
entités (`## Entités` / `###`) **ou** `vertical: chr` explicite.

```bash
creezio new-app \
  --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md \
  --out /tmp/tempoflow3 --force
```

`creezio brand apply --spec … --out …` refuse un `product.md` stub
(plus de génération notes).

## 3. Layout généré — 2 repos

```text
<app>/                  # monorepo marque
├── brand-spec/
├── server/             # livrable (métier, ui/, harness, Docker)
├── client/             # desktop thin remote-only
└── AGENTS.md

<app>-admin/            # repo ADMIN dédié (privé)
```

Pas de `admin/` dans le monorepo. Pas de `server/crm/`.

## 4. Contrat runtime

```ts
import { startBrandDesktop } from "@creezio/app-runtime";
await startBrandDesktop({ … });
```

Mount démo (squelette **et** from-prd) :

```ts
createInteractiveDemoMount({
  defaults: collectInteractiveDemoDefaults([
    { moduleId: "os", scenarios: [genericOsTourScenario({ productName })] },
    { moduleId: "brand", scenarios: collectDemoScenarios() },
  ]),
});
```

Un seul `InteractiveDemoRoot`, **dans** `SessionProvider` (BrandChrome
factory). Pas de `brandDemoScenarios()`.

## 4b. Sidebar = catalogue (interdiction `OS_NAV`)

Le chrome généré monte `<NavCatalogLoader />` (`@creezio/shell-ui/ui`) :
`GET /api/v1/modules/nav` alimente `configureSidebar({ getNavItems })`.
Les pages OS (mails, tâches, Granola, GrokBot, préférences,
collaborateurs) apparaissent **via le catalogue kit**, pas une liste
inline. Le métier vient de `collectNavItems()` (mount nav auto-register
dans `app-runtime`).

**Interdit** de recopier `const OS_NAV = […]` / d'écrire des hrefs
granola/grokbot dans le chrome / d'ajouter `@creezio/nav` (ou granola /
grokbot) aux deps npm d'une app neuve tant que ces packages ne sont pas
publiés. Admin : `defaultOsAdminNavItems({ includePlugins })` — consommé,
pas recopié. Plan : [PLAN-NAV-CATALOG.md](../plans/PLAN-NAV-CATALOG.md).

## 5. Secrets (jamais commités, jamais dumpés)

VPS fail-closed (`server-docker create`, sauf `CREEZIO_TUNNEL_LOCAL=1`) :

- Tunnel : `CREEZIO_CF_API_TOKEN` + `CREEZIO_CF_ACCOUNT_ID` +
  `CREEZIO_CF_ZONE_ID` (optionnel `_ZONE_NAME`)
- Owner : `CREEZIO_OWNER_EMAIL` + `CREEZIO_OWNER_PASSWORD`
- Packages : `CREEZIO_NPM_TOKEN` / `GH_TOKEN` pour `@creezio/*`

Local : `CREEZIO_TUNNEL_LOCAL=1 npm run server-docker:create -- demo`

## 6. Suite

| Je veux… | Guide |
|----------|--------|
| Ajouter un module métier | [CREATE-MODULE.md](./CREATE-MODULE.md) |
| Interview BrandSpec seule | [CREATE-BRAND.md](./CREATE-BRAND.md) |
| Flotte / Docker | skill `creezio-fleet-ops` |

Skill Cursor : [`.cursor/skills/creezio-create-app/SKILL.md`](../../.cursor/skills/creezio-create-app/SKILL.md).
