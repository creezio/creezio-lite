# État des lieux — intention OS Creezio (post-O11, arbitrage ×3)

| | |
|--|--|
| **Date** | 2026-07-30 |
| **Baseline mesurée** | kit `6844bd3` tip (post-cutover shell/tasks) · TF/CV/Fidu sync vendor H6 |
| **SoT intention** | [ARCHITECTURE-INTENTION.md](ARCHITECTURE-INTENTION.md) · [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) · R0 |
| **Plans fermés (≠ 100 % intention)** | M16 · N9 · O11 (~76 % auto-déclaré sur sous-ensemble) |
| **Ce doc** | Règle ×3 · carte piliers → écart réel → dettes → Plan P* jusqu’à intention |

> **Interdit de lire ceci comme un audit MCP.** MCP est **un pilier parmi
> d’autres**. Le fil conducteur = *plateforme porte tout le commun ; marques =
> minimum métier ; zéro jumeau plateforme*.

---

## 0. Règle d’arbitrage UNIQUE (intention première)

**Si une fonctionnalité existe (ou existait avant nos cassures) dans les TROIS
projets TempoFlow + Certivan + Fidu → c’est NATIF plateforme (`@creezio/*`),
avec config optionnelle si besoin.**

| Cas | Verdict |
|-----|---------|
| Présent ×3 (même forme divergente) | **NATIF** — extraire / éteindre jumeaux locaux |
| Présent ×2 + 3ᵉ feature-off / absent UI mais store/dep kit | **NATIF** + config optionnelle (pas « métier ») |
| Spécifique à **une seule** marque | **MÉTIER** (panier TF, RTI/VASP CV, GED/Pennylane Fidu, …) |

**Conséquences verrouillées (plus jamais de « questions bloquantes ») :**

- Tasks / kanban ×3 → **NATIF** (même sans config connue ; kanban+AI/Hermes inclus).
- Cockpit + onboarding / setup ×3 → **NATIF shell**.
- Product Hub / plugins / fabrique, Fleet, Mails, Auth UI, Assistant surfaces,
  Database UI, Search / sidebar / workspace → **NATIF** dès que ×3 (preuve §B).
- `features.plugins/fleet=false` (Fidu) = **config optionnelle**, pas un trou
  produit ni une invitation à reclasser en métier.
- `resolveBrandDbPath` / `resolvePluginDbPath` peu utilisés = **dette adoption
  API** (P02), pas une question ouverte.

Les anciennes « 5 questions bloquantes » (§B trous) étaient une **erreur de
cadrage**. Elles sont **retirées** ; chaque point est tranché par preuve code
ci-dessous.

---

## A. Pourquoi on n’avance pas (causes structurelles)

Cinq freezes (M16, N9, O11 + audits) ressortent ~75 % pour les **mêmes raisons** :

1. **Done = package kit existe + gate verte**, pas « marque = minimum métier ».
   La matrice marque ✅ dès qu’un `@creezio/*` est présent et syncable — alors
   que TF/CV gardent encore des **dizaines de kLOC** de plateforme locale
   (shell UI, tasks kanban, plugin-products, oauth MCP, cockpit…).

2. **Chaque plan redéfinit « 100 % » comme la fin de *son* chemin critique.**
   M* = modules/cutovers ciblés ; N* = hosts/assistant/migrations ; O* =
   anti-façades + host mince + quelques jumeaux. Aucun plan n’a pris comme
   gate la checklist **intention §4** (CMS complet + marques sans jumeaux).

3. **Extraction sans extinction.** On porte TF → kit, on sync vendor, on laisse
   la copie marque « pour ne pas casser ». Résultat : **double SoT** (kit +
   brand). Les gates O8 interdisent les façades ≤40 LOC, pas les jumeaux
   500–1100 LOC.

4. **Matrice ✅ ≠ consommation produit.** Ex. fabrique conversationnelle ✅
   (demobrand/console) mais **0** usage dans TF/CV/Fidu ; `@creezio/tasks` ✅
   (+ UI kanban kit) alors que TF/CV gardent `src/lib/tasks.ts` ~725 LOC
   (+ runners IA jumelés) et Fidu un autre jumeau (`cabinet-tasks` + kanban local).

5. **Audits successifs recentrés sur le dernier chantier** (MCP O4r, host O7,
   vocabulaire O9) → on re-mesure un sous-ensemble et on re-publie ~76 %.

6. **Cadrage faux « est-ce métier ? »** sur des surfaces ×3 (tasks, cockpit,
   onboarding…) → paralysie artificielle. **Corrigé par §0.**

