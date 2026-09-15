# Phase O11 — Freeze plan O* (vision honnête)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | Kit + TempoFlow + Certivan + Fidu |
| **Prérequis** | [PHASE-O10.md](PHASE-O10.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Kit tip O10** | `fca58d1` |
| **Kit tip O11** | `8879de4` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Oui — TF **0.10.33** · CV **0.1.16** · Fidu **0.1.65** |

---

## Objectif

Geler le **plan O0→O11** (gates + docs + SHAs + feeds) sans mentir sur la
vision intention. **Façades ciblées O1–O8 = mort** (gates). **Paperclip =
mort.** Domaine métier TF **interdit** dans le kit natif (ADR) — dette
vocabulaire legacy encore mesurable (voir checklist).

> **Pas de « 100 % cosmétique ».** Le plan O* est **fermé** ; la vision
> stricte intention (~jumeaux zéro, MCP une seule SoT, zéro vocabulaire TF
> kit) reste **partielle** — voir § Vision honnête.

---

## Vision honnête (freeze)

| Règle O* | Statut | Preuve |
|----------|--------|--------|
| Paperclip = mort | ✅ | 0 API Paperclip runtime packages (gate O11.6) |
| Façades mince O1–O2 / O8 (re-export ≤40 LOC interdits) | ✅ | `test-phase-o8` |
| Host wirings mince O7 | ✅ | stack ≤80 · ctx ≤100 · preload ≤120 ×3 |
| `assistant-chat` SoT kit | ✅ | 0 copie locale ×3 |
| MCP factory `create*BrandMcp` + bind Hono | 🟡 | câblé ×3 ; handlers hors factory restants (GED Fidu, monolithe CV, host-tools TF) |
| Pas de domaine TF dans kit natif | 🟡 | ADR + allowlists ; dette `fournisseurId` / panier / supplier_* encore dans packages |
| Jumeaux plateforme = NON done | 🟡 | gros lots O3/O9 absorbés ; **~24 kLOC** TF↔CV near-copies encore hors inventaire O* |
| Plan O0→O11 gates | ✅ | `test-phase-o0` … `o11` + dry-run ×3 |

### % vision brutalement honnête : **~76 %**

Acquis structurels réels (assistant SoT, anti-façades ciblées, host mince,
factory MCP, Paperclip mort, O9p shell-ui/tasks). Dettes lourdes ouvertes :
jumeaux résiduels, MCP Hono pas une seule SoT, vocabulaire TF kit,
`argsPreview` marque, GED Fidu hors `createFiduModuleMcpTools`.

*(Jalons plan O0→O11 « done » ≈ 100 % du chemin critique documenté ;
vision intention stricte ≈ 76 %.)*

### Dettes restantes (hors done O11)

1. Jumeaux lib/UI/electron TF↔CV résiduels (~24 kLOC hors périmètre O9)
2. Dup `modules/` ↔ `electron/modules/` (quasi-copies marque)
3. GED Fidu : tools Hono encore hors `createFiduModuleMcpTools`
4. MCP Hono legacy (CV monolithe / TF `hono-host-tools` / Fidu inline)
5. Vocabulaire TF (`fournisseurId`, panier, `supplier_*`) dans packages natifs
6. `argsPreview` TS marque ×3 (non bloquant O4r4)
7. `creezio-boot.ts` jumeaux ×3 (~90 LOC)

---

## Freeze artefacts

| Artefact | Preuve |
|----------|--------|
| Matrice | [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) — O0→O11 |
| PLAN-O | [PLAN-O.md](PLAN-O.md) — O0→O11 ✅ |
| Gates kit | `test-phase-o0` … `test-phase-o11` dans `npm test` |
| Dry-run sync | TF + Certivan + Fidu → `OK dry-run` (H6, liste complète, `kitSha`) |
| ARCHITECTURE_VERSION | `"H6"` |

### SHAs gold O11

| Repo | SHA | Note |
|------|-----|------|
| Kit `creezio/creezio` | `8879de4` | gate o11 · SYNC pin marques |
| TempoFlow | `30d8627` | ship **0.10.33** + pin tip |
| Certivan | `e0c9e43` | ship **0.1.16** + pin tip |
| Fidu | `15f415f` | ship **0.1.65** + pin tip |

### Feeds desktop (post-republish)

| Marque | Version | Lien |
|--------|---------|------|
| TempoFlow | **0.10.33** | https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/TempoFlow-Setup-0.10.33.exe |
| Certivan | **0.1.16** | https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/Certivan-Setup-0.1.16.exe |
| Fidu | **0.1.65** | https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.65.exe |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-o0…o11
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/tempoflow2/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/certivan-app/crm/scripts/electron/sync-creezio-vendor.sh
CREEZIO_SYNC_DRY_RUN=1 bash /opt/docker/fidu/crm/scripts/electron/sync-creezio-vendor.sh
```

### Gate `test-phase-o11`

- PHASE-O11 + PLAN-O O11 Done
- Gates o0…o11 présents dans `package.json`
- Matrice mentionne O11 + % vision honnête (pas « 100 % » cosmétique seul)
- Dry-run sync ×3 ; SYNC `architectureVersion=H6` + `kitSha`
- Paperclip absent runtime kit
- Checklist dettes (GED / argsPreview / jumeaux) documentée

---

## Done

| Critère | Preuve |
|---------|--------|
| PHASE-O11 + test-phase-o11 | ✅ |
| PLAN-O O0→O11 | ✅ |
| Matrice freeze honnête | ✅ |
| Dry-run ×3 | ✅ |
| Kit `npm test` | ✅ |
| Republish feeds TF/CV/Fidu | ✅ (runtime O7/O9p) |
| % vision honnête documenté | ✅ **~76 %** |

---

## Suite

**Plan O* fermé** (chemin critique documenté). Suite éventuelle = plan dédié
dettes vision (jumeaux résiduels, MCP SoT unique, purge vocabulaire TF kit) —
hors scope O11.
