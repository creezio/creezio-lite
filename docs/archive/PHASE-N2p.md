# Phase N2p — Cutover hosts (TF → Certivan → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-N2.md](PHASE-N2.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N2 SHA** | `9f44eb6` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (wiring electron, non packing) |

---

## Objectif

Cutover marques : jumeaux host plateforme absents ; SoT
`@creezio/electron-shell` (+ embeds `@creezio/platform-core`) via
`host-n2-bindings` + `host-stack` + preload mince (`createDesktopApi` +
esbuild). **Paperclip = mort**. Stubs / jumeaux = **non-done**.

---

## Sign-off marques

| Marque | Repo SHA | Wiring | Meili | Deletes (jumeaux) |
|--------|----------|--------|-------|-------------------|
| **TempoFlow** | `b602b08` | `host-n2-bindings.ts` (`ensureTfHostN2Configured`) + hooks meili CLI | kit gold (indexer/coherence hooks ≤20 LOC) | hermes/n8n/embed-*/os-sandbox, crash, web-telemetry, bridge, server-launcher, ai-workspace-*, disk-space |
| **Certivan** | `7e5bfa6` | `host-n2-bindings.ts` (`ensureCvHostN2Configured` + `shouldRestartNextAfterHermesStart`) | métier dossiers/véhicules conservé | idem plateforme (+ disk-space) |
| **Fidu** | `393bb98` | `host-n2-bindings.ts` (`ensureFiduHostN2Configured`) ; flotte N/A | GED métier conservé (~1256 LOC indexer) | idem plateforme |

### Budgets

| Surface | Critère |
|---------|---------|
| `preload-app.ts` | ≤260 LOC ×3 ; bundle `preload-app.js` ne `require` que `electron` |
| TF `meili-indexer.ts` / `meili-coherence-query.ts` | hooks CLI mince → kit |
| CV / Fidu meili | schéma + indexeur métier **conservés** (hors catalogue TF gold) |
| `host-n2-bindings.ts` | Client+Serveur (pas host-only) |

---

## Fix kit inclus (N2p)

- `brand-desktop-runtime` : `sessionCookieName: deps.sessionCookieName` → `BridgeClient`
- `@creezio/shell` `createDesktopApi` : méthodes `aiWorkspace*` (preload mince)

---

## Gates

```bash
# Par marque (TF → CV → Fidu)
npm run electron:compile
npm run test:hermes-embed && npm run test:n8n-embed   # si présents
npm run test:shell
npm run test:ai-workspace || npm run test:electron-ai-workspace
npm run build

# Kit
cd /opt/docker/creezio
npm run build -w @creezio/electron-shell && npm run build:cjs
npm run build -w @creezio/shell
npm test   # incl. test-phase-n2p
```

### Gate `test-phase-n2p`

- Absents ×3 : `hermes-embed|n8n-embed|embed-*|os-sandbox|crash-reporter|web-telemetry|bridge-client|server-launcher|ai-workspace-*|disk-space`
- `host-n2-bindings.ts` présent ×3 ; `preload-app.ts` ≤260 LOC
- TF meili CLI hooks ; CV/Fidu meili métier présents
- Paperclip mort
- PLAN-N N2p marqué livré + SHAs

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV+Fidu poussé | SHAs ci-dessus |
| Imports kit / platform-core | main + host-stack + bindings |
| Gate `test-phase-n2p` | ✅ |
| Republish packing | Non (différé) |

---

## Suite

**N3** — Assistant marque → `@creezio/assistant`.
