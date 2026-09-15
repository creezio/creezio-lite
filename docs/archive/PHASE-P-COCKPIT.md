# Phase P — Cockpit serveur → `@creezio/cockpit`

| | |
|--|--|
| **Statut** | ✅ **IMPLEMENTED** — package + cutover TF→CV→Fidu |
| **Date** | 2026-07-30 |
| **Package cible** | **`@creezio/cockpit`** (nouveau package dédié UI server-cockpit) |
| **Arbitrage placement** | [AUDIT-SHELL-UI-SCOPE.md](AUDIT-SHELL-UI-SCOPE.md) — cockpit **hors** `shell-ui` ; après `@creezio/onboarding` (`feff378`) |
| **Repos** | TF `tempoflow2` `5c7339d` · CV `certivan-app` `d0e63ae` · Fidu `fidu` `1cc301a` · kit `creezio` `feff378` |
| **SoT intention** | [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md) §0 (×3 = NATIF) · preuve §B cockpit |
| **Hors scope ce plan** | Implémentation / scaffold · cutover marques · onboarding/tasks/MCP · extract settings/sidebar/workspace shell-ui · inventer un cockpit métier Fidu |

> **Placement définitif.** UI cockpit serveur = **`packages/cockpit`**
> (`@creezio/cockpit`). **Pas** un sous-dossier de `shell-ui`. **Pas**
> fourré dans onboarding/tasks. Splash reste `@creezio/electron-shell`.
> Routes Hono / libs data restent **marque** (ou extract serveur ultérieur).

> Validation user OK — livré `@creezio/cockpit` + cutover ×3.

---

## 0. Verdict en une phrase

**Cockpit UI TF ≡ CV** (sim ≥ 0,99, ~1 464 LOC UI + 180 LOC health/routes
identiques) → **NATIF `@creezio/cockpit`** = moteur UI (shell autonome +
client CRM) + **hooks de perso** (brand / deep-link / download / flags
onglets). **Fidu : pas d’UI cockpit** — infrastructure plateforme déjà là
(`app-kind` → `cockpitPath`, garde-fou Electron, `plugin-acl`) → **dette
parité à créer** au cutover, **pas** un produit métier distinct à inventer.

---

## 1. Audit comparatif TF × CV × Fidu

### 1.1 Fichiers & volumétrie — mesuré 2026-07-30

| Surface | TF | CV | Fidu |
|---------|----|----|------|
| `components/cockpit/server-cockpit-shell.tsx` | **926** LOC | **926** (sim **0,999**) | **absent** |
| `components/cockpit/cockpit-client.tsx` | **490** LOC | **490** (sim **0,999**) | **absent** |
| `app/server-cockpit/page.tsx` | 19 | 19 (sim **1,000**) | **absent** |
| `app/cockpit/page.tsx` | 29 | 29 (sim **0,991**) | **absent** |
| `server/routes/cockpit.ts` | 81 | 81 (sim **1,000**) | **absent** |
| `lib/cockpit-health.ts` | 99 | 99 (sim **1,000**) | **absent** |
| **Total UI** (`components` + pages) | **1 464** | **1 464** | **0** |
| **Total backend cockpit** | **180** | **180** | **0** |

Diff TF↔CV UI = **uniquement** branding :

| Point hardcodé | TF | CV |
|----------------|----|----|
| `window.*Desktop` | `tempoflowDesktop` | `certivanDesktop` |
| Deep link join | `tempoflow://join/<host>` | `certivan://join/<host>` |
| Copy « héberge … Server » | TempoFlow | Certivan |
| Subtitle page `/cockpit` | « serveur TempoFlow » | « serveur Certivan » |
| `CLIENT_DOWNLOAD_URL` | feed TF + `TempoFlow-Setup-latest.exe` | feed CV + `Certivan-Setup-latest.exe` |

**Aucune** divergence de tabs, d’API fetch, de validation, ni de layout.