**Conclusion :** on n’est pas à 76 % d’un OS presque fini. On est à **socle
packages largement créé**, avec une **dette transversale massive** :
*les marques ne sont pas encore des compositions minces*.

---

## B. Verdict ×3 — surfaces plateforme (mesure 2026-07-30)

Légende présence : **local** = code marque encore SoT UI/HTTP ; **kit** =
consomme `@creezio/*` ; **off** = feature flag / UI absente mais capacité
plateforme ; **twin** = TF↔CV sim≥0,85.

| Feature | TF | CV | Fidu | Verdict | Où ça vit aujourd’hui | Cassé / jumeau par cutovers ? |
|---------|----|----|------|---------|------------------------|-------------------------------|
| **Tasks / kanban (+ AI/Hermes)** | mount mince `routes/tasks` (~8 LOC) + page kit | idem | idem (plus de `cabinet-tasks` / kanban local) | **NATIF** | SoT `@creezio/tasks` (+ UI kanban + `createTasksHonoRoutes`) ; cutover ×3 **DONE** | Non — jumeaux éteints |
| **Cockpit (server shell)** | import `@creezio/cockpit/ui` | idem | mount kit (parité) | **NATIF shell** | SoT `@creezio/cockpit` ; cutover ×3 **DONE** | Non |
| **Onboarding / setup** | import `@creezio/onboarding/ui` + steps métier | idem | idem | **NATIF shell** | SoT `@creezio/onboarding` (`SetupWizard` + moteur) ; steps métier restent marque | Non — setup/onboarding plateforme éteints |
| **Product Hub / plugins HTTP** | stub → `createPluginProductsRoutes` | stub kit | store kit ; `features.plugins=false` *(config intentionnelle)* | **NATIF** (+ config) | SoT `@creezio/product-hub` HTTP ; mounts **DONE** ; fabrique TF+CV (P10) | HTTP OK ; Fidu flag ok |
| **Fabrique plugins** | flag/mount kit | mount kit (`PRODUCT_HUB_FACTORY`) | 0 (`plugins=false`) | **NATIF** | Kit + demobrand/console ; **shippé TF+CV** ; Fidu off = config | P10 **PARTIEL** (Fidu) |
| **Fleet** | wrapper env mince | wrapper + `fleet-dossier-samples` métier | `features.fleet=false` *(config intentionnelle)* | **NATIF** (+ config) | SoT `@creezio/observability/fleet-collector` (P25) **DONE** | Non |
| **Mails** | page `/mails` → `@creezio/mails/ui` | idem | `uiEnabled: true` + kit UI | **NATIF** (+ config UI) | SoT `@creezio/mails` ; UI cutover **largement DONE** (Fidu on) | Mineur polish |
| **Auth / login UI** | `LoginForm` `@creezio/auth/ui` | idem | idem | **NATIF** | SoT `@creezio/auth` store+UI ; cutover **DONE** | Non |
| **Assistant surfaces** | mount mince `createAssistantRoutes` | idem | idem | **NATIF** | Runtime + routes SoT `@creezio/assistant` ; mounts **DONE** | Non (HTTP gras éteint) |
| **Database UI** | façade mince + kit panels | idem | idem | **NATIF** | `@creezio/database` ; policy teintée TF = P29 | Partiel OK |
| **Search global** | `@creezio/shell-ui` `GlobalSearchProvider` | idem | idem | **NATIF** | SoT kit ; cutover **DONE** (`search-history` lib locale mince ok) | Non |
| **Sidebar / nav shell** | `@creezio/shell-ui` sidebar | idem | idem | **NATIF** | SoT kit ; cutover **DONE** | Non |
| **Workspace / tabs** | `@creezio/shell-ui` workspace | idem | idem | **NATIF** | SoT kit ; cutover **DONE** | Non |
| **Boot Electron** | `creezio-boot.ts` ~90 | ~91 | ~85 | **NATIF** | Composition encore locale ×3 | Mineur |
| **MCP façade** | oauth/app mince kit ; AI + `open_external_tab` → kit | idem | AI + `open_external_tab` kit ; GED = factory modules | **NATIF** (façade+OAuth) | `@creezio/mcp-facade` (`createOpenExternalTabHostMcpTools`) + `createAiTaskHostMcpTools` ; cutover ×3 **DONE** ; **D-P18 PARTIEL** (schemas) | Oui — schemas twin |
| **Browser-tabs** | kit `electron-shell/browser-tabs` (+ allowlist métier) | façades kit | façades kit | **NATIF** (+ métier TF) | SoT kit ; cutover TF **DONE** (`supplier-tabs.ts` local éteint) | Non — métier via allowlist |
| **n8n provisioning plugins** | ~315 twin | twin | — | **NATIF** (hub) | Encore brand TF/CV | Oui |
| **Schemas / oauth MCP** | `schemas.ts` ~823 + `oauth.ts` ~61 twin | twin | twin ~814 / 65 | **NATIF** | Encore brand ×3 — **D-P28b OPEN** | Oui |
| **Settings desktop** | pages/settings marque + kit `shell-ui/ui/settings` | idem | idem | **NATIF** (+ métier) | Chrome settings kit ; **settings métier** encore marque — **OPEN** | Partiel |

