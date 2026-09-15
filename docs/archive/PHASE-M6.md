# Phase M6 — Delete stubs launchers/chrome TF (complet)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M5.md](PHASE-M5.md) |
| **Découpe** | [M6a](PHASE-M6a.md) launchers → [M6b](PHASE-M6b.md) chrome |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (packing inchangé) |

---

## Objectif

Tous les stubs R3.3 launchers + chrome TF → imports directs
`@creezio/electron-shell` (+ `host-runtime-ctx` / adapters host-stack).
Fichiers listés **absents** ; `rg "stub R3|stub R3.3" electron/` → **0**.

---

## Fichiers absents (vision)

| Fichier | Phase |
|---------|-------|
| `hermes-launcher.ts` | M6a |
| `n8n-launcher.ts` | M6a |
| `tunnel.ts` | M6a |
| `node-runtime.ts` | M6a |
| `npm-cli.ts` | M6a |
| `updater.ts` | M6b |
| `splash-ui.ts` | M6b |
| `tray.ts` | M6b |
| `logger.ts` | M6b |
| `meili-launcher.ts` | M6b |
| `admin-window.ts` | M6b (kit pur) |

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| 11 fichiers listés absents | ✅ |
| `rg "stub R3\|stub R3.3" electron/` → 0 | ✅ |
| host-stack = kit + host-runtime-ctx (+ adapter meili) | ✅ |
| Gates M6a + M6b | ✅ |
| Vendor liste complète | ✅ (inchangé M6 — pas de delta kit code) |

**Exclu M6** : Certivan/Fidu stubs (→ **M6p**).

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `87bc6e8` |
| TF `tempoflow2` M6a | `f6fcb48` |
| TF `tempoflow2` M6b | `f4364c9` |

---

## Verdict

**Phase M6 : TERMINÉE.** Stubs launchers + chrome TF morts ; SoT kit.
Suite : **M6p** (Certivan puis Fidu).
