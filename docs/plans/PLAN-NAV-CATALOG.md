# PLAN — Catalogue de nav OS (sidebar robuste + admin)

> Statut : **plan à exécuter** — rédigé le 2026-08-31.
> Périmètre : kit `creezio` uniquement (SoT). Les marques consomment après
> publication npm + `npm update "@creezio/*"`.
> Principe : **un module natif hybride « nav catalog »** — les packages OS
> et les modules métier **s’enregistrent** ; l’admin **masque / réordonne /
> renomme** sans toucher au chrome marque. Plus jamais de
> `{ href: "/granola", label: "Granola", icon: NotebookPen }` collé à la
> main dans un `owned-by-brand`.

---

## 1. Verdict (ce que l’utilisateur a raison de trouver anormal)

**Il n’existe pas aujourd’hui de module natif « sidebar catalog » éditable
en admin.** Ce que le kit a déjà :

| Capacité | Où | Ce qu’elle fait | Ce qu’elle ne fait **pas** |
|---|---|---|---|
| Chrome sidebar | `@creezio/shell-ui` `sidebar.tsx` + `configureSidebar` | Rend une liste d’items + filtre `permission` / `canShowHref` | Ne connaît pas le catalogue des modules OS |
| SoT kit OS | `defaultOsPrimaryNavItems()` (`packages/shell-ui/ui/layout/native-os-nav.ts`) | Liste mails / tâches / granola / grokbot / préférences / collaborateurs | **Les marques ne l’appellent pas** — elles recopient une constante `OS_NAV` |
| Factory | `packages/factory/src/generators/os-ui.ts` `OS_NAV` | Génère la même liste **figée** dans le chrome neuf | Un nouveau module OS n’apparaît **pas** sur une marque déjà générée |
| Access-control | `@creezio/access-control` `/admin/access` | Matrice rôles × `nav.*` — **cacher** une entrée déjà listée | **Ajouter**, réordonner, activer un module OS, changer le label |
| `BrandModuleDef.navItems` | `@creezio/app-runtime` `collectNavItems()` | SoT métier (Electron `registerBrandNav`, Foove `GET /api/v1/modules/nav`) | **Pas consommé** par le chrome React TempoFlow3 (NAV manuscrit) |
| Actions sidebar | `registerSidebarActionsProvider` | Contributions dynamiques **sans href** (visite guidée) | Pas de hrefs de nav |
| Plugins | `host.plugins.fetchVisible` | Seule section vraiment dynamique | Hors modules OS |

Donc : **ajouter Granola / GrokBot = patch chrome marque**. C’est un
symptôme, pas un geste produit. La sidebar n’est pas un catalogue ; c’est
une **liste inline owned-by-brand**.

### Preuves (repos)

- TempoFlow3 `server/ui/lib/shell-ui/configure-shell-ui-client.tsx` :
  `const NAV = [ … /taches, /mails, … ]` — **pas** `/granola` ni `/grokbot`,
  **pas** d’appel à `defaultOsPrimaryNavItems()`.
- Foove2 `server/ui/components/brand-chrome.tsx` : mieux — métier via
  `GET /api/v1/modules/nav` (`createNavMount` **owned-by-brand** dans
  `brand-module-api.ts`) + `OS_NAV` encore **hardcodé** (tâches, mails,
  préférences, collaborateurs — **sans** granola / grokbot).
- Factory `renderUiBrandChrome` : `OS_NAV` recopié, pas importé du kit.
- `CORE_NAV_ITEMS` (`packages/shell-ui/src/core-nav.ts`) et
  `defaultOsPrimaryNavItems()` : **deux listes kit** déjà désalignées
  (home / assistant / setup / login vs sidebar réelle).
- Access-control (`docs/ARCHITECTURE.md` § Contrôle d’accès) : « visibilité
  **par rôle** » — pas un catalogue. Owner figé = tout voir. Store
  `core.db`, pas `brand.db`.

---

## 2. Objectif produit