`server-cockpit-shell` ↔ `cockpit-client` (même marque) : sim ≈ **0,29** —
deux surfaces distinctes (pas un doublon à fusionner aveuglément) qui
partagent le même domaine (santé / IA / ACL / sessions).

### 1.2 Deux surfaces (commun TF+CV)

| Surface | Route | Conteneur | Rôle |
|---------|-------|-----------|------|
| **Server cockpit** (gold split 0.10) | `/server-cockpit` | Hors `AppShell` — shell ops dédié | App **Serveur** : supervision seule ; garde-fou Electron rabote toute nav CRM |
| **Cockpit CRM** (legacy / owner) | `/cockpit` | Dans `AppShell` | Vue owner dans le CRM Client ; « Ouvrir l’app admin », liens `/admin` |

#### Onglets `ServerCockpitShell` (×6 — identiques TF/CV)

1. **Santé** — Next/DB, Meili, Hermes, n8n, tunnel (API + IPC live)
2. **Collaborateurs IA** — liste users `kind=ai`, activité tasks, open/close workspace
3. **Accès & sessions** — sessions desktop / bridges
4. **Logs** — `GET /api/v1/admin/request-logs?limit=40`
5. **Plugins / ACL** — get/put plugin-acl
6. **Invitations** — URL serveur + deep-link join + download client + création user humain/IA

#### `CockpitClient` (sous-ensemble + admin)

Santé · Collaborateurs IA · Accès (dont `openAdminWindow`) · ACL plugins.
**Pas** d’onglets Logs / Invitations / création users (ceux-ci = shell autonome).

### 1.3 Contrats API / IPC consommés (identiques TF/CV)

| Contrat | Usage |
|---------|--------|
| `GET /api/v1/cockpit/health` | Santé agrégée |
| `POST /api/v1/cockpit/ai-workspace/:id/close` | Fermer fenêtre IA |
| `GET/PUT /api/v1/cockpit/plugin-acl[/:id]` | ACL plugins |
| `GET/POST /api/v1/users` | Liste + création humain/IA (shell) |
| `GET /api/v1/desktop/sessions` | Sessions / bridges |
| `GET /api/v1/tasks/activity/:id` | Activité collab IA |
| `GET /api/v1/admin/request-logs` | Logs (shell) |
| IPC `getTunnelStatus` → `{ online, publicUrl, hostname? }` | Tunnel live |
| IPC `openAdminWindow` | Client CRM (`CockpitClient`) |
| `openAiWorkspaceView` (`shell-ui/ui`) | Ouvrir workspace IA |
| `isRemoteDesktopClient` (`shell-ui/ui`) | Écran « pas sur le serveur » |
| `AiActivityPanel` (`@creezio/tasks/ui`) | Panel activité |

Kit déjà prêt côté **boot / garde-fou** (hors package UI) :

- `platform-core` : `bootBehavior.cockpitPath` (`/server-cockpit` si
  `kind=server`, sinon `/cockpit`) + `isAllowedServerCockpitPath`
- `electron-shell` : `installServerCockpitGuard`, load URL cockpit, admin-window
- `shell-ui` : `SERVER_COCKPIT_PATH`, `resolveDesktopHomePath`, exclusion
  workspace `/server-cockpit`, `AuthWindowChrome variant="dark"`

### 1.4 Fidu — preuve honnête (pas d’invention métier)

| Présent | Absent |
|---------|--------|
| `electron/app-kind.ts` réexporte `isAllowedServerCockpitPath` + `bootBehaviorFor` (kit → `cockpitPath`) | `components/cockpit/*` |
| Vendor / runtime Electron : garde-fou + boot cockpit (kit) | `app/cockpit`, `app/server-cockpit` |
| `lib/plugin-acl.ts` (173 LOC) — commentaire « cockpit » | `server/routes/cockpit.ts`, `lib/cockpit-health.ts` |
| Routes plateforme utiles : `/users`, `/desktop`, `/admin` (request-logs), `/tasks` | Nav entries `/cockpit` / `/server-cockpit` |
| Mentions docs TLS « cockpit.creez.io » = **infra hébergement**, pas UI produit | `lib/desktop-download.ts` (URL client) |

