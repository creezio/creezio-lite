# Phase I16 — Certivan ACL L3 + shell-ui + conso + republish

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `certivan-app` (+ doc kit) |
| **Prérequis** | [PHASE-I15.md](PHASE-I15.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Oui** — Client + Serveur **0.1.14** |

---

## Objectif

Bascule Certivan sur le control-plane kit avec ACL Product Hub L3
(`decidePluginAccess` / `createPluginControlPlaneAclFromStore`) ; adapters
shell-ui / nav ; preuve stores plateforme ; republish Client+Serveur.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `plugin-hub-store` + `plugin-control-adapters` | ✅ |
| 2 | `plugin-control-api` → kit handler + ACL L3 + extras Certivan | ✅ |
| 3 | `src/lib/plugin-acl.ts` → façade `decidePluginAccess` | ✅ |
| 4 | shell-ui : `creezio-nav-shell` + sidebar + `GET /api/v1/shell/nav` | ✅ |
| 5 | `mcp-entry` gate une entrée `/mcp` | ✅ |
| 6 | Tests `plugin-acl-l3` / `phase-i12` / `phase-i13` + régressions VASP | ✅ |
| 7 | Bump **0.1.14** + `remote-build-win.sh --publish` | ✅ |
| 8 | Feeds SHA documentés + Gate G1 post-H5/H6 | ✅ |

## Feeds 0.1.14

Base : `https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/`

| Artefact | URL | SHA256 |
|----------|-----|--------|
| **Client** | [Certivan-Setup-0.1.14.exe](https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/Certivan-Setup-0.1.14.exe) | `fa6447f634e19e06fb902a7b3292e049c73a31de657e9101feb186ef326a062c` |
| **Serveur** | [Certivan-Server-Setup-0.1.14.exe](https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/server/Certivan-Server-Setup-0.1.14.exe) | `a12d7245f2551857c71ebb4805e8d26e76e671240e94a552e18133ca5e50ff71` |

`latest.yml` client + serveur → version **0.1.14**.

## Compat Hermes

Sans headers actor : acteur = **clé service** (Bearer control-plane).  
Avec headers : ACL L3/L4 + deny cross-org.  
Bridge env : `CERTIVAN_PLUGINS_*`.

## Verdict

**Phase I16 : TERMINÉE.** Suite : **I17** (Fidu ADR clientSlim + foundation).
