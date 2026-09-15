# CREATE-BRAND — interview agent → BrandSpec → app

Guide pour un **agent créateur** qui crée une marque Creezio sans écrire
d'orchestration OS.

## Flux

Happy path **naissance d'app** : une commande
[`creezio brand create`](./CREATE-APP.md) (pas `demo-app`, pas de notes).
Ce guide = interview BrandSpec / apply métier **après** remplissage.

```text
Interview (questionnaire) → brand-spec/ → creezio brand doctor
                                      → creezio brand apply
                                      → creezio brand smoke
                                      → startBrandDesktop (runtime)
```

## 1. Interview (remplir BrandSpec)

Questions minimales (voir `interview.schema.json`) :

1. Nom produit / brandId / domaine
2. Tagline + utilisateurs cibles
3. Entités cœur + champs
4. Flux métier principal (étapes)
5. Besoins plateforme : Meili / MCP / chat / onboarding
6. Modules métier — chaque module = dossier `modules/<id>/` **5 fichiers**
   (`prd.md`, `interview.md`, `TODO.md`, `CHANGELOG.md`, `gate.mjs`) au standard
   [DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md). Scaffold :
   `creezio brand module init <id> --app <app>`. L'interview de module
   déclare notamment, pour chaque page UI, les composants du **kit graphique
   imposé** ([DOC-STANDARD-UI.md](../DOC-STANDARD-UI.md)).

**Conventions OS non négociables** (section éponyme de
[DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md)) : une interview générée
ne peut PAS les contredire. En particulier : la home d'une marque vit à
`/dashboard` (le workspace kit canonise `/` → `/dashboard`), `app/page.tsx`
(`/`) reste une **pure redirection factory** (jamais de contenu), et
l'entrée de nav « accueil » pointe `href: "/dashboard"` — jamais `href: "/"`.
Routes OS (`/taches`, `/mails`, `/admin/*`…) et `/site/*` : réservées.

**Démo interactive native obligatoire** : la factory câble le mount
(`createInteractiveDemoMount`), les migrations, le CSS et la dep UI ;
`CreezioUiBoot` monte `InteractiveDemoRoot` (le chrome marque ne peut pas
l'oublier). Chaque `BrandModuleDef` expose ≥ 1 scénario jouable
(`genericOsTourScenario({ productName })` inclus). Une app sans démo
interactive est invalide. Le seed de données métier reste marque
(`demo-seed` / `demo-data`).

Ne **jamais** demander à l'agent d'implémenter des launchers Meili/n8n/Hermes
dans la marque.

Travail multi-agents sur les modules : périmètre de fichiers par agent,
claim des tâches TODO et branches `module/<id>/<tache>` — voir
[DOC-STANDARD-MODULE.md](../DOC-STANDARD-MODULE.md).

## 2. Commandes

```bash
creezio brand init --id acme --name Acme --domain acme.local --vertical generic
# → apps/acme/brand-spec/

# Après remplissage product.md + modules/
creezio brand doctor --spec apps/acme/brand-spec
creezio brand apply --spec apps/acme/brand-spec --out apps/acme --force
# Repos GitHub : creezio brand apply … --push (token requis)
creezio brand smoke --app apps/acme
```

## 2b. Layout généré — 2 repos (LA norme)

`creezio brand create` / `brand apply` / `new-app` génèrent **2 arbres
locaux**. Les repos GitHub ne sont créés **que** avec `--push` (token
requis) ; le défaut est local, même si `GITHUB_TOKEN` est posé.

```text
<app>/                  # monorepo marque (client + server)
├── brand-spec/     # SoT marque
├── server/         # livrable principal (métier, ui/, harness, Docker)
│                   # (membre du workspace npm racine)
├── client/         # desktop thin remote-only (main client-only, pack, feeds)
│                   # (projet npm indépendant — .npmrc local)
├── docker-data/    # runtime gitignoré (registre servers.json, volumes)
├── .npmrc          # registre @creezio → GitHub Packages (token via env)
└── package.json    # orchestrateur racine + workspaces ["server"]

<app>-admin/            # repo ADMIN dédié (privé, jamais public)
├── server-admin.json        # config flotte versionnée SANS secrets
├── fleet-hosts.json         # miroir hôtes enrôlés SANS tokens
├── docker-compose.admin.yml
└── docker-data/             # runtime gitignoré (secrets, tokens)
```

**Pas de `admin/` dans le monorepo marque.** L'app admin complète (OS en mode
admin : flotte, support, billing…) vit dans le repo `<app>-admin` — voir
[../adr/ADR-admin-app-os.md](../adr/ADR-admin-app-os.md).

