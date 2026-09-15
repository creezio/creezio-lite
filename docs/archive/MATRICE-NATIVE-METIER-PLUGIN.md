# Matrice Natif / Métier / Plugin

> Cartographie **Phase H0** (2026-07-29), réalignée **D0** / **C0**, puis
> **R0** (intention OS : geler inventions ; V1–V3 = prototypes ≠ SoT).
> **M0→M16** (2026-07-30) : **vision stricte freeze** — stubs / façades /
> jumeaux = **NON done** (jamais « stub OK ») ; plan [PLAN-M.md](PLAN-M.md) ·
> freeze [PHASE-M16.md](PHASE-M16.md).
> **N0→N9** (2026-07-30) : **vision stricte 100 % freeze** — [PLAN-N.md](PLAN-N.md) ·
> [PHASE-N9.md](PHASE-N9.md) ; stubs / jumeaux = **NON done** ; **Paperclip** = mort.
> Versions courantes : TF **0.10.32** · Certivan **0.1.15** · Fidu **0.1.63**.
> **O0→O11** (2026-07-30) : plan [PLAN-O.md](PLAN-O.md) **fermé** —
> freeze [PHASE-O11.md](PHASE-O11.md) ; **ne pas lire O11 comme 100 % intention**.
> **État des lieux intention (post-O11)** :
> [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md) · roadmap
> [PLAN-P.md](PLAN-P.md) — **règle ×3=NATIF** ; plus de questions bloquantes ;
> post-cutover : Shell CRM + Tasks + MCP host tools (`open_external_tab` /
> AI tasks) + browser-tabs TF + fabrique TF/CV + aliases P29 ✅ ; restent
> **schemas/oauth twin (D-P28b)**, fingerprint Meili TF kit, settings métier ;
> Fidu `plugins`/`fleet=false` = config intentionnelle.
> Versions courantes : TF **0.10.33** · Certivan **0.1.16** · Fidu **0.1.65**.
> Légende : **✅** livré **et cutover marques prouvé** · **🟡** package/kit
> partiel ou jumeaux restants · **❌** absent / hors scope volontaire.
> **⚠️** Plusieurs lignes ci-dessous restent ✅ « package existe » (historique
> M/N/O) — la vérité cutover est dans l’état des lieux P* jusqu’à réécriture.
> **Paperclip** = mort (aucune marque).

Source cadre : [ARCHITECTURE-INTENTION.md](ARCHITECTURE-INTENTION.md).  
Gel inventions : [PHASE-R0.md](PHASE-R0.md). Database : [PHASE-R1.md](PHASE-R1.md).
Product Hub SoT : [PHASE-R2.md](PHASE-R2.md).
Vision stricte M* : [PLAN-M.md](PLAN-M.md) · [PHASE-M0.md](PHASE-M0.md) ·
[PHASE-M16.md](PHASE-M16.md).  
Vision stricte N* : [PLAN-N.md](PLAN-N.md) · [PHASE-N0.md](PHASE-N0.md) ·
[PHASE-N9.md](PHASE-N9.md).

---

## 1. Natif Creezio — packages / capacités

