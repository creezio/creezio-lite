# Phase O3 — Jumeaux Electron plateforme → kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (extract only) |
| **Prérequis** | [PHASE-O2.md](PHASE-O2.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O2 kit tip** | `e1335d8` / docs `33bc9d2` |
| **Kit tip O3** | `0b7daec` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (cutover = O3p) |

---

## Objectif

SoT unique des near-copies Electron plateforme (gold TF paramétré) dans
`@creezio/electron-shell` / `@creezio/platform-core`. **Pas de cutover marques**
(les jumeaux locaux restent jusqu’à O3p).

**Façades / stubs = NON done.** Paperclip = mort.

---

## Travaux

| Zone | Action |
|------|--------|
| `platform-core` | `installer-prefs`, `licensing` (opts) ; paths/connection/recovery/factory-reset déjà SoT |
| `electron-shell` `host/n8n/` | `api-key`, `agent-isolation` |
| `electron-shell` `desktop/` | `assistant-chrome`, `oauth-loopback`, `profile-picker-html`, `error-page-html` |
| `electron-shell` `host/hermes/` | `crm-key`, `ensure-crm-key-db` (CLI, createRequire) |
| `browser-tabs` | export `installUserAgent`, `FAKE_CURSOR_INJECT` |
| Gates | `test-phase-o3` ; jumeaux marques **encore présents** (anti-cutover prématuré) |

---

## Gates

```bash
cd /opt/docker/creezio && npm run build:packages && npm test   # incl. test-phase-o3
# Post-O3p : jumeaux absents (voir PHASE-O3p / test-phase-o3p)
test ! -f /opt/docker/tempoflow2/crm/electron/n8n-api-key.ts
test ! -f /opt/docker/certivan-app/crm/electron/n8n-api-key.ts
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Modules O3 présents + exportés | ✅ |
| `build:packages` + `npm test` | ✅ |
| Cutover différé à O3p (extract-only) | ✅ (O3) → O3p done |
| Paramétrage marque (opts/brand) | ✅ |

---

## Suite

**O3p** — ✅ Cutover livré ([PHASE-O3p.md](PHASE-O3p.md)).
