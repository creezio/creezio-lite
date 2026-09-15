# Briefs agents — nav catalog + UI Granola / GrokBot

> SoT plan : [../plans/PLAN-NAV-CATALOG.md](../plans/PLAN-NAV-CATALOG.md).
> Repo : `creezio/creezio`. Branche de base : `main` (ou la PR
> `cursor/modules-granola-grokbot-7766` si les packages granola/grokbot
> n’y sont pas encore mergés).
> Un brief = **un agent cloud**, **une PR**, **un changeset**.
> Répondre en français. Secrets jamais commités (`grn_`, `whsec_`,
> tokens Cursor, PAT). Pas de vocabulaire marque dans `packages/*/src|ui`
> (gate `test-phase-no-brand-vocab`). Pas de `zod` en dependency. Imports
> `@creezio/api-kernel` / `@creezio/platform-core` **type-only**.
> Design system : `@creezio/shell-ui/ui/kit` + [DOC-STANDARD-UI.md](../DOC-STANDARD-UI.md).
> Git : `git -c user.name=Creezio -c user.email=creezio@users.noreply.github.com`
> — ne pas toucher `git config`. Branche `cursor/<slug>-<suffixe>`.
> Après code : `npm run build:packages` sur les workspaces touchés + la
> gate citée. Changeset `.changeset/*.md` (fixed lockstep — voir
> `.changeset/config.json`).

**Parallélisme**

```
NAV-1  ──►  NAV-2  ──►  NAV-3
GRANOLA-1  //  GRANOLA-2     (indépendants de NAV-*)
GROKBOT-1  //  GROKBOT-2     (indépendants de NAV-*)
```

NAV-2 **attend** NAV-1 mergé (ou rebase dessus). NAV-3 attend NAV-2.
Granola / GrokBot peuvent partir **tout de suite** en parallèle.

---

# BRIEF NAV-1 — Catalogue OS unique (sans admin)

## Mission

Faire de `defaultOsPrimaryNavItems()` / un registre `NavCatalogEntry` le
**seul** SoT des entrées OS primaires. La factory et le chrome généré
**ne recopient plus** une constante `OS_NAV`. Aucun écran admin dans
cette PR.

## Contexte (ne pas « redécouvrir »)

- Aujourd’hui `packages/shell-ui/ui/layout/native-os-nav.ts`
  `defaultOsPrimaryNavItems()` **existe** mais les marques / la factory
  **recopient** `OS_NAV` (`packages/factory/src/generators/os-ui.ts`
  ~662–670).
- `packages/shell-ui/src/core-nav.ts` `CORE_NAV_ITEMS` est une **2ᵉ**
  liste (home, assistant, setup…) — à dériver ou documenter, pas à
  laisser diverger en silence.
- `SidebarNavItem.icon` = composant React. Le catalogue doit stocker un
  **nom lucide** sérialisable.
- Plan : `docs/plans/PLAN-NAV-CATALOG.md` §3.1–3.2 et Phase A.

## Livrable

1. Types dans `packages/shell-ui/src/` (exportés via `src/index.ts`) :
   `NavCatalogEntry`, `NavCatalogSource`, `NavCatalogGroup`,
   `NavOverride`, `resolveNavCatalog(input)`.
2. `resolveNavCatalog` **pur** : merge os + modules + extras + overrides
   + `features`. Règles du plan §3.2 (collision id = throw en test /
   retour `errors[]` côté runtime admin ; collision href = module gagne).
3. `registerOsNavEntry(entry)` + `listOsNavEntries()` dans
   `shell-ui` (Node-safe, pas de React). Seed des entrées actuelles
   (taches, mails, granola, grokbot, parametres, collaborateurs) via
   un `registerDefaultOsNavEntries()` appelé par `defaultOsCatalogEntries()`.
4. `resolveNavIcon(name: string)` dans `shell-ui/ui` — allowlist lucide
   (ceux déjà utilisés + Bot, NotebookPen). Inconnu → icône `Circle`
   + warning, pas de throw UI.
5. `defaultOsPrimaryNavItems()` devient un **adaptateur** :
   `listOsNavEntries()` → `SidebarNavItem[]` (icônes résolues). Ne pas
   casser les call sites existants.