| Capacité | Package cible (ou existant) | Statut | Preuve / écart |
|----------|-----------------------------|--------|----------------|
| Identité marque / manifests | `@creezio/brand-config` | ✅ | `AppManifest`, Client+Serveur, manifests TF/Certivan/Fidu/DemoBrand |
| Paths / ports / profiles / local-config schéma | `@creezio/platform-core` | ✅ | paths, app-kind, connection, updater-state, embeds catalog |
| Preload / IPC / DesktopBridge | `@creezio/shell` | ✅ | `IpcChannels`, `createDesktopApi`, types bridge |
| Runtime Electron (boot, updater, tray, splash, window) | `@creezio/electron-shell` | ✅ | splash-ui, tray, updater, prepareDesktopBoot |
| Host Meili / search | `@creezio/electron-shell` (+ paths) | 🟡 | `host/meili-launcher`, `resolveMeiliDataDir` ; fingerprint `counts.fournisseurs` historique (P29) |
| Host tunnel | `@creezio/electron-shell` + platform-core | ✅ | `host/tunnel`, `tunnel-urls` |
| Host n8n | `@creezio/electron-shell` | ✅ | `host/n8n/*` (B.2) |
| Host Hermes | `@creezio/electron-shell` | ✅ | `host/hermes/*` (B.2) |
| Product Hub / plugins lifecycle + ACL L3/L4 | `@creezio/product-hub` | ✅ | **R2** SoT `core.db` (TF Next cutover) ; H5 ACL see/install/execute |
| **Fabrique plugins conversationnelle** | `@creezio/product-hub` (+ demobrand/console) | 🟡 | **C3** scaffold + console ; mounts marque **TF+CV** (`createPluginFactoryRoutes`) ; Fidu `plugins=false` = config |
| **Observabilité** (activité / usages / CP) | `@creezio/observability` | ✅ | **C4** SQLite console + demobrand + vendor TF pilote |
| **Automations lifecycle** (plugins/org) | `@creezio/automations` | ✅ | **V3 prototype** lifecycle-only — **≠** Database row-level ; C4 persist demobrand |
| **Database admin + automations row-level** | `@creezio/database` | ✅ | **M1–M2p** moteur + UI/routes kit ; TF/Certivan/Fidu sans panels locaux |
| Plugins host (spawn, grants, events) | platform-core + electron-shell | ✅ | `plugins/*`, control plane + `acl` option H5 |
| Desktop tooling publish / remote-build | `@creezio/desktop-tooling` | ✅ | publish-desktop, remote-build-win, after-pack |
| Factory new-app | `@creezio/factory` | ✅ | scaffold Client+Serveur + demobrand |
| Propagation kit→marques | `@creezio/propagation` | ✅ | semver, impact, canaux, extension points, registre L3 |
| Console ops | `apps/console` | ✅ | kit-versions (+ `ARCHITECTURE_VERSION` I0), feeds, gates, POST-H5 |
| **Auth** (session, login, recovery) | `@creezio/auth` | ✅ | Mémoire + **`createSqliteAuthStore` I1** ; **TF C1** SoT kit credentials + JWT/ACL brand |
| **Shell-UI / nav + slots** | `@creezio/shell-ui` | ✅ | **I7** : `createNavShellAdapter` + `NavRenderModel` ; TF/Certivan/Fidu I12/I16/I18 |
| **Assistant / chat** | `@creezio/assistant` | ✅ | **I2** + **C1** rich schema ; **TF C1** chat-db façade kit (plus dual-write) |
| **API kernel** (façade HTTP cœur) | `@creezio/api-kernel` | ✅ | ScopedDbAccess H2 + `authorizePluginAccess` H5 |
| **MCP façade / proxy** | `@creezio/mcp-facade` | 🟡 | H4/H5 + OAuth/`createMcpHonoApp` mince ×3 ; host tools SoT (`createOpenExternalTabHostMcpTools` + `createAiTaskHostMcpTools`) cutover ×3 ; **reste schemas/oauth twin D-P28b** |
| **Tasks** (natif plateforme, kanban+AI inclus) | `@creezio/tasks` | ✅ | Cutover ×3 : `tasks.ts` / `cabinet-tasks` / kanban / AI absents marques ; SoT kit store+UI+`createTasksHonoRoutes` ; mounts mince `/api/v1/tasks` |
| **Mails** (natif plateforme) | `@creezio/mails` | 🟡 | Store+UI kit ; pages `/mails` kit ×3 ; Fidu `uiEnabled: true` — polish/providers encore ouverts |
| **Shell CRM** (sidebar/workspace/cockpit/setup/onboarding/search) | `@creezio/shell-ui` (+ `onboarding` / `cockpit`) | ✅ | Cutover ×3 : sidebar/workspace/search/setup/cockpit absents marques ; SoT `shell-ui` + `@creezio/onboarding` + `@creezio/cockpit` |
| **Fleet** (ops telemetry) | observability + platform-core + shell-ui | ✅ | SoT kit `observability/fleet-collector` (P25) ; marques = env/domaine + wrappers ≤80 LOC ; Fidu `fleet:false` = config |
| Sync vendor standardisé | `scripts/sync-creezio-vendor.sh` | ✅ | **I0** — assert `ARCHITECTURE_VERSION=H6`, CJS, wrappers 3 marques |
| Politique republish | [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) | ✅ | I14/I16/I18 livrés ; suite D3/D4/D5 si runtime packaged |
| **SQLite multi-fichiers** (core / brand / plugin) | `@creezio/platform-core` | ✅ | paths H1 + `createSqliteRuntime` / migrations H2 |
| Splash / host stack (contrat lazy) | `@creezio/electron-shell` | ✅ | splash + host-stack pattern ; Fidu `clientSlim: false` — ADR I17, réouverture **D5** |

