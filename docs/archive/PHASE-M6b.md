# Phase M6b — Delete stubs chrome logger/splash/tray/updater/meili/admin TF

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (docs) + `tempoflow2` |
| **Prérequis** | [PHASE-M6a.md](PHASE-M6a.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Stubs chrome R3 (`logger`, `splash-ui`, `tray`, `updater`, `meili-launcher`,
`admin-window`) → imports directs `@creezio/electron-shell` + hooks marque
inline (`main.ts` / `hostMeili` adapter). Fichiers TF **absents**.

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/logger.ts` | **35** stub | **absent** |
| `electron/splash-ui.ts` | **77** stub | **absent** |
| `electron/tray.ts` | **49** stub | **absent** |
| `electron/updater.ts` | **102** stub | **absent** |
| `electron/meili-launcher.ts` | **39** stub | **absent** |
| `electron/admin-window.ts` | **97** | **absent** (kit `openAdminWindow` / `closeAdminWindow`) |
| `electron/main.ts` | imports stubs | kit + labels TF splash / feed updater / tray |
| `electron/host-stack.ts` | `require("./meili-launcher")` | adapter `startMeili` kit + paths/sandbox |
| Call-sites logger | `./logger` | `@creezio/electron-shell` |

---

## Critères done vision (M6b)

| Critère | Preuve |
|---------|--------|
| 6 fichiers chrome/admin absents | ✅ |
| `rg "stub R3\|stub R3.3" electron/` → 0 | ✅ |
| admin = kit pur (0 LOC TF) | ✅ |
| hostMeili = kit + host paths | ✅ |

---

## Gates

```bash
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:splash-ui \
  && npm run test:updater \
  && npm run test:ops-journal \
  && npm run test:electron-main-graph \
  && npm run test:hermes-embed \
  && npm run test:n8n-embed \
  && npm run test:app-kind
```

| Gate | Résultat |
|------|----------|
| TF `electron:compile` | ✅ |
| splash / updater / ops-journal / main-graph | ✅ |
| hermes / n8n embed / app-kind | ✅ |

---

## Push

| Repo | SHA |
|------|-----|
| TF `tempoflow2` | `f4364c9` |

---

## Suite

**M6** complet → [PHASE-M6.md](PHASE-M6.md) ; puis **M6p** Certivan/Fidu.