**Verdict Fidu :** trou de **parité shell plateforme**, pas un cockpit
fiduciaire métier (GED/Pennylane/…). Au cutover : **créer** pages + mount
routes health/ACL (jumeau TF/CV ou extract mince) + brancher
`@creezio/cockpit` — **sans** inventer d’onglets métier cabinet.

Si un jour Fidu choisit `features` pour masquer le cockpit serveur, ce
sera **config optionnelle** (comme `plugins/fleet=false`), pas un
reclassement « métier ».

### 1.5 Ce qui est commun vs divergence (synthèse)

| Couche | Commun (→ package) | Perso marque (hooks / hors package) |
|--------|--------------------|-------------------------------------|
| Layout shell + 6 tabs | Oui TF≡CV | Labels tabs override optionnel |
| Layout client CRM | Oui TF≡CV | Subtitle AppShell |
| Fetch health / users / ACL / sessions / logs / activity | Oui | Base path si un jour ≠ `/api/v1` (défaut OK) |
| IPC tunnel / admin window | Oui via `getShellDesktopApi` | — |
| Product name / « Server » copy | Pattern commun | `getShellUiBrand().productName` |
| Deep link `://join/` | Pattern commun | `deepLinkProtocol` (config ou brand) |
| Download client | Lien + CTA | `clientDownloadUrl` injecté |
| Routes + `buildCockpitHealth` | Jumeau TF≡CV | Restent **marque** dans ce plan (deps `@/lib/db`, users, product-hub, ai-workspace) — option extract `src/health` si deps injectables |
| Fidu UI | — | **À créer** (consommation package) |

### 1.6 Couplage minimal hors périmètre

| Dépendance | Action dans ce plan |
|------------|---------------------|
| `shell-ui` Button/Badge/Input/`cn`/`openAiWorkspaceView`/`isRemoteDesktopClient` | Dep one-way `cockpit` → `shell-ui` |
| `getShellDesktopApi` / `getShellUiBrand` | Remplacer `window.*Desktop` hardcodé |
| `@creezio/tasks/ui` `AiActivityPanel` | peerDep optionnelle (comme pattern tasks) |
| Auth `getSession` owner gate | Pages marque (mince) |
| Routes Hono cockpit | **Hors** package UI ; cutover Fidu = ajouter twin |
| Nav-config ACL paths | Marque (1–2 lignes) |
| Onboarding / setup / sidebar / MCP | **Interdit** de toucher |

---

## 2. État actuel kit

| Attendu cockpit | Présent ? | Où |
|-----------------|-----------|-----|
| Package `@creezio/cockpit` | ❌ | — |
| `ServerCockpitShell` / `CockpitClient` | ❌ | 100 % local TF/CV |
| Types health / ACL UI | ❌ | locaux |
| Brand deepLink / clientDownload dans shell-ui | ❌ partiel | `productName` + desktop API oui ; **pas** `deepLinkProtocol` ni URL download |
| Boot `cockpitPath` + garde-fou | ✅ | `platform-core` + `electron-shell` |
| `resolveDesktopHomePath` → `/server-cockpit` | ✅ | `shell-ui` |
| Exclusion workspace `/server-cockpit` | ✅ | `shell-ui` `ui/workspace/types.ts` |
| `AuthWindowChrome` dark | ✅ | `shell-ui` |

**Gap :** zéro module UI cockpit dans le kit. L’audit scope interdit de
combler ce gap **dans** `shell-ui`.

---

## 3. Design cible — `@creezio/cockpit` = moteur + API de perso

### 3.1 Principes