---

## 2. Modules métier TempoFlow (exemples) — **repo marque**, pas kit

Ces lignes restent dans **tempoflow2** (ou équivalent). Statut = existence
produit observée — **pas** une cible d’extraction kit.

| Module métier | Repo | Statut produit | Extraction / mounts brand | Notes kit / dette |
|---------------|------|----------------|---------------------------|-------------------|
| Panier | tempoflow2 | ✅ | ✅ `modules/panier` API+MCP+nav | Jamais dans `@creezio/*` |
| Dispatch | tempoflow2 | ✅ | ✅ `modules/dispatch` API+MCP+nav | Idem |
| Relevés | tempoflow2 | ✅ | ✅ `modules/releves` API+MCP+nav | Idem |
| Optimiser | tempoflow2 | ✅ | ✅ nav via dispatch (`brand.optimiser`) | Algo reste lib TF |
| Catalogue / catalog-sync | tempoflow2 | ✅ | ✅ **I11** API+MCP+nav (`createCatalogueMount`) | Plus 🟡 — faux écart corrigé D0 |
| Supplier tabs / marketplaces | tempoflow2 | ✅ | ✅ nav `brand.fournisseurs` (+ catalogue) | UI fournisseurs brand |
| Stack | tempoflow2 | ✅ | ✅ **I11** API+MCP+nav (`createStackMount`) | Plus 🟡 — faux écart corrigé D0 |
| Scan | tempoflow2 | ✅ | ✅ **D3** API resolve/search/add-to-panier + nav | Produit figé UI→panier ; pas de tables dédiées |

> **Fleet** = natif plateforme (P25), pas module métier — voir §1 et état des lieux §0/§B.

**Contrat d’accueil kit** : ✅ shell-ui + api-kernel + MCP scindé.  
**H3 / I11 / M13** : modules TF dans `tempoflow2/crm/electron/modules/` +
`brand-runtime.ts` ; allowlist métier-only [PHASE-M13.md](PHASE-M13.md)
(voir aussi [PHASE-H3.md](PHASE-H3.md), [PHASE-I11.md](PHASE-I11.md)).

Autres marques (indicatif, hors extraction) :

| Marque | Exemples métier | Repo | Conso H6 / gold M* |
|--------|-----------------|------|---------------------|
| Fidu | GED, CRM (`dossiers`/`contacts`/`ged`) | `/opt/docker/fidu` | **M15 gold** ; core = `platformCoreMigrations` ; ship **0.1.60** ; Paperclip absent |
| Certivan | RTI / VASP (`dossiers`/`pieces`/`rti`) | `/opt/docker/certivan-app` | **M14 gold** ; core = `platformCoreMigrations` ; **0.1.15** |

---

## 3. Plugins — sidecars organisation

