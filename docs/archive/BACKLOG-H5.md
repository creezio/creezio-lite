# Backlog H5 — Harden plugins / ACL

| | |
|--|--|
| **Statut** | ✅ Sign-off — [PHASE-H5.md](PHASE-H5.md) |
| **Prérequis** | [PHASE-H4.md](PHASE-H4.md) sign-off |
| **Repo kit** | `/opt/docker/creezio` — `@creezio/product-hub` + mcp-facade + api-kernel + demobrand |
| **Repo marque** | TempoFlow : consommation L3 progressive (hors scope bloquant) |
| **Gold standard** | demobrand E2E plugin-control ; ne pas casser TF / Certivan / Fidu |

---

## Décisions verrouillées

1. Plugins = **org plugins** avec ACL (qui voit / installe / exécute)
2. SQLite `plugin/<id>` créée **à l'install** seulement ; jour 0 = core+brand
3. Deny cross-layer (plugin ↛ core write) déjà H2 — H5 durcit **ACL org / Product Hub**
4. Capacités L3 : `see` / `install` / `execute` (défaut membership = see+execute)
5. Deny cross-org : org B ne voit/installe/exécute pas un plugin bound à org A
6. Même `decidePluginAccess` pour API + MCP + control-plane
7. Métier reste brand repo ; kit = natif + plugin host
8. Packaging lessons intactes

---

## Sous-phases

```
H5.0  Audit Product Hub + plugin host (kit H1.8, demobrand H2.4, TF L4)
H5.1  ACL L3 capabilities see/install/execute + schema binding H5
H5.2  Deny cross-org (policy + store + headers actor)
H5.3  Policies cohérentes API + MCP (decidePluginAccess partagé)
H5.4  Control-plane ACL optionnel (rétrocompat sans `acl`)
H5.5  E2E demobrand plugin-control (install → DB → MCP → revoke)
H5.6  Tests kit H5 verts + docs + ARCHITECTURE_VERSION=H5 + push
```

| ID | But | Done |
|----|-----|------|
| **H5.0** | Inventaire gaps L3 / control-plane / TF L4-only | ✅ |
| **H5.1** | `decidePluginAccess`, caps, `PRODUCT_HUB_ACL_H5_SQL` | ✅ |
| **H5.2** | `plugin_org_binding` + `isCrossOrgDenied` | ✅ |
| **H5.3** | api-kernel `authorizePluginAccess` + mcp `createDenyUnauthorizedPluginToolPolicy` | ✅ |
| **H5.4** | control-plane `acl` + electron-shell pass-through | ✅ |
| **H5.5** | demobrand sandbox install/uninstall + test E2E | ✅ |
| **H5.6** | PHASE-H5, bump H5, push | ✅ |

---

## Hors scope H5 (post-plan / consommation marques)

- Migration progressive TempoFlow `plugin-acl` L4 → L3 org + caps kit
- Extraction Fidu / Certivan vers kit
- UI Admin Plugins multi-org
- Auto-promotion plugins
- Republish exe marques (sauf si régression forcée — non requis H5 kit)
