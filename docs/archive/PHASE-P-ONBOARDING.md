# Phase P — Onboarding / Setup → `@creezio/onboarding`

| | |
|--|--|
| **Statut** | ✅ **Implemented** — package + cutover ×3 |
| **Date** | 2026-07-30 |
| **Package cible** | **`@creezio/onboarding`** (nouveau package dédié) |
| **Arbitrage placement** | [AUDIT-SHELL-UI-SCOPE.md](AUDIT-SHELL-UI-SCOPE.md) kit `5a62b32` — onboarding/setup **hors** `shell-ui` |
| **Repos** | TF `tempoflow2` · CV `certivan-app` · Fidu `fidu` · kit `creezio` |
| **SoT intention** | [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md) §0 (×3 = NATIF) |
| **Hors scope ce plan** | Implémentation package · cutover marques · tasks · cockpit · MCP · extract settings shell-ui |

> **Placement définitif.** Setup + moteur onboarding = **`packages/onboarding`**
> (`@creezio/onboarding`). **Pas** un sous-dossier de `shell-ui`. Splash reste
> dans `@creezio/electron-shell`. Cockpit = package ultérieur séparé.

> **Livré** : package `@creezio/onboarding` + cutover TF/CV/Fidu (jumeaux
> setup/moteur supprimés). Steps/slots/config métier restent marque.

---

## 0. Verdict en une phrase

**Setup** = jumeau quasi-identique ×3 (sim ≥ 0,97) → **100 % dans
`@creezio/onboarding`**. **Onboarding** = **moteur UI commun** (stepper,
micro-questions, advance/skip/complete) ×3 + **contenu/API métier divergent**
→ package = moteur + slots + branding config ; **pas** le schéma restaurant TF.

---

## 1. Audit comparatif TF × CV × Fidu

### 1.1 Fichiers & volumétrie (UI + pages) — revalidé 2026-07-30

| Surface | TF | CV | Fidu |
|---------|----|----|------|
| `components/setup/setup-wizard.tsx` | 484 LOC | 484 (sim **0,975** vs TF) | 484 (sim **0,971** vs TF) |
| `app/setup/page.tsx` | 7 LOC | 7 | 7 |
| `components/onboarding/*` | **2838** LOC (8 steps + micro + import) | **638** LOC (3 steps, **sans** micro) | **2180** LOC (8 steps + micro) |
| `onboarding-shell.tsx` (Stepper) | 89 · labels resto | 78 · 3 labels | 88 · labels cabinet |
| `micro.tsx` | 362 | — | 362 (**sim 1,000** vs TF) |
| `onboarding-wizard.tsx` | 336 | 153 (sim 0,51) | 234 (sim 0,70) |
| Routes `server/routes/onboarding.ts` | 309 | 309 (**identique** TF) | **76** (profil only) |
| `lib/onboarding-queries.ts` | 474 | 474 (twin TF) | 297 (cabinet) |

### 1.2 Flow setup (commun ×3)

Séquence **identique** :

1. **Compte** — username / password / confirm / « rester connecté »
2. **Récupération** — génération clé IPC + ack + copie
3. **Tunnel** — slug + `checkTunnelSlug` + preview `*.{suffix}`
4. **OpenAI** — BYOK + `completeSetup` → redirect `/onboarding`

Contrats IPC (déjà kit `electron-shell` / `shell`) : `getSetupStatus`,
`generateRecoveryKey`, `checkTunnelSlug`, `completeSetup`,
`setAssistantChrome`, `rechooseConnection`.

Gate middleware ×3 : `SETUP_COMPLETE !== "1"` + desktop local → force `/setup`
(hors chrome workspace).

### 1.3 Divergences setup (uniquement branding / copy)

