# Backlog H3 — Modules métier TempoFlow (brand repo)

| | |
|--|--|
| **Statut** | ✅ Sign-off |
| **Prérequis** | [PHASE-H2.md](PHASE-H2.md) sign-off |
| **Repo marque** | `/opt/docker/tempoflow2` (GitHub `creezio/tempoflow2`) |
| **Repo kit** | `/opt/docker/creezio` — docs + `ARCHITECTURE_VERSION` uniquement |
| **Gold standard** | tempoflow2 **0.10.x** — **pas** tempoflow2-backup |

---

## Décisions verrouillées

1. Modules métier **dans le brand repo** — **jamais** dans `@creezio/*`
2. Tables métier → SQLite **brand** (`tempoflow2.db` = `resolveBrandDbPath`)
3. Montages `registerModuleApi` + MCP space `module` + slots `shell-ui`
4. Migrations brand versionnées dans tempoflow2 (`composeMigrations`)
5. Découpage **progressif** module par module + gates verts
6. Zéro panier / dispatch / relevés dans packages creezio
7. **Zéro perte de features** — chemins Hono / UI / MCP TF existants restent

---

## Sous-phases

```
H3.0  Inventaire exhaustif modules TF → tables brand
H3.1  Structure brand modules + vendor contrats H2
H3.2  Migrations brand + SqliteRuntime core+brand (boot)
H3.3  Modules panier + dispatch + releves (API/MCP/nav)
H3.4  Modules vague 2 (catalogue, stack, scan stubs/registry)
H3.5  Tests smoke H3 + gates métier existants
H3.6  Docs PHASE-H3 + ARCHITECTURE_VERSION=H3 + matrice + push
```

| ID | But | Done |
|----|-----|------|
| **H3.0** | Inventaire modules + mapping tables brand vs core | ✅ |
| **H3.1** | `electron/modules/` + vendor api-kernel/mcp-facade/shell-ui/auth | ✅ |
| **H3.2** | `brand-runtime.ts` : `createSqliteRuntime` + brandMigrations TF | ✅ |
| **H3.3** | registerModuleApi panier/dispatch/releves + MCP + registerBrandNav | ✅ |
| **H3.4** | Registry catalogue/stack (+ scan nav) sans réécriture UI totale | ✅ |
| **H3.5** | `test-phase-h3-modules` + smoke shell/métier pertinents verts | ✅ |
| **H3.6** | PHASE-H3, bump H3, matrice ✅/🟡, push kit + TF | ✅ |

---

## Hors scope H3 (→ H4+)

- Proxy MCP unifié durci (fusion complète MCP TF historique ↔ mcp-facade)
- Réécriture totale sidebar / UI vers slots only
- Extraction Fidu / Certivan
- Split physique catalogue éditeur vs client DB (déjà documenté purge)

---

## Ordre d’extraction (produit)

1. **panier** — surface claire, tables `commandes`/`commande_lignes` (brouillon)
2. **dispatch** — versions + optimiser API
3. **releves** — `releves_prix` + lecture
4. **catalogue** / **stack** / **scan** — registry + nav (vague 2)
