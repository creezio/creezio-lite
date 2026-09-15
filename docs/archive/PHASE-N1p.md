# Phase N1p — Cutover plugins runtime (TF → Certivan → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-N1.md](PHASE-N1.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N1 SHA** | `fadb3e4` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Différé / non packing (wiring electron uniquement) |

---

## Objectif

Cutover marques : jumeaux `electron/plugin-{runtime,launcher,git,control-extras,…}`
absents ; SoT `@creezio/electron-shell` via `configurePluginHost` + imports
directs kit. **Paperclip = mort**.

---

## Sign-off marques

| Marque | Repo SHA | Wiring | Deletes |
|--------|----------|--------|---------|
| **TempoFlow** | `063ac3c` | `plugin-host-bindings.ts` (`ensureTfPluginHostConfigured`) · envPrefix `TEMPOFLOW` + legacy `TF2` | runtime/launcher/git/control-extras/adapters/crm-key/data/accept-check/test-runner/events/execution-grant/control-token |
| **Certivan** | `e463290` | `plugin-host-bindings.ts` (`ensureCvPluginHostConfigured`) · envPrefix `CERTIVAN` | idem |
| **Fidu** | `2fd5a0f` | wiring mince N5 inchangé (`plugin-control-boot` + host-na-stubs) ; **0** jumeaux runtime ; vendor sync N1 | n/a (déjà absents) |

`plugin-control-api.ts` marque : barrel ≤40 LOC re-export kit (TF/CV) ou entrée mince Fidu.  
`plugin-hub-store.ts` : wiring product-hub ≤40 LOC (conservé).

---

## Fix kit inclus (N1p)

`createPluginExecutionGrant` / `validatePluginExecutionGrant` utilisent
`productHubTokensFromManifest(bindings.manifest).grantTokenPrefix`
(ex. `tf2_exec_` / `certivan_exec_`) — défaut platform-core `exec_` insuffisant
pour le control-plane marque.

---

## Gates

```bash
# Par marque (TF puis CV) — stop si rouge
bash crm/scripts/electron/sync-creezio-vendor.sh
npm run electron:compile
npm run test:plugin-runtime && npm run test:plugin-git && npm run test:plugin-control-api
npm run test:shell   # + test:plugin-acl-l3 si présent
npm run build

# Kit
cd /opt/docker/creezio
npm run build -w @creezio/electron-shell && npm run build:cjs
npm test   # incl. test-phase-n1p
```

### Gate `test-phase-n1p`

- Absents TF+CV : `plugin-runtime|launcher|git|control-extras` (+ jumeaux purs listés)
- `plugin-control-api.ts` ≤40 LOC si présent
- Fidu : absents `plugin-runtime|launcher|git|control-extras`
- Paperclip mort (src marques + kit plugins)
- PLAN-N N1p marqué livré

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV+Fidu poussé | SHAs ci-dessus |
| Imports kit / configurePluginHost | host-stack + bindings |
| Gate `test-phase-n1p` | ✅ |
| Republish packing | Non (différé) |

---

## Suite

**N2** — Jumeaux hosts → kit — ✅ [PHASE-N2.md](PHASE-N2.md).