### Métier (une seule marque) — hors extraction kit

| Feature | Marque | Preuve |
|---------|--------|--------|
| Panier, dispatch, relevés, catalogue, scan, supplier-tabs | **TF only** | modules TF |
| RTI / VASP / dossiers pièces atelier | **CV only** | modules Certivan |
| GED, Pennylane, contacts/cabinet métier, relances | **Fidu only** | modules Fidu |

### Anciens « trous » — réponses par preuve (plus de questions)

| Ancien trou | Réponse |
|-------------|---------|
| Tasks kanban AI/Hermes natif ou vertical ? | **NATIF.** ×3 (TF/CV twin + Fidu kanban/routes/AI). Kit a déjà store + UI kanban partielle. Extraire gold TF, éteindre locaux, aligner Fidu. |
| Cockpit / setup / onboarding shell ou marque ? | **NATIF shell.** Setup-wizard sim≥0,93 ×3 ; onboarding ×3 ; cockpit TF+CV twin, Fidu = dette parité shell. |
| Fleet-collector kit ou infra hors repo ? | **NATIF ops** → SoT kit/console ; marques = flag + samples. |
| Fidu `plugins/fleet=false` permanent ? | **Config optionnelle** plateforme (N5). Capacité reste native ; on peut réactiver sans reclasser métier. |
| `resolveBrand/PluginDbPath` absents ? | **Dette adoption P02** — API kit existe ; runtime marques encore sur alias `resolveDbPath`. Pas bloquant produit pour classer les surfaces. |

---

## C. Carte de l’intention première (piliers)

Source : ARCHITECTURE-INTENTION §1–4 + matrice §1–3 + R0/VISION (prototypes ≠ SoT).

| # | Pilier | Rôle | Kit | Marque | Plugin |
|---|--------|------|-----|--------|--------|
| P01 | Identité / multi-exe | Manifest Client+Serveur+publish, feeds, bridge | `brand-config`, tooling | data branding, secrets feeds | — |
| P02 | SQLite multi-fichiers | `core` / `brand` / `plugin/<id>` jour 0 | `platform-core` runtime | schéma métier brand + seeds | DB à l’install |
| P03 | Shell IPC / DesktopBridge | Canaux preload, API desktop | `shell` | bindings noms marque | — |
| P04 | Runtime Electron | Boot, updater, tray, splash, window | `electron-shell` | wiring mince + labels | — |
| P05 | Host Meili | Search launcher + index plateforme | `electron-shell` | indexeurs / schémas métier | — |
| P06 | Host tunnel | URLs / service tunnel | `electron-shell` + platform-core | domaine marque | — |
| P07 | Host n8n | Runtime embed n8n | `electron-shell` | hooks ≤ mince | sidecars tags |
| P08 | Host Hermes | Runtime agent central | `electron-shell` | skills métier | — |
| P09 | Product Hub | Lifecycle plugins, ACL L3, control-plane, store `core.db` | `product-hub` + host CP | evidence FS ; **config** on/off | sidecars |
| P10 | Fabrique plugins | Intention→PRD→scaffold | `product-hub` (+ console/demobrand) | mounts TF+CV ; Fidu config off | résultat |
| P11 | Observabilité | Activité / usages / CP | `observability` | mounts / pas de 2ᵉ moteur | events |
| P12 | Automations lifecycle | plugin/org/factory/obs triggers | `automations` (**≠** DB row-level) | — | — |
| P13 | Database admin + auto row-level | Browse/CRUD/views + automations données | `database` | `configureDatabasePolicy` métier | — |
| P14 | Auth | Session, login UI, recovery, core.db | `auth` + shell-ui | branding / JWT ACL si besoin | — |
| P15 | Shell-UI / nav + slots | Nav + sidebar + workspace + cockpit + setup/onboarding + search | `shell-ui` | slots métier + labels | nav plugin |
| P16 | Assistant runtime | Chat, tools plateforme, UI | `assistant` | prompts/Meili/règles déclaratives | tools découverts |
| P17 | API kernel | Façade HTTP cœur + mount modules/plugins | `api-kernel` | modules API métier | APIs plugin |
| P18 | MCP façade | **Un** MCP app : cœur + modules + plugins | `mcp-facade` | factory modules métier | tools plugin |
| P19 | Tasks plateforme | CRUD + **kanban + AI/Hermes** natifs | `tasks` (+ assistant hermes) | **0** jumeau kanban | — |
| P20 | Mails plateforme | Boîte / index générique | `mails` | providers / templates ; UI on/off config | — |
| P21 | Sync vendor / propagation | Kit→marques, semver, registres | scripts + `propagation` | wrappers sync | org registry |
| P22 | Desktop ship | remote-build, publish, feeds | `desktop-tooling` | packing marque | — |
| P23 | Factory new-app | Scaffold Client+Serveur | `factory` + demobrand | — | — |
| P24 | Console ops | Versions, feeds, gates, factory demo | `apps/console` | — | — |
| P25 | Fleet / ops telemetry | Agent flotte, samples, settings | `observability` + `platform-core` + `shell-ui` | feature flag / samples métier | — |
| P26 | Modules métier | API+MCP+nav+data **marque** | **contrats seulement** | TF/CV/Fidu modules | — |
| P27 | Couche plugins orga | Sidecars ACL, data isolée, discovery façades | hub + host | feature on/off | **plugins** |
| P28 | Anti-jumeau plateforme | Transversal : 0 copie plateforme dans marques | gates + extract | delete cutover | — |
| P29 | Kit sans domaine marque | Capacités génériques ; labels via config | ADR no-brand-domain | i18n / configure* | — |

