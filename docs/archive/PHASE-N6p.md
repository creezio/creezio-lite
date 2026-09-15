# Phase N6p — Cutover admin (TF → Certivan)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repos** | `creezio/creezio` + TempoFlow + Certivan |
| **Prérequis** | [PHASE-N6.md](PHASE-N6.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N6 kit SHA** | `e4ec7fb` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Vendor sync liste complète TF+CV (pas d’exe Fidu — hors surface) |

---

## Objectif

UI + libs Admin Plugins / MCP / usage-analytics **absentes** des marques
(ou façades ≤80 LOC) ; mounts pages consomment `@creezio/*/ui`.

**Paperclip = mort.**  
**Exclu** : Fidu (pas de surface admin plugins) ; agregateurs / data-mapping ;
rewrite tool-registry métier.

---

## Cutover

| Marque | Pages mounts | Clients locaux | Façades |
|--------|--------------|----------------|---------|
| TempoFlow | plugins / plugins/[id] / mcp / analytics ≤80 | **absents** | mcp-admin, usage-analytics*, routes kit |
| Certivan | idem | **absents** | idem |

### Absents (TF + CV)

`src/components/admin/analytics-client.tsx`,
`src/components/admin/mcp-admin-client.tsx`,
`src/components/admin/analytics-productivity-panel.tsx`.

### Hosts marque

- `brand-mcp-admin-host.ts` → `configureMcpAdmin`
- `brand-usage-analytics-host.ts` → `configureUsageAnalytics`
- `brand-product-hub-ui-host.ts` (+ `-client`) → `configureProductHubUiBrand` +
  `configureTabWorkspaceHook`
- Provider usage : mount mince `@creezio/observability/ui` + session

### Kit (pré-cutover)

- UI imports `../dist/...` (vendor sans `src/`)
- `AdminPluginDetail` named export
- `configureUsageAnalyticsUiBrand` réexporté depuis `@creezio/observability/ui`

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-n6p

# TF
cd /opt/docker/tempoflow2/crm
test ! -f src/components/admin/analytics-client.tsx
wc -l src/app/admin/plugins/page.tsx   # ≤80
npm run build && npm run electron:compile
npm run test:plugin-acl-l3 && npm run test:plugin-sidebar

# CV
cd /opt/docker/certivan-app/crm
test ! -f src/components/admin/mcp-admin-client.tsx
npm run build && npm run electron:compile
npm run test:plugin-acl-l3 && npm run test:plugin-sidebar
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV poussé | SHAs ci-dessous |
| Pages mounts ≤80 LOC | ✅ |
| Clients locaux absents | ✅ |
| Vendor liste complète | ✅ sync ×2 |
| Gates build / electron / ACL / sidebar | ✅ |
| Kit sign-off | (voir SHAs) |

---

## SHAs

| Repo | SHA | Notes |
|------|-----|-------|
| Kit | `f8862de` | N6p UI fix + docs + gate |
| TempoFlow | `c85bb0f` | cutover admin |
| Certivan | `08a02b1` | cutover admin |

---

## Suite

**N7** — `supplier-tabs` hors métier Certivan / Fidu (reste TF only).
