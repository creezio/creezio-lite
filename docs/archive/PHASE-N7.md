# Phase N7 — `supplier-tabs` hors métier Certivan / Fidu

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repos** | `creezio/creezio` + Certivan + Fidu (+ TF inchangé) |
| **Prérequis** | [PHASE-N6p.md](PHASE-N6p.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N6p kit tip** | `4338fa8` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Oui Fidu (desktop) · vendor sync CV |

---

## Objectif

Jumeaux `supplier-tabs` / `supplier-driver` **absents** (ou façades ≤40 LOC)
sur Certivan + Fidu. SoT générique dans `@creezio/electron-shell`
`host/browser-tabs`. **Métier supplier reste TempoFlow**
(`electron/supplier-tabs.ts` gold local).

**Paperclip = mort.**

---

## Travaux

| Zone | Rôle |
|------|------|
| Kit `host/browser-tabs/*` | Manager + driver + tab-url/load-state + chrome-ua (gold TF) |
| `configureBrowserTabs({ resolvePreloadPath })` | Injection preload marque |
| CV / Fidu | Façades `supplier-tabs.ts` / `supplier-driver.ts` → kit |
| TF | **Inchangé** — supplier-tabs métier local (~797 LOC) |

### Absents / minces (CV + Fidu)

- Implémentation locale manager/driver **remplacée** par réexport kit
- Helpers locaux `tab-load-state` / `tab-url` **deleted** (SoT kit)

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-n7

# TF — métier intact
test -f /opt/docker/tempoflow2/crm/electron/supplier-tabs.ts
wc -l /opt/docker/tempoflow2/crm/electron/supplier-tabs.ts   # >> 100

# CV
cd /opt/docker/certivan-app/crm
wc -l electron/supplier-tabs.ts   # ≤40
npm run electron:compile && npm run build
npm run test:plugin-acl-l3 && npm run test:plugin-sidebar

# Fidu
cd /opt/docker/fidu/crm
wc -l electron/supplier-tabs.ts   # ≤40
npm run build && npm run electron:compile && npm run test:fidu
```

---

## Done

| Critère | Preuve |
|---------|--------|
| Kit browser-tabs | ✅ |
| CV+Fidu façades | ✅ |
| TF supplier-tabs local | ✅ |
| Gates | ✅ |
| SHAs | ci-dessous |
| Republish Fidu | [Fidu-Setup-0.1.63.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.63.exe) |

---

## SHAs

| Repo | SHA | Notes |
|------|-----|-------|
| Kit | `d86a708` | browser-tabs + docs |
| Certivan | `336739d` | façades N7 |
| Fidu | `8ec21d2` | façades + release **0.1.63** |
| TempoFlow | `c85bb0f` | inchangé N7 |

---

## Suite

**N8** — Gates LOC + allowlists vision.
