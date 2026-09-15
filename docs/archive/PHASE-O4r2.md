# Phase O4r2 — Un registre MCP unique (façade marque = SoT)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-O4r.md](PHASE-O4r.md) · [ADR-assistant-tools-mcp.md](ADR-assistant-tools-mcp.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

Éliminer le **mini-registre parallèle** `mcp-bridge.ts` (handlers panier / RTI / accounting hardcodés).

**SoT** = factory marque `modules/brand-mcp.ts` → `create*ModuleMcpTools(api)`  
consommée par **Electron** (`brand-runtime`) **et** **assistant** (`mcp-bridge` = adaptateur mince).

---

## Wiring

| Surface | SoT | Brand |
|---------|-----|-------|
| Factory façade | `modules/brand-mcp.ts` (`create*BrandMcp`) | ×3 |
| Tools module.* | `modules/mcp-tools.ts` | ×3 |
| ApiKernel mounts | `modules/*/api-mount` (+ Next `brand-module-api.ts`) | ×3 |
| Assistant | `mcp-bridge.ts` → `mcpFacadeToAssistantConfig(create*BrandMcp(api))` | mince |
| Accounting Fidu | `modules/accounting/*` + `module.accounting.query` | Electron + assistant |
| open tab Fidu | kit `supplier_open_tab` | **pas** de jumeau `module.desktop.*` |

### Preuve anti-jumeau

- `mcp-bridge.ts` ×3 : **aucune** définition `name: "module.…"` / handler métier
- `create*BrandMcp` importé par `electron/brand-runtime.ts` **et** `src/lib/assistant/mcp-bridge.ts`
- TF : `module.statut.set` dans `mcp-tools` + mount `statut`
- Fidu : `module.accounting.query` dans `mcp-tools` + mount `accounting`

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-o4r2

# ×3 marques
bash scripts/electron/sync-creezio-vendor.sh   # liste complète packages
npm run test:assistant-routing
npm run test:active-surface
```

### Gate `test-phase-o4r2`

- Présents ×3 : `modules/brand-mcp.ts`, `src/lib/brand-module-api.ts`
- `mcp-bridge.ts` mince : `create*BrandMcp` + `mcpFacadeToAssistantConfig` ; **pas** de `handler:` métier
- Electron `brand-runtime` utilise `create*BrandMcp`
- Fidu : `module.accounting.query` dans `modules/mcp-tools.ts`
- Absents ×3 : `TOOL_DEFINITIONS` dans `prompts.ts`
- ADR mis à jour (O4r2)

---

## Dettes reportées (pas de nouveau jumeau)

| Dette | Notes |
|-------|-------|
| `entitySources` / `formatSearchHit` | Toujours TS marque ; pas de manifest déclaratif kit sans invention — hors vague |
| Hono `/mcp` `MCP_TOOL_REGISTRY` legacy | Surface publique historique (D1) ; façade module.* = adaptateur brand-mounts ; unifier handlers Hono ≠ objectif O4r2 |
| open_external_tab module | Plateforme `supplier_open_tab` = SoT ; pas de `module.desktop.*` |

---

## SHAs (gold O4r2)

| | SHA |
|--|--|
| Kit | feat `30dbf06` · tip `3d580a9`+ (docs pin) |
| TempoFlow | `ee516af` (feat `68ebdf8`) |
| Certivan | `b92465e` (feat `bde11ba`) |
| Fidu | `c7d71c9` (feat `c9933ee`) |
