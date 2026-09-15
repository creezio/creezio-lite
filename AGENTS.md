# Creezio Lite : profil Sites

Pour une nouvelle application ChatGPT Sites, lire START-HERE.md puis docs/COMPATIBILITY.md. Utiliser les compétences Sites installées. Le dépôt complet est un fork du kit Creezio ; le profil Sites réside dans template/ et packages/sites-adapter/.

- Garder les 36 packages upstream, leurs dépendances, leur factory, les sources React et le design. Ne pas reconstruire une sidebar, des onglets ou un thème ressemblant à Creezio.
- Le shell est WorkspaceRoot de @creezio/shell-ui/ui ; les composants natifs possèdent leur interface.
- Les différences de code upstream sont inventoriées dans upstream-patches.json ; toute différence non recensée est une erreur du contrôle de provenance.
- Hermes et n8n sont exclus du runtime Sites sur demande du propriétaire. Les packages desktop/serveur sont préservés en source ; leur présence ne signifie pas qu’ils s’exécutent sur Sites.
- API native : monter les véritables modules dans api-kernel et injecter la persistance D1. Ne pas déguiser D1 asynchrone en SQLite synchrone. Requêtes paramétrées et filtrées par org_id, identité vérifiée par Sites, mutations contrôlées par origine et rôle.
- Ne pas utiliser de stockage en mémoire pour remplacer une fonctionnalité serveur non portée. Décrire précisément les fonctionnalités qui exigent encore une adaptation ou un service externe.
- Vérifier avec npm run test:sites, npm run check, typecheck et build du template puis deux applications générées. Les tests upstream natifs sont distincts (npm test).
- template/creezio est généré : modifier la source, puis npm run sync:template. Ne pas remplacer un lockfile lors de l’installation.
- Les workflows de publication npm et propagation upstream sont conservés dans upstream-workflows/, sans déclenchement dans ce fork.

Les instructions upstream ci-dessous s’appliquent aux packages d’origine ; la section Sites ci-dessus précise les adaptations de ce fork.

---

# AGENTS — monorepo `creezio`

> **Agents/devs : lisez d'abord [docs/RUNBOOK-AGENTS.md](./docs/RUNBOOK-AGENTS.md)** — topologie serveurs, release kit→apps, runners, gates CI, deploy, cookbook incidents.

Guide pour agents IA travaillant sur le kit plateforme `@creezio/*`.

## Mission du repo

Le kit est la **source of truth (SoT)** du socle desktop Creezio (CMS stable) :
auth, shell UI, API, MCP, assistant, tasks, mails, observability, plugins host,
Electron runtime, tooling publish, factory, propagation.

Les marques (`winhub`, `tempoflow3`, `foove2`…) consomment le kit en **packages npm
versionnés** (`@creezio/*` publiés sur GitHub Packages —
[docs/NPM-DISTRIBUTION.md](./docs/NPM-DISTRIBUTION.md)) + wiring métier.
**Le métier vertical reste dans les repos marque.**

Toute marque générée par la factory = **2 repos** :

1. **Monorepo marque** (`server/` métier + Docker, `client/` desktop thin
   remote-only, avec `brand-spec/` à la racine et `docker-data/` runtime
   gitignoré). **Pas de `admin/` dans le monorepo.**
2. **Repo admin dédié** `<brand>-admin` (privé, jamais public) : l'app admin
   de la marque (pilotage flotte, support, billing… — voir
   [docs/adr/ADR-admin-app-os.md](./docs/adr/ADR-admin-app-os.md)), config
   sans secrets, `docker-data/` runtime gitignoré.

