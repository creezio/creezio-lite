# Phase M6p — Hosts Certivan puis Fidu (vision stricte)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `certivan-app` + `fidu` |
| **Prérequis** | [PHASE-M6.md](PHASE-M6.md) (TF gold) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Même cutover que M4+M5+M6 TF sur **Certivan puis Fidu** (séquentiel) :
jumeaux pleins / bootstraps / launchers / chrome → SoT
`@creezio/electron-shell` + wiring `local-config-store` + `host-runtime-ctx`.
Fichiers listés **absents** ; `rg "stub R3|stub R3.3" electron/` → **0**.

---

## Travaux kit

| Livrable | Détail |
|----------|--------|
| `host/n8n/launcher.ts` | Dual-read `.${prefix}-encryption-key` / `.${prefix}-owner.json` |
| `host/hermes/launcher.ts` | `ensureApiKey` brand-aware ; clear `.certivan-` / `.fidu-webui-password` |
| `host/hermes/runtime-bootstrap.ts` | `WEBUI_DEPS_MARKER_LEGACY_CERTIVAN` + `_FIDU` (+ pins) |
| Exports | `WEBUI_DEPS_MARKER_LEGACY_CERTIVAN`, `WEBUI_DEPS_MARKER_LEGACY_FIDU` |
| Tests | `scripts/test-phase-m6p.mjs` |

---

## M6p-Certivan

| Fichier | Après |
|---------|-------|
| 14 jumeaux (local-config, bootstraps, launchers, chrome…) | **absents** |
| `local-config-store.ts` / `host-runtime-ctx.ts` | `cv*` ≤40 / ≤200 |
| `host-stack.ts` | kit + adapters |
| Gates compile + hermes/n8n/node/splash/main-graph/shell subset | ✅ |
| SHA | `a0a072f` |

---

## M6p-Fidu

| Fichier | Après |
|---------|-------|
| 10 jumeaux (local-config, bootstraps hermes/n8n, launchers hermes/n8n/meili, logger, updater, npm-cli, tunnel) | **absents** |
| `paperclip-*` | **retirés** (plus dans aucune marque) |
| `paperclip-config.ts` | **supprimé** |
| `local-config-store.ts` / `host-runtime-ctx.ts` | `fidu*` |
| Pas de `host-stack` (clientSlim false) — imports directs factories | ✅ |
| Gates compile + hermes/n8n + first-run/recovery/updater/byok/app-kind | ✅ |
| Republish | Non (packing inchangé) |

---

## Critères done vision

| Critère | Certivan | Fidu |
|---------|----------|------|
| Jumeaux plateforme listés absents | ✅ | ✅ |
| `rg "stub R3\|stub R3.3" electron/` → 0 | ✅ | ✅ |
| host-runtime-ctx + local-config-store | ✅ | ✅ |
| Vendor liste complète | ✅ | ✅ |
| Paperclip hors produit (retiré) | n/a | ✅ |

---

## Push

| Repo | SHA |
|------|-----|
| kit dual-read Certivan | `83fd161` |
| kit + markers Fidu + docs sign-off | `d90bf03` |
| Certivan `certivan-app` | `a0a072f` |
| Fidu `fidu` | `16a398a` |

---

## Verdict

**Phase M6p : TERMINÉE.** Certivan + Fidu hosts = SoT kit.
Suite : **M7** (fleet/obs TF).
