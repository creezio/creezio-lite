# Phase O9 — Jumeaux lib/UI plateforme restants → kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (extract only) |
| **Prérequis** | [PHASE-O8.md](PHASE-O8.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O8 kit tip** | `c50d217` / tip `8b7f0ef` |
| **Kit tip O9** | `3e4194a` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (cutover = O9p) |

---

## Objectif

SoT unique des near-copies **plateforme** TF↔CV restantes (shell UI,
settings desktop, workspace chrome, tasks UI, api-scopes / utils /
public-origin / trails admin). **Pas de cutover marques**.

**Façades / stubs / jumeaux = NON done.** Paperclip = mort.  
**Exclu kit** : panier/RTI/GED ; onboarding restaurant ; `nav-context` /
`page-meta` métier ; `tab-workspace-context` (supplier-surface) ;
routes serveur + libs DB (`lib/tasks.ts`, …).

---

## Inventaire (post-O3/O5, ≥90 %, extractable)

| Zone | Package | Contenu |
|------|---------|---------|
| Brand + libs | `@creezio/shell-ui` | `configureShellUiBrand`, api-scopes, utils, public-origin, page-trails admin, ops-track, geo/img/cover, keepalive, desktop-home-path |
| UI shell | `@creezio/shell-ui/ui` | primitives, layout chrome, workspace (hors tab-context), settings desktop×N, desktop bridge, search/list tools |
| Hosts injection | idem | `configureTabWorkspaceHost`, `configureGlobalSearchHost`, `configureAiActivityPanel` |
| Tasks UI | `@creezio/tasks/ui` | types, kanban, detail sheet, ai-activity-panel |

**Hors extract (métier / DB / residue)** : onboarding restaurateur, sidebar
métier, cockpit, `lib/tasks`+routes, `global-search-provider` (reste marque
jusqu’à host O9p), entity trails `page-meta`.

LOC extract ≈ **11 k** (shell-ui src/lib + ui + tasks/ui).

---

## Pattern injection (O9p)

```ts
import {
  configureShellUiBrand,
  normalizeApiScopes,
} from "@creezio/shell-ui";
import {
  configureTabWorkspaceHost,
  DesktopN8nSettings,
} from "@creezio/shell-ui/ui";
import { TasksKanbanClient, AiActivityPanel } from "@creezio/tasks/ui";
import { configureAiActivityPanel } from "@creezio/shell-ui/ui";

configureShellUiBrand({
  desktopApiGlobal: "tempoflowDesktop",
  publicHostSuffix: "tempoflow.fr",
  titlebarDragClass: "tempoflow-titlebar-drag",
  titlebarNoDragClass: "tempoflow-titlebar-no-drag",
  productName: "TempoFlow",
  apiKeyPrefix: "tf2_live_",
});
configureTabWorkspaceHost({ useTabWorkspace: () => useTabWorkspace() });
configureAiActivityPanel(AiActivityPanel);
```

---

## Gates

```bash
cd /opt/docker/creezio
npm run build:packages && npm test   # incl. test-phase-o9
```

### Gate `test-phase-o9`

- Modules + exports `./ui` shell-ui & tasks
- 0 `@/` · 0 Paperclip · 0 `window.tempoflowDesktop` dans extract
- Jumeaux marques **encore présents** (anti-cutover)
- Smoke `configureShellUiBrand` + `normalizeApiScopes` + trails

---

## Done

| Critère | Preuve |
|---------|--------|
| Inventaire + extract gold TF | ✅ |
| `build:packages` + `test-phase-o9` | ✅ |
| Cutover différé O9p | ✅ |
| Paperclip mort | ✅ |

---

## Suite

**O9p** — Cutover jumeaux lib/UI (TF → CV → Fidu) + delete liste O9.

## Addendum intention (post-O9, avant O9p)

Contrainte : **pas de domaine métier TF dans packages natifs**.
Voir [ADR-no-brand-domain-in-native-packages.md](ADR-no-brand-domain-in-native-packages.md).

Remédiation kit : `OpenExternalSiteOpts` / `siteId` / « Site externe » /
tools `external_*` (alias `supplier_*` dépréciés) ; paths panier/optimiser
vidés par défaut + `configureFullscreenPaths` ; icônes tab-bar injectables.