| Point | TF | CV | Fidu |
|-------|----|----|------|
| `window.*Desktop` | `tempoflowDesktop` | `certivanDesktop` | `fiduDesktop` |
| Nom produit UI | TempoFlow | Certivan | Fidu |
| Suffixe tunnel | `tempoflow.fr` | `certivan.creez.io` | `fidu.creez.io` |
| Placeholder slug | `mon-restaurant` | `mon-restaurant` | `mon-cabinet` |
| Phrase étape 3 | « adresse mobile » | idem TF | « adresse d’accès distant (tunnel) » |
| Couleur accent | `#f0701d` (hardcodé ×3) | idem | idem |
| Fond | `#14182f` | idem | idem |

**Aucune** divergence de validation, d’ordre d’étapes, ni de payload
`completeSetup`. Le wizard utilise déjà `Button` / `Input` de
`@creezio/shell-ui/ui`, mais **pas** `getShellDesktopApi()` /
`getShellUiBrand()`.

### 1.4 Flow onboarding — commun vs divergences

#### Commun (plateforme → `@creezio/onboarding`)

| Brique | Preuve ×3 |
|--------|-----------|
| Routes pages `/onboarding` + `?step=` | Oui |
| Shell plein écran `onb-stage` + Fraunces | Oui (CSS globals marques) |
| Palette crème / encre `#14182f` / teal `#0e7b7b` / orange `#f0701d` | Oui |
| **Stepper** visuel (cercles + traits + labels) | Code quasi-identique ; **labels** injectés |
| Intro : grid promesses + CTA Commencer / Plus tard | Layout commun ; **copy + hero** diverge |
| Persistence `onboarding_step` + `POST /skip` + `POST /complete` | Oui (chemins API identiques) |
| `editMode` → saute au récap | Oui |
| Sortie → home | TF/CV : `resolveDesktopHomePath()` (kit) ; Fidu : hardcode `/dashboard` |
| Hors workspace tabs | `workspace/types.ts` kit exclut déjà `/setup` `/onboarding` |

#### Divergences front (métier — restent marque)

| | TF | CV | Fidu |
|--|----|----|------|
| Nb étapes | **8** | **3** | **8** |
| Labels stepper | Bienvenue → Établissement → Achats → Fournisseurs → Objectifs → Contraintes → Préférences → Récap | Bienvenue → Atelier → Récap | Bienvenue → Cabinet → Organisation → Collecte → Relances → Portail → Communications → Récap |
| Micro-questions | Oui (`micro.tsx`) | Non (formulaires simples) | Oui (**même** `micro.tsx` que TF) |
| Interstitiels titre | Oui | Non | Oui |
| Hero intro | mascotte `/tempo/tempo-waving.png` + « Tempo » | badge « CV » | mascotte Tempo (dette branding) |
| Domaine données | restaurant + profil achats + imports/lignes | reuse table `restaurant` (nom/ville/responsable) | `cabinet_profil` + formes juridiques + seed |
| Import fichiers | Oui (step Achats) | Non (routes twin **mortes** côté UI) | Non |
| Copy | achats / économies / fournisseurs | VASP / RTI / DREAL | cabinet / GED / relances / portail |

#### Backend (hors `@creezio/onboarding` — frontière stricte)

- **TF ↔ CV** : routes + queries + `import-parser` **jumeaux** ; CV UI n’utilise
  qu’un sous-ensemble (`/restaurant`, `/profil`, skip/complete). Dette :
  schéma « restaurant » sous CV.
- **Fidu** : API mince adaptée cabinet — **bon modèle** de perso côté serveur
  (pas d’obligation à unifier le schéma SQLite dans ce package).

**Conclusion découpe :** le package porte le **chrome + moteur de parcours** ;
chaque marque fournit `steps[]` (composants + labels + handlers API). Les
routes HTTP / migrations restent **marque** (ou package data ultérieur) —
**pas** une dette bloquante du 100 % `@creezio/onboarding`.

### 1.5 Couplage minimal hors périmètre

