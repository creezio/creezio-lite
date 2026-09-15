# Phase O6 — Certivan dé-TF (migrations / queries catering)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | Certivan (+ kit docs/gate) |
| **Prérequis** | [PHASE-O5p.md](PHASE-O5p.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O5p** | kit tip `97a4d2a` / pin `5cfa4c3` · CV `a7b96b3` |
| **Kit tip O6** | `04d8148` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Différé (runtime migrations au boot — pas de DB packaged dans l’installeur) |

### SHAs

| Repo | SHA |
|------|-----|
| Certivan | `4712cd8` |
| Kit tip | `04d8148` |

---

## Objectif

Certivan **sans fork catering TempoFlow actif** : steps 001/006–010/013–015/019/021
= tombstones ; drop legacy **043** ; libs queries catalogue **absentes** ;
allowlist Database = métier VASP. **Façades / stubs = NON done.** Paperclip = mort.
**Exclu** : TF ; Fidu ; O7 host wirings.

---

## Migrations

| Step | Statut O6 |
|------|-----------|
| `001`, `006`–`010`, `013`–`015`, `019`, `021` | **tombstone** (no-op) |
| `011`, `012`, `016`, `018` | **vivants** (billing / onboarding) |
| `036` baseline + `037`–`042` métier | inchangés (FRESH sans catalogue) |
| **`043_drop_tempoflow_catering`** | **DROP** tables/vues/triggers catalogue TF |

Politique extraite de `AUDIT-RESTES-TEMPOFLOW.md` + `test-fresh-baseline` (`TF_ABSENT`)
+ baseline `036` (FRESH déjà sans catalogue).

---

## Libs / wiring

| Action | Cible |
|--------|--------|
| **Delete** | `queries.ts`, `commande-queries.ts`, `catalog-queries.ts`, `version-queries.ts`, `version-types.ts`, `rayons.ts`, `statut.ts` (+ composants statut morts) |
| **Add** | `search-sql-fallback.ts` (dossiers / véhicules only) |
| **Rewrite** | `context.ts`, `search.ts`, `open-external-tab.ts` (O4r : `mcp-bridge` remplace brand-chat-tools) |
| **Allowlist** | `CERTIVAN_CRUD_WHITELIST` via `configureCertivanDatabaseHost` (pattern Fidu) |

---

## Gates

```bash
# Kit
cd /opt/docker/creezio && node --test scripts/test-phase-o6.mjs

# Certivan
cd /opt/docker/certivan-app/crm
npm run build
npm run electron:compile
npx tsx scripts/test-fresh-baseline.mjs
npm run test:database-module
```

### Gate `test-phase-o6`

- Tombstones catering + `043` présent dans `steps/`
- Libs catering absentes ; `search-sql-fallback` métier only
- `CERTIVAN_CRUD_WHITELIST` (pas `TEMPOFLOW_CRUD_WHITELIST`)
- Pas `add_to_cart` / panier (O4r: mcp-bridge CV sans panier)
- PLAN-O O6 marqué livré · Paperclip mort

---

## Done

| Critère | Preuve |
|---------|--------|
| Catering steps neutres | tombstones + 043 |
| Fresh sans tables TF | `test-fresh-baseline` |
| Legacy drop catalogue | `test-fresh-baseline` §2 |
| Queries métier only | libs TF absentes |
| Database module VASP | `test:database-module` 33 ok |
| build + electron:compile | ✅ |
| `test-phase-o6` | ✅ |

---

## Suite

**O7** — Host wirings mince (`host-stack` ≤80 · `host-runtime-ctx` ≤100 ·
`preload-app` ≤120).