Depuis **Admin → Navigation** (ou un onglet de `/admin/access`) :

1. Voir **toutes** les entrées enregistrées (OS, métier, plugins).
2. **Masquer / afficher** une entrée (override persisté).
3. **Réordonner** (drag ou champ `order`).
4. **Renommer** le label (override, le défaut kit/marque reste).
5. **Assigner** une permission `nav.*` (réutilise access-control).
6. Un **nouveau module OS** (granola, grokbot, le prochain) apparaît
   **automatiquement** après `npm update "@creezio/*"` + rebuild UI —
   **sans** éditer le chrome marque.
7. Feature-off marque (`features.plugins === false`, fidu) : l’entrée
   correspondante n’est pas proposée, pas seulement cachée.

La garde API (`ApiMount.permission`) reste la frontière réelle. La sidebar
n’est qu’une vue.

---

## 3. Architecture cible

Patron **module natif hybride**
([ADR-module-natif-hybride.md](../adr/ADR-module-natif-hybride.md)) —
**pas** un 4ᵉ SoT inline.

### 3.1 Contrat unique `NavCatalogEntry`

Vivre dans `@creezio/shell-ui` (types UI-agnostiques déjà là :
`CoreNavItem`). Étendre, ne pas dupliquer.

```ts
export type NavCatalogSource = "os" | "module" | "plugin" | "extra";
export type NavCatalogGroup = "core" | "brand" | "plugin" | "admin";

export type NavCatalogEntry = {
  /** Stable, never a href (hrefs change). Ex. "os.granola", "module.prospects". */
  id: string;
  href: string;
  label: string;
  /** Nom lucide, pas un composant — sérialisable JSON / brand.db. */
  icon: string;
  group: NavCatalogGroup;
  order: number;
  permission?: string;
  /** Défaut kit/marque avant override admin. */
  defaultVisible: boolean;
  source: NavCatalogSource;
  /** false = feature-off, jamais listé même si override visible. */
  available: boolean;
};
```

`SidebarNavItem.icon` reste un composant React au **rendu**. Le catalogue
stocke un **nom** (`NotebookPen`) résolu par un registry lucide kit
(`resolveNavIcon(name)` dans `shell-ui/ui`). Interdit d’importer lucide
dans le mount Node.

### 3.2 Sources (providers) — un seul merge

```
resolveNavCatalog({
  os: defaultOsCatalogEntries(),          // kit, code
  modules: collectNavItems(),             // marque, BrandModuleDef
  plugins: fetchVisible(),                // runtime, déjà existant
  extras: brandExtras?,                   // rare, owned-by-brand
  overrides: readNavOverrides(db),        // brand.db
  features: manifest.features,            // plugins/fleet off
}) → NavCatalogEntry[]
```

Règles de merge (fail-closed, déterministes) :

1. Collision d’`id` = **erreur** (doctor + gate). Collision d’`href` =
   warning + le provider le plus spécifique gagne (`module` > `os`).
2. Override admin : `hidden`, `order`, `label`, `group`, `permission`
   (jamais `id` / `href` / `source` — ce n’est pas un CMS de routes).
3. `available === false` (feature-off) **gagne** sur `hidden === false`.
4. Filtrage session : `entry.permission` ∩ `me.permissions` — **déjà**
   dans `sidebar.tsx` `hasItemPermission`. Ne pas réimplémenter.
5. Owner voit tout ce qui est `available` (comportement access-control).

### 3.3 Où vit le moteur ?

**Ne pas créer un package `@creezio/nav` isolé** si ça duplique
access-control. Découpage :

| Couche | Package | Pourquoi |
|---|---|---|
| Types + merge pur + `defaultOsCatalogEntries()` + `resolveNavIcon` | `@creezio/shell-ui` | Déjà SoT nav ; zéro DB |
| Overrides + mount `/api/v1/modules/nav` + admin UI | **étendre** `@creezio/access-control` **ou** nouveau hybride `@creezio/nav` | Voir §3.4 |
| Chrome factory | `@creezio/factory` `renderUiBrandChrome` | Plus de `OS_NAV` inline |
| Wrappers `/admin/nav` | `@creezio/os-ui` | Comme `/admin/access` |
| Seed permissions `nav.granola` / `nav.grokbot` | marque `configureAccessControl` + défauts kit OS | Access-control déjà là |