| Dépendance | Pourquoi mentionnée | Action dans ce plan |
|------------|---------------------|---------------------|
| `ShellUiBrand` / `getShellDesktopApi` | Setup hardcode encore `window.*Desktop` | **Consommer** (dep → `shell-ui`, jamais l’inverse) |
| `AuthWindowChrome` | Chrome frameless login/setup | Doc wrap page marque ; import depuis `shell-ui/ui` |
| `resolveDesktopHomePath` | Sortie onboarding TF/CV | API onboarding l’utilise par défaut ; Fidu override optionnel |
| Exclusion paths workspace | Déjà dans `ui/workspace/types.ts` | **Aucun** chantier sidebar |
| Middleware `SETUP_COMPLETE` | Gate first-run | Reste marque (1 fichier) — hors extract UI |
| Cockpit serveur | Cible home `appKind=server` | Lien via `resolveDesktopHomePath` seulement |
| Splash | Boot desktop | **Déjà** `@creezio/electron-shell` — hors scope |

---

## 2. État actuel kit

| Attendu onboarding/setup | Présent ? | Où |
|--------------------------|-----------|-----|
| Package `@creezio/onboarding` | ❌ | — (à créer en phase code, **après** validation) |
| `SetupWizard` | ❌ | 100 % local ×3 |
| `OnboardingWizard` / host steps | ❌ | — |
| `Stepper` / `OnboardingShell` | ❌ | — |
| `micro` (MicroScreen, useMicro, …) | ❌ | TF≡Fidu local |
| CSS `onb-*` | ❌ | dans `globals.css` marques |
| Brand tokens (`productName`, `publicHostSuffix`, desktop API) | ✅ | `@creezio/shell-ui` `src/brand.ts` |
| `getShellDesktopApi` | ✅ | `shell-ui` |
| `resolveDesktopHomePath` | ✅ | `shell-ui` |
| Exclusion `/setup` `/onboarding` workspace | ✅ | `shell-ui` `ui/workspace/types.ts` |
| `AuthWindowChrome` | ✅ | `shell-ui` `ui/desktop/` |
| Primitives Button/Input | ✅ | déjà consommées par setup local |

**Gap :** zéro module setup/onboarding dans le kit. O9 a **explicitement
exclu** l’onboarding restaurateur. L’audit scope (`5a62b32`) interdit de
combler ce gap **dans** `shell-ui`.

---

## 3. Design cible — `@creezio/onboarding` = moteur + API de perso

### 3.1 Principes

1. **Un seul package** : `@creezio/onboarding` = SetupWizard + moteur onboarding
   + micro + stepper + CSS `onb-*`.
2. **Setup = 100 % package** (une seule implémentation). Marque =
   `configureShellUiBrand` (shell-ui) + overrides copy optionnels du package.
3. **Onboarding = moteur package + registry de steps marque.** Zéro hardcode
   « restaurant » / « cabinet » / « atelier » dans le kit.
4. **Intelligent, pas clone TF :** CV court (3 steps) et Fidu cabinet sont des
   configs de première classe, pas des forks du parcours achats.
5. **Persistance / schéma = hors package UI** : le host injecte un
   `OnboardingTransport` (fetch wrappers).
6. **Dépendances one-way :** `@creezio/onboarding` → `@creezio/shell-ui`
   (Button, Input, AuthWindowChrome, brand, desktop API, home path).
   **`shell-ui` ne dépend jamais d’`onboarding`.**
7. Feature flags pour activer/désactiver briques (OpenAI obligatoire,
   interstitiels, skip, micro-engine).

### 3.2 Emplacement package (indicatif — phase code)

```
packages/onboarding/
  package.json              # name: @creezio/onboarding
  README.md
  src/
    index.ts                # re-exports stables
  ui/
    setup/
      setup-wizard.tsx
      setup-types.ts
      setup-copy.ts
    onboarding/
      onboarding-wizard.tsx
      onboarding-shell.tsx  # Stepper
      micro.tsx
      interstitial.tsx
      types.ts              # types moteur (pas OnbRestaurant)
      onboarding.css
    index.ts
```

Exports proposés (miroir pattern `@creezio/tasks`) :

```json
{
  "name": "@creezio/onboarding",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./ui": { "types": "./ui/index.ts", "import": "./ui/index.ts" }
  },
  "dependencies": {
    "@creezio/shell-ui": "0.1.0"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0"
  }
}
```

