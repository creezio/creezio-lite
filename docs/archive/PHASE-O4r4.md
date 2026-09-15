# Phase O4r4 — Projections assistant déclaratives

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-O4r3.md](PHASE-O4r3.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish** | Non |

---

## Objectif

Sortir `entitySources` / `formatSearchHit` du switch TS ×3 vers un **moteur kit**
+ **règles déclaratives marque** extraites (pas inventées).

---

## Wiring

| Couche | SoT |
|--------|-----|
| Kit | `createEntitySourcesFromRules` / `createFormatSearchHit` (`@creezio/assistant`) |
| Marque | `entity-sources.ts` = tableau de règles + `argsPreview` (reste TS mince) |

`argsPreview` reste marque : préviews tools métier hétérogènes — **dette non bloquante**.

---

## Gates

```bash
cd /opt/docker/creezio && npm run build -w @creezio/assistant && npm test  # test-phase-o4r4
# ×3
bash scripts/electron/sync-creezio-vendor.sh   # liste complète marque
npm run test:assistant-routing
npm run test:active-surface
```

---

## SHAs

| | SHA |
|--|--|
| Kit | `f9d49ac` (+ tip docs pin) |
| TempoFlow | `1c98930` |
| Certivan | `51e9ce5` |
| Fidu | `786dc41` |