### Hors scope volontaire (docs — ne pas compter comme dette 100 %)

- Auto-promotion plugin → module marque
- Univers perso hors org
- Cloud registry multi-tenant

---

## D. État réel par pilier (mesure 2026-07-30)

Légende écart : **OK** / **PARTIEL** / **ABSENT produit** / **INVENTÉ à côté** (prototype).

| Pilier | État | Preuve mesurable | Écart vs intention |
|--------|------|------------------|--------------------|
| P01 Identité / multi-exe | **OK** | Manifests + electron-builder ×3 ; Client+Serveur | Mineur (docs packing) |
| P02 SQLite multi-DB | **PARTIEL** | `createSqliteRuntime` ×3 ; `platformCoreMigrations` ; **0** `resolveBrandDbPath` / `resolvePluginDbPath` dans marques | Layout conceptuel kit ; adoption API paths incomplète |
| P03 Shell IPC | **OK** | `@creezio/shell` deps ×3 ; preload mince O7 | — |
| P04 Electron runtime | **PARTIEL** | `electron-shell` ~24,5 kLOC kit ; host sous plafonds O7 ; `creezio-boot.ts` ~85–91 LOC ×3 locaux | Boot jumeau mince |
| P05 Meili | **PARTIEL** | Host kit ; indexeurs métier marques | OK frontière ; fingerprint kit encore teinté TF (`counts.fournisseurs`) — P29 |
| P06 Tunnel | **OK** | Host kit + domaines marque | — |
| P07 n8n | **PARTIEL** | Host kit ; `n8n-plugin-provisioning.ts` ~315 LOC twin TF↔CV | Provisioning encore jumeau marque |
| P08 Hermes | **PARTIEL** | Host kit ; skills marque ; kanban tasks marque jumelé | Couplage tasks/Hermes encore brand |
| P09 Product Hub | **OK mounts** | HTTP SoT kit `createPluginProductsRoutes` ; stubs TF/CV ; Fidu `plugins:false` *(config)* | Vertical/factory UI = P10 |
| P10 Fabrique plugins | **PARTIEL** | demobrand + console ; mounts kit **TF+CV** ; Fidu `plugins:false` | Fidu off = config ; critère « ≥1 marque » **DONE** (CV) |
| P11 Observabilité | **PARTIEL** | Package ~7,2 kLOC ; deps ×3 ; Fidu admin `/admin/{mcp,analytics,api}` pages **DONE** | Parité ops/lifecycle encore mince |
| P12 Automations lifecycle | **PARTIEL** | Dep ×3 ; surface surtout demobrand / brand-runtime TF | Peu de surface produit |
| P13 Database | **OK** | `@creezio/database` fail-closed ; allowlists métier ×3 marques ; panels locaux absents | — |
| P14 Auth | **OK** | `@creezio/auth` store + `LoginForm` kit ; cutover UI ×3 **DONE** | — |
| P15 Shell-UI | **OK cutover** | sidebar / workspace / search SoT `shell-ui` ; setup/onboarding `@creezio/onboarding` ; cockpit `@creezio/cockpit` ; cutover ×3 **DONE** | Libs minces `nav-context` / `search-history` locales ok |
| P16 Assistant | **OK mounts** | `createAssistantRoutes` monté mince ×3 ; runtime kit | — |
| P17 API kernel | **PARTIEL** | Package existe ; modules montés marques | Façade unique pas partout |
| P18 MCP façade | **PARTIEL** | `create*BrandMcp` ×3 ; OAuth/`createMcpHonoApp` mince ×3 ; AI host SoT `@creezio/tasks` ×3 ; `open_external_tab` SoT `@creezio/mcp-facade` ×3 ; GED Fidu = factory modules ; restent schemas twin | **D-P18 PARTIEL** (D-P28b) |
| P19 Tasks | **OK** | SoT kit store+UI+routes ; jumeaux locaux éteints ×3 ; mounts mince | — |
| P20 Mails | **OK largement** | UI/API kit ×3 ; Fidu `uiEnabled: true` | Polish providers |
| P21 Sync / propagation | **OK** | dry-run H6 + kitSha ; vendor incl. onboarding/cockpit | — |
| P22 Desktop ship | **OK** | Feeds : TF 0.10.33 · CV 0.1.16 · Fidu 0.1.65 | — |
| P23 Factory / demobrand | **OK kit** | apps/demobrand | Preuve scaffold ≠ marques minces |
| P24 Console | **OK kit** | apps/console | — |
| P25 Fleet | **OK** | collector SoT kit (`observability/fleet-collector`) ; Fidu `fleet:false` | Flag = config |
| P26 Modules métier | **OK frontière** | symlink `modules`→`electron/modules` ×3 | — |
| P27 Plugins discovery | **PARTIEL** | Host kit ; Fidu feature-off | Config, pas reclassement |
| P28 Anti-jumeau | **PARTIEL** | Shell/tasks/auth/mails/browser-tabs cutover **DONE** ; restent schemas/oauth/n8n/scripts | D-P28b + scripts |
| P29 Kit sans domaine TF | **PARTIEL** | SoT générique + **aliases hygiene DONE** (gate `test-phase-p29`) ; reste fingerprint Meili TF + wire HTTP historique | **D-P29 PARTIEL** |