Workspace : `packages/*` couvre déjà le nouveau dossier. Ajouter
`-w @creezio/onboarding` dans `build` / `build:packages` du root kit
(phase code uniquement).

### 3.3 API proposée — Setup

```ts
/** Config optionnelle — le reste vient de getShellUiBrand() (shell-ui). */
export type SetupWizardConfig = {
  /** Override labels étapes (défaut: Compte / Récupération / Tunnel / OpenAI). */
  stepLabels?: [string, string, string, string];
  /** Placeholder slug (défaut générique: "mon-espace"). */
  slugPlaceholder?: string;
  /** Phrase d’aide étape tunnel. */
  tunnelHelp?: string;
  /** Si false, étape 4 optionnelle / sautable (défaut true = actuel ×3). */
  requireOpenaiKey?: boolean;
  /** Redirect post-success (défaut "/onboarding"). */
  afterCompleteHref?: string;
  /** Accent CSS (défaut #f0701d — ou token brand futur). */
  accentColor?: string;
  /** Fond (défaut #14182f). */
  backgroundColor?: string;
};

export function SetupWizard(props?: { config?: SetupWizardConfig }): JSX.Element;
```

Règles internes :

- IPC **uniquement** via `getShellDesktopApi()` (plus de `window.tempoflowDesktop`).
- Copy produit / suffixe tunnel via `getShellUiBrand().productName` +
  `publicHostSuffix`.
- Fallback non-desktop : écran « lancez l’app desktop {productName} ».
- Enveloppe recommandée page marque :
  `<AuthWindowChrome variant="dark"><SetupWizard /></AuthWindowChrome>`
  (chrome importé depuis `@creezio/shell-ui/ui`, **pas** re-export obligatoire
  depuis onboarding).

### 3.4 API proposée — Onboarding engine

```ts
export type OnboardingStepId = string;

export type OnboardingStepDef = {
  id: OnboardingStepId;
  label: string;                 // stepper
  /** Titre interstitiel (si flags.interstitials). */
  interstitialTitle?: string;
  /**
   * Contenu step. Reçoit helpers du moteur.
   * La marque compose ses step-*.tsx ici.
   */
  render: (ctx: OnboardingStepContext) => React.ReactNode;
};

export type OnboardingStepContext = {
  stepIndex: number;
  entry: "start" | "end";       // reprise micro depuis la fin
  saving: boolean;
  skipping: boolean;
  advance: () => void;          // → index+1 + persist + interstitial?
  goTo: (index: number) => void;
  back: () => void;
  setSaving: (v: boolean) => void;
  setError: (msg: string | null) => void;
};

export type OnboardingTransport = {
  /** Persistance best-effort de l’index (PATCH profil step). */
  persistStep: (stepIndex: number) => void | Promise<void>;
  skip: () => Promise<void>;
  complete: () => Promise<void>;
};

export type OnboardingWizardFlags = {
  interstitials?: boolean;      // défaut true
  allowSkip?: boolean;          // défaut true
  /** ms affichage interstitiel */
  interstitialMs?: number;
};

export type OnboardingTheme = {
  accentColor?: string;         // #f0701d
  inkColor?: string;            // #14182f
  tealColor?: string;           // #0e7b7b
  creamBackground?: string;     // #faf7f1
};

export type OnboardingWizardProps = {
  steps: OnboardingStepDef[];   // inclut intro (0) + … + recap
  transport: OnboardingTransport;
  initialStep?: number;
  editMode?: boolean;           // → last step
  flags?: OnboardingWizardFlags;
  theme?: OnboardingTheme;
  /** Après skip/complete (défaut resolveDesktopHomePath depuis shell-ui). */
  resolveExitHref?: () => Promise<string> | string;
  className?: string;
};

export function OnboardingWizard(props: OnboardingWizardProps): JSX.Element;
export function Stepper(props: { steps: string[]; current: number }): JSX.Element;

/* Micro-engine — exportés pour steps marque */
export {
  useMicro,
  MicroScreen,
  MicroLabel,
  BigInput,
  BigOption,
  AUTO_ADVANCE_MS,
};
```

