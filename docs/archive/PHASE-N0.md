# Phase N0 — Purge artefacts (Paperclip build + Fidu git clean)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ preuves locales Fidu build) |
| **Prérequis** | [PHASE-M16.md](PHASE-M16.md) · plan [PLAN-N.md](PLAN-N.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

Zéro artefact plateforme mort sur disque / working tree ; **Paperclip = mort**
partout (déjà absent du src ; build Fidu sale avant N0).

---

## Travaux

| Action | Preuve |
|--------|--------|
| `rm -f fidu/crm/build/electron/paperclip-*` | absents après purge |
| `crm/.gitignore` contient `/build` | ligne 23 Fidu |
| `npm run electron:compile` Fidu | **ne régénère pas** paperclip |
| WT Fidu | clean (dist-electron-server dirty restauré) |
| Assert TF/CV/Fidu | 0 `paperclip-*.ts` sous `electron/` ; 0 `paperclipApi` / `startPaperclip` runtime |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-n0
test ! -e /opt/docker/fidu/crm/build/electron/paperclip-launcher.js
test ! -e /opt/docker/tempoflow2/crm/electron/paperclip-launcher.ts
test ! -e /opt/docker/certivan-app/crm/electron/paperclip-launcher.ts
# 0 hits runtime :
rg -l 'paperclipApi|startPaperclip|paperclip-launcher' \
  /opt/docker/fidu/crm/electron /opt/docker/tempoflow2/crm/electron \
  /opt/docker/certivan-app/crm/electron || true
```

---

## Done

| Critère | Preuve |
|---------|--------|
| `paperclip-*.js(|.map)` absents sous `fidu/crm/build/` | ✅ |
| `rg paperclipApi\|startPaperclip` → 0 dans `electron/` ×3 | ✅ |
| WT Fidu sans artefact paperclip non ignoré | ✅ |
| Gate `test-phase-n0` | ✅ |
| Fidu push | **non** (aucun fichier tracké touché — purge build ignoré) |

---

## Suite

**N1** — Runtime plugins Electron → kit (`plugin-runtime|launcher|git|control-extras`).
