# Phase O7 — Host wirings mince (host-stack / ctx / preload)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | Kit + TempoFlow + Certivan + Fidu |
| **Prérequis** | [PHASE-O6.md](PHASE-O6.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O4r4 tip** | kit `6c5391a` · TF `1c98930` · CV `51e9ce5` · Fidu `786dc41` |
| **Kit tip O7** | `a964f17` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Différé feeds (runtime host/preload touché — republish O11 ou à la demande) |

### SHAs

| Repo | SHA |
|------|-----|
| Kit tip | `a964f17` |
| TempoFlow | `9934848` |
| Certivan | `54bb924` |
| Fidu | `c3ccbdd` |

---

## Objectif

Wirings marque = **composition mince** du kit. Plafonds mesurables ×3.
**Façades / stubs = NON done.** Paperclip = mort.

**Exclu** : supplier TF ; rewrite `brand-desktop-runtime` ; extraction GED Fidu
MCP host → `createFiduModuleMcpTools` (dette documentée, hors O7).

---

## Kit

| Module | API |
|--------|-----|
| `@creezio/electron-shell` | `createBrandHostStack`, `createBrandHostRuntime`, helpers CRM key / tunnel |
| `@creezio/shell` | `wireCrmHostPreload`, `buildCrmHostDesktopApi`, `installPreloadTelemetry` |

## Marques (après)

| Surface | Plafond | Pattern |
|---------|--------:|---------|
| `electron/host-stack.ts` | ≤80 | `createBrandHostStack({…})` + export destructuré |
| `electron/host-runtime-ctx.ts` | ≤100 | brand opts + `createBrandHostRuntime` |
| `electron/preload-app.ts` | ≤120 | `wireCrmHostPreload({ bridgeName, titlebar… })` |
| `src/lib/brand-host.ts` | — | fusion `brand-*-host` (installers ; client Product Hub séparé) |

### Dettes annexes (hors done O7)

- Fidu GED tools Hono encore hors `createFiduModuleMcpTools` (pas bloquant plafonds).
- CV writes host Bearer — intentionnel.
- `argsPreview` TS marque — non bloquant.

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && npm run build:packages && npm test  # incl. test-phase-o7

# Marques
for d in tempoflow2 certivan-app fidu; do
  cd /opt/docker/$d/crm
  npm run electron:sync-vendor   # liste complète
  npm run build && npm run electron:compile
done
```

### Gate `test-phase-o7`

- PHASE-O7 + PLAN-O O7
- LOC ×3 : host-stack ≤80 · ctx ≤100 · preload ≤120
- Imports kit (`createBrandHostStack` / `createBrandHostRuntime` / `wireCrmHostPreload`)
- Anciens `brand-*-host.ts` absents ; `brand-host.ts` présent ×3
- Exports kit shell + electron-shell

---

## Done

| Critère | Preuve |
|---------|--------|
| Plafonds LOC ×3 | `test-phase-o7` |
| Kit factories | `brand-host-stack.ts` / `brand-host-runtime.ts` / `create-crm-host-preload.ts` |
| Fusion brand-host | 1 fichier ×3 (+ client Product Hub) |
| build:packages + npm test | ✅ |
| electron:compile ×3 | ✅ |
| vendor liste complète ×3 | ✅ |

---

## Suite

**O8** — Gates anti-façade permanents (`test-phase-o8`).