#### Composition marque (exemples — pas du code livré ici)

```ts
// TempoFlow — 8 steps métier locaux
import { OnboardingWizard } from "@creezio/onboarding/ui";

<OnboardingWizard
  steps={[
    { id: "intro", label: "Bienvenue", render: (ctx) => <StepIntro … /> },
    { id: "restaurant", label: "Établissement", interstitialTitle: "…", render: … },
    // …
  ]}
  transport={tfTransport}   // wrap /api/v1/onboarding
  flags={{ interstitials: true }}
/>

// Certivan — 3 steps
<OnboardingWizard
  steps={[intro, atelier, recap]}
  transport={cvTransport}
  flags={{ interstitials: false }}
/>

// Fidu — 8 steps cabinet
<OnboardingWizard
  steps={[intro, cabinet, org, collecte, relances, portail, prefs, synthese]}
  transport={fiduTransport}
  resolveExitHref={() => "/dashboard"}  // ou aligner sur resolveDesktopHomePath
/>
```

#### Ce qui **ne** va **pas** dans `@creezio/onboarding`

- Types `OnbRestaurant` / `CabinetProfil` / labels OBJECTIF_LABELS / PACK_LABELS
- Steps concrets `step-restaurant`, `step-atelier`, `step-cabinet`, …
- `import-parser`, routes Hono, migrations `011_onboarding`
- Mascotte Tempo hardcodée (slot hero intro marque)
- UI cockpit, settings desktop, workspace tabs, splash

### 3.5 Branding tokens

Déjà suffisant pour setup via **shell-ui** : `productName`, `publicHostSuffix`,
`desktopApiGlobal`.

**Recommandation :** theme onboarding via props `OnboardingTheme` sur le shell
du package, **pas** obligation d’étendre `ShellUiBrand` au jour 1 (évite de
gonfler shell-ui pour ce chantier).

### 3.6 CSS

Extraire le bloc `.onb-*` (stage, scroll, anim, interstitial, stagger) depuis
`globals.css` marques vers `packages/onboarding/ui/onboarding/onboarding.css`
(ou injection `getOnboardingStyleSheet()`). Les apps importent une fois
(layout onboarding ou global). Critère : **même rendu** sans duplication ×3.

### 3.7 Graphe dépendances (falsifiable)

```
marques (TF/CV/Fidu)
  → @creezio/onboarding/ui     (SetupWizard, OnboardingWizard, micro, …)
  → @creezio/shell-ui[/ui]     (Button, Input, AuthWindowChrome, brand, …)

@creezio/onboarding
  → @creezio/shell-ui          (OK)

@creezio/shell-ui
  ↛ @creezio/onboarding        (INTERDIT)
```

Gate : `package.json` de `shell-ui` ne liste pas `@creezio/onboarding` ;
aucun import inverse dans `packages/shell-ui/**`.

---

## 4. Plan d’implémentation → 100 % package

> Ordre strict. **Pas de cutover marques** tant que les gates package ne sont
> pas verts. Cutover = chantier suivant (hors ce livrable code), mais les
> critères « consommation » définissent le Done produit intention.

### Étape A — Scaffold + SetupWizard (P-ONB-A) ✅

1. Créer `packages/onboarding` (`package.json`, tsconfig, exports `.` + `/ui`).
2. Brancher workspace root (`build` / `build:packages` → `-w @creezio/onboarding`).
3. Porter `setup-wizard.tsx` depuis gold TF ; IPC via `getShellDesktopApi` +
   brand via `getShellUiBrand`.
4. `SetupWizardConfig` + defaults copy.
5. Test unitaire / harness : mock desktop API → parcours 4 steps + erreurs
   validation (sans Electron).
6. (Option) story demobrand page `/setup` consommant le package.

**Done A (falsifiable)**