Le `client/src/electron/main.ts` est **client-only** : pas de
`brand-migrations` / `brand-module-api` (inutiles en `requireRemoteProfile`).
Plus de layout plat.

## 3. Contrat runtime marque

`main.ts` doit rester une **déclaration** :

```ts
import { startBrandDesktop } from "@creezio/app-runtime";
// manifest + bootBrandKernel + meiliFeed + navItems
await startBrandDesktop({ … });
```

Si un besoin OS manque → **gap kit** (`@creezio/app-runtime` /
`electron-shell`), pas de copie dans la marque.

## 4. Anti-triche

| Interdit | Pourquoi |
|----------|----------|
| Templates CHR riches dans factory | Contourne la sonde |
| Sidecar `metier-api.mjs` / `store.json` | Hors contrat SQLite |
| Jumeau `listenBrandKernelHttp` dans main | Contourne la façade |
| UIDs Meili `tf2_*` | Réservés — seuls les UIDs `catalog_*` du kit sont admis |
| Deuxième base métier lue par l'UI/API | Un seul plan de données : `brand.db` ([ADR-single-data-plane](../adr/ADR-single-data-plane.md)) — les flux externes sont projetés à l'import, gate `single-data-plane` |

## 4b. Fichiers métier protégés (`owned-by-brand`)

Après enrichissement manuel (bonus API, UI interactive, migrations riches),
protéger contre `creezio brand apply --force` :

1. **Sources TS/TSX/MD** — première ligne / en-tête :
   `/** creezio:owned-by-brand */`
2. **`package.json`** — `"creezio": { "ownedByBrand": true, … }`  
   → apply **merge** (conserve `creezio.*` + scripts métier, met à jour le shell deps).

Sans marker, `--force` réécrit le fichier avec le template factory (stubs).
Gate : `node --test scripts/test-os-owned-by-brand.mjs`.

Reset clean-room TF3 : `node scripts/reset-tempoflow3.mjs` (backup + apply + build).

## 5. Premier serveur Docker (marque neuve) vs clone hôte

`brand apply` / `new-app` préparent **automatiquement** les lockfiles npm
(`package-lock.json`, même sans `--push` — le défaut). Ensuite :

```bash
cd <app>
# Dev local (loopback, owner optionnel) :
CREEZIO_TUNNEL_LOCAL=1 npm run server-docker:create -- demo
# VPS / prod — hostname {slug}.crm.foove.io + owner first-run obligatoires
# (.env : CREEZIO_CF_API_TOKEN + _ACCOUNT_ID + _ZONE_ID + CREEZIO_OWNER_EMAIL +
# CREEZIO_OWNER_PASSWORD ; slug réservé → <brand>-<slug>) :
npm run server-docker:create -- acme -- --profile prod
```

**Deux chemins distincts — ne pas les confondre :**

| Chemin | Layout `node_modules` | Action |
|--------|----------------------|--------|
| **Docker** (`server-docker:*`, `docker:build`) | Dockerfile COPY vers `/app/node_modules` | Locks via `prepareBrandDistribution` / `ensure-server-lock.mjs` — **ne pas** bricoler à la main dans l'image |
| **Clone hôte** (harness, `metier:api`, smokes) | `{marque}/node_modules` (hoisting workspace racine) | **Obligatoire** : `npm ci` à la racine (workspace) après clone / avant harness |

Le scaffold génère `workspaces: ["server"]` à la racine : un `npm ci` racine
hoiste les deps dans `node_modules/` racine et `server/` résout par walk-up
standard. Un `npm ci --prefix server` seul créerait un lock parasite —
toujours installer depuis la racine.

## 6. Sonde TempoFlow3

Référence vivante : le repo marque `tempoflow3` (frère du kit —
`brand-spec/` à sa racine) + gates kit
`scripts/test-phase-brand-spec.mjs` / `test-phase-app-runtime.mjs`.