1. **Un seul package** : `@creezio/cockpit` = UI server-cockpit (shell
   autonome + client CRM) + types + config.
2. **Gold = TF/CV twin** — extraire le commun ; substituer hardcodes brand
   par hooks. **Pas** un clone TF « bourrin » avec `if (brand === …)`.
3. **Fidu = même package**, parité UI + routes au cutover — pas un 2ᵉ
   cockpit métier.
4. **Perso = config / slots**, pas forks :
   - tokens produit / deep-link / download ;
   - flags d’onglets (masquer Logs / Invitations / Plugins si besoin) ;
   - slot optionnel `extraTabs` pour extensions futures **sans** y mettre
     du GED/Pennylane dans le kit.
5. **Routes / health / SQLite = hors package UI** (frontière stricte,
   miroir onboarding). Option ultérieure : porter `buildCockpitHealth` en
   `src/` avec deps injectées — **hors 100 % UI** de ce plan.
6. **Dépendances one-way :**
   `@creezio/cockpit` → `@creezio/shell-ui` (+ peer `@creezio/tasks` pour
   `AiActivityPanel`). **`shell-ui` / `onboarding` / `tasks` ne dépendent
   jamais de `cockpit`.**
7. IPC **uniquement** via `getShellDesktopApi()` — zéro
   `tempoflowDesktop|certivanDesktop|fiduDesktop` dans le package.

### 3.2 Emplacement package (indicatif — phase code)

```
packages/cockpit/
  package.json              # name: @creezio/cockpit
  README.md
  src/
    index.ts                # types + configureCockpit (non-React)
    types.ts                # CockpitHealth, AclPlugin, …
    config.ts               # configure / getCockpitConfig
  ui/
    server-cockpit-shell.tsx
    cockpit-client.tsx
    parts/                  # StatusDot, ServiceCard, shared panels (factor interne)
    index.ts
```

Exports proposés :

```json
{
  "name": "@creezio/cockpit",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./ui": { "types": "./ui/index.ts", "import": "./ui/index.ts" }
  },
  "dependencies": {
    "@creezio/shell-ui": "0.1.0"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "@creezio/tasks": "0.1.0",
    "lucide-react": ">=0.400.0",
    "sonner": ">=1.0.0"
  }
}
```

Workspace : ajouter `-w @creezio/cockpit` dans `build` / `build:packages`
(phase code uniquement).

### 3.3 API proposée — config / perso

```ts
export type CockpitTabId =
  | "sante"
  | "ia"
  | "acces"
  | "logs"
  | "plugins"
  | "invitations";

export type CockpitConfig = {
  /**
   * Protocole deep-link (ex. "tempoflow" → tempoflow://join/<host>).
   * Défaut : dérivé possible plus tard de brand-config ; jour 1 = requis
   * via configureCockpit / prop.
   */
  deepLinkProtocol: string;
  /** URL installeur client (Invitations + CTA). */
  clientDownloadUrl: string;
  /**
   * Onglets visibles du shell autonome.
   * Défaut = les 6 gold TF/CV.
   */
  tabs?: CockpitTabId[];
  /** Prefetch interval ms (défaut 15000). */
  refreshMs?: number;
  /** Base API (défaut "/api/v1"). */
  apiBase?: string;
};

/** Configure une fois au boot marque (layout / providers). */
export function configureCockpit(next: Partial<CockpitConfig>): void;
export function getCockpitConfig(): CockpitConfig;

export type ServerCockpitShellProps = {
  config?: Partial<CockpitConfig>; // override local
  /** Slot tabs additionnels (après les natifs filtrés). */
  extraTabs?: Array<{
    id: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    render: () => React.ReactNode;
  }>;
  className?: string;
};

export function ServerCockpitShell(props?: ServerCockpitShellProps): JSX.Element;

export type CockpitClientProps = {
  config?: Partial<CockpitConfig>;
  className?: string;
};

export function CockpitClient(props?: CockpitClientProps): JSX.Element;
```

