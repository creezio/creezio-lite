# Phase M3p — Product Hub : Certivan puis Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `certivan-app` `6b45c2d` → `fidu` `91d7e34` / `0.1.59` (+ kit `03d994b`) |
| **Prérequis** | [PHASE-M3.md](PHASE-M3.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Fidu ship pipeline si desktop |

---

## Objectif

Mêmes critères M3 sur **Certivan** puis **Fidu** : façades ≤40 LOC,
`startHostPluginControlPlane`, SoT `core.db`, adapters verticaux minces.

---

## Certivan

| Travaux | Statut |
|---------|--------|
| `plugin-control-api` barrel + `plugin-control-extras` | ✅ |
| `plugin-hub-store` → `createBrandProductHubBindings` | ✅ |
| `product-hub-adapter` + `createProductHubHost` | ✅ |
| Routes / n8n provisioning → hub DB (core) | ✅ |
| Vendor sync liste complète | ✅ |
| Gates acl-l3 / control-api / runtime / product-hub | ✅ |

## Fidu

| Travaux | Statut |
|---------|--------|
| `plugin-control-api` barrel ≤40 + `plugin-control-boot` | ✅ |
| `plugin-hub-store` → bindings kit | ✅ |
| Pas de façade Next Product Hub (absent) | ✅ |
| Vendor sync liste complète | ✅ |
| Gates `test:plugin-acl-l3` + `test:plugin-control-api-d4` | ✅ |

---

## Gates

```bash
cd /opt/docker/certivan-app/crm && bash scripts/electron/sync-creezio-vendor.sh \
  && npm run electron:compile && npm run test:plugin-acl-l3 \
  && npm run test:plugin-control-api && npm run test:plugin-runtime \
  && npm run test:product-hub
cd /opt/docker/fidu/crm && bash scripts/electron/sync-creezio-vendor.sh \
  && npm run electron:compile && npm run test:plugin-acl-l3 \
  && npm run test:plugin-control-api-d4
cd /opt/docker/creezio && npm test
```

---

## Critères done vision

| Critère | Certivan | Fidu |
|---------|----------|------|
| Façades ≤40 LOC | ✅ | ✅ |
| `startHostPluginControlPlane` | ✅ | ✅ |
| SoT core.db Product Hub | ✅ | ✅ (store electron) |
| Vendor liste complète | ✅ | ✅ |

---

## Suite

**M4** — Delete `local-config` TF (si session le permet).

---

## Verdict

**Phase M3p : TERMINÉE.** Product Hub / control-plane SoT kit sur les trois marques.
