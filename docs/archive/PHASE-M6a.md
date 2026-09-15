# Phase M6a — Delete stubs launchers hermes/n8n/tunnel/node/npm TF

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (docs) + `tempoflow2` |
| **Prérequis** | [PHASE-M5.md](PHASE-M5.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Stubs R3.3 launchers / runtime (`hermes-launcher`, `n8n-launcher`,
`tunnel`, `node-runtime`, `npm-cli`) → imports directs
`@creezio/electron-shell` + factories `host-runtime-ctx`
(`tfHermesHost` / `tfN8nHost` / `tfTunnelService` /
`tfEnsureTempoflowNode`). Stubs TF **absents**.

Découpe M6 : **M6a** = launchers ; **M6b** = chrome
(splash/tray/updater/logger/meili/admin-window).

---

## Travaux kit

| Livrable | Détail |
|----------|--------|
| Aucun delta code | SoT launchers / node / npm déjà dans `electron-shell` (M5) |
| `docs/PHASE-M6a.md` | Sign-off |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/hermes-launcher.ts` | **94** stub | **absent** |
| `electron/n8n-launcher.ts` | **113** stub | **absent** |
| `electron/tunnel.ts` | **71** stub | **absent** |
| `electron/node-runtime.ts` | **92** stub | **absent** |
| `electron/npm-cli.ts` | **129** stub | **absent** |
| `electron/host-stack.ts` | require stubs | `tfHermesHost` / `tfN8nHost` / `tfTunnelService` / `tfEnsureTempoflowNode` |
| `electron/host-runtime-ctx.ts` | factories | + `tfEnsureTempoflowNode` + réexports Node pins (≤200 LOC) |
| Call-sites | `./node-runtime`, `./n8n-launcher`… | kit + `host-runtime-ctx` |
| `host-only-electron-modules.json` | stubs listés | stubs retirés ; `host-runtime-ctx` conservé |

---

## Critères done vision (M6a)

| Critère | Preuve |
|---------|--------|
| `test ! -f electron/hermes-launcher.ts` | ✅ |
| `test ! -f electron/n8n-launcher.ts` | ✅ |
| `test ! -f electron/tunnel.ts` | ✅ |
| `test ! -f electron/node-runtime.ts` | ✅ |
| `test ! -f electron/npm-cli.ts` | ✅ |
| `rg "stub R3\|stub R3.3" electron/` → 0 | ✅ |
| host-stack = kit + host-runtime-ctx (pas de require stubs) | ✅ |
| Stubs chrome = **non-done** (→ M6b) | — |

**Exclu M6a** : delete `updater` / `splash-ui` / `tray` / `logger` /
`meili-launcher` / shrink `admin-window` (→ **M6b**) ;
Certivan/Fidu (→ **M6p** après M6 complet).

---

## Gates

```bash
cd /opt/docker/creezio && npm test
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:node-runtime \
  && npm run test:hermes-embed \
  && npm run test:n8n-embed \
  && npm run test:electron-main-graph \
  && npm run test:embed-sandbox \
  && npm run test:agent-isolation \
  && npm run test:app-kind \
  && npm run test:ops-journal \
  && npm run test:updater \
  && npm run test:splash-ui
```

| Gate | Résultat |
|------|----------|
| kit `npm test` | ✅ 224 pass |
| TF `electron:compile` | ✅ |
| TF node-runtime / hermes / n8n embed | ✅ |
| TF electron-main-graph / embed-sandbox / agent-isolation | ✅ |
| TF app-kind / ops-journal / updater / splash-ui | ✅ |

---

## Suite

**M6b** — Delete stubs chrome → [PHASE-M6b.md](PHASE-M6b.md) ;
**M6** complet → [PHASE-M6.md](PHASE-M6.md).

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `664d15b` |
| TF `tempoflow2` | `f6fcb48` |

---

## Verdict

**Phase M6a : TERMINÉE.** Stubs launchers hermes/n8n/tunnel/node/npm TF
morts ; SoT kit + `host-runtime-ctx`.