### Chiffre jumeaux (ne pas omettre)

| Périmètre | Fichiers | LOC (TF) |
|-----------|---------:|---------:|
| TF↔CV même path sim≥0.85 **produit** (`src/`+`electron/`) | 111 | **~21 650** |
| dont UI shell-ish (layout/cockpit/workspace/mail/setup/desktop/search) | ~18+ | **~6 500+** |
| dont lib tasks/AI/onboarding/oauth/n8n | ~10+ | **~5 000+** |
| dont server (assistant/tasks/plugin-products/mcp/schemas) | ~18 | **~5 700** |
| Scripts/tests/fleet-collector twins | ~67 | **~14 000** |
| `modules/` duplique `electron/modules` | — | **Non** — symlink M10 ✅ |

---

## E. Inventaire RESTANT (dettes = écarts piliers)

Sévérité : **P0** = ×3 encore local / bloque marques minces ; **P1** pilier
incomplet ; **P2** hygiene ; **P3** polish.

| ID | Zone (pilier) | Symptôme mesurable | Impact | Sév. | Effort | Dépendances |
|----|---------------|--------------------|--------|------|--------|-------------|
| D-P28a | Shell-UI (P15+P28) | ~~twins sidebar/workspace/cockpit/setup/search~~ → cutover ×3 kit | — | **DONE** | — | — |
| D-P19 | Tasks (P19+P08) | ~~jumeaux `tasks.ts`/kanban/AI~~ → SoT `@creezio/tasks` ×3 | — | **DONE** | — | — |
| D-P09 | Product Hub (P09) | HTTP mounts kit **DONE** ; factory UI/vertical reste | Factory = P10 | **DONE mounts** | — | P10 |
| D-P16 | Assistant surface (P16) | mounts `createAssistantRoutes` mince ×3 **DONE** | — | **DONE mounts** | — | — |
| D-P18 | MCP (P18) | AI host + `open_external_tab` SoT kit cutover ×3 **DONE** ; oauth/app mince **DONE** ; GED Fidu factory modules ; reste schemas twin | ≠ une liste tools | **P1 PARTIEL** | M | D-P28b |
| D-P25 | Fleet (P25) | collector SoT kit ; wrappers env marque ; Fidu `fleet:false` = config | — | **DONE** | — | — |
| P10 | Fabrique (P10) | mounts kit **TF+CV** ; Fidu `plugins:false` | Vision produit Fidu off | **PARTIEL** | M | Fidu config |
| D-P20 | Mails (P20) | UI kit ×3 ; Fidu `uiEnabled: true` | Polish providers | **DONE largement** | S | — |
| D-P14 | Auth UI (P14) | `LoginForm` kit ×3 | — | **DONE** | — | — |
| D-P07 | n8n provisioning | ~315 twin | brand SoT | **P2** | M | P09 |
| D-P04 | Boot | `creezio-boot` ~90 ×3 | composition non unique | **P2** | S | — |
| D-P02 | Multi-DB paths | resolveBrand/Plugin quasi 0 | adoption floue | **P2** | M | — |
| D-P29 | Domaine kit | aliases hygiene **DONE** ; reste fingerprint Meili TF + wires HTTP | kit ≠ 100 % générique | **P2 PARTIEL** | M | P05 |
| D-P11 | Obs Fidu | admin `/admin/{mcp,analytics,api}` pages kit **DONE** | lifecycle/ops parité | **PARTIEL** | S | — |
| D-P12 | Automations lifecycle | peu hors demobrand | V3 | **P2** | M | — |
| D-P28b | Schemas/oauth MCP | schemas + oauth twin ×3 | serveur plateforme brand | **P1 OPEN** | L | D-P18 |
| D-browser-tabs | Browser-tabs TF | ~~`supplier-tabs.ts` local~~ → kit `browser-tabs` + allowlist métier | — | **DONE** | — | — |
| D-settings | Settings métier | chrome settings kit ; pages/settings métier encore marque | frontière package | **P2 OPEN** | M | P15 |
| D-P28c | Scripts twins | ~14 kLOC | CI ×2 | **P3** | L | après runtime |
| D-GATES | Gates/CI | brand roots `/opt/docker` → sibling resolve ; `npm test` **505/505** ; p0/p-shell-ui | — | **DONE** | — | durcir anti-twin |
| D-MATRICE | Docs | Shell/Tasks/MCP host/browser-tabs/P10 CV ✅ ; restes honnêtes | — | **DONE partiel** | S | — |

