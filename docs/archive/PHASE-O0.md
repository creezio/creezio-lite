# Phase O0 — Hygiene SYNC dirty + polish

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ purge locale Fidu `build/`) |
| **Prérequis** | [PHASE-N9.md](PHASE-N9.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline N9 kit tip** | `3826e30` (docs) / `49f1bd1` (freeze N9) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non |

---

## Objectif

Baseline O* propre : inventaire dettes post-N9 figé ; SYNC/docs prêts à pin
`kitSha` ; **0** résidu `host-na-stubs` / Paperclip sur disque ; dry-run sync
vendor ×3 verts (liste complète H6).

**Façades / stubs / jumeaux = NON done** (O* refuse l’indulgence N8 ≤40 LOC).  
**Paperclip = mort.**

---

## Inventaire dettes O* (2026-07-30, HEAD marques)

Chemins relatifs aux `crm/` marques. Mesures relues sur disque (pas inventées).

| Dette | Preuve | Étape |
|-------|--------|-------|
| Façades Electron `plugin-control-api` | présent TF+CV+Fidu | **O1** |
| Façades `supplier-tabs\|driver\|preload-supplier` | CV+Fidu (TF = métier gras) | **O1** |
| Façades lib `mcp-admin` / `chat-db` | TF+CV (+ chat-db Fidu) | **O2** |
| Wraps migr. Fidu `platformHistoricalMigrations` | steps wrap | **O2** |
| Jumeaux Electron plateforme TF↔CV | ~34 fichiers / ~5,4 kLOC | **O3/O3p** |
| `assistant-chat.ts` | TF 1957 · CV 1954 · Fidu 1953 LOC | **O4/O4p** |
| Admin request-logs / api-endpoints | clients locaux ×3 | **O5/O5p** |
| CV fork catering 006–021 | legacy + queries | **O6** |
| Host gras | stack 204–241 · ctx 116–246 · preload **259** | **O7** |
| Indulgence façades ≤40 LOC (N8) | gate N8 | **O8** |
| Jumeaux lib/UI restants | post O3/O5 | **O9/O9p** |
| Matrice / SYNC pin tip | hygiene | **O10/O11** |
| Artefact `build/electron/host-na-stubs.js` Fidu | **purgé O0** | ✅ |

### SHAs marques (baseline O0)

| Marque | SHA | Note |
|--------|-----|------|
| TempoFlow | `c85bb0f` | N6p admin |
| Certivan | `51c7c22` | N6p + N7 |
| Fidu | `5e5367d` | N7 + **0.1.63** |

### Liste vendor complète (H6)

`brand-config shell platform-core product-hub electron-shell desktop-tooling
api-kernel mcp-facade shell-ui auth assistant tasks mails observability
automations database` — **16** packages.

---

## Travaux

| Action | Preuve |
|--------|--------|
| [PLAN-O.md](PLAN-O.md) O0→O11 | ✅ |
| Inventaire (ce fichier) | ✅ |
| `scripts/sync-creezio-vendor.sh` écrit `kitSha` | ✅ |
| `rm -f fidu/crm/build/electron/host-na-stubs.js(|.map)` | ✅ absents |
| Assert `host-na-stubs.ts` src absent ×3 | ✅ (déjà N5) |
| Dry-run sync TF/CV/Fidu | ✅ `OK dry-run` |
| `scripts/test-phase-o0.mjs` + `npm test` | ✅ |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-o0
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/tempoflow2/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/certivan-app/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/fidu/crm/scripts/electron/sync-creezio-vendor.sh
test ! -f /opt/docker/fidu/crm/electron/host-na-stubs.ts
test ! -f /opt/docker/fidu/crm/build/electron/host-na-stubs.js
```

---

## Done

| Critère | Preuve |
|---------|--------|
| PLAN-O + inventaire SHA gold | ✅ |
| Dry-run ×3 OK (liste complète) | ✅ |
| **0** `host-na-stubs` src/build | ✅ |
| Paperclip absent src/build ×3 | ✅ (N0 + re-assert O0) |
| Gate `test-phase-o0` | ✅ |
| Marques push | **non** (purge `build/` ignoré ; aucun tracké touché) |

---

## Suite

**O1** — Anti-façades Electron mince (`supplier-*` CV/Fidu + `plugin-control-api` ×3).
