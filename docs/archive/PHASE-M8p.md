# Phase M8p — Stores auth/assistant/tasks/mails Certivan puis Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `certivan-app` + `fidu` |
| **Prérequis** | [PHASE-M8.md](PHASE-M8.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non |

---

## Objectif

Mêmes critères que M8 sur Certivan, puis Fidu : SoT `@creezio/auth|assistant|tasks|mails` ;
`platform-stores` absent ou ≤80 LOC (Product Hub M3p seulement).

---

## Travaux Certivan

| Fichier | Après |
|---------|-------|
| adapters auth/assistant/tasks-mails/paths/contract | **absents** |
| `platform-stores/**` | **≤80** (product-hub + index) |
| call-sites | `@creezio/*` directs |
| vendor | liste complète |

## Travaux Fidu

| Critère | Note |
|---------|------|
| `src/lib/platform-stores` | **absent** (déjà) |
| `brand-runtime` | imports kit directs |
| vendor | liste complète |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m8p
cd /opt/docker/certivan-app/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile \
  && npm run test:phase-c2-stores \
  && npm run test:phase-i13 \
  && npm run test:tasks \
  && npm run test:mcp-tasks \
  && npm run test:email-inbox \
  && npm run test:assistant-routing \
  && npm run test:assistant-chat-scope \
  && npm run electron:compile
cd /opt/docker/fidu/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile && npm run test:phase-i13
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `50043f5` |
| Certivan `certivan-app` | `036f180` |
| Fidu `fidu` | `25e4e75` |
| TF (prérequis M8) | `d7b60b4` |

---

## Suite

**M9** — MCP/API anti-jumeau.
