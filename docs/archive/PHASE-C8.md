# Phase C8 — Docs finales + republish marques touchées

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | kit + TF + Certivan + Fidu |
| **Prérequis** | C1–C7 verts + poussés |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Oui** |

---

## Objectif

Clôturer la correction C* : docs / gates / matrice à **100 % corrigé**,
sync vendor final, bump + publish Client+Serveur des marques touchées,
feeds SHA documentés.

## Marques republish

| Marque | Version | Contenu C* empaqueté |
|--------|---------|----------------------|
| TempoFlow | **0.10.32** | C1 stores + C4 obs/automations + C7 CP |
| Certivan | **0.1.15** | C2 MCP/stores + C6 RTI + C7 CP |
| Fidu | **0.1.57** | C5 mounts + C7 CP |

## Checklist

- [x] Docs PHASE-C3…C8 + matrice / POST-H5 / VISION alignés
- [x] Sync vendor H6 3 marques
- [x] Tests verts (kit + smokes marques C*)
- [x] Bump patch 3 marques
- [x] `remote-build-win.sh --publish` × 3
- [x] SHA feeds documentés ci-dessous
- [x] Push kit + marques

## Feeds / SHA

| Marque | Client | SHA256 | Serveur | SHA256 |
|--------|--------|--------|---------|--------|
| TempoFlow **0.10.32** | [Setup](https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/TempoFlow-Setup-0.10.32.exe) | `e74fe962aa1a515a313d1fe70117e8978fa6ff6ff894bbb0c34525177bddad53` | [Server](https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/server/TempoFlow-Server-Setup-0.10.32.exe) | `568d1d1c99a1bdadb82f3aab3d35dcd7098c925ef07420f178e1e9cf268fb5a7` |
| Certivan **0.1.15** | [Setup](https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/Certivan-Setup-0.1.15.exe) | `4128435fe0361d4f01501d97139f746b6152bf1614a5acf9ccfdd55cf5acc54f` | [Server](https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/server/Certivan-Server-Setup-0.1.15.exe) | `05f08837e9383c40702653eec3bb59e11ba5fcde419a04dfcce48d2d79e55793` |
| Fidu **0.1.57** | [Setup](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/Fidu-Setup-0.1.57.exe) | `402cc7660bc3522355937fe6d86d6634abe272a342c28105bc7e4eee5e3bddc0` | [Server](https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/server/Fidu-Server-Setup-0.1.57.exe) | `cd1cf09c6c50e77c67818665a5319514bf2ff566d517b24a8cae5e1c7985fd54` |

`latest.yml` client + serveur → versions ci-dessus pour chaque marque.

## Correctif packaging (C8)

Rename `useKitAssistant` → `kitAssistantEnabled` dans TF/Certivan
`chat-db.ts` : le préfixe `use*` déclenchait `react-hooks/rules-of-hooks`
pendant `next build` distant (bloquant le republish).

## Hors scope (volontaire, inchangé)

- Auto-promotion plugin→module
- Univers perso
- Cloud registry

## Verdict

**Phase C8 : TERMINÉE.** Correction C0–C8 = **100 % corrigé**.
