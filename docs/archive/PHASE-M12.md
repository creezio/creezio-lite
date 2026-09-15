# Phase M12 — `main.ts` ≤ 800 LOC via façade kit

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M11.md](PHASE-M11.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | Non (pas de packing) |

---

## Objectif

`electron/main.ts` TempoFlow ≤ **800 LOC** : composition marque uniquement ;
runtime desktop plateforme = `installBrandDesktopRuntime` dans
`@creezio/electron-shell` (extrait du monolithe TF, pas d’invention).

---

## Travaux kit

| Livrable | Note |
|----------|------|
| `electron-shell/src/desktop/brand-desktop-runtime.ts` | Corps main (IPC, splash, shell, boot, shutdown) |
| `installBrandDesktopRuntime(deps)` | Injection store / hosts / paths / vertical / electron |
| Peer dep | `@creezio/observability` (ops/fleet déjà utilisés par le main) |
| Garde Client | Agent flotte early-boot seulement si `allowLocalStack` |

---

## Travaux TF

| Fichier | Avant | Après |
|---------|------:|------:|
| `electron/main.ts` | **4061** LOC | **≤800** (composition + deps) |
| Smokes | lisaient `main.ts` seul | `readDesktopRuntimeSrc()` = main + vendor runtime |

Vertical inchangé (tabs, AI workspace, brand-runtime, host-stack lazy, catalog…).

---

## Critères done vision

| Critère | Preuve |
|---------|--------|
| `main.ts` ≤ 800 LOC | ✅ |
| Runtime plateforme SoT kit | ✅ `installBrandDesktopRuntime` |
| Pas de jumeau main « à moitié » | ✅ cutover atomique |
| Vendor liste complète | ✅ |
| Gates ci-dessous | ✅ |
| PHASE-M12.md | ✅ |

**Exclu M12** : slim Certivan/Fidu → **M12p** ; audit métier-only → **M13**.

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m12
cd /opt/docker/tempoflow2/crm && bash scripts/electron/sync-creezio-vendor.sh
npm run electron:compile \
  && npm run test:electron-main-graph \
  && npm run test:client-slim-boot \
  && npm run test:shell \
  && npm run electron:compile
```

---

## Push

| Repo | SHA |
|------|-----|
| kit `creezio/creezio` | `9b92e60` |
| TF `tempoflow2` | `643707e` |

---

## Suite

**M12p** — Certivan/Fidu `main.ts` slim (seuils documentés) via la même façade.
