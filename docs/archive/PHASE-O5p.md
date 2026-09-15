# Phase O5p — Cutover admin request-logs / api-endpoints (TF → CV → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-O5.md](PHASE-O5.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O5 kit tip** | `d6d5b81` / pin `834e48b` |
| **Kit tip O5p** | `97a4d2a` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

### SHAs marques (gold O5p)

| Marque | SHA |
|--------|-----|
| TempoFlow | `2203a41` |
| Certivan | `a7b96b3` |
| Fidu | `8009aed` |

---

## Objectif

**0** clients / libs request-logs locaux ×3 ; **0** `api-endpoints-client`
local TF+CV ; mounts importent `@creezio/observability` (+ `/ui`). Vendor
liste complète (kit tip O5). **Paperclip = mort**. **Façades = NON done**.

---

## Deletes

| Fichier | TF | CV | Fidu |
|---------|----|----|------|
| `src/lib/request-logs.ts` | ✅ | ✅ | ✅ |
| `src/server/request-log-middleware.ts` | ✅ | ✅ | ✅ |
| `src/server/routes/request-logs.ts` | ✅ | ✅ | ✅ |
| `src/components/admin/request-logs-client.tsx` | ✅ | ✅ | ✅ |
| `src/components/admin/api-endpoints-client.tsx` | ✅ | ✅ | N/A |

---

## Wiring marque

| Surface | SoT | Brand |
|---------|-----|-------|
| Ring buffer / redact / list | `@creezio/observability` | — |
| Middlewares API / MCP | kit | `app.ts` / `mcp/app.ts` |
| Routes admin logs | `createRequestLogsRoutes()` | mount `/admin` |
| UI logs | `RequestLogsClient` `/ui` | pages + `admin-mcp-host` |
| UI endpoints | `ApiEndpointsClient` `/ui` | pages TF/CV |
| `listRequestLogs` MCP admin | kit | `brand-mcp-admin-host` TF/CV |

Pages AppShell ≤80 LOC (request-logs ~18 · api ~27).

---

## Gates

```bash
# ×3 marques
bash scripts/electron/sync-creezio-vendor.sh   # liste complète
npm run build
npm run electron:compile

# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-o5p
```

### Gate `test-phase-o5p`

- Absents ×3 : lib / middleware / routes / request-logs-client
- Absents TF+CV : api-endpoints-client
- Imports kit dans `app.ts` / `mcp/app.ts` / pages
- Vendor `observability` + `dist/request-logs`
- PLAN-O O5p livré + SHAs marques
- Paperclip mort

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV+Fidu poussé | SHAs ci-dessus |
| 0 jumeaux request-logs ×3 | ✅ |
| Vendor kit tip O5 | ✅ `834e48b` |
| Gates build / electron:compile ×3 | ✅ |
| `test-phase-o5p` | ✅ |
| Republish packing | Non |

---

## Suite

**O6** — Certivan dé-TF (migrations / queries catering).
