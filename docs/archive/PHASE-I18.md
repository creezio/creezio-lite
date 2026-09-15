# Phase I18 — Fidu ACL L3 + shell-ui + conso + republish

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `fidu` (+ doc kit) |
| **Prérequis** | [PHASE-I17.md](PHASE-I17.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Oui** — Client + Serveur **0.1.55** |

---

## Objectif

ACL L3 (store Product Hub + `decidePluginAccess`), shell-ui nav, conso stores
plateforme, standing ship Fidu (build + compile + test:fidu + publish).

## Note control-plane HTTP

Fidu n’a **pas** de `plugin-launcher` / `plugin-control-api` (vertical GED
sans Product Hub plugins sidecars). I18 livre :

- `plugin-hub-store` + `createFiduControlPlaneAcl` (prêt)
- `brand-runtime.controlPlaneAcl` + tests deny cross-org
- HTTP `startPluginControlApi` / `startHostPluginControlPlane` = **N/A**
  (GED-only) jusqu’à introduction plugins

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | ACL L3 store + façade `plugin-acl.ts` | ✅ |
| 2 | shell-ui nav + `/api/v1/shell/nav` + mcp-entry | ✅ |
| 3 | Tests i12 / i13 / acl-l3 + phase-h3 + test:fidu | ✅ |
| 4 | Standing ship → **0.1.55** publish | ✅ |
| 5 | Feeds SHA + conso 3 marques 100 % | ✅ |

## Feeds 0.1.55

Base : `https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/`

| Artefact | URL | SHA256 |
|----------|-----|--------|
| **Client** | [Fidu-Setup-0.1.55.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.55.exe) | `c68a35e7af12486d552c523c23de803120c53453993d668dd34c99cc09f4fa4a` |
| **Serveur** | [Fidu-Server-Setup-0.1.55.exe](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/server/Fidu-Server-Setup-0.1.55.exe) | `2b315450be3bfb2a374007f840aebc9957ee0d2c6f7c69fcdb3558b166a553fd` |

`latest.yml` client + serveur → version **0.1.55**.

## Compat Hermes / ACL

Sans headers actor : acteur = **clé service** (si control-plane HTTP un jour).  
Avec headers : ACL L3 + deny cross-org via `decidePluginAccess` / store.  
Bridge prêt : `createFiduControlPlaneAcl` + `fiduActorHeaders`.

## Conso 3 marques (I9–I18)

| Marque | Foundation | ACL + shell + conso | Republish |
|--------|------------|---------------------|-----------|
| TempoFlow | I9 | I10–I13 | I14 **0.10.30** |
| Certivan | I15 | I16 | I16 **0.1.14** |
| Fidu | I17 | I18 | I18 **0.1.55** |

## Verdict

**Phase I18 : TERMINÉE.** Chantier conso 3 marques = **100 %**.
Suite hors plan I* : ops / host-stack Fidu `clientSlim` si réouverture ADR.
