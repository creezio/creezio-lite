# Phase M0 — Baseline anti-demi-mesure (vision stricte)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (+ gates TF lecture seule) |
| **Prérequis** | Plan [PLAN-M.md](PLAN-M.md) · audit vision ~32 % |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Figer l’état réel TempoFlow / kit et **interdire** tout sign-off « stub = done »,
« façade OK », « aminci OK ». Les phases R*/C*/I* restent **historique** ; le
critère done pour la suite est la **vision stricte** (commun = `@creezio/*`
uniquement ; marque = minimum métier).

---

## Freeze (règles non négociables pendant M*)

1. **Une seule étape à la fois** — pas de M(n+1) tant que gate M(n) rouge.
2. Stubs / façades / jumeaux / fichiers plateforme dans TF = **étape NON done**.
3. Extraire TF → kit ; **ne pas inventer**.
4. Tests verts → push GitHub → ensuite seulement l’étape suivante.
5. Sync vendor = **liste complète** (jamais un seul package).
6. Certivan / Fidu = `Mp` **après** TF gold du **même** module.
7. Zéro **nouvelle** feature plateforme inventée dans TF / Certivan / Fidu pendant M*.

---

## Inventaire daté (2026-07-29) — dettes vision TF

Chemins relatifs à `/opt/docker/tempoflow2/crm`. LOC = lignes fichiers `.ts`/`.tsx`.

| Domaine | Chemin | LOC | Statut vision | Étape cible |
|---------|--------|-----|---------------|-------------|
| Database shims | `src/lib/database/**` | **100** | ❌ shims re-export | **M1** |
| Admin UI Database | `src/components/admin/database-client.tsx` | 795 | ❌ UI encore TF | **M2** |
| Admin UI automations | `src/components/admin/database/database-automations-panel.tsx` | 389 | ❌ UI encore TF | **M2** |
| Route Admin Database | `src/server/routes/admin-database.ts` | 469 | 🟡 handlers TF | **M2** (aminci) |
| Product Hub façade | `electron/plugin-control-api.ts` | 467 | ❌ jumeau | **M3** |
| Product Hub adapter | `src/lib/platform-stores/product-hub-adapter.ts` | 308 | ❌ façade | **M3** |
| Platform stores (total) | `src/lib/platform-stores/**` | 775 | 🟡 | **M3 / M8** |
| Plugin hub store | `electron/plugin-hub-store.ts` | 114 | 🟡 | **M3** |
| local-config jumeau | `electron/local-config.ts` | **814** | ❌ jumeau | **M4** |
| Hermes bootstrap | `electron/hermes-runtime-bootstrap.ts` | 768 | ❌ jumeau | **M5** |
| n8n bootstrap | `electron/n8n-runtime-bootstrap.ts` | 256 | ❌ jumeau | **M5** |
| Launchers stubs | `electron/{hermes,n8n,meili}-launcher.ts` | 94+113+39 | ❌ stubs | **M6** |
| Window chrome stub | `electron/window-chrome-html.ts` | 25 | ❌ stub | **M6** |
| Fleet stub | `electron/fleet-agent.ts` | 57 | ❌ stub | **M7** |
| Ops journal stub | `electron/ops-journal.ts` | 55 | ❌ stub | **M7** |
| main.ts | `electron/main.ts` | **4026** | ❌ hors budget ≤800 | **M12** |
| Core migrations | `electron/modules/core-migrations.ts` | 36 | 🟡 | **M11** |
| Brand migrations | `electron/modules/brand-migrations.ts` | 161 | ✅ métier OK si cœur kit | **M11** |
| creezio-boot | `electron/creezio-boot.ts` | 90 | 🟡 | M6 / M12 |
| plugin-product-hub | `src/lib/plugin-product-hub.ts` | 319 | 🟡 | **M3** |
| mcp-runtime | `src/lib/mcp-runtime.ts` | 22 | 🟡 | **M9** |

### Marques (Database)

| Marque | `src/lib/database` | Note |
|--------|--------------------|------|
| TempoFlow | présent (shims ~100 LOC) | gold cutover = **M1** |
| Certivan | présent (copie / shims locaux) | **M1p** après M1 |
| Fidu | **absent** | **M1p** : sync vendor + imports directs si besoin runtime |

---

## Gates M0 (exécutés verts)

```bash
cd /opt/docker/creezio && npm test && npm run build:packages
cd /opt/docker/tempoflow2/crm && npm run electron:compile \
  && npm run test:database-module \
  && npm run test:electron-main-graph
```

| Gate | Résultat |
|------|----------|
| kit `npm test` | ✅ 188 pass (pré-M0) + suite `test-phase-m0` |
| kit `build:packages` | ✅ |
| TF `electron:compile` | ✅ |
| TF `test:database-module` | ✅ 32 ok |
| TF `test:electron-main-graph` | ✅ |

---

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | Inventaire daté (ce fichier) | ✅ |
| 2 | [PLAN-M.md](PLAN-M.md) — plan M0→M16 | ✅ |
| 3 | Freeze anti-stub documenté | ✅ |
| 4 | Amendement matrice (vision stricte M*) | ✅ |
| 5 | `scripts/test-phase-m0.mjs` | ✅ |
| 6 | Push kit | ✅ |

---

## Suite

**M1** — Database engine : supprimer `crm/src/lib/database/**` shims ; imports
`@creezio/database` directs. Voir [PHASE-M1.md](PHASE-M1.md) (après cutover).

---

## Verdict

**Phase M0 : TERMINÉE.** Baseline inventoriée ; R*/C* = historique ; critère
done M* = vision stricte (**stub ≠ done**). Aucun cutover code dans M0.