Règles internes :

- Copy « {productName} Server » via `getShellUiBrand().productName`.
- Desktop detection / tunnel / `openAdminWindow` via `getShellDesktopApi()`.
- Join link : `` `${protocol}://join/${tunnelHost}` ``.
- Download : `getCockpitConfig().clientDownloadUrl` (jamais hardcodé feed TF).
- Remote client → écran bloquant existant (shell).

#### Composition marque (indicatif — pas de code livré ici)

```tsx
// boot marque
configureShellUiBrand({ productName: "TempoFlow", desktopApiGlobal: "tempoflowDesktop", … });
configureCockpit({
  deepLinkProtocol: "tempoflow",
  clientDownloadUrl: CLIENT_DOWNLOAD_URL,
});

// app/server-cockpit/page.tsx — gate session owner reste marque
import { ServerCockpitShell } from "@creezio/cockpit/ui";
return <ServerCockpitShell />;

// app/cockpit/page.tsx
import { CockpitClient } from "@creezio/cockpit/ui";
return (
  <AppShell title="Cockpit serveur" … subtitle={`… serveur ${productName}`}>
    <CockpitClient />
  </AppShell>
);
```

#### Ce qui **ne** va **pas** dans `@creezio/cockpit`

- Routes Hono, `buildCockpitHealth` couplé à `@/lib/db` (sauf extract
  injectable ultérieur)
- `plugin-acl` persistence, `listPluginProducts`, `closeAiWorkspaceOnHost`
- Onglets métier Fidu (GED, Pennylane, relances…)
- Setup / onboarding / sidebar / workspace / search
- Hardcode `tempoflow://` / feeds download marques

### 3.4 Factorisation interne (anti-clone)

`ServerCockpitShell` et `CockpitClient` partagent aujourd’hui ~même
chargement santé/users/ACL/activity. En extract :

- `parts/service-card.tsx`, `parts/status-dot.tsx`
- hook `useCockpitDashboard()` (fetch + poll + tunnel IPC)
- panels réutilisés (Santé, IA, ACL) ; shell ajoute Logs / Invitations /
  création users ; client ajoute `openAdminWindow` + liens admin

**Critère :** pas deux copies collées du gold — un moteur, deux hosts.

### 3.5 Branding tokens

| Token | Source jour 1 |
|-------|----------------|
| `productName`, desktop API | `shell-ui` `ShellUiBrand` (déjà) |
| `deepLinkProtocol` | **`CockpitConfig`** (évite d’étendre shell-ui au jour 1 ; option plus tard aligner `brand-config.manifest.deepLinkProtocol`) |
| `clientDownloadUrl` | **`CockpitConfig`** (feeds distincts TF/CV/Fidu) |

### 3.6 Graphe dépendances (falsifiable)

```
marques (TF/CV/Fidu)
  → @creezio/cockpit/ui
  → @creezio/shell-ui[/ui]
  → @creezio/tasks/ui          (AiActivityPanel — peer)

@creezio/cockpit
  → @creezio/shell-ui          (OK)

@creezio/shell-ui
  ↛ @creezio/cockpit           (INTERDIT)

@creezio/onboarding
  ↛ @creezio/cockpit           (INTERDIT — lien home path seulement)
```

Gate : `package.json` de `shell-ui` / `onboarding` / `tasks` **sans**
`@creezio/cockpit` ; aucun import inverse dans ces packages.

---

## 4. Plan d’implémentation → 100 % package

> Ordre strict. Cutover marques = après Done package (étape E) — **fait**.

### Étape A — Scaffold + types + config (P-CKPT-A)

1. Créer `packages/cockpit` (`package.json`, tsconfig, exports `.` + `/ui`).
2. Brancher workspace root (`build` / `build:packages` → `-w @creezio/cockpit`).
3. `CockpitConfig` + `configureCockpit` / `getCockpitConfig`.
4. Types partagés (`CockpitHealth`, users, ACL, sessions, logs).
5. Gate : zéro import marque ; zéro dep inverse.

