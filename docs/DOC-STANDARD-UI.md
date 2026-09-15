# Standard UI — kit graphique imposé

Toutes les apps Creezio (marques, apps admin) utilisent **le même kit
graphique**. La SoT est le design system kit `@creezio/shell-ui/ui/primitives`,
re-exporté dans chaque app sous `ui/components/ui/<primitive>.tsx` (scaffold
factory, gate `test-phase-os-ui-scaffold`). Un module n'introduit **jamais**
son propre langage visuel.

Vérifié côté marque par la gate UI de l'app (TF3 :
`server/scripts/test-ui-kit.mjs`, `npm run test:ui-kit`).

## Catalogue des composants imposés

### 1. Primitives kit (`@/components/ui/<primitive>`)

Re-exports purs de `@creezio/shell-ui/ui/primitives/*` — **ne pas forker,
ne pas dupliquer** :

| Primitive | Quand l'utiliser |
|---|---|
| `button` | toute action cliquable (variants: default/outline/ghost/destructive) |
| `card` | tout bloc de contenu délimité (Card/CardHeader/CardTitle/CardContent) |
| `input`, `label`, `select` | tout formulaire |
| `dialog`, `sheet` | modale / panneau latéral (création, édition, détail rapide) |
| `tabs` | vues alternatives d'une même page |
| `badge` | statuts, compteurs, tags |
| `dropdown-menu`, `command` | menus d'actions, palettes de commande |
| `avatar`, `separator`, `scroll-area`, `skeleton`, `breadcrumb` | chrome de page |
| `chart` | tout graphique (wrapper Recharts du kit) |
| `sonner` | toasts / notifications |

### 2. Composants partagés de l'app (`@/components/*`)

Génériques transverses de la marque, construits **sur** les primitives —
à réutiliser avant d'écrire quoi que ce soit de nouveau (référence TF3) :

| Composant | Quand l'utiliser |
|---|---|
| `data-table` | toute liste tabulaire (tri, colonnes) |
| `list-toolbar`, `search-input`, `faceted-filters`, `range-filters` | barres d'outils de listes |
| `pagination` | pagination de listes |
| `statut-badge`, `statut-filter`, `statut-actions` | cycle de vie / statuts d'entités |
| `layout/section-view-shell` | gabarit standard de page métier (titre, actions, contenu) |
| `global-search` | recherche globale (Meili) |
| `charts/*` | graphiques métier composés |

### 3. Composants de module (`@/components/<module>/*`)

Un module peut avoir ses composants dédiés (ex. `promotions/…`) **composés
des primitives et partagés ci-dessus**. Ils vivent dans le dossier du module
et ne sont pas importés par d'autres modules (sinon → promotion en composant
partagé, tâche sérialisée).

## Interdits

- **Pas de lib UI tierce** ajoutée par un module (`@mui/*`, `antd`,
  `chakra-ui`, `styled-components`, `@emotion/*`, bootstrap…). Les seules
  dépendances UI viennent du kit (Radix via shell-ui, Tailwind, lucide-react,
  recharts) ou d'utilitaires non-UI (ex. `qrcode`).
- **Pas de CSS modules** (`*.module.css`) ni de fichiers CSS par page — le
  styling passe par Tailwind + tokens du design system (`globals.css` reste
  le seul CSS global).
- **Pas de fork des primitives** : `ui/components/ui/*.tsx` restent des
  re-exports purs du kit. Un besoin de variante = évolution dans
  `@creezio/shell-ui` (kit), pas une copie locale.
- **Pas de composants dupliqués** : avant de créer un composant, chercher
  dans `@/components/ui` puis `@/components/*` ; un tableau ad hoc alors que
  `data-table` existe = refusé en review.
- **Pas de styles ad hoc** qui recréent un composant existant (un
  `<div onClick>` stylé au lieu de `button`, une bordure arrondie au lieu de
  `card`).

## Desktop API (bridge Electron)

Toute lecture de l’API preload passe par **`getShellDesktopApi()`**
(`@creezio/shell-ui`), après `configureShellUiBrand({ desktopApiGlobal })`.
Interdit : `window.tempoflowDesktop`, `window.tempoflow3Desktop`,
`window.certivanDesktop`, etc. en dur dans le code UI.

**Piège agents (anti-régression)** : ne **jamais** faire un
`sed` / `StrReplace replace_all` sur un identifiant global
(`window.tempoflowDesktop` → `getShellDesktopApi()`) sans, **dans le même
changement**, ajouter :

```ts
import { getShellDesktopApi } from "@creezio/shell-ui";
```

Un replace massif sans import casse tous les fichiers d’un coup — gate
`scripts/test-phase-shell-desktop-api.mjs`.

## Réactivité data (pages listes)

Toute page dont le contenu doit suivre les mutations (chat MCP, API,
formulaires) déclare sa resource :

```tsx
"use client";
import { useCreezioResource } from "@creezio/shell-ui/ui";

export function ClientsLiveRefresh() {
  useCreezioResource("clients"); // même id que EntitySpec.resource / table
  return null;
}
```

Contrat : mutations → header `x-creezio-data-changed` ou `emitDataChanged` →
événement `creezio:data-changed` → `router.refresh()` si la pane est active.
Voir [CREATE-MODULE.md](./agents/CREATE-MODULE.md).

### `openOrNotify(href)` — montrer la cible (pas pastille-only)

Après une mutation UX qui doit **être vue** (ex. ajout panier) :

| État onglet `pathname` | Comportement | Retour |
|---|---|---|
| Actif | rien (le bus data rafraîchit) | `"active"` |
| Ouvert, inactif | **focus** l'onglet (`activateTab`) | `"focused"` |
| Absent | `navigate(href, { newTab: true })` | `"opened"` |

Ne plus se contenter d'une pastille : l'utilisateur doit voir la page cible.
Coupler avec `useCreezioResource("<id>")` sur cette page pour le refresh RSC.

### Tools MCP → resource

`inferResourceFromToolName(toolName)` (`@creezio/shell-ui`) mappe les
écritures vers la resource bus : convention `module.<owner>.<action>`
(lecture → `null`), alias métier (`panier`, `promotions`, `tasks`…),
préfixes legacy (`add_to_*`, `create_*`…). L'assistant émet
`emitDataChanged({ resource, source: "assistant" })` sur chaque
`tool_result` d'écriture.

## Déclaration dans l'interview de module

La section « 4. UI, nav & permissions » de chaque `interview.md`
([DOC-STANDARD-MODULE.md](./DOC-STANDARD-MODULE.md)) liste, **pour chaque
page**, les composants du kit utilisés :

```markdown
### Page /promotions
- gabarit : layout/section-view-shell
- liste : data-table + list-toolbar + faceted-filters + pagination
- statuts : statut-badge
- création : dialog + input/label/select + button
```

## Gate de conformité

La gate UI de l'app vérifie (calibrage utile sans être pénible) :

1. aucun import de lib UI interdite sous `ui/` (pages + composants) ;
2. aucun `*.module.css` sous `ui/` ;
3. `ui/components/ui/*.tsx` = re-exports purs `@creezio/shell-ui` ;
4. les pages `ui/app/**/page.tsx` n'importent que react/next,
   `@/components/*`, `@/lib/*`, `@/hooks/*`, `@/app/*`, imports relatifs et
   utilitaires non-UI allowlistés.

Si l'existant d'une app viole la règle, la gate est posée au niveau
réellement atteignable et les écarts sont tracés en dette dans le `TODO.md`
du module concerné — on ne baisse jamais la gate ensuite.