| Capacité | Où | Statut | Notes |
|----------|-----|--------|-------|
| Manifest / events / execution grant | `@creezio/platform-core` | ✅ | Contrats purs |
| Lifecycle / PRD / impact / n8n tags / ACL | `@creezio/product-hub` | ✅ | + `createSqliteProductHubStore` (H1.8) ; demobrand opt-in sqlite |
| Fabrique conversationnelle (intention→plugin) | product-hub factory + demobrand | ✅ | **C3** scaffold réel + console SQLite + PrdDrafter |
| Control plane HTTP host | `@creezio/electron-shell` + product-hub | ✅ | **C7** — `startHostPluginControlPlane` unifié TF/Certivan/Fidu/demobrand |
| Registre org L3 | `@creezio/propagation` | ✅ | **I6** : `createFileOrgPluginRegistry` + console `/api/org-plugins` |
| UI Admin Plugins multi-org | demobrand + product-hub admin | ✅ | **I5** : `admin-plugins` API + HTML ; caps see/install/execute |
| DB `plugin/<id>` à l’install | `@creezio/platform-core` `ensurePluginDb` | ✅ | Fichier créé à l’install uniquement |
| ACL granulaire qui voit/utilise | product-hub `acl` + sqlite store | ✅ | **L3 livré** TF/Certivan/Fidu (I10/I16/I18) — plus « L4 user-only » |
| Univers perso totalement séparé | — | ❌ *(volontaire)* | Hors scope — plugins = **orga** |

Promotion plugin → module natif **marque** : processus humain (voir architecture) ;
point d’extension `vertical.plugin.promoted` / `kit.plugin.accepted` déjà
nommés dans `@creezio/propagation` (contrats, pas automation).

---

## 4. Synthèse rapide (freeze M16 + N9)

| Couche | ✅ | 🟡 | ❌ |
|--------|----|----|-----|
| Natif socle | brand-config… fabrique C3, obs C4, lifecycle automations V3, **Database R1**, CP C7, `platformCoreMigrations` M11 ; **N6** admin UI kit ; **N7** browser-tabs kit (TF cutover) ; MCP host tools SoT ; P29 aliases | schemas/oauth twin ; fingerprint Meili TF ; settings métier | — |
| Métier TF | panier…scan ; browser-tabs kit + allowlist ; **M13** + **N8** allowlists ; main slim ; ship **0.10.33** | schemas twin ; settings métier | — |
| Métier Certivan | **M14 gold** RTI + core kit ; **N6p** admin cutover ; plugin-factory mount ; ship **0.1.16** | schemas twin | — |
| Métier Fidu | **M15 gold** GED/CRM + core kit ; GED = `createFiduModuleMcpTools` ; admin mcp/analytics/api ; ship **0.1.65** | `plugins`/`fleet=false` config ; schemas twin | — |
| Plugins | hub + ACL L3 3 marques ; fabrique C3 + mounts TF/CV ; obs/automations C4 ; CP C7 | Fidu factory off | auto-promotion / univers perso / cloud registry *(volontaire)* |

**Vision stricte M0→M16** = **signée**.  
**Vision stricte N0→N9** = **signée** ([PHASE-N9.md](PHASE-N9.md)) — stub / jumeau ≠ done.  
**Plan O0→O11** = **fermé** ([PHASE-O11.md](PHASE-O11.md)) — vision intention
**~76 %** honnête (jumeaux / MCP SoT / vocabulaire TF kit = dettes).  
**Socle** H0–H5 + I0–I18 + D0–D6 + V1–V3 + M* + N* + O* = cadre fermé.  
Addendum vision : [VISION-V1-V3.md](VISION-V1-V3.md) · freeze M16 · freeze N9 ·
freeze O11.

### SHAs gold N9

| Marque | SHA | Note |
|--------|-----|------|
| TempoFlow | `c85bb0f` | N6p admin cutover |
| Certivan | `51c7c22` | N6p + N7 façades |
| Fidu | `5e5367d` | N7 + release **0.1.63** |
| Kit | voir [PHASE-N9.md](PHASE-N9.md) | N0→N9 |

### SHAs gold O11

| Marque | SHA | Note |
|--------|-----|------|
| TempoFlow | `30d8627` | ship **0.10.33** |
| Certivan | `e0c9e43` | ship **0.1.16** |
| Fidu | `15f415f` | ship **0.1.65** |
| Kit | `8879de4` | O0→O11 · vision ~76 % |

### Historique correction C* (fermé)

[PHASE-C0.md](PHASE-C0.md) → **C1–C8** : dual-write TF stores → **cutover SoT kit**
(C1) ; Certivan C2 dualités MCP+stores fermées ; mounts Fidu (C5) ; RTI (C6) ; CP unifié (C7) ;
republish (C8). Plus de rétention brand « shadow only » — kit SoT.
