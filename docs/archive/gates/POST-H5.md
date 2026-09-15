# Gates post-H5 — checklist transversale (Phase I0)

> Complète G1/G2/G3 (Phases A–G). Ne remplace pas les gates marques.  
> Sign-off H5 kit : [PHASE-H5.md](../PHASE-H5.md). Plan I* : [PHASE-I0.md](../PHASE-I0.md).  
> **Correction post-audit** : [PHASE-C0.md](../PHASE-C0.md) → C1…C8 (demi-mesures 🟡).

## Kit (`creezio/creezio`)

- [x] `ARCHITECTURE_VERSION = "H6"` (freeze I8 ; était H5 ACL)
- [x] Script canonique `scripts/sync-creezio-vendor.sh` (assert version + CJS + SYNC.json)
- [x] Console expose `architectureVersion` (`GET /api/kit-versions`)
- [x] Politique republish : [REPUBLISH-POLICY.md](../REPUBLISH-POLICY.md)
- [x] Phases I1–I8 livrées (persistance + control-plane + admin + shell-ui + freeze)
- [x] D0–D6 + V1–V3 socle (sign-offs) — **pas** « 100 % produit » (voir C*)
- [x] **C1–C8** correction complète (cutover → fabrique → V2/V3 → mounts → CP → republish)

## TempoFlow (`tempoflow2`)

- [x] Wrapper sync → contrat kit I0
- [x] Vendor H6 consommé nominal (I9)
- [x] ACL L3 + control-plane `acl` (I10)
- [x] Republish I14 Client+Serveur **0.10.30** *(historique)*
- [x] D1 MCP unique + D2 adapters dual-write + D3 scan → republish **0.10.31** *(courant)*
- [x] **C1** cutover stores SoT kit · **C4** obs/automations · **C7** CP · republish **0.10.32** (C8)

## Certivan (`certivan-app`)

- [x] Wrapper sync → contrat kit I0 (liste H5 baseline)
- [x] Foundation SqliteRuntime + modules (I15)
- [x] Republish uniquement I16 (**0.1.14** courant)
- [x] D6 polish aliases
- [x] **C2** dualités fermées · **C6** RTI API · **C7** CP · republish **0.1.15** (C8)

## Fidu (`fidu`)

- [x] Wrapper sync → contrat kit I0
- [x] ADR `clientSlim` + foundation (I17) — clientSlim reste **false** (D5)
- [x] ACL L3 store + shell-ui + conso stores (I18)
- [x] Republish I18 Client+Serveur **0.1.55** *(historique)*
- [x] D4 control-plane HTTP → republish **0.1.56** *(courant)*
- [x] **C5** mounts utiles · **C7** CP host unifié · republish **0.1.57** (C8)

## Dry-run sync TF (preuve I0)

```bash
CREEZIO_SYNC_DRY_RUN=1 bash crm/scripts/electron/sync-creezio-vendor.sh
# attendu : ARCHITECTURE_VERSION=H6, packages baseline, OK dry-run
```
