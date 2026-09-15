# Phase M13 — Audit TF métier-only

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` + `tempoflow2` |
| **Prérequis** | [PHASE-M12p.md](PHASE-M12p.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish** | Non |

---

## Objectif

Vérifier que TempoFlow n’a plus de **jumeaux / stubs plateforme** : le métier
reste dans TF ; le runtime plateforme est SoT kit. **Pas de stubs fantômes.**
Paperclip = mort (absent).

---

## Allowlist TF (métier-only + wiring mince)

| Zone | Contenu autorisé |
|------|------------------|
| Modules métier | `panier`, `dispatch`, `releves`, `catalogue`, `stack`, `scan` (+ `mcp-*` / `nav*` brand) |
| Seeds / vertical | `hermes-*-seed`, `hermes-crm-key`, `n8n-api-key`, `agent-isolation`, … |
| Host wiring | `host-runtime-ctx.ts` (hooks), `host-stack.ts` (lazy Serveur) |
| Brand runtime | `brand-runtime.ts` (mounts métier + ACP) |
| Composition | `main.ts` ≤ 800 LOC via `installBrandDesktopRuntime` |
| Migrations brand | `electron/modules/brand-migrations.ts` + `electron/migrations/steps/*` historique |

**Hors allowlist delete** (doivent rester absents) : launchers meili/hermes/n8n/fleet/ops,
`local-config.ts`, bootstraps hermes/n8n, `src/lib/database`, `core-migrations`,
`mcp-runtime` / `mcp-hono-proxy` jumeaux, tout Paperclip.

### Zones grises (wiring gras — pas jumeaux delete-stub)

- `plugin-control-extras.ts`, parties volumineuses de `brand-runtime.ts`
- Runner `electron/migrations/steps/*` (socle DB historique)
- Docs TF stale citant d’anciens chemins

---

## Preuves audit

| Critère | Résultat |
|---------|----------|
| `electron/main.ts` | ≤ 800 LOC + `installBrandDesktopRuntime` |
| Jumeaux plateforme (liste M13) | **Absents** |
| `src/lib/database` shim | **Absent** |
| `core-migrations` jumeau | **Absent** — `platformCoreMigrations()` kit |
| `modules` | Symlink → `electron/modules` |
| Paperclip | **Absent** |

---

## Gates

```bash
cd /opt/docker/creezio && npm test   # incl. test-phase-m13
cd /opt/docker/tempoflow2/crm
npm run electron:compile \
  && npm run test:shell \
  && npm run test:database-module \
  && npm run test:phase-h3 \
  && npm run build
```

---

## Done vision M13

| Critère | Preuve |
|---------|--------|
| Allowlist métier figée | ✅ ce doc + `test-phase-m13.mjs` |
| Inventaire jumeaux plateforme TF = 0 | ✅ gate M13.3 |
| Gates TF shell / database / h3 / build / compile | ✅ |
| `PHASE-M13.md` + PLAN-M §M13 | ✅ |
| Suite | **M14** Certivan gold |

---

## Suite

Selon [PLAN-M.md](PLAN-M.md) : **M14** Certivan gold.