### 3.4 Choix : étendre access-control vs package `nav`

**Recommandation : package hybride `@creezio/nav`** (comme onboarding),
**pas** un fourre-tout dans access-control.

Raisons :

- Access-control = **qui peut voir** (rôles × permissions, `core.db`).
- Nav catalog = **quoi afficher et dans quel ordre** (catalogue +
  overrides, `brand.db` — c’est du chrome marque).
- Mélanger les deux = l’écran « Rôles & accès » devient illisible et on
  casse le contrat owner-figé.
- Foove a déjà un `createNavMount()` owned-by-brand qui ne sert que le
  métier : le kit doit **absorber** ce mount (plus de copie marque).

L’écran admin peut être **deux onglets** d’une même page
`/admin/access` (Access | Navigation) **ou** `/admin/nav` dédié. Préférer
`/admin/nav` + lien depuis access : moins de risque de régression sur la
matrice rôles.

### 3.5 Store `brand.db`

```sql
CREATE TABLE IF NOT EXISTS nav_overrides (
  entry_id    TEXT PRIMARY KEY,
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER,
  label       TEXT,
  icon        TEXT,
  grp         TEXT,
  permission  TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL
);
```

Pas de table « entries » : le catalogue est **code + registre**, pas du
contenu seedé. Sinon dual-write (code OS vs rows).

### 3.6 API mount `createNavMount` (kit)

`registerModuleApi("nav", createNavMount({ collectModules, features }))`

| Route | Auth | Rôle |
|---|---|---|
| `GET /` | session | Catalogue **résolu** pour la session (métier + OS + overrides, déjà filtré `available`) — remplace Foove `createNavMount` |
| `GET /catalog` | `platform.access.manage` | Catalogue brut + overrides (admin) |
| `PUT /overrides` | `platform.access.manage` | Upsert partiel `{ entryId, hidden?, order?, label?, … }` |
| `PUT /overrides/reorder` | `platform.access.manage` | `{ ids: string[] }` |
| `DELETE /overrides/:entryId` | `platform.access.manage` | Retour défaut |

`GET /` ne renvoie **pas** les icônes composant : `icon: string`. Le
chrome résout via `resolveNavIcon`.

### 3.7 Chrome marque cible

```ts
import { defaultOsCatalogEntries, resolveNavIcon } from "@creezio/shell-ui/ui";

configureSidebar({
  getNavItems: () => resolvedNav.map((e) => ({
    href: e.href,
    label: e.label,
    icon: resolveNavIcon(e.icon),
    permission: e.permission,
    fromShell: e.source === "os",
  })),
  getAdminItems: () => resolvedAdmin.map(/* idem */),
});
```

Le chrome **ne liste plus** granola / grokbot / mails. Il **consomme**.
Foove `BrandNavLoader` devient un loader **unique** kit
(`<NavCatalogLoader />` exporté par `@creezio/nav/ui` ou `shell-ui/ui`).

### 3.8 Enregistrement d’un module OS (le geste scalable)

Aujourd’hui : éditer `native-os-nav.ts` **et** `OS_NAV` factory **et**
chaque chrome marque. Demain :

1. Le package OS exporte `navCatalogEntry` (id, href, icon, order,
   permission, defaultVisible).
2. `defaultOsCatalogEntries()` **importe** ces exports (ou un registre
   `registerOsNavEntry` côté shell-ui, analogue à
   `registerSidebarActionsProvider`).
3. Factory / chrome : **zéro** ligne granola.