---

## F. Plan d’implémentation par dette (critères falsifiables)

### D-GATES + D-MATRICE (d’abord process)

1. **Done** : gate kit échoue si fichier plateforme (allowlist inverse) encore jumeau TF↔CV sim≥0,85 hors allowlist **métier** ; matrice ✅ seulement si cutover marques prouvé.
2. **Étapes** : `scripts/lib/intention-twins.mjs` + `scripts/test-phase-p0-intention.mjs` ; rewrite légende matrice ; [PHASE-P0.md](PHASE-P0.md).
3. **Preuve** : `npm test` (p0) mesure cutover (jumeau local XOR SoT kit) ; p1/p2 durcissent l’absence.
4. **Ordre** : **avant / en parallèle immédiat** des extractions P0 code.
5. **Risque** : faux positifs métier — allowlist panier/GED/RTI/Pennylane.

### D-P28a — Shell-UI / cockpit / workspace / setup / onboarding / search

1. **Done** : 0 jumeau `sidebar` / `tab-workspace-context` / `server-cockpit-shell` / `setup-wizard` / `onboarding-*` plateforme / `global-search-provider` entre TF et CV ; Fidu consomme les mêmes exports kit ; marques ≤ wiring + slots + steps métier onboarding.
2. **Étapes** : inventaire gold TF → extract `shell-ui` ; cutover TF→CV→Fidu ; delete locaux.
3. **Preuve** : sim path absent ou sim&lt;0,4 ; build×3 ; smoke shell/onboarding.
4. **Ordre** : **P0 code** (avec tasks).
5. **Risque** : slots nav métier — tests nav ×3.

### D-P19 — Tasks natifs complets (kanban + AI/Hermes)

