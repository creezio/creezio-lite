# Audit — scope réel de `@creezio/shell-ui`

| | |
|--|--|
| **Date** | 2026-07-30 |
| **Nature** | Arbitrage structure packages (pas d’implémentation) |
| **SoT** | Code `packages/shell-ui` · apps TF/CV/Fidu · [ETAT-DES-LIEUX-INTENTION.md](ETAT-DES-LIEUX-INTENTION.md) · [PHASE-P-ONBOARDING.md](PHASE-P-ONBOARDING.md) (plan tranché → `@creezio/onboarding`) |

---

## 1. Verdict (3 phrases)

**Les deux.** Le nom `shell-ui` visait à l’origine **nav + slots** (H1/I7) ; O9 y a versé ~10,5 kLOC de chrome CRM (primitives, layout, workspace, settings×17, search, libs misc) — ce n’est plus « juste un mauvais nom ». Les docs intention (P15 / matrice « Shell CRM ») ont ensuite **légitimé le fourre-tout** en classant cockpit + setup/onboarding + search sous le même package, alors que les apps gardent déjà des dossiers séparés. **« NATIF shell » = classification ×3 (plateforme), pas une frontière de package.**

---

## 2. Qu’est-ce que `shell-ui` aujourd’hui ?

| Export | Rôle |
|--------|------|
| `@creezio/shell-ui` | Nav registry / adapters + brand config + libs utilitaires |
| `@creezio/shell-ui/ui` | UI React (primitives → settings desktop) |

**Hors shell-ui (packages dédiés livrés)** : `@creezio/onboarding` (`SetupWizard` + moteur onboarding) · `@creezio/cockpit` (`ServerCockpitShell`) — cutover marques fait. Sidebar / workspace / search = SoT `@creezio/shell-ui/ui`.  
**Splash** : déjà dans `@creezio/electron-shell` (`splash-ui.ts`, pilier P04) — **pas** shell-ui.

### Inventaire domaines (source `ui/` + `src/`, ~10,5 kLOC)

| Domaine | Fichiers / LOC approx | Rester dans shell-ui ? | Sortie cible |
|---------|----------------------|------------------------|--------------|
| Nav + slots + registry | `src/{types,core-nav,registry,adapters}` ~400 | **Oui** (cœur historique) | — |
| Brand / desktop API glue | `src/brand.ts` | **Oui** (contrat commun UI) | — |
| Libs misc (utils, origins, trails, ops, geo, img…) | `src/lib/*` ~766 | Partiel | utils purs → `platform-core` ou laisser ; ops → `observability` plus tard |
| Primitives (shadcn-like) | `ui/primitives/*` ~1,3 k | **Oui** (socle partagé) | ou `@creezio/ui` si un jour trop lourd |
| Layout / chrome pages | `ui/layout/*` ~485 | **Oui** | — |
| Workspace / tabs hosts | `ui/workspace/*` ~1,8 k | **Oui** (shell runtime) | — |
| Search UI + host | `ui/global-search*` + list tools ~1 k | **Oui** court terme | optionnel `@creezio/search-ui` si grossit |
| Settings desktop×N | `ui/settings/*` ~3,3 k | **Trop** pour le nom | garder en sous-chemin `shell-ui/ui/settings` ou `@creezio/desktop-settings` (P2) |
| Desktop chrome / PWA / loading | `ui/desktop/*`, `pwa/`, `page-loading/` ~480 | **Oui** (chrome shell) | — |
| Client libs (fleet, hermes, n8n, AI) | `ui/lib/*` ~752 | Limite | fleet → conso `observability` ; hosts restent mince |
| **Setup / onboarding** | package `@creezio/onboarding` | **Non** (package dédié) | **`@creezio/onboarding`** ✅ |
| **Cockpit UI** | package `@creezio/cockpit` | **Non** (package dédié) | **`@creezio/cockpit`** ✅ |
| **Splash** | — | N/A | **déjà** `@creezio/electron-shell` |
| **Auth store / session** | — | N/A | **déjà** `@creezio/auth` ; login UI = cutover vers auth (+ chrome shell-ui) |

---

## 3. Alignement apps (séparation claire)

Les trois marques **séparent déjà** par dossiers — le kit ne doit pas aplatir ça :

| Surface | TF | CV | Fidu |
|---------|----|----|------|
| Onboarding UI | `components/onboarding` ~2,8 k | ~0,6 k | ~2,2 k |
| Setup | `components/setup` 484 | 484 | 484 |
| Cockpit | `components/cockpit` ~1,4 k + `app/cockpit` | idem | **absent** (dette parité) |
| Workspace | `components/workspace` ~1,4 k | ~1,4 k | ~1,3 k |
| Auth UI | `components/auth` | idem | idem |
| Splash | runtime Electron (kit `electron-shell` + builds locaux) | idem | idem |
| Layout / sidebar | `components/layout` ~1 k | ~1 k | ~0,9 k |

Routes pages : `app/setup`, `app/onboarding` (± `app/cockpit`) partout où la surface existe.

---

## 4. Pourquoi le fourre-tout ?

1. **O9** = extract gold TF « shell CRM » dans **un** package déjà nommé nav — exclusion explicite de l’onboarding restaurateur, mais pas de découpe settings/workspace/search.
2. **P15 / matrice** ont listé cockpit + setup/onboarding + search comme contenu cible de `shell-ui` (pilier « Shell CRM ») — confusion **classification NATIF** ↔ **un seul npm package**.
3. Pattern récurrent kit : créer le package-parapluie d’abord, découper plus tard — alors que d’autres piliers ont déjà des packages dédiés (`auth`, `tasks`, `mails`, `electron-shell` pour splash).

---

## 5. Découpage cible (cohérent « un package à la fois » + ×3)

| Package | Contenu | Priorité extract |
|---------|---------|------------------|
| **`@creezio/shell-ui`** | Nav + slots + primitives + layout chrome + workspace/tabs + search hosts + desktop chrome mince. **Pas** le produit onboarding. | Stabiliser le périmètre (doc + README) |
| **`@creezio/onboarding`** | `SetupWizard` (100 % commun) + moteur onboarding (stepper, micro, host steps) + CSS `onb-*` ; slots marque pour steps métier | **P0 / Phase P** |
| **`@creezio/cockpit`** | UI server cockpit (TF/CV gold → Fidu parité) | Après onboarding |
| **`@creezio/electron-shell`** | Splash + boot + hosts (déjà) | Ne pas déplacer |
| **`@creezio/auth`** | Session + login UI (cutover) | P14 |
| Optionnel plus tard | `@creezio/desktop-settings` si settings restent le plus gros LOC | P2 |

**Dépendances** : `@creezio/onboarding` → `shell-ui/ui` (Button/Input, `AuthWindowChrome`, `getShellUiBrand`, `resolveDesktopHomePath`) + `@creezio/shell` (IPC). Routes HTTP / schémas SQLite restent marque (ou package data ultérieur).

---

## 6. Impact audit onboarding en cours

- **Ne pas** cibler l’implémentation comme sous-dossier obligatoire de `shell-ui`.
- **Cibler** un **nouveau** package `@creezio/onboarding` (setup + moteur onboarding).
- Audit + plan finalisés dans [PHASE-P-ONBOARDING.md](PHASE-P-ONBOARDING.md) — package cible **`@creezio/onboarding`** (plus DRAFT).
- Mettre à jour P15 / matrice : « Shell CRM » = *famille de surfaces natives*, pas *un seul package*.