6. Factory `renderUiBrandChrome` : **supprimer** `const OS_NAV = […]`.
   Composer `...BRAND_NAV, ...defaultOsPrimaryNavItems()`. Idem
   `getAdminItems` : appeler `defaultOsAdminNavItems({ includePlugins })`
   au lieu de recopier. Garder `BRAND_NAV` métier généré (Phase C
   l’absorbera).
7. Gate `scripts/test-phase-nav-catalog.mjs` (merge pur + collision +
   feature-off + factory chrome **sans** literal `"/granola"` dans
   `OS_NAV`). Enregistrer dans le script `test` racine **et**
   `scripts/docs/FILES.md` (inventaire).
8. Doc : mettre à jour le commentaire de `native-os-nav.ts` (les marques
   **doivent** composer, plus « miroir »). Pointer
   `docs/plans/PLAN-NAV-CATALOG.md`.

## Interdit

- Table SQL, mount HTTP, page admin (c’est NAV-2).
- Modifier TempoFlow3 / Foove (propagation).
- Ajouter granola/grokbot en dur dans un chrome marque.
- Vocabulaire marque.

## Tests de recette

```bash
npm run build -w @creezio/shell-ui
# factory : rebuild du workspace factory si tu touches os-ui.ts
node --test scripts/test-phase-nav-catalog.mjs
npm run test:kit -- --from test-phase-os-ui-scaffold
# si factory-two-repos est trop lourd / E401 npm : skip explicite, le dire
```

## Done when

- `rg 'const OS_NAV' packages/factory` → 0.
- `defaultOsPrimaryNavItems()` dérive du registre.
- Gate verte. Changeset minor `shell-ui` + `factory`.

---

# BRIEF NAV-2 — Module hybride `@creezio/nav` (overrides admin)

## Mission

Créer le package `@creezio/nav` : persist des overrides sidebar en
`brand.db`, mount `/api/v1/modules/nav`, écran admin masquer / réordonner /
renommer. **Dépend de NAV-1** (types `NavCatalogEntry` / `resolveNavCatalog`).

## Patron

Suivre [CREATE-PACKAGE.md](./CREATE-PACKAGE.md) + ADR
[ADR-module-natif-hybride.md](../adr/ADR-module-natif-hybride.md)
(modèle `@creezio/onboarding`, **pas** `@creezio/support`).

- Mount : `api.registerModuleApi("nav", createNavMount(opts))`.
- DB : `brand.db` + `navMigrations()`.
- **Auto-register dans `app-runtime` `start-brand-desktop.ts`** — c’est du
  chrome OS, contrairement à granola/grokbot.
- Permission admin : `platform.access.manage` (déjà access-control).
- Pas de `zod`. Imports kernel/platform **type-only**.

## API

Voir plan §3.6. `GET /` = catalogue résolu session (remplace le
`createNavMount` Foove owned-by-brand — ne pas le toucher ici, juste
**même contrat** `{ items: [{ id, href, label, order, group?, permission?, icon }] }`).

`GET /catalog` + `PUT /overrides` = admin.

Schéma `nav_overrides` : plan §3.5. Ne **pas** persister le catalogue
entier.

`createNavMount({ collectModuleEntries, features, osEntries })` :
`osEntries` défaut = `listOsNavEntries()` de shell-ui.

## UI admin

- `packages/nav/ui/nav-admin-client.tsx` — `NavAdminClient`.
- Primitives kit : `Card`, `Button`, `Badge`, `Input`, `Switch` si
  existant sinon checkbox kit, pas de lib DnD tierce. Réorder = boutons
  haut/bas **ou** input `order` (plus simple, suffisant v1).
- Liste : source (os/module/plugin), href, label éditable, visible,
  permission, order.
- Feature-off : badge « indisponible », toggle disabled.
- Wrapper : `packages/os-ui/routes/admin/nav/page.tsx` + segment
  `OS_UI_ROUTE_SEGMENTS`.
- Entrée admin : **via le catalogue** (`registerOsNavEntry` id
  `os.admin.nav`, href `/admin/nav`, group `admin`) — pas un 3ᵉ
  `ADMIN_NAV` hardcodé. Si NAV-1 n’a pas encore de registre admin,
  ajouter l’entrée dans `defaultOsAdminNavItems()` **et** le dire dans
  le changeset.

## Câblage

- `packages/app-runtime/src/start-brand-desktop.ts` : migrations +
  `registerModuleApi("nav", …)`.
