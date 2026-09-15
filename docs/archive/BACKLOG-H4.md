# Backlog H4 — MCP proxy unifié durci

| | |
|--|--|
| **Statut** | ✅ Sign-off — [PHASE-H4.md](PHASE-H4.md) |
| **Prérequis** | [PHASE-H3.md](PHASE-H3.md) sign-off |
| **Repo kit** | `/opt/docker/creezio` — `@creezio/mcp-facade` + docs + `ARCHITECTURE_VERSION` |
| **Repo marque** | `/opt/docker/tempoflow2` — bridge aliases + surface publique unique |
| **Gold standard** | tempoflow2 **0.10.x** — **pas** de régression `test:mcp-*` |

---

## Décisions verrouillées

1. **Une** surface MCP d’app : core + module + plugin découverts ensemble
2. Namespaces : `creezio.*` / `module.<id>.*` / `plugin.<id>.*`
3. Aliases legacy TF (`get_panier` → `module.panier.get`) + `publicSurface: legacy-preferred`
4. Deny cross-layer call cohérent api-kernel H2 (`__cross/`, spoof `targetSpace`)
5. Métier reste brand repo ; kit = natif façade/proxy uniquement
6. Ne pas casser les tools historiques exposés sur `/mcp` (gold)

---

## Sous-phases

```
H4.0  Audit MCP historique TF ↔ mcp-facade (doublons panier/relevés)
H4.1  Kit : namespaces + assert
H4.2  Kit : aliases + publicSurface (anti double exposition)
H4.3  Kit : policies deny cross-layer + registerTool registry
H4.4  TF : aliases brand-runtime + catalogue unifié
H4.5  TF : bridge Hono `/mcp` (list_tools_by_space + zéro module.panier.*)
H4.6  Tests kit H4 + E2E TF test:mcp-* + smoke H4
H4.7  Docs PHASE-H4 + ARCHITECTURE_VERSION=H4 + push
```

| ID | But | Done |
|----|-----|------|
| **H4.0** | Inventaire doublons + mapping alias | ✅ |
| **H4.1** | `namespace.ts` parse/assert | ✅ |
| **H4.2** | aliases + `legacy-preferred` | ✅ |
| **H4.3** | `denyCrossLayerToolCall` + `registerTool` | ✅ |
| **H4.4** | TempoFlow brand-runtime + `mcp-aliases` | ✅ |
| **H4.5** | Bridge Hono catalogue unifié | ✅ |
| **H4.6** | `test-phase-h4` + `test:mcp-*` + smoke TF | ✅ |
| **H4.7** | PHASE-H4, bump H4, push | ✅ |

---

## Hors scope H4 (→ H5)

- Harden plugins/ACL runtime (Product Hub L3 + policies orga)
- Réécriture totale sidebar / UI slots only
- Extraction Fidu / Certivan