1. **Done** : `tasks.ts` / `ai-task-*` / routes tasks génériques / kanban UI **absents** des marques (ou wrappers ≤ mince) ; SoT `@creezio/tasks` (+ assistant hermes) ; Fidu sans `cabinet-tasks` jumeau.
2. **Étapes** : extract gold TF → kit ; cutover TF→CV→Fidu ; delete.
3. **Preuve** : `test ! -f src/lib/tasks.ts` × TF/CV ; kanban tests verts ×3 ; Fidu `/taches` via kit.
4. **Ordre** : **P0 code** parallèle shell.
5. **Risque** : Hermes sync / AI workspace — smokes existants.

### D-P09 / P10 — Product Hub HTTP + fabrique

1. **Done** : 0 `plugin-products.ts` jumeau ; routes = mount kit ; fabrique **shippée** TF+CV (`createPluginFactoryRoutes`) — plus de ✅ cosmétique demobrand-only. Fidu `plugins=false` = config.
2. **Étapes** : ~~extract routes gold TF → product-hub ; cutover CV~~ **DONE** ; optionnel activer Fidu.
3. **Preuve** : `test-plugin-factory-wire` CV ; mounts TF/CV.
4. **Ordre** : après P0 shell/tasks (ou juste après gates).
5. **Risque** : grants / n8n tags.

### D-P18 — MCP une SoT

1. **Done** : host-tools = host-only ; `createMcpOAuthRoutes` / `createMcpHonoApp` mince ×3 ; `createAiTaskHostMcpTools` SoT `@creezio/tasks` ×3 ; `createOpenExternalTabHostMcpTools` SoT `@creezio/mcp-facade` ×3 ; Fidu GED = factory modules (`module.ged.*`).
2. **Étapes** : schemas twin (D-P28b) ; égalité `listTools` Electron = Hono = assistant.
3. **Preuve** : `test-phase-p18-host-tools` ; `test-phase-p18-open-external-tab` ; smokes MCP ×3.
4. **Ordre** : après D-P09.
5. **Risque** : clients MCP externes (aliases).

### D-P16 / D-P25 / D-P20 / D-P14 / …

Voir tableau §E : done = « jumeau plateforme absent + import kit + test marque »
(ou feature-off **documenté comme config**, jamais comme reclassement métier).

---

## G. Roadmap séquencée — Plan P* (incréments poussables)

**Règles :** une vague = un incrément poussable (kit + marques touchées) ;
façade/re-export ≠ done ; pas de « P(n+1) si gate intention rouge » ;
extraire TF gold ; **règle §0** — **pas** de vague « décisions humaines » sur
les surfaces ×3.

```text
P0  Gates intention + matrice honnête + doc §0     (S)   ← PROCESS
P1  Shell-UI jumeaux (sidebar/workspace/cockpit/     (XL) ← CODE P0
    setup/onboarding/search) → kit + cutover ×3
P2  Tasks+AI+Hermes kanban → kit SoT + extinction    (XL) ← CODE P0
    jumeaux TF/CV/Fidu
P3  Product Hub routes + n8n provisioning            (L)
P4  MCP SoT unique (GED Fidu + trim host)            (L)
P5  Assistant routes + mounts plafonds               (M)
P6  Auth login UI + mails UI parité (config Fidu)    (M)
P7  Fleet collector → kit/ops (flag Fidu reste ok)   (M)
P8  Server twins (schemas, mcp/oauth)                (L)
P9  Boot creezio-boot + multi-DB paths clairs        (M)
P10 Purge vocabulaire TF kit (P29)                   (L)
P11 Obs/automations lifecycle parité marques         (M)
P12 Fabrique plugins shippée ≥1 marque               (L)
P13 Scripts/tests twins hygiene                      (L)
P14 Freeze intention 100 % (checklist §H) + republish (S)
```

**Sessions estimées :** ~**14–18** (plus de branchement sur « si métier » —
tasks/shell sont **toujours** P1–P2).

**Chemin critique :** `P0 → P1 → P2 → P3 → P4 → … → P14`.

---

## H. Critère 100 % intention (checklist cochable)

Si **un** item reste ouvert → **pas** 100 %.

### Intention structurelle

- [ ] Commun uniquement dans `@creezio/*` ; marques = data + modules API/MCP/nav + config/labels/branding
- [ ] **0** jumeau plateforme TF↔CV (sim≥0,85) hors allowlist métier explicite *(reste schemas/oauth/n8n/scripts)*
- [x] **0** façade/re-export « done » (même ≤40 LOC) *(gates O8 + intention)*
- [x] Paperclip mort (déjà vrai)
- [ ] Domaine TF absent des API/labels kit — aliases hygiene **DONE** ; reste fingerprint Meili TF — **D-P29 PARTIEL**
- [ ] SQLite `core`/`brand`/`plugin/<id>` : chemins + runtime utilisés clairement (doc + code alignés)
- [x] Multi-exe Client+Serveur+publish par marque (déjà vrai) + feeds à jour après cutovers runtime