- [x] Package `@creezio/onboarding` existe ; build package vert
- [x] Aucun `tempoflowDesktop|certivanDesktop|fiduDesktop` dans le module
- [x] `SetupWizard` exporté depuis `@creezio/onboarding/ui`
- [x] Test : `completeSetup` appelé avec payload attendu quand mocks OK
- [x] Changer `configureShellUiBrand({ productName, publicHostSuffix })` change
      le rendu (assert test ou snapshot)
- [x] `packages/shell-ui/package.json` **sans** dep `@creezio/onboarding`

### Étape B — Micro + Stepper + CSS (P-ONB-B) ✅

1. Porter `micro.tsx` (TF≡Fidu) → package.
2. Porter `Stepper` paramétré par `steps: string[]` (plus de `STEP_LABELS`
   hardcodés).
3. Extraire CSS `onb-*`.
4. Interstitial générique (`title` string).

**Done B**

- [x] `useMicro` / `MicroScreen` / `Stepper` exportés
- [x] Fichier CSS package présent ; plus de dépendance au CSS marque pour le moteur
- [x] Test micro : avance N questions → `onDone` ; back depuis fin

### Étape C — OnboardingWizard host (P-ONB-C) ✅

1. Implémenter moteur (`advance` / `back` / `entry` / interstitial / skip /
   complete / error banner) branché sur `steps[]` + `transport`.
2. Pas d’import de steps métier.
3. Harness demobrand : 3 steps factices (intro / form / recap) prouvant CV-like
   **et** 8 steps factices prouvant TF/Fidu-like.

**Done C**

- [x] Wizard package sans string métier (`restaurant`, `cabinet`, `VASP`, `achats`)
- [x] Demobrand (ou test RTL) : config 3 steps **et** config 8 steps passent
- [x] `editMode` ouvre le dernier step ; `persistStep` appelé à chaque advance
- [x] Exit utilise `resolveDesktopHomePath` par défaut

### Étape D — Pack export + doc package (P-ONB-D) ✅

1. README `@creezio/onboarding` : Setup + Onboarding (exemples config ×3).
2. `ui/index.ts` exports stables.
3. Gate CI : `npm run build:packages` + tests phase dédiés
   (`scripts/test-phase-p-onboarding.mjs` ou équivalent) — inclut gate
   **pas d’import inverse** shell-ui → onboarding.

**Done D = 100 % package**

- [x] Exports listés §3 présents sous `@creezio/onboarding[/ui]`
- [x] Aucun jumeau setup/onboarding-engine **dans le kit** (une SoT package)
- [x] Tests + build verts sur tip
- [x] Doc package + ce PHASE à jour (statut → implémenté)
- [x] Aucun fichier setup/onboarding sous `packages/shell-ui/ui/`

### Étape E — Cutover marques ✅

À faire **après** D, par un autre chantier (pas ce commit) :

| Marque | Actions | Done marque |
|--------|---------|-------------|
| ×3 setup | Page `/setup` = `<SetupWizard config={…} />` ; supprimer local `setup-wizard.tsx` | `diff` local absent ; sim N/A |
| TF onboarding | Wizard local → host package + steps TF en slots ; shell/micro locaux supprimés | plus de `components/onboarding/micro.tsx` local |
| CV onboarding | Idem, 3 steps ; **ne pas** importer steps TF | parcours atelier OK |
| Fidu onboarding | Idem ; transport cabinet ; corriger hero Tempo → asset Fidu (dette) | micro local supprimé |
| Align Fidu exit | `resolveDesktopHomePath` ou config explicite | plus de hardcode divergent non justifié |

**Anti-pattern interdit :** copier le wizard TF entier dans le package puis
`if (brand === 'fidu')` — utiliser **registry de steps**.

---

## 5. Critères « 100 % » (checklist unique)

### Package `@creezio/onboarding` (obligatoire — Done ce plan)