- Ordre de build `package.json` `build:packages` : après `shell-ui`,
  avant `os-ui` / `app-runtime` (respecter
  `node scripts/build-workspaces.mjs --packages-only --list` + gate
  `test-phase-build-order-imports`).
- `scripts/build-cjs.mjs`, `.changeset/config.json` `fixed[]`,
  `docs/PACKAGES.md`, `AGENTS.md` racine « Où modifier quoi »,
  trio `packages/nav/{README,AGENTS,docs/FILES.md}`.
- Gate `scripts/test-phase-nav-module.mjs` (nom distinct de
  `test-phase-nav-catalog` NAV-1) : migrations, GET/PUT overrides,
  feature-off, secrets absents, 403 sans permission.

## Interdit

- Recopier la matrice access-control.
- Store `core.db`.
- Vocabulaire marque.
- Casser `GET /api/v1/access/*`.

## Tests

```bash
npm run build -w @creezio/nav
node --test scripts/test-phase-nav-module.mjs
npm run test:kit -- --from test-phase-nav-catalog
```

## Done when

- Admin peut masquer `os.granola` → `GET /` ne le renvoie plus (non-owner
  avec permission absente **ou** hidden). Owner : décider et tester
  (recommandé : owner voit tout `available`, hidden s’applique quand même
  — documenter le choix dans `packages/nav/AGENTS.md`).
- Changeset minor `nav`, `os-ui`, `app-runtime`.

---

# BRIEF NAV-3 — Factory + chrome consomme le catalogue

## Mission

Plus aucun chrome généré / doc factory ne dit « recopiez OS_NAV ».
Loader unique `<NavCatalogLoader />`. Gate ratchet. **Dépend de NAV-2**.

## Livrable

1. `packages/nav/ui/nav-catalog-loader.tsx` (ou `shell-ui/ui`) :
   fetch `GET /api/v1/modules/nav`, bump version, alimente
   `configureSidebar({ getNavItems })`. API publique stable.
2. Factory `renderUiBrandChrome` : **plus** de `defaultOsPrimaryNavItems()`
   inline si NAV-2 est là — le loader suffit. `BRAND_NAV` métier reste
   **ou** disparaît si `GET /` inclut déjà `collectNavItems` (préférer
   tout via `GET /` : chrome = loader + adminItems).
3. `defaultOsAdminNavItems` consommé, pas recopié (si pas fait en NAV-1).
4. Gate `test-phase-os-nav-catalog.mjs` : chaque
   `OS_UI_ROUTE_SEGMENTS` primaire (`/taches`, `/mails`, `/granola`,
   `/grokbot`, `/parametres`, `/collaborateurs`) a une entrée catalogue
   **ou** `horsNavJustification` dans os-ui.
5. Grep fail-closed : `packages/factory/**` ne contient plus
   `"/granola"` ni `"/grokbot"` en literal chrome.
6. Doc upgrade dans `docs/PROPAGATION.md` + `docs/agents/CREATE-APP.md` :
   paragraphe « sidebar = catalogue, interdiction OS_NAV ».
7. **Ne pas** modifier les repos `tempoflow3` / `foove2` ici. Écrire
   le snippet d’upgrade **complet** dans `docs/plans/PLAN-NAV-CATALOG.md`
   §7 (Foove : supprimer `createNavMount` + `OS_NAV` ; TF3 : retirer
   les lignes OS de `NAV`).

## Tests

```bash
node --test scripts/test-phase-os-nav-catalog.mjs
npm run test:kit -- --from test-phase-os-ui-scaffold
```

## Done when

Une marque `creezio brand create` neuve montre Granola/GrokBot **sans**
que le générateur mentionne ces hrefs. Changeset minor `factory`,
`os-ui`, `nav`.

---

# BRIEF GRANOLA-1 — Fiche note + transcript + dossiers

## Mission

Passer l’UI `@creezio/granola` d’une grille sommaire à un **workspace
notes** : liste filtrable, fiche (summary + transcript paginé), dossiers.

Le **mount / client API existent déjà**. Interdit de réécrire le backend
sauf trou bloquant (alors changeset + gate).

## Existant (lire avant de coder)