### Piliers natifs — cutover marques

- [x] Shell-UI : pas de sidebar/cockpit/workspace/setup/onboarding/search plateforme locaux jumelés — **D-P28a DONE**
- [x] Auth UI : login générique kit (marque = branding) — **D-P14 DONE**
- [x] Tasks : SoT kit **complet** (CRUD + kanban + AI/Hermes) — **D-P19 DONE**
- [x] Mails : UI/API natifs kit ; Fidu `uiEnabled: true` — **D-P20 largement DONE**
- [x] Database : panels + engine kit + policy sans fuite domaine TF non configurée *(fuite labels = P29)*
- [x] Product Hub : HTTP/control-plane/store mounts kit ; ACL L3 — **D-P09 mounts DONE**
- [x] Fabrique plugins : **shippée** ≥1 marque hors demobrand (TF+CV mounts) — **P10 PARTIEL** (Fidu `plugins=false` = config)
- [ ] Observabilité + automations lifecycle : consommation réelle ou feature-off config *(Fidu admin mcp/analytics/api ✅ ; lifecycle encore mince)*
- [x] Fleet : SoT kit/ops ; pas de collector jumeau — **D-P25 DONE** *(Fidu `fleet=false` = config intentionnelle)*
- [x] Hosts Meili/tunnel/n8n/Hermes : wiring mince seulement *(n8n provisioning twin = D-P07 ; fingerprint Meili TF = D-P29)*
- [x] Assistant : runtime kit ; mounts brand plafonnés — **D-P16 mounts DONE** ; tools via MCP unique = D-P18
- [ ] API kernel + MCP : une façade ; plugins découverts dans `listTools` — **D-P18 PARTIEL / D-P28b OPEN** (schemas twin)
- [x] Sync vendor H6 + kitSha ×3
- [x] Browser-tabs : TF cutover kit `electron-shell/browser-tabs` — **D-browser-tabs DONE**
- [ ] Settings métier : chrome kit vs pages métier marque — **D-settings OPEN**

### Gold TempoFlow / métier marques

- [ ] Aucune régression features TF (panier, dispatch, relevés, catalogue, scan, supplier-tabs, **kanban natif**)
- [ ] Certivan RTI / Fidu GED : features métier intactes après cutovers

### Process

- [x] Gate `test-phase-p0-intention` / `test-phase-p-shell-ui` verte (Shell/Tasks ✅ si cutover prouvé)
- [x] Gates brand roots : `/opt/docker` → sibling resolve ; `npm test` **505/505**
- [x] Matrice : ✅ seulement si cutover prouvé ; 🟡/❌ sincères *(Shell CRM + Tasks + MCP host tools + browser-tabs + P10 CV ✅)*
- [ ] Plan P* fermé **sans** redéfinir 100 % comme « gates plan »
- [ ] Republish TF/CV/Fidu post-cutovers runtime

---

## I. Références

- [ARCHITECTURE-INTENTION.md](ARCHITECTURE-INTENTION.md)
- [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md)
- [PLAN-P.md](PLAN-P.md)
- [PHASE-R0.md](PHASE-R0.md) · [VISION-V1-V3.md](VISION-V1-V3.md)
- [PLAN-M.md](PLAN-M.md) · [PHASE-M16.md](PHASE-M16.md)
- [PLAN-N.md](PLAN-N.md) · [PHASE-N9.md](PHASE-N9.md)
- [PLAN-O.md](PLAN-O.md) · [PHASE-O11.md](PHASE-O11.md)
- [ADR-assistant-tools-mcp.md](ADR-assistant-tools-mcp.md)
- [ADR-no-brand-domain-in-native-packages.md](ADR-no-brand-domain-in-native-packages.md)

---

*Livrable mesure + arbitrage (post-cutover shell/tasks/auth/mails/hub/assistant/fleet/MCP-host/browser-tabs/P10-CV/P29-aliases).
Restent ouverts honnêtement : **D-P28b** schemas/oauth twin ×3 ; **Meili fingerprint TF**
dans kit indexer (D-P29) ; **Fidu `plugins`/`fleet=false`** = config intentionnelle ;
**settings métier** (D-settings).*
