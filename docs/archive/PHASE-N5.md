# Phase N5 — Feature-off Fidu (`host-na-stubs` → contrat kit)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repos** | `creezio/creezio` + Fidu |
| **Prérequis** | [PHASE-N4p.md](PHASE-N4p.md) · plan [PLAN-N.md](PLAN-N.md) |
| **Baseline N4p kit SHA** | `5dca2bb` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Oui Fidu (host-stack packaged) |

---

## Objectif

Plus de stubs locaux Fidu : le kit expose `createFeatureOffHost` (signatures
extraites de `host-na-stubs.ts`) ; le manifeste déclare
`features.plugins=false` / `fleet=false` ; `host-na-stubs.ts` **absent**.

**Paperclip = mort.**  
**Exclu** : activer le runtime plugins Fidu ; cutover TF/CV (hosts réels).

---

## Travaux kit

| Module | Rôle |
|--------|------|
| `electron-shell/src/host/feature-off-host.ts` | `createFeatureOffHost` — plugins / control-extras / tests / accept / fleet |
| `brand-config` `BrandFeatures` + `isFeatureEnabled` | contrat manifeste |
| `manifests/fidu.ts` | `features: { plugins: false, fleet: false }` |
| `manifests/tempoflow.ts` / `certivan.ts` | `features: { plugins: true, fleet: true }` |

### API

```ts
import { createFeatureOffHost } from "@creezio/electron-shell";
import { fiduManifest, isFeatureEnabled } from "@creezio/brand-config";

isFeatureEnabled(fiduManifest, "plugins"); // false

const off = createFeatureOffHost({
  brandLabel: "Fidu",
  userDataDir: () => paths.userDataDir(),
  features: { plugins: false, fleet: false },
});
// off.plugins.enablePlugin(...) → { ok: false, detail: "Plugins runtime N/A Fidu" }
```

`features.plugins=true` / `fleet=true` sur ce factory **lève** (pas de faux
runtime).

---

## Cutover Fidu

| Fichier | Action |
|---------|--------|
| `electron/host-stack.ts` | branche `createFeatureOffHost` ; control-plane boot inchangé |
| `electron/host-na-stubs.ts` | **delete** |

Réponses IPC `ok: false` / listes vides **inchangées** fonctionnellement.

---

## Gates

```bash
cd /opt/docker/creezio && npm run build -w @creezio/brand-config \
  && npm run build -w @creezio/electron-shell && npm test
# incl. test-phase-n5

cd /opt/docker/fidu/crm
bash scripts/electron/sync-creezio-vendor.sh   # liste complète
npm run electron:compile && npm run test:shell && npm run test:phase-c5
test ! -f electron/host-na-stubs.ts
```

---

## Critère done

- [x] `host-na-stubs.ts` **absent**
- [x] 0 `require("./host-na-stubs")`
- [x] Manifest Fidu `features.plugins=false` / `fleet=false`
- [x] Host-stack → `createFeatureOffHost` kit
- [x] Gates kit + Fidu verts
- [x] Doc `PHASE-N5.md` + PLAN-N

---

## SHAs

| Repo | SHA | Notes |
|------|-----|-------|
| Kit | `de903b2` | `createFeatureOffHost` + `BrandFeatures` |
| Fidu feat | `20d9adf` | delete stubs + host-stack + vendor |
| Fidu release | `cf87426` | **0.1.62** |

Publish :
[https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.62.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.62.exe)

---

## Suite

**N6** — Admin Plugins / MCP / analytics génériques → kit.