| Fichier | Rôle |
|---|---|
| `packages/granola/ui/granola-client.tsx` | UI actuelle (3 blocs) |
| `packages/granola/src/mount.ts` | `GET notes`, `GET notes/:id`, `POST notes/:id/sync`, `GET remote/notes`, `GET remote/folders` |
| `packages/granola/src/client.ts` | `getNote({ include: "transcript" })`, `getTranscript`, `listFolders`, `listNotes` |
| `packages/granola/AGENTS.md` | Frontières |
| `docs/DOC-STANDARD-UI.md` | Kit graphique |

## UI cible (une page, pas de nouvelles routes Next)

Gabarit type `section-view-shell` (titre + actions) **avec primitives
kit uniquement** (`Card`, `CardHeader`, `Button`, `Input`, `Badge`,
`Tabs`, `ScrollArea`, `Sheet` ou `Dialog` pour la fiche, `Select`,
`Skeleton`, toasts `sonner`).

1. **Toolbar** : recherche titre (filtre local sur `GET notes`), Select
   dossier (`GET remote/folders` — empty si clé API absente, pas d’erreur
   bloquante), bouton « Synchroniser depuis Granola » =
   `GET remote/notes` puis sync des ids manquants via `POST notes/:id/sync`
   (batch borné, ex. 10, rate-limit burst 25 / 5 s — ne pas bombarder).
2. **Liste** : titre, summary clamp, date, badge dossier si dispo.
   Empty state déjà là : l’enrichir (CTA webhook). Loading skeletons.
3. **Fiche** (Sheet droite ou Dialog large, pas un Card coincé sous la
   liste) :
   - titre, dates, folder ;
   - Tabs `Résumé` | `Transcript` ;
   - Transcript : `GET notes/:id` d’abord ; si pas de transcript en local,
     proxy `GET` via client `getTranscript` — **ajouter une route mount**
     `GET notes/:id/transcript` (proxy) si elle n’existe pas, plutôt que
     d’appeler Granola depuis le browser ;
   - bouton « Re-synchroniser » → `POST notes/:id/sync` ;
   - pagination curseur transcript si l’API la renvoie (`next_cursor`).
4. Mobile : fiche en Sheet full-width. Vérifier viewport étroit si tu
   as un browser ; sinon tests + layout `flex-col`.

## Backend autorisé (minimal)

- `GET notes/:id/transcript` → proxy `client.getTranscript`.
- Optionnel : persister `transcript_json` / `folder_id` sur
  `granola_notes` **nouvelle migration** `granola_00N_*` (jamais
  renuméroter). Si tu persistes, masquer rien de secret.

## Interdit

- Afficher `apiKey` / `signingSecret` en clair (déjà masqués).
- Appeler `public-api.granola.ai` depuis le browser.
- SSE / websocket.
- Vocabulaire marque.

## Tests

Étendre `scripts/test-phase-granola.mjs` :

- `GET notes/:id/transcript` 401/409 sans clé, 200 avec fetch injectable ;
- sync note conserve le titre ;
- UI : au minimum un test mount ; pas de test React obligatoire si le
  package n’a pas de runner UI — ne pas inventer Jest.

```bash
npm run build -w @creezio/granola
node --test scripts/test-phase-granola.mjs
```

## Done when

On ouvre une note, on lit le résumé **et** le transcript (fixture
injectable). Changeset minor `granola`. Ne **pas** toucher factory /
sidebar (NAV-*).

---

# BRIEF GRANOLA-2 — Webhooks + santé + empty/error

## Mission

Rendre le connecteur **opérable** : gérer les endpoints webhook Granola
(list / patch / delete), santé signature, états vides / erreurs
actionnables. Ne pas refaire la fiche note (GRANOLA-1).

## Existant

Mount déjà : `GET webhook-info`, `POST register-webhook`,
`GET/PUT/DELETE config`, `GET events`,
`GET/PATCH/DELETE remote/webhook-endpoints`.

UI actuelle : un bouton « Enregistrer le webhook » + badges + liste
événements brute.

## UI cible (section Configuration + Livraisons)

1. **Santé**
   - badges : clé API, secret, URL HTTPS, endpoint id ;
   - si événements `verified=0` alors que secret configuré → bandeau
     fail-closed « signature invalide — livraisons rejetées / à auditer » ;
   - `publicBaseUrl` helper (placeholder origine actuelle).
2. **Endpoints distants** (`GET remote/webhook-endpoints`)
   - table : id, url, scopes, events ;
   - actions : Désactiver / Supprimer (`PATCH` / `DELETE`) avec confirm
     `AlertDialog` kit ;
   - « Enregistrer » existant conserve le `signing_secret` **côté
     serveur uniquement** (`secretStored: true`, jamais renvoyer le
     secret).