**Done A**

- [x] Package `@creezio/cockpit` build vert
- [x] Config testable (override deepLink / download)
- [x] `shell-ui` / `onboarding` **sans** dep `@creezio/cockpit`

### Étape B — Moteur partagé + `CockpitClient` (P-CKPT-B)

1. Extraire gold TF `cockpit-client.tsx` → package ; IPC via
   `getShellDesktopApi` ; copy via `productName`.
2. Hook `useCockpitDashboard` + parts StatusDot / ServiceCard.
3. Harness / test : mock fetch + mock desktop API → rendu santé + ACL
   toggle appelle PUT.

**Done B**

- [x] `CockpitClient` exporté `@creezio/cockpit/ui`
- [x] Aucun `tempoflowDesktop|certivanDesktop|fiduDesktop` dans le package
- [x] Aucun hardcode `tempoflow://` / URL feed TF

### Étape C — `ServerCockpitShell` (P-CKPT-C)

1. Porter gold TF shell ; brancher config tabs / download / deep-link.
2. Réutiliser panels du moteur (pas copier-coller client).
3. Écran remote-client + Invitations + Logs + création users.
4. Support `extraTabs` (test avec 1 tab factice).

**Done C**

- [x] `ServerCockpitShell` exporté
- [x] Tabs filtrables via `config.tabs`
- [x] Join link = `${deepLinkProtocol}://join/…`
- [x] CTA download = `clientDownloadUrl`

### Étape D — Pack export + tests + README (P-CKPT-D) = 100 % package

1. README `@creezio/cockpit` : shell + client + config ×3 + Fidu parité.
2. `ui/index.ts` exports stables.
3. Script gate `scripts/test-phase-p-cockpit.mjs` (ou équivalent) :
   build, no brand globals, no inverse deps, config deep-link/download.
4. Mettre à jour statut de ce PHASE → implemented **après** code.

**Done D = 100 % package**

- [x] Exports §3 présents
- [x] Tests + `build:packages` verts
- [x] Doc package + PHASE à jour
- [x] **Aucun** fichier cockpit sous `packages/shell-ui/`
- [x] **Aucun** code feature onboarding/tasks/MCP touché

### Étape E — Cutover marques (après D — autre chantier)

| Marque | Actions | Done marque |
|--------|---------|-------------|
| TF | Pages → imports package ; supprimer `components/cockpit/*` ; `configureCockpit` au boot | locaux absents |
| CV | Idem (config certivan + feed CV) | locaux absents ; sim N/A |
| Fidu | **Créer** pages minces + mount `cockpitRoutes` + `cockpit-health` (twin TF/CV ou copie une fois puis delete) + `configureCockpit({ deepLinkProtocol: "fidu", clientDownloadUrl })` + nav ACL paths | UI package consommée ; pas de fork métier ; smoke server kind → `/server-cockpit` |
| ×3 | Nav-config paths inchangés ou alignés ; gate owner pages restent marque | build ×3 |

**Anti-patterns interdits**

- ❌ Fourrer le cockpit dans `shell-ui` ou `onboarding`
- ❌ `if (brand === 'fidu')` métier dans le package
- ❌ Inventer onglets GED/Pennylane « pour Fidu »
- ❌ Laisser jumeaux TF/CV après cutover (« pour ne pas casser »)

---

## 5. Critères « 100 % » (checklist unique)

### Package `@creezio/cockpit` (obligatoire — Done ce plan code)

1. Package créé ; exports `ServerCockpitShell` + `CockpitClient`.
2. `configureCockpit` / `CockpitConfig` (`deepLinkProtocol`,
   `clientDownloadUrl`, `tabs?`).
