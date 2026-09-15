# Phase H4 — MCP proxy unifié durci

| | |
|--|--|
| **Statut** | ✅ Sign-off |
| **ARCHITECTURE_VERSION** | `"H4"` (`@creezio/platform-core`) |
| **Kit** | `/opt/docker/creezio` |
| **Marque TF** | `/opt/docker/tempoflow2` |
| **Prérequis** | [PHASE-H3.md](PHASE-H3.md) |
| **Backlog** | [BACKLOG-H4.md](BACKLOG-H4.md) |

---

## Objectif

Unifier le MCP historique TempoFlow (`tempoflow2-crm` / Hono `/mcp`) et
`@creezio/mcp-facade` sous **une** surface de discovery : core / module /
plugin, avec auth/policies et **zéro double exposition** panier / relevés.

---

## Audit (H4.0)

| Domaine | Historique `/mcp` | Façade H3 `module.*` | Résolution H4 |
|---------|-------------------|----------------------|---------------|
| Panier | `get_panier`, `add_to_panier`, … | `module.panier.get`, `module.panier.add_ligne` | Alias legacy → canonique ; surface `legacy-preferred` |
| Relevés | `list_releves_prix` | `module.releves.list` | Idem |
| Dispatch | — (via commandes) | `module.dispatch.*` | Canonique seul (pas de doublon) |
| Cœur | — | `creezio.*` | Catalogue unifié + tool `list_tools_by_space` |
| Auth publique | OAuth JWT + API key + `mcp_tool_policies` | JWT façade Electron | Inchangé côté Hono ; deny cross-layer sur façade |

---

## Livrables kit

| Item | Preuve |
|------|--------|
| Namespaces `creezio.*` / `module.<id>.*` / `plugin.<id>.*` | `packages/mcp-facade/src/namespace.ts` |
| Aliases + `publicSurface: legacy-preferred` | `facade.ts` |
| Policy `denyCrossLayerToolCall` | `policy.ts` |
| Registry `registerTool` / `registerAlias` / `listAliases` | API façade |
| Tool admin `creezio.admin.list_aliases` | core tools |
| `ARCHITECTURE_VERSION = "H4"` | platform-core |
| Tests | `scripts/test-phase-h4.mjs` (suite `npm test`) |

## Livrables TempoFlow

| Item | Preuve |
|------|--------|
| Map aliases (miroir) | `src/lib/mcp-aliases.ts` ↔ `electron/modules/mcp-aliases.ts` |
| brand-runtime façade H4 | aliases + legacy-preferred + deny |
| Catalogue unifié | `src/server/mcp/unified-catalog.ts` |
| Tool Hono `list_tools_by_space` | registre 23 tools + `server.ts` |
| Zéro `module.panier.*` sur Hono | gate smoke H4 |
| Smoke | `npm run test:phase-h4` |
| E2E offline | `test:mcp-admin:p0/p1/p2`, `test:mcp-base-url`, `test:mcp-tasks` |

---

## Checklist sign-off

- [x] H4.0–H4.7 livrés (pas de sous-partie skippée)
- [x] Tests kit H4 verts (`npm test`)
- [x] `test:mcp-*` TF offline verts ; oauth live = credentials absents (non-régression code)
- [x] Doublons panier/relevés éliminés (legacy-preferred + catalogue)
- [x] `ARCHITECTURE_VERSION = "H4"`
- [x] Docs PHASE-H4 + BACKLOG-H4 + matrice
- [x] Push kit + TF
- [x] Suite H5 documentée ci-dessous

**Exe Windows** : non republishée — surface publique H4 = Hono `/mcp`
(déploiement Server). Façade Electron brand-runtime H4 est dans le vendor
compilé ; republish Client/Server uniquement si packaging desktop requis.

## Verdict

**H4 maximisé** : proxy MCP unique (façade kit + catalogue/tool Hono),
aliases anti-doublon, deny cross-layer, tests verts, version H4.

---

## Suite H5 — Harden plugins / ACL

→ **Livré** : [PHASE-H5.md](PHASE-H5.md) / [BACKLOG-H5.md](BACKLOG-H5.md).
