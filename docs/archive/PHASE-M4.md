# Phase M4 — Delete `local-config` TF (jumeau mort)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M3p.md](PHASE-M3p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Jumeau `electron/local-config.ts` (~814 LOC) → SoT
`@creezio/electron-shell` (`createLocalConfigStore` /
`createLocalConfigStoreSync`) uniquement.
Wiring TF ≤40 LOC ; `test ! -f electron/local-config.ts`.

---

## Travaux kit

| Livrable | Détail |
|----------|--------|
| `platform-core/fleet-telemetry.ts` | Types + sanitize/patch (extrait TF) |
| `LocalConfigFileV1.fleetTelemetry` | Champ schéma |
| `electron-shell` store | `get/setFleetTelemetry` |
| `configPath` dynamique | `string \| (() => string)` (profil join) |
| `createLocalConfigStoreSync` | `encryption: "electron"` + `loadElectronSafeStorageSync` |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/local-config.ts` | **814** | **absent** |
| `electron/local-config-store.ts` | — | **≤40** wiring kit |
| Call sites (`main`, launchers…) | `from "./local-config"` | `tfLocalConfigStore()` |
| `fleet-telemetry.ts` | logique pure locale | réexport `@creezio/platform-core` + labels UI |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| `test ! -f electron/local-config.ts` | ✅ |
| Imports SoT `@creezio/electron-shell` | ✅ `createLocalConfigStoreSync` |
| Wiring ≤40 LOC | ✅ `local-config-store.ts` |
| Deltas TF portés (fleet + path dynamique) | ✅ |
| Vendor liste complète | ✅ |

**Exclu M4** : Certivan/Fidu local-config (→ plus tard) ; stubs launchers (→ **M5/M6**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test && npm run build:packages
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:first-run-auth \
  && npm run test:connection-profile \
  && npm run test:profile-argv \
  && npm run test:recovery-key \
  && npm run test:byok-strict
```

| Gate | Résultat |
|------|----------|
| kit `npm test` (+ M4) | ✅ |
| TF vendor sync complète | ✅ |
| TF `electron:compile` | ✅ |
| TF first-run-auth / connection / profile / recovery / byok | ✅ |

---

## Suite

**M5** — Delete bootstraps hermes/n8n → [PHASE-M5.md](PHASE-M5.md).

---

## Verdict

**Phase M4 : TERMINÉE.** Jumeau `local-config` TF mort ; SoT kit.
