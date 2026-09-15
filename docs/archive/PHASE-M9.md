# Phase M9 — MCP/API anti-jumeau

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` (+ Certivan cutover miroir) |
| **Prérequis** | [PHASE-M8p.md](PHASE-M8p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non |

---

## Objectif

Cœur MCP/API via `@creezio/mcp-facade` + `@creezio/api-kernel` ;
plus de fichiers plateforme `mcp-runtime` / `mcp-hono-proxy` dans
`electron/modules/` (TF / Certivan). TF = mounts métier + aliases/tools
brand only.

---

## Travaux kit

| Livrable | Note |
|----------|------|
| `mcp-facade/runtime.ts` | `MCP_PRODUCT_EXECUTOR`, `resolveMcpFacadeRole`, modes |
| `mcp-facade/hono-proxy.ts` | `wrapMcpFacadeWithHonoProxy` + `__mcpHonoProxyTest` |
| `mcp-facade/core-tools.ts` | `createCoreMcpTools` + `CREEZIO_CORE_MCP_TOOL_NAMES` |
| façade | consomme `createCoreMcpTools` (plus de copie locale) |

---

## Travaux TF

| Fichier | Après |
|---------|-------|
| `electron/modules/mcp-runtime.ts` | **absent** → kit |
| `electron/modules/mcp-hono-proxy.ts` | **absent** → kit |
| `electron/modules/mcp-aliases.ts` | métier (conservé) |
| `electron/modules/mcp-tools.ts` | métier (conservé) |
| `brand-runtime.ts` | imports `@creezio/mcp-facade` directs |
| `src/lib/mcp-runtime.ts` | alias mince → kit |
| `tool-registry` / `unified-catalog` | noms cœur via `CREEZIO_CORE_MCP_TOOL_NAMES` |

## Travaux Certivan (miroir, anti jumeau inter-marques)

| Fichier | Après |
|---------|-------|
| `mcp-runtime` / `mcp-hono-proxy` modules | **absents** |
| `brand-runtime` + `src/lib/mcp-runtime` | kit |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| Pas de couple plateforme `mcp-runtime` / `mcp-hono-proxy` TF↔Certivan | ✅ absents |
| Tools cœur importés kit | ✅ `CREEZIO_CORE_MCP_TOOL_NAMES` / `createCoreMcpTools` |
| TF modules = métier (+ aliases/tools brand) | ✅ |
| Vendor liste complète | ✅ |
| Gates ci-dessous | ✅ |
| PHASE-M9.md | ✅ |

**Exclu M9** : unifier arbre métier TF `modules/` vs `electron/modules/`
(symlink déjà) — mounts panier/dispatch… → **M10**.

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m9
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile \
  && npm run test:phase-h4 \
  && npm run test:phase-d1 \
  && npm run test:mcp-base-url \
  && npm run test:mcp-admin:p0 \
  && npm run test:api-publique \
  && npm run test:phase-i12 \
  && npm run electron:compile
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `1908d73` |
| TF `tempoflow2` | `059df48` |
| Certivan `certivan-app` | `55cf82f` |

---

## Suite

**M10** — Un seul arbre métier TF (`electron/modules/{panier,…}` absents
si doublon hors symlink).