Préférer un **registre runtime** (`registerOsNavEntry`) pour que
granola/grokbot n’aient pas à être listés dans `native-os-nav.ts` — sinon
on a juste déplacé le hardcode. Le wrapper os-ui `/granola` importe
`GranolaClient` : ce side-effect enregistre l’entrée. Alternative plus
explicite (recommandée pour le Node/harness) : `app-runtime`
`startBrandDesktop` appelle `registerOsNavEntry(granolaNavEntry)` quand
`os.granola` est câblé — même endroit que le mount.

**Fail-closed** : une page os-ui sans entrée catalogue = gate
`test-phase-os-nav-catalog` (chaque `OS_UI_ROUTE_SEGMENTS` primaire a une
entrée, ou `horsNavJustification`).

---

## 4. Phases d’implémentation (kit)

Les briefs agents (§ docs/agents) découpent ça en PRs parallélisables.
Dépendances : **NAV-1 → NAV-2 → NAV-3**. Granola / GrokBot UI = **indépendants**.

### Phase A — SoT unique côté kit (sans admin)

- `NavCatalogEntry` + `resolveNavCatalog` (pur, testable).
- `defaultOsCatalogEntries()` lit un registre, **plus** une liste recopiée
  dans la factory.
- `resolveNavIcon` + allowlist lucide (gate : pas d’icône inconnue).
- Factory : `getNavItems: () => merge(BRAND_NAV, defaultOs…)` **ou**
  mieux le loader. **Supprimer `const OS_NAV = […]`**.
- Codemod doc : chrome owned-by-brand **doit** appeler
  `defaultOsCatalogEntries()` / loader — plus de miroir.
- Gate : factory scaffold n’embed plus les hrefs `/granola` en dur ;
  `test-phase-os-nav-catalog`.

À ce stade Granola apparaît sur **toute marque factory-neuve** et sur
toute marque qui remplace son `OS_NAV` par l’appel kit — **toujours pas
d’admin masquer**.

### Phase B — Overrides admin (hybride)

- Package `@creezio/nav` (ou mount dans access-control si on inverse le
  choix §3.4 — **ne pas inverser sans ADR**).
- `navMigrations()`, `createNavMount`, UI `NavAdminClient`.
- Wrapper `os-ui/routes/admin/nav/page.tsx`.
- `start-brand-desktop` : **auto-register** le mount `nav` (ici, oui —
  c’est du chrome OS, pas du métier ; contrairement à granola/grokbot).
- Permissions : réutiliser `platform.access.manage`.
- Gate `test-phase-nav-catalog.mjs` : merge, override, feature-off,
  collision id, GET session vs GET catalog.

### Phase C — Absorb brand mounts + upgrade marques

- Factory : générer `<NavCatalogLoader />` au lieu de `OS_NAV`.
- Doc upgrade TempoFlow3 / Foove : supprimer NAV OS inline ; Foove
  **supprime** son `createNavMount` owned-by-brand.
- Access-control : ajouter les groupes `nav.granola` / `nav.grokbot` dans
  le seed OS recommandé (pas dans le package access-control en dur
  marque).
- `collectNavItems()` alimente le même catalogue (source `module`).
- TempoFlow3 : **arrêter** de dupliquer métier dans `const NAV = […]` —
  même loader que Foove.

### Phase D — Qualité / ratchet

- Interdire un 2ᵉ `OS_NAV` dans `packages/factory` (gate grep).
- `CORE_NAV_ITEMS` vs catalogue : **une seule** liste, ou `CORE_NAV_ITEMS`
  dérivé du catalogue (aujourd’hui désaligné).
- Doctor brand-spec : chrome qui liste `/mails` en dur = warning puis
  error après une release de grâce.

---

## 5. Hors scope (ne pas faire)

- CMS de routes (créer un href depuis l’admin) — les routes OS restent
  matérialisées par `os-ui`.
- Permissions owner éditables.
- Vocabulaire marque dans `@creezio/*`.
- Patcher TempoFlow3 / Foove **dans cette PR kit** (propagation npm).
- Dual-write catalogue en DB + code.
- Réutiliser `registerSidebarActionsProvider` pour des hrefs (mauvais
  type : `onSelect` sans navigation).