3. Zéro global desktop marque ; zéro feed/URL TF hardcodés.
4. Dépendance **unidirectionnelle** vers `shell-ui` ; peer tasks OK ;
   **zéro** dep inverse depuis shell-ui / onboarding / tasks.
5. Build + tests dédiés verts.
6. **Aucun** module cockpit sous `packages/shell-ui/`.
7. Factorisation interne shell/client (pas deux clones collés).

### Adoption (cutover E — hors livrable plan)

8. Aucun `components/cockpit/server-cockpit-shell.tsx` /
   `cockpit-client.tsx` local TF/CV.
9. Fidu : pages + routes health/ACL présentes **ou** flag documenté
   `features.cockpit=false` **avec** preuve produit — défaut attendu =
   **parité ON** (même package).
10. Smoke manuel desktop `kind=server` → `/server-cockpit` (TF/CV, puis Fidu).

---

## 6. Risques

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Remettre cockpit dans `shell-ui` | Fourre-tout | Placement gelé + audit scope ; gate 0 fichier sous shell-ui |
| Traiter Fidu « hors scope » sans preuve | Parité abandonnée | Preuve §1.4 : infra OK, UI absente → **créer** |
| Inventer cockpit métier Fidu | Scope creep vertical | Interdit ; mêmes tabs plateforme |
| Emporter routes/db dans le package trop tôt | Couplage data | Routes restent marque ; health injectable plus tard |
| Dep circulaire / peer tasks manquant | Build casse | peerOptional + gate imports |
| Oublier `configureCockpit` au boot | Join/download cassés | README + test config requise (throw soft / assert) |
| Coupler onboarding/tasks « en passant » | Scope creep | Interdit — seul package cockpit |

---

## 7. Ordre recommandé (résumé)

```
[validation user]
    → A Scaffold @creezio/cockpit + config/types
        → B CockpitClient + useCockpitDashboard
            → C ServerCockpitShell + tabs/slots
                → D exports + tests + README  = 100 % package
                    → E cutover TF → CV → Fidu (parité) + extinction jumeaux
```

Estimation relative : **A** S · **B** M · **C** M · **D** S · **E** M
(Fidu E un peu plus long : pages + routes à créer).

---

## 8. Références mesures (2026-07-30)

```
server-cockpit-shell TF↔CV  sim=0.999  LOC 926/926
cockpit-client       TF↔CV  sim=0.999  LOC 490/490
app/server-cockpit   TF↔CV  sim=1.000  LOC 19/19
app/cockpit          TF↔CV  sim=0.991  LOC 29/29
routes/cockpit       TF↔CV  sim=1.000  LOC 81/81
lib/cockpit-health   TF↔CV  sim=1.000  LOC 99/99
shell vs client (TF) sim≈0.29  (surfaces distinctes)
Fidu UI cockpit      LOC 0   (parité à créer)
```

Fichiers gold UI : TF ou CV (équivalent) — préférer TF puis substituer
IPC → `getShellDesktopApi` + config deep-link/download.

Fichiers **hors** package (ce plan) : `routes/cockpit.ts`,
`cockpit-health.ts` (deps marque), pages auth gate, nav-config.

Arbitrage placement : [AUDIT-SHELL-UI-SCOPE.md](AUDIT-SHELL-UI-SCOPE.md).
Précédent package dédié : [PHASE-P-ONBOARDING.md](PHASE-P-ONBOARDING.md)
(`@creezio/onboarding`, `feff378`).

---

## 9. Livrable / statut push

- ✅ Audit comparatif TF vs CV (+ Fidu honnête)
- ✅ Design `@creezio/cockpit` (moteur + hooks perso)
- ✅ Plan A→E jusqu’à 100 % package + cutover + critères done
- ✅ Doc poussée kit — **stop** ; attendre validation avant code
- ✅ Package `@creezio/cockpit` + gates `test-phase-p-cockpit` + cutover ×3
