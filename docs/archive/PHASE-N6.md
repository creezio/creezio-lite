# Phase N6 — Admin Plugins / MCP / analytics génériques → kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` |
| **Prérequis** | [PHASE-N5.md](PHASE-N5.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N5 kit SHA** | `b818804` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

SoT des UI + handlers **génériques** Admin Plugins / MCP admin /
usage-analytics (gold TempoFlow) dans le kit. **Sans cutover marques** (→ N6p).

**Paperclip = mort.**  
**Exclu** : agregateurs / data-mapping / rules / tool-registry métier ;
rewrite Fidu (pas de surface admin plugins).

---

## Travaux kit

| Package | Surface | Rôle |
|---------|---------|------|
| `@creezio/product-hub` | `src/plugin-ui/*` + `./ui` | helpers sidebar/panel + `AdminPluginsList` / `AdminPluginDetail` |
| `@creezio/mcp-facade` | `src/admin/*` + `./ui` | `configureMcpAdmin` + `createMcpAdminRoutes` + `McpAdminClient` |
| `@creezio/observability` | `src/usage/*` + `./ui` | usage-analytics libs/routes + `AnalyticsClient` / provider |

### API

```ts
import {
  configureProductHubUiBrand,
  pluginSidebarItems,
} from "@creezio/product-hub";
import { AdminPluginsList, AdminPluginDetail } from "@creezio/product-hub/ui";

import {
  configureMcpAdmin,
  createMcpAdminRoutes,
} from "@creezio/mcp-facade";
import { McpAdminClient } from "@creezio/mcp-facade/ui";

import {
  configureUsageAnalytics,
  configureUsageAnalyticsUiBrand,
  createUsageAnalyticsIngestRoutes,
  createUsageAnalyticsAdminRoutes,
} from "@creezio/observability";
import {
  AnalyticsClient,
  UsageAnalyticsProvider,
} from "@creezio/observability/ui";
```

Injection marque : `getDb` / `listTools` / `desktopApiGlobal` / `aidAttr` —
zéro import `@/` dans le kit.

### demobrand

Surface **I5 ACL** (`admin-plugins` HTML/API) **inchangée** — distincte de
l’UI Product Hub React (CRM). Les panels CRM consomment `@creezio/*/ui`.

---

## LOC (`wc -l` extract N6)

| Zone | LOC approx. |
|------|------------:|
| mcp-facade admin + ui | ~800 |
| observability usage + ui | ~3100 |
| product-hub plugin-ui + ui | ~2000 |
| **Total** | **~5900** |

---

## Gates

```bash
cd /opt/docker/creezio && npm run build:packages && npm test
# incl. test-phase-n6
```

---

## Critère done

- [x] Libs + routes MCP admin / usage-analytics dans kit
- [x] UI admin plugins / mcp / analytics via `./ui`
- [x] 0 agregateurs / data-mapping / Paperclip dans extract
- [x] `PRODUCT_HUB_VERTICAL_REMAINING` sans `admin-ui-plugins`
- [x] demobrand I5 ACL conservé
- [x] Doc `PHASE-N6.md` + PLAN-N
- [x] **Pas de cutover** TF/CV (→ N6p)

---

## SHAs

| Repo | SHA | Notes |
|------|-----|-------|
| Kit | `e4ec7fb` | N6 extract |

---

## Suite

**N6p** — Cutover admin TF → CV (mounts ≤80 LOC, delete clients locaux).
