# Phase O1 — Anti-façades Electron mince (supplier + plugin-control-api)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + TempoFlow + Certivan + Fidu |
| **Prérequis** | [PHASE-O0.md](PHASE-O0.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O0 kit tip** | `ab068b7` |
| **Kit tip O1** | `ff1ca87` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (wiring ; packing différé) |

### SHAs marques (gold O1)

| Marque | SHA |
|--------|-----|
| TempoFlow | `f634176` |
| Certivan | `524d2b2` |
| Fidu | `c5379f6` |

---

## Objectif

**0 façade** Electron mince : plus de re-export `plugin-control-api` ni
`supplier-tabs|driver|preload-supplier` (CV/Fidu). Imports directs
`@creezio/electron-shell` / `@creezio/electron-shell/browser-tabs`.

**Façades ≤40 LOC = NON done** (O* refuse l’indulgence N7/N8).  
TF conserve `supplier-tabs` / `supplier-driver` / `preload-supplier` **métier**.  
**Paperclip = mort.**

---

## Travaux

| Zone | Action |
|------|--------|
| Kit `browser-tabs` | `browser-tab-preload` + `browserTabPreloadPath` ; `configureBrowserTabs` défaut kit ; `typesVersions` subpath |
| TF | **delete** `plugin-control-api.ts` ; supplier métier intact |
| CV / Fidu | **delete** `plugin-control-api` + `supplier-*` + `preload-supplier` ; imports kit |
| Fidu | `plugin-control-boot.ts` conservé (wiring ACL, ≠ façade) |
| Gates N7/N8 | amendés : façades supplier **absentes** (plus ≤40) |
| Tests marques | assert absence façade ; require kit / boot |
| Vendor | sync liste complète ×3 (`kitSha`) |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-o1
# par marque :
bash crm/scripts/electron/sync-creezio-vendor.sh
npm run electron:compile
# TF/CV :
npm run test:plugin-control-api
# asserts :
test ! -f crm/electron/plugin-control-api.ts   # ×3
test ! -f crm/electron/supplier-tabs.ts        # CV+Fidu
wc -l crm/electron/supplier-tabs.ts            # TF ≥400
```

---

## Done

| Critère | Preuve |
|---------|--------|
| `plugin-control-api` absent ×3 | ✅ |
| CV/Fidu supplier façades absentes | ✅ |
| TF supplier ≥400 LOC | ✅ |
| Imports `@creezio/electron-shell/browser-tabs` | ✅ |
| `test-phase-o1` + `npm test` | ✅ |
| Sync vendor liste complète ×3 | ✅ |

---

## Suite

**O2** — Anti-façades lib (`mcp-admin`, `chat-db`, wraps migrations Fidu).