---

## 6. Tests

| Gate | Assert |
|---|---|
| `test-phase-nav-catalog` (nouvelle) | merge pur, override, feature-off, collision, icon allowlist |
| `test-phase-os-ui-scaffold` | chrome généré **sans** `OS_NAV` hrefs granola/grokbot en dur ; import catalogue |
| `test-phase-os-nav-catalog` (nouvelle) | chaque segment OS primaire ∈ catalogue ou justification |
| `test-phase-no-brand-vocab` | inchangé |
| Factory two-repos | marque neuve : `/granola` présent **via catalogue**, pas via literal chrome |

---

## 7. Migration marques (après publish)

1. Merge kit `main` → publish `@creezio/nav` + bump shell-ui / os-ui / factory.
2. Marque : `npm update "@creezio/*"` (racine + `server/ui` + `client`).
3. Remplacer le chrome (snippets ci-dessous). **Ne pas** ajouter
   `@creezio/nav` aux deps tant que le package n'est pas publié — le
   loader s'importe depuis `@creezio/shell-ui/ui`.
4. `os-ui:materialize` pour `/admin/nav`.
5. Gates marque.

### Foove — supprimer `OS_NAV` + `createNavMount` owned-by-brand

Dans `server/ui/components/brand-chrome.tsx` (ou équivalent) :

```tsx
import {
  configureSidebar,
  defaultOsAdminNavItems,
  defaultOsPrimaryNavItems,
  NavCatalogLoader,
} from "@creezio/shell-ui/ui";

configureSidebar({
  getNavItems: () => defaultOsPrimaryNavItems(),
  getAdminItems: () => defaultOsAdminNavItems({ includePlugins: true }),
});

export function BrandChrome({ children }) {
  return (
    <SessionProvider>
      <RequireSession>
        <NavCatalogLoader />
        <WorkspaceRoot>{children}</WorkspaceRoot>
      </RequireSession>
    </SessionProvider>
  );
}
```

Dans `server/src/electron/brand-module-api.ts` : **supprimer**
`createNavMount` local et `api.registerModuleApi("nav", …)`. Le kit
auto-register le mount dans `createBrandKernel` (`collectNavItems` /
`navItems` → source `module`). Garder le registre modules.

### TempoFlow3 — retirer les lignes OS de `NAV`

Dans `server/ui/lib/shell-ui/configure-shell-ui-client.tsx` : supprimer
les entrées `/taches`, `/mails`, `/parametres`, `/collaborateurs` (et
toute ligne OS). **Préféré** : ne plus lister le métier non plus —
`collectNavItems()` alimente déjà `GET /api/v1/modules/nav`. Monter le
même `<NavCatalogLoader />` que Foove (import `@creezio/shell-ui/ui`).

Workaround **temporaire** (hors factory-neuve — **déconseillé**) :

```ts
import { defaultOsPrimaryNavItems } from "@creezio/shell-ui/ui";

configureSidebar({
  getNavItems: () => [...BRAND_NAV, ...defaultOsPrimaryNavItems()],
});
```

**Pas** recopier granola/grokbot en dur. Une marque `creezio brand create`
neuve n'a plus ce workaround : chrome = loader.

---

## 8. Décision d’architecture (à graver)

| Question | Décision |
|---|---|
| Module sidebar natif existait-il ? | **Non.** Access-control = ACL, pas catalogue. |
| Nouveau package ? | **Oui** `@creezio/nav` (hybride), Phase B. |
| Auto-mount dans app-runtime ? | **Oui** pour `nav` (chrome OS). **Non** pour granola/grokbot (déjà le patron). |
| Où déclarer une entrée OS ? | `registerOsNavEntry` au câblage `os.<id>` / export du package OS. |
| Overrides | `brand.db` `nav_overrides`, jamais `core.db`. |
| Qui filtre par rôle ? | Sidebar existante + access-control. Le catalogue n’invente pas d’ACL. |
