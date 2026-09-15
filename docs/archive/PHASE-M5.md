# Phase M5 — Delete bootstraps hermes/n8n TF (jumeaux morts)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M4.md](PHASE-M4.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Jumeaux `electron/hermes-runtime-bootstrap.ts` (~768 LOC) et
`electron/n8n-runtime-bootstrap.ts` (~256 LOC) → SoT
`@creezio/electron-shell` (`host/hermes/runtime-bootstrap`,
`host/n8n/runtime-bootstrap`) uniquement.
Hooks marque (`host-runtime-ctx.ts`) ≤200 LOC ; bootstraps TF **absents**.

---

## Travaux kit

| Livrable | Détail |
|----------|--------|
| `host/hermes/runtime-bootstrap.ts` | Deltas TF : `installHermesAgent`, scripts vendorisés + checksum, stages Windows, os-profile sandbox, WebUI tar.gz + pin, `WEBUI_DEPS_MARKER` / `webuiPythonDepsReady` / skip pip |
| `host/n8n/runtime-bootstrap.ts` | Deltas TF : `force`, `failDiskSpace`, package.json isolé, timeout npm 30 min, messages FR |
| `host/npm-cli.ts` | `timeoutMs` optionnel (kill) |
| Exports `electron-shell` | helpers marker / install / package path |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/hermes-runtime-bootstrap.ts` | **768** | **absent** |
| `electron/n8n-runtime-bootstrap.ts` | **256** | **absent** |
| `electron/host-runtime-ctx.ts` | hooks | **≤200** (inchangé rôle) |
| Tests hermes/n8n-embed | jumeau local | SoT vendor kit |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| `test ! -f electron/hermes-runtime-bootstrap.ts` | ✅ |
| `test ! -f electron/n8n-runtime-bootstrap.ts` | ✅ |
| Deltas TF portés (`installHermesAgent`, webui deps…) | ✅ kit |
| Hooks `host-runtime-ctx` ≤200 LOC | ✅ |
| Vendor liste complète | ✅ |
| Stubs launchers = **non-done** (→ M6) | — |

**Exclu M5** : delete stubs launchers/chrome/tunnel/… (→ **M6**) ; Certivan/Fidu bootstraps (→ **M6p**).

---

## Gates

```bash
cd /opt/docker/creezio && npm test && npm run build:packages
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:hermes-embed \
  && npm run test:n8n-embed \
  && npm run test:hermes-context-seed \
  && npm run test:n8n-api-key \
  && npm run test:embed-env \
  && npm run test:electron-main-graph
```

| Gate | Résultat |
|------|----------|
| kit `npm test` (+ M5) | ✅ 224 pass |
| TF vendor sync complète | ✅ liste complète |
| TF `electron:compile` | ✅ |
| TF hermes/n8n-embed + context-seed + api-key + embed-env + main-graph | ✅ |

---

## Suite

**M6a** — Delete stubs launchers (hermes/n8n/tunnel/node/npm) ; puis **M6b** chrome.
→ [PHASE-M6a.md](PHASE-M6a.md)

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `40a694e` |
| TF `tempoflow2` | `015f796` |

---

## Verdict

**Phase M5 : TERMINÉE.** Jumeaux bootstraps hermes/n8n TF morts ; SoT kit.
