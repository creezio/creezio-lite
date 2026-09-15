# Phase D0 — Docs / matrice alignement (dette post-I18)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (docs uniquement) |
| **Prérequis** | Plan H0→H5 + I0→I18 fermé (tip kit ~`520bb56`) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Aligner la documentation kit sur l’état **réel** post-conso 3 marques
(TF 0.10.30 · Certivan 0.1.14 · Fidu 0.1.55) : supprimer les 🟡 faux
(catalogue / stack / ACL L3), corriger le dry-run I0 H5→H6, ouvrir le
backlog dette **D1–D6** sans toucher au runtime packaged.

## Contexte

Rien de bloquant I* ; reste = **dette + vision**. Préfixe **D** = dette
post-I18. Ordre strict : D0 → D1 → … → D6, puis vision V1–V3.

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) réalignée | ✅ |
| 2 | [PHASE-I0.md](PHASE-I0.md) dry-run H6 documenté | ✅ |
| 3 | [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) + README phases D* | ✅ |
| 4 | Ce fichier + backlog D1–D6 | ✅ |
| 5 | Push kit — **pas** de republish | ✅ |

## Corrections matrice (D0)

| Écart | Avant (faux) | Après |
|-------|--------------|-------|
| Catalogue / stack mounts | 🟡 « Mount API suite » | ✅ I11 `createCatalogueMount` / `createStackMount` |
| ACL L3 marques | 🟡 « TF L4 user-only » / control-plane sans acl | ✅ I10 TF · I16 Certivan · I18 Fidu store |
| Dry-run sync I0 | Doc `H5` | Courant = **H6** (POST-H5 déjà OK) |
| Scan | 🟡 générique | ✅ mount status UI-only I11 ; API métier = **D3** |

## Backlog dette D1–D6 (ordre strict)

| Phase | Cible | Contenu |
|-------|-------|---------|
| **D1** | TempoFlow | Une seule stack MCP runtime (éliminer dualité Hono `/mcp` + façade Electron) |
| **D2** | TempoFlow | Unifier stores plateforme auth/assistant/tasks/mails (sortir du shadow kit) |
| **D3** | TempoFlow | Scan mount métier ou doc produit figée + feature gates ; republish si runtime |
| **D4** | Fidu | Control-plane HTTP plugins (`startHostPluginControlPlane` + ACL) |
| **D5** | Fidu | ADR `clientSlim` : migrer lazy **ou** « false définitif » + critères réouverture |
| **D6** | Certivan | Audit dualités ; corriger ou N/A documenté |

## Vision (après D0–D6)

| Phase | Contenu |
|-------|---------|
| **V1** | Fabrique plugins conversationnelle (demobrand E2E) — ✅ [PHASE-V1.md](PHASE-V1.md) |
| **V2** | Observabilité native kit — ✅ [PHASE-V2.md](PHASE-V2.md) |
| **V3** | Automations data-driven — ✅ [PHASE-V3.md](PHASE-V3.md) · [VISION-V1-V3.md](VISION-V1-V3.md) |

Hors scope volontaire inchangé : auto-promotion plugin→module, univers perso,
cloud registry.

## Checklist

- [x] Matrice catalogue/stack/ACL L3 plus 🟡 faux
- [x] PHASE-I0 dry-run H6
- [x] PHASE-D0 + backlog D*/V*
- [x] REPUBLISH-POLICY étendue D*
- [x] `npm test` kit verts
- [x] Push kit — 0 republish exe

## Suite

→ **D1–D6 + V1–V3 livrés** (socle).  
→ **Correction post-audit** : [PHASE-C0.md](PHASE-C0.md) → C1…C8
(demi-mesures 🟡 restantes : dual-write TF, dualités Certivan, V1–V3
prod-ready, mounts, control-plane unifié).

## Verdict

**Phase D0 : TERMINÉE.**