La factory crée les 2 repos (`creezio brand apply` / `new-app`, push GitHub
via `github-repos.ts`). Plus de layout plat ni de `admin/` embarqué (détection
legacy conservée côté tooling). Voir [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Carte de documentation

| Zone | Doc humaine | Doc agents | Inventaire fichiers |
|------|-------------|------------|---------------------|
| Racine | [README.md](./README.md) | **ce fichier** | [docs/PACKAGES.md](./docs/PACKAGES.md) |
| Chaque `packages/*` | `packages/<pkg>/README.md` | `packages/<pkg>/AGENTS.md` | `packages/<pkg>/docs/FILES.md` |
| Apps | `apps/*/README.md` | `apps/*/AGENTS.md` | `apps/*/docs/FILES.md` |
| Scripts/gates | [scripts/README.md](./scripts/README.md) | [scripts/AGENTS.md](./scripts/AGENTS.md) | [scripts/docs/FILES.md](./scripts/docs/FILES.md) |
| Architecture | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | [docs/ARCHITECTURE-INTENTION.md](./docs/ARCHITECTURE-INTENTION.md) | [docs/archive/](./docs/archive/) (historique) |
| Ops flotte | [docs/RUNBOOK-FLOTTE.md](./docs/RUNBOOK-FLOTTE.md) | **skill** [.cursor/skills/creezio-fleet-ops/SKILL.md](./.cursor/skills/creezio-fleet-ops/SKILL.md) | — |

**Règle** : ne pas créer un mega-doc unique — mettre à jour le package concerné.

## Frontières absolues

1. **Pas de domaine marque** dans `@creezio/*` (ADR `ADR-no-brand-domain-in-native-packages.md`).
2. **Kit = SoT plateforme** ; brands = métier + `configure*` / bindings.
3. **Isolation DB** : `core` / `brand` / `plugin/<id>` — deny cross-layer.
4. **Fidu** : `features.plugins` / `features.fleet` peuvent être `false` — ne pas forcer.
5. **Dual-write interdit** : cutovers C* terminés ; pas de shadow brand « en plus » du kit.

## Install-dir data layout (toutes marques)

Packagé (`app.isPackaged`) : **toutes** les données runtime vivent sous
`{installDir}/data/` — pas sous Roaming / `%APPDATA%`.

| Chemin | Contenu |
|--------|---------|
| `{installDir}/data/` | `userData` Electron (`app.setPath`) |
| `{installDir}/data/logs/` | journal main (`{logBasename}.log`) |
| `{installDir}/data/crash-reports/` | JSON crash + `pending/` |
| `{installDir}/data/sqlite/`, embeds… | DB, Hermes/n8n homes, Meili… |

- Windows NSIS : `Local\Programs\<Product>\data\` (writable utilisateur).
- AppImage : `{dirname($APPIMAGE)}/data/` (le mount squashfs est read-only).
- Dev / non packagé : comportement Electron + remap `userDataSegment` inchangé.
- SoT : `resolvePackagedDataDir` / `guessPackagedDataDir` (`@creezio/platform-core`),
  ancré dans `startBrandDesktop` + `prepareDesktopBoot` — la factory/`--from-prd`
  hérite automatiquement via `@creezio/app-runtime`.
- NSIS : crée `$INSTDIR\data` à l’install ; purge optionnelle à la désinstall.
- Ne **pas** documenter Roaming comme lieu des logs pour les builds packagés.

## Ordre de build / dépendances

Voir `package.json` script `build:packages`. Ordre typique :

`brand-config` → `shell` → `platform-core` → `product-hub` → `api-kernel` →
`mcp-facade` → `auth` → `shell-ui` → `nav` → `os-ui` → `onboarding` →
`interactive-demo` → `cockpit` →
`assistant` → `tasks` → `mails` → `support` → `integrations` → `granola` → `grokbot` → `fleet` → `observability` → `landing` → `admin` → `automations` →
`database` → `browser-host` → `search` → `host-runtime` →
`electron-shell` → `brand-spec` →
`app-runtime` → `desktop-tooling` → `factory` → `propagation` → `build:cjs`.

Après changement runtime consommé par les marques : **`npm run build:packages`
obligatoire**, puis changeset + merge `main` → publication npm
(`docs/NPM-DISTRIBUTION.md`) ; la marque consomme via `npm update "@creezio/*"`.
Un dist stale (src monté, dist pas rebuild) est **refusé** fail-closed par la
gate `test-phase-runtime-dist-freshness` (ADR.1b généralisée) et par
`creezio server-docker publish|build` (`scripts/lib/assert-runtime-dist.mjs` —
contrats src↔dist + hash de contenu).

## Où modifier quoi

| Besoin | Package |
|--------|---------|
| Identité desktop / feeds / GUID | `brand-config` |
| Preload / IPC contracts | `shell` |
| Paths, SQLite multi-fichier, embeds env | `platform-core` |
| Product Hub / ACL plugins / factory PRD | `product-hub` |
| Façade HTTP `/api/v1` | `api-kernel` |
| MCP unifié / OAuth / host tools | `mcp-facade` |
| Session / login / recovery | `auth` |
| Nav + chrome CRM UI | `shell-ui` |
| Catalogue sidebar + overrides admin (`/admin/nav`, `brand.db`) | `nav` |
| Pages Next OS (mails/tâches/setup/admin…) matérialisées dans les marques | `os-ui` |
| First-run setup + onboarding produit hybride (contenu DB + preferences) | `onboarding` |
| Démo interactive native (product tour live, faux curseur, scénarios DB) | `interactive-demo` |
| Landing page publique de marque (`lp.{zone}`, contenu DB éditable admin) | `landing` |
| Server cockpit UI | `cockpit` |
| Chat / Hermes Work / tools | `assistant` |
| Kanban / AI missions | `tasks` |
| Inbox mails | `mails` |
| Tickets support serveur marque (page `/support`) | `support` |
| Ops / fleet / analytics / request-logs | `observability` |
| Backend flotte typé (gestes Docker, updates, agent hôte, protocole agent↔backend) | `fleet` |
| Modules apps admin de marque (fleet/support/prospection/roadmap/billing) | `admin` |
| Automations lifecycle plugins/org | `automations` |
| Intégrations / clés API tierces (`integration://<slug>`, sync n8n) | `integrations` |
| Webhook + sync notes Granola (meeting notes) | `granola` |
| Pilotage d'agents cloud via l'API Cursor v1 (token, runs) | `grokbot` |
| Admin Database CRUD | `database` |
| Recherche Meili (feed, indexation, browse, cohérence) | `search` |
| Host runtime Node pur (hermes, n8n, tunnel, plugins, sandbox, server-launcher) | `host-runtime` |
| Desktop Electron (boot, fenêtres, tray, updater, splash) | `electron-shell` |
| Chromium serveur IA (CDP, driver, screencast) | `browser-host` |
| Façade desktop marque (`startBrandDesktop`) | `app-runtime` |
| BrandSpec YAML / doctor | `brand-spec` |
| Publish / remote-build | `desktop-tooling` |
| `creezio new-app` / `creezio brand` | `factory` |
| Serveur Docker headless multi-instances | `docker/server` + `creezio server-docker` — gestes ops : skill [creezio-fleet-ops](./.cursor/skills/creezio-fleet-ops/SKILL.md) |
| Semver / impact / registre org | `propagation` |

## Tests

```bash
npm run test:kit         # gates pures kit (~100) — 100 % vertes partout, fail-fast
npm run test:brands      # gates lisant les repos marque (~55) — skip auto si absents
npm run test:env         # gates lourdes opt-in (4 : cold-warm, factory-prd, docker-parity)
npm test                 # les ~159 gates en un node --test (CI complet)
npm run build:packages   # tsc + dual CJS
```

Gates liées aux packages : `scripts/test-phase-*.mjs`. Ne pas « fixer » un gate
en affaiblissant l’assert sans comprendre la dette documentée. Matrice
suite→prérequis : [scripts/README.md](./scripts/README.md).

Workflow : `npm run test:kit` → première rouge → corriger →
`npm run test:kit -- --from <gate>`. Les skips sont toujours explicites
(raison affichée), jamais silencieux.

## Pièges connus

- **dist stale → package/image sans routes** : `dist/` est gitignoré. Modifier
  un mount en `packages/*/src` sans `npm run build:packages` puis release/publish
  embarque un dist vieux → routes absentes en prod (vécu Admin Database).
  Protection fail-closed : gate `test-phase-runtime-dist-freshness` (dans
  `test:kit`) + `server-docker publish|build`. Avant
  tout publish : `cd /opt/docker/creezio && npm run build:packages`.
  Bypass urgence uniquement : `CREEZIO_SKIP_RUNTIME_DIST_ASSERT=1` (déconseillé).
- **Meili = composant CORE fail-closed (comme SQLite)** : dès qu'un feed
 déclare ≥ 1 index (`catalog_products`, …), le boot **échoue explicitement**
 si le binaire Meili est absent / ne démarre pas (`MeiliRequiredError`,
 plus de `engine:"sql-fallback"` silencieux) ; les listes catalogue
 (browse/filtre/pagination, **y compris sans `q`**) passent par Meili, et
 Meili KO = **503 `meili_unavailable`** (ou `engine:"indexing"` pendant
 l'indexation initiale) — **zéro LIKE SQL de secours sur le catalogue**.
 SQL reste légitime UNIQUEMENT hors index : entité non indexée, agrégats
 lourds, écritures, joins non indexés, bornes prix sur relevés, EAN,
 fiche by id, filtre rejeté (visible). Échappatoire dev/tests hors-browse
 uniquement : `CREEZIO_ALLOW_NO_MEILI=1` (warning bruyant, interdit en
 prod). Chaque module métier déclare son schéma data + index
 (`meiliIndexes`) **ou** `horsIndexJustification` — doctor brand-spec
 fail-closed `MODULE_MEILI_MISSING` (0.10.13+). Détail :
 [`packages/electron-shell/AGENTS.md`](./packages/electron-shell/AGENTS.md)
 (section Meili) + `app-runtime` (feed/boot).
- **Bug générique marque → fix kit/factory d'abord** : si le défaut touche
  toute marque générée (layout, smokes, scaffold, Docker, auth harness…),
  corriger dans `@creezio/*` / `packages/factory` puis publier (changeset) —
  **interdit** de « documenter seulement » une marque (workaround docs
  TF3-only) pour un trou factory. Descente marque = release npm + `npm
  update` + alignement docs, pas le SoT.
- **Plugins Electron** : dans `electron-shell` `host/plugins/launcher.ts`, le
  handler `child.on("exit")` doit comparer `cur?.child === child` avant
  `running.delete(id)`, sinon un restart après PUT files efface le process
  respawné.
- **zod v3/v4** : ne pas ajouter `zod` aux dependencies d'un nouveau package —
  le hoisting npm résout la v3 attendue par le reste du kit (une v4 locale
  casse les types croisés). Utiliser les helpers de `@creezio/tasks` qui
  encapsulent déjà zod.
- **Identité git** : ne jamais toucher `git config` — committer avec
  `git -c user.name=Creezio -c user.email=creezio@users.noreply.github.com commit …`.
- **Consommation après publish** : tout changement kit n'existe pour les
  marques qu'après **publication npm** (merge `main` → publish.yml) puis
  `npm update "@creezio/*"` côté marque — le lockfile pinne la version,
  donc update toujours APRÈS la publication, jamais avant.
- **Layout `node_modules` hôte** : clone marque → `npm ci` racine (workspace
  — hoisting racine). Docker pose `/app/node_modules` via `npm ci -w server`.
- **Vocabulaire marque dans le kit** (frontière n°1) : toute nouvelle
  occurrence de `tempoflow` / `certivan` / `fidu` / `winhub` / `foove` /
  `TF2` / `TF3` / `chr-catalog` dans `packages/*/src|ui` est refusée
  fail-closed — gate `test-phase-no-brand-vocab` (`test:kit`), dette héritée
  ratchetée dans `scripts/no-brand-vocab-allowlist.json` (compteurs
  décroissants + tickets audit F1.x, on n'y ajoute JAMAIS rien).
- **Import statique d'`electron` dans `electron-shell/src/host/**`** : casse
  le chargement Node pur (tests kit, harness serveur). Valeurs via
  `loadElectron()` (`host/load-electron.ts`, unique exception), types via
  `import type` — gate `test-phase-host-no-electron` (`test:kit`).
- **Bump partiel des manifests marque** : une app a plusieurs manifests à
  deps `@creezio/*` (server, server/ui, client) ; un bump partiel = CI verte
  mais ancienne page os-ui servie (incident login 0.6.0, règle d'or
  [docs/PROPAGATION.md](./docs/PROPAGATION.md)). Protection : doctor
  brand-spec `CREEZIO_MANIFEST_MISALIGNED` (error) + gate
  `test-phase-creezio-manifest-align` (`test:kit`).
- **`brand-desktop-runtime.ts` n'est PAS un runtime legacy mort** : c'est
 le moteur desktop partagé — `startBrandDesktop` (chemin moderne) le
 consomme via `installBrandOsDesktop`. Pas de branche marque dedans ; la
 compat héritée (`desktop/legacy-brand-compat.ts`) a été **retirée en H10**
 — défauts génériques inline, clients legacy migrés par le codemod
 `scripts/codemods/H10/` (ADR
 `docs/adr/ADR-p2a-desktop-legacy-freeze.md`, note de clôture).
- **Import runtime `@creezio/*` hors ordre de build** : un import runtime
  (non `import type`) vers un package construit après soi = dist
  stale/absent sur build frais ; idem cycle runtime. Gate
  `test-phase-build-order-imports` (`test:kit`) — SoT ordre :
  `node scripts/build-workspaces.mjs --packages-only --list`.

## Propagation vers marques

1. Changer le kit + build + changeset.
2. PR kit mergée sur `main` → publication npm (publish.yml).
3. Côté marque : `npm update "@creezio/*"` + commit du lockfile.
4. Adapter wiring / tests marque si l’API publique change (codemods
   fournis sur bump ARCHITECTURE_VERSION).
5. `test:shell` / gates marque.

## Guides de création (`docs/agents/`)

Guides pas-à-pas exploitables sans contexte préalable (commandes copiables
+ checklist) :

| Je veux créer… | Guide |
|---|---|
| une app marque (happy path) | [CREATE-APP.md](./docs/agents/CREATE-APP.md) |
| une marque (interview BrandSpec) | [CREATE-BRAND.md](./docs/agents/CREATE-BRAND.md) |
| un package kit `@creezio/*` | [CREATE-PACKAGE.md](./docs/agents/CREATE-PACKAGE.md) |
| un plugin (template kit ou marque) | [CREATE-PLUGIN.md](./docs/agents/CREATE-PLUGIN.md) |
| un module métier de marque | [CREATE-MODULE.md](./docs/agents/CREATE-MODULE.md) |
| un module d'app admin | [CREATE-ADMIN-MODULE.md](./docs/agents/CREATE-ADMIN-MODULE.md) |

## Créer une app (happy path)

**Une commande** — [docs/agents/CREATE-APP.md](./docs/agents/CREATE-APP.md)
+ skill [`.cursor/skills/creezio-create-app/SKILL.md`](./.cursor/skills/creezio-create-app/SKILL.md) :

```bash
creezio brand create --id acme --name Acme --domain acme.local
creezio brand module init articles --app /chemin/acme
```

`creezio demo-app` est **déprécié** (exit 1). Plus de module notes par
défaut, plus de `server/crm/`.

Interview BrandSpec seule : [CREATE-BRAND.md](./docs/agents/CREATE-BRAND.md).

## Legacy — brief produit TempoFlow3 (`--from-prd`)

Toujours supporté, **pas** le happy path. Fixture :
[`docs/experiences/tempoflow3/PRD-PRODUIT.md`](./docs/experiences/tempoflow3/PRD-PRODUIT.md)
(`vertical: chr` explicite). Un `product.md` stub = **error** (plus de
fallback notes).

```bash
creezio new-app \
  --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md \
  --out apps/tempoflow3 --force
```

ADR : [`docs/adr/ADR-factory-from-prd.md`](./docs/adr/ADR-factory-from-prd.md).

## Ne pas faire

- Committer des secrets / PAT.
- Extraire du métier TF/CV/Fidu « pour faire joli » dans le kit.
- Modifier `docs/archive/PHASE-*.md` historiques pour cacher une régression (ajouter une note / nouvelle phase).
- Toucher `apps/demobrand` comme produit client — c’est une sandbox kit.
- Réécrire toute la doc dans un seul fichier à la racine.
- Exiger un plan ingénieur (host-stack, phases P*) pour naître une app :
  utiliser `creezio brand create` (CREATE-APP). `--from-prd` = legacy TF3.

## Liens rapides

- [docs/PACKAGES.md](./docs/PACKAGES.md) — index de tous les packages
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — modes de déploiement, boot, admin
- [.cursor/skills/creezio-fleet-ops/SKILL.md](./.cursor/skills/creezio-fleet-ops/SKILL.md) — runbook flotte (créer serveur/compte, login, publish/update, admin, enroll, client, diagnostics)
- [docs/MATRICE-NATIVE-METIER-PLUGIN.md](./docs/MATRICE-NATIVE-METIER-PLUGIN.md)
- [docs/PROPAGATION.md](./docs/PROPAGATION.md)
- [docs/BACKLOG.md](./docs/BACKLOG.md) — dettes restantes assumées
- [docs/experiences/tempoflow3/PROMPT-PRODUIT.md](./docs/experiences/tempoflow3/PROMPT-PRODUIT.md)
- [docs/adr/ADR-factory-from-prd.md](./docs/adr/ADR-factory-from-prd.md)