1. ✅ Package créé ; exports `SetupWizard` + `SetupWizardConfig`.
2. ✅ Exports `OnboardingWizard` + `OnboardingStepDef` + `OnboardingTransport`.
3. ✅ `Stepper`, micro-engine, interstitial, CSS `onb-*` exportés / documentés.
4. ✅ Zéro type/schéma métier resto/cabinet/atelier dans le package.
5. ✅ Dépendance **unidirectionnelle** vers `shell-ui` mince ; **zéro** dep inverse.
6. ✅ Build + tests dédiés verts (`scripts/test-phase-p-onboarding.mjs`).
7. ✅ Harness test : shapes 3 steps **et** 8 steps.
8. ✅ **Aucun** module setup/onboarding sous `packages/shell-ui/`.

### Adoption ×3

9. ✅ Aucun `components/setup/setup-wizard.tsx` local.
10. ✅ Aucun moteur `onboarding-wizard.tsx` / `onboarding-shell.tsx` / `micro.tsx`
    local (hosts `onboarding-host.tsx` + `step-*.tsx` + types + transport).
11. ⏸️ Smoke desktop first-run (manuel / xvfb) — hors gate CI package.

---

## 6. Risques

| Risque | Impact | Mitigation |
|--------|--------|------------|
| Remettre setup/onboarding dans `shell-ui` | Fourre-tout confirmé | Placement gelé ici + audit scope ; gate « 0 fichier sous shell-ui/ui/setup\|onboarding » |
| Extraire en clonant TF (8 steps achats dans le package) | CV/Fidu forcés dans un mauvais moule | Registry steps ; demobrand 3 **et** 8 steps |
| Emporter routes/queries TF dans le package | Violation frontière UI / data | Transport injecté ; routes restent marque |
| Dep circulaire shell-ui ↔ onboarding | Couplage mortel | Gate package.json + rg imports |
| CSS globals oubliés → UI cassée au cutover | Régression visuelle | CSS dans package + import unique documenté |
| Fidu hero Tempo | Dette marque visible | Slot intro ; fix Fidu au cutover |
| CV twin queries mortes | Confusion maintenance | Hors package ; ticket data/brand séparé |
| Coupler sidebar/cockpit/tasks « en passant » | Scope creep | Interdit — seul package onboarding |

---

## 7. Ordre recommandé (résumé)

```
A Scaffold @creezio/onboarding + SetupWizard (brand API shell-ui)
    → B micro + Stepper + CSS
        → C OnboardingWizard host + demobrand 3/8
            → D exports + tests + README + gate no-inverse  = 100 % package
                → E cutover ×3 (autre chantier)
```

Estimation relative : **A** S–M · **B** S · **C** M · **D** S · **E** M
(cutover E hors charge « package seul »).

---

## 8. Références mesures (2026-07-30, tip apps)

```
setup TF↔CV sim=0.975  LOC 484/484
setup TF↔Fidu sim=0.971
micro TF↔Fidu sim=1.000  LOC 362
shell Stepper TF↔Fidu sim=0.915 (labels)
wizard TF↔CV sim=0.507   (contenu divergent)
wizard TF↔Fidu sim=0.695 (moteur proche, steps différents)
routes TF↔CV sim=1.000   LOC 309 (hors package)
routes TF↔Fidu sim≈0.16  LOC 76 Fidu (hors package)
onboarding UI total : TF 2838 · CV 638 · Fidu 2180
```

Fichiers gold setup : n’importe lequel des trois (diff = branding only) —
préférer TF puis substituer IPC→`getShellDesktopApi`.

Fichiers gold micro/stepper : TF ou Fidu (`micro` identique).

Fichiers **non-gold** pour le package : steps métier, `types.ts` marque,
`onboarding-queries`, routes.

Arbitrage placement : [AUDIT-SHELL-UI-SCOPE.md](AUDIT-SHELL-UI-SCOPE.md)
(`5a62b32`).

---

## 9. Livrable / statut push

- ✅ Audit comparatif conservé
- ✅ Package `@creezio/onboarding` (SetupWizard + moteur + micro + CSS)
- ✅ Gates `test-phase-p-onboarding.mjs` + wiring `build` / vendor sync / CJS
- ✅ Cutover ×3 : apps consomment le package ; jumeaux setup/moteur supprimés
- ✅ Doc PHASE → **implemented**
