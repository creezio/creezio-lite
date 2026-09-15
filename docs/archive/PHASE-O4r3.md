# Phase O4r3 — Unifier Hono `/mcp` → `create*BrandMcp`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-O4r2.md](PHASE-O4r2.md) · [ADR-assistant-tools-mcp.md](ADR-assistant-tools-mcp.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

Éliminer le **second registre de handlers métier** Hono (`server.ts` +
`MCP_TOOL_REGISTRY` comme SoT d’exécution).

**SoT** = factory marque `create*BrandMcp` → `create*ModuleMcpTools`  
consommée par **Electron**, **assistant** **et** **Hono `/mcp`**.

Kit : `bindFacadeToolsToHono` / `mcpFacadeResultToSdk` dans `@creezio/mcp-facade`.

---

## Wiring

| Surface | SoT | Brand |
|---------|-----|-------|
| Factory | `modules/brand-mcp.ts` | ×3 |
| Hono `/mcp` | `bindFacadeToolsToHono(create*BrandMcp(api))` | ×3 |
| Policies / scopes | `MCP_TOOL_REGISTRY` (métadonnées) + `registerMcpTool` wrap | TF/CV |
| Host-only | desktop `open_external_tab`, tâches IA, (CV) write dossiers… | hors factory |
| TF Next gold | `brand-module-api` mounts Meili/commande-queries | TF |
| CV Next gold | dossiers/pièces via `dossier-queries` | CV |

### Preuve anti-jumeau

- TF `server.ts` : **pas** d’import `commande-queries` / `queries` ; panier/catalogue via façade
- CV : **pas** de `registerMcpTool(…, "list_dossiers"|"get_dossier"|"list_pieces")`
- Fidu : façade bound ; tools GED host historiques encore présents (dette documentée — hors aliases `list_dossiers` / `list_contacts` / `accounting_query`)

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && npm run build -w @creezio/mcp-facade && npm test  # incl. test-phase-o4r3

# ×3 marques — vendor liste complète
bash scripts/electron/sync-creezio-vendor.sh
npm run test:assistant-routing
npm run test:active-surface
# TF
npm run test:phase-d1
```

### Gate `test-phase-o4r3`

- Kit exporte `bindFacadeToolsToHono`
- `server.ts` ×3 : `create*BrandMcp` + `bindFacadeToolsToHono` + `buildMcpServer` async
- TF : 0 handlers panier/catalogue dans `server.ts`
- CV : 0 register host pour list/get dossiers + list_pieces
- TF mcp-tools/aliases couvrent close/update/product/commandes
- ADR + PHASE + PLAN mis à jour

---

## Dettes reportées

| Dette | Notes |
|-------|-------|
| Fidu tools GED host (`search_entreprises`, pivot…) | Pas encore dans `createFiduModuleMcpTools` — extraire en vague suivante |
| CV write dossiers / search / AI / open_tab | Host volontaire (ctx Bearer / Meili search) — pas de jumeau façade |
| `entitySources` / `formatSearchHit` | → O4r4 |
| Host wirings gras | → O7 |

---

## SHAs (gold O4r3)

| | SHA |
|--|--|
| Kit | `f33f3b8` (+ tip docs pin) |
| TempoFlow | `6475831` |
| Certivan | `a71ee32` |
| Fidu | `03a2ed5` |