3. **Livraisons**
   - filtre type (`note.generated` / `note.edited` / `note.access_granted`) ;
   - badge `×N` retries déjà là ;
   - clic → scroll/highlight de la note liée si `note_id`.
4. **Erreurs** : toast `sonner` + texte `j.error` (déjà partiel). Distinguer
   `db_unavailable` (503) / module non monté (marque pas encore câblée) :
   message « Le module Granola n’est pas enregistré sur ce serveur »
   plutôt que « injoignable ».
5. Accessibilité : labels sur tous les inputs (DOC-STANDARD-UI).

## Backend

Rien d’obligatoire. Si `PATCH remote/webhook-endpoints/:id` est incomplet,
le compléter avec test fetch injectable.

## Tests

Étendre `scripts/test-phase-granola.mjs` : list/delete endpoint (mock
fetch), register-webhook ne leak pas `signing_secret` dans le body HTTP
client.

```bash
npm run build -w @creezio/granola
node --test scripts/test-phase-granola.mjs
```

## Conflits

GRANOLA-1 touche `granola-client.tsx` aussi. **Coordination** : extraire
dès le départ `granola-connect-panel.tsx` (config+webhook) et
`granola-notes-panel.tsx` (liste+fiche). Chaque agent **possède un
fichier**. Si GRANOLA-1 n’a pas encore extrait, **toi (GRANOLA-2) tu
extrais** le panneau connect et tu laisses un re-export pour le client
monolithe. Documente le split dans `packages/granola/AGENTS.md`.

---

# BRIEF GROKBOT-1 — Repos, modèles, usage, artefacts

## Mission

Enrichir l’UI `@creezio/grokbot` avec les **surfaces API déjà montées**
mais absentes de l’UI : sélecteur repos (cache 1 h), usage tokens,
artefacts + download.

## Existant

| Route mount | UI aujourd’hui |
|---|---|
| `GET/PUT config`, `GET status` | token + badge |
| `GET models` | `<select>` natif (pas le `Select` kit) |
| `GET repositories` | **absent** (saisie URL libre) |
| `POST/GET agents`, runs, cancel, archive | présent, rustique |
| `GET agents/:id/usage` | **absent** |
| `GET agents/:id/artifacts` + `.../download` | **absent** |

Client : `packages/grokbot/src/client.ts`. **Pas de SSE** (volontaire).
Rate limit repos : 1 req/min — le mount cache 1 h, `?refresh=1` force.
Ne **jamais** spammer `GET repositories` au poll 15 s.

## UI cible

1. **Lancer un agent** (Card existante)
   - `Select` kit pour **modèle** (`GET /models` une fois / session).
   - `Select` kit pour **repo** (`GET /repositories`, afficher
     `owner/name` ; valeur = url). Option « URL manuelle » si liste vide.
   - Bouton discret « Rafraîchir les repos » → `?refresh=1` + toast si
     429.
   - Checkbox PR déjà là → `Switch` kit si dispo.
   - Option **mode** `agent` | `plan` (body `mode` déjà typé
     `CursorCreateAgentBody.mode`) — Select.
2. **Panneau agent ouvert**
   - Bloc **Usage** : `GET agents/:id/usage` (tokens in/out si le JSON
     amont les a — afficher raw structuré, pas inventer d’unités).
   - Bloc **Artefacts** : liste `GET artifacts` ; download =
     `GET artifacts/download?path=` → ouvrir l’URL présignée **ou**
     télécharger via le mount (ne pas exposer le token Cursor).
   - Lien PR si `pr_url` / `git.branches[].prUrl` (déjà partiel dans les
     runs).
3. Remplacer `<textarea>` / `<select>` natifs par primitives kit
   (`Textarea` si exportée, sinon Input + class kit). Toasts `sonner`.

## Interdit

- Streaming SSE (hors scope, voir GROKBOT-2 pour le poll fin).
- Afficher le token en clair.
- Vocabulaire marque (`tempoflow`, `foove`…).
- Appeler `api.cursor.com` depuis le browser.

## Tests

Étendre `scripts/test-phase-grokbot.mjs` :

- `GET repositories` sert le cache (2ᵉ appel sans fetch amont) ;
- `?refresh=1` rappelle l’amont ;
- `GET usage` / `artifacts` passthrough mock.

```bash
npm run build -w @creezio/grokbot
node --test scripts/test-phase-grokbot.mjs
```

## Conflits

Même fichier `grokbot-client.tsx` que GROKBOT-2. **Toi tu possèdes**
`grokbot-launch-form.tsx` + `grokbot-usage-artifacts.tsx`. Extraire dès
le premier commit. GROKBOT-2 possède `grokbot-agent-runs.tsx`.

---

# BRIEF GROKBOT-2 — Runs live, follow-up, archive/unarchive

## Mission

Rendre le suivi d’un agent **lisible et vivant** sans SSE : poll ciblé,
timeline des runs, follow-up, unarchive, empty/error.

## UI cible

1. **Liste agents** : statut badge (déjà), repo, date ; filtre
   « Archivés » (unarchive via `POST .../unarchive` — route existante,
   **absente de l’UI**).
2. **Détail**
   - Poll **uniquement** l’agent ouvert : `GET agents/:id` +
     `GET .../runs` toutes les 3–5 s si un run est `RUNNING`/`CREATING`,
     sinon 15 s. **Ne plus** refetch models/repos dans ce poll.
   - Timeline : status, durée (`durationMs`), `result` (déjà), branches /
     PR cliquables.
   - Follow-up : Textarea kit + Envoyer (existant) + disable si run
     running (ou autoriser — rester aligné API ; si l’API accepte, laisser).
   - Cancel : existant, confirmer `AlertDialog`.
   - Lien « Ouvrir dans Cursor » existant : `Button` `asChild` + `a`.
3. **États**
   - Token manquant : card CTA, pas la liste vide mensongère.
   - 409 `cursor_api_key_missing` / `cursor_api_error` : message amont.
   - Module non monté : même copy que Granola-2.
4. Accessibilité + skeletons sur la timeline.

## Backend

Rien d’obligatoire. Interdit d’ajouter le SSE dans cette PR (complexe,
hors kit fetch injectable). Si tu documentes un follow-up SSE, le mettre
en `packages/grokbot/AGENTS.md` « hors scope v1 ».

## Tests

Étendre la gate : `POST unarchive`, `POST cancel` (mock). Pas de test
timer UI.

```bash
npm run build -w @creezio/grokbot
node --test scripts/test-phase-grokbot.mjs
```

---

# Prompt unique à coller (en-tête commun)

Chaque agent commence par ce bloc + **un seul** brief ci-dessus :

```text
Repo : creezio/creezio (kit @creezio/*).
Lis d'abord AGENTS.md racine, docs/RUNBOOK-AGENTS.md, le brief assigné
dans docs/agents/BRIEFS-NAV-GRANOLA-GROKBOT.md, et
docs/plans/PLAN-NAV-CATALOG.md (si brief NAV-*).
Patron module hybride : docs/adr/ADR-module-natif-hybride.md.
UI : docs/DOC-STANDARD-UI.md — primitives @creezio/shell-ui/ui/kit uniquement.
Interdit : secrets dans git/PR, vocabulaire marque (tempoflow/foove/winhub
/fidu/certivan) dans packages/*/src|ui, zod en dep, import runtime
api-kernel/platform-core, patcher node_modules, modifier tempoflow3/foove2.
Branche cursor/<brief-id>-<suffixe>. Changeset. Gates du brief vertes.
Réponds en français. Code complet dans tes commits, pas de diffs partiels
sur un fichier que tu réécris.
```

| Agent | Brief | Dépend de | Packages touchés |
|---|---|---|---|
| 1 | NAV-1 | — | `shell-ui`, `factory`, gate |
| 2 | NAV-2 | NAV-1 | **nouveau** `nav`, `os-ui`, `app-runtime` |
| 3 | NAV-3 | NAV-2 | `factory`, `os-ui`, `nav` |
| 4 | GRANOLA-1 | — | `granola` |
| 5 | GRANOLA-2 | — | `granola` (split fichiers) |
| 6 | GROKBOT-1 | — | `grokbot` |
| 7 | GROKBOT-2 | — | `grokbot` (split fichiers) |

Si seulement 3 agents : lancer **NAV-1**, **GRANOLA-1**, **GROKBOT-1**.
NAV-2 / UI restantes ensuite.
