# Phase C0 — Alignement docs / gates / backlog C* (correction post-audit)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (docs + test cohérence) |
| **Prérequis** | D0–D6 + V1–V3 signés (socle) ; audit honnête 🟡 |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Remplacer le récit « D0–D6 / V1–V3 signés = done produit » par un **état
réel** : versions feeds actuelles, demi-mesures listées, phases **C\***
(Correction) comme suite officielle jusqu’à « 100 % corrigé ».

## Contexte

Rien de bloquant I* / D* / V* pour le socle. L’audit post-V3 classe plusieurs
zones en **🟡 demi-mesure** (dual-write TF, dualités Certivan acceptées,
fabrique V1 toy, V2/V3 mémoire/éphémères, mounts Fidu/RTI minces,
control-plane multi-styles, docs versions périmées).

Préfixe **C** = Correction. Hors scope volontaire inchangé : auto-promotion
plugin→module, univers perso, cloud registry.

## Versions marques (réelles)

| Marque | `package.json` | Note gate |
|--------|----------------|-----------|
| TempoFlow | **0.10.31** | I14 = 0.10.30 historique ; D3 republish |
| Certivan | **0.1.14** | I16 |
| Fidu | **0.1.56** | I18 = 0.1.55 historique ; D4 republish |

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | [gates/POST-H5.md](gates/POST-H5.md) versions + note C* | ✅ |
| 2 | [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) 🟡 réels | ✅ |
| 3 | Ce fichier + backlog C1–C8 | ✅ |
| 4 | [REPUBLISH-POLICY.md](REPUBLISH-POLICY.md) lignes C* | ✅ |
| 5 | README / CHANGELOG / VISION addendum | ✅ |
| 6 | `scripts/test-phase-c0.mjs` | ✅ |
| 7 | Push kit — **pas** de republish | ✅ |

## Backlog correction C1–C8 (ordre)

```text
C0 → C1 → C2 → C3 → C4 → C7 → C8
       ↘ C5 (après C1, // C6)
       ↘ C6 (après C2)
```

| Phase | Cible | Contenu | Republish |
|-------|-------|---------|-----------|
| **C1** | TempoFlow | Cutover stores → SoT kit ; zéro dual-write runtime | → C8 |
| **C2** | Certivan | Fermer dualités MCP + stores en code (plus N/A) | → C8 |
| **C3** | Kit | V1 fabrique réelle (scaffold + console persistée ; LLM opt.) | Non |
| **C4** | Kit + TF | V2/V3 SQLite + console + vendor + demobrand + ≥1 marque | → C8 |
| **C5** | Fidu | Mounts ged/contacts/dossiers list/get/mutation | C8 |
| **C6** | Certivan | RTI API métier (≠ UI-only) | C8 |
| **C7** | 4 boots | `startHostPluginControlPlane` unifié | C8 |
| **C8** | All | Docs finales + sync + republish marques touchées | **Oui** |

## Demi-mesures figées (état C0)

| Zone | État réel C0 | Phase fermeture |
|------|--------------|-----------------|
| TF auth/assistant | Dual-write D2 | **C1** |
| TF tasks/mails | Brand-retained D2 | **C1** |
| Certivan MCP/stores | Dualités acceptées D6 | **C2** |
| V1 fabrique | PRD déterministe + console mémoire | **C3** |
| V2/V3 | Demobrand OK ; console/obs mémoire ; pas vendor marques | **C4** |
| Fidu mounts | Status/COUNT minces | **C5** |
| Certivan RTI | Mount UI-only | **C6** |
| Control-plane | 3 styles différents | **C7** |
| Docs / feeds | Versions gate périmées (corrigé ici) | **C0** + **C8** |

## Checklist

- [x] Versions gate = `package.json` marques
- [x] Aucune case ✅ trompeuse pour dual-write / factory toy / console mémoire / D6 N/A
- [x] Lien C* depuis README / PHASE-D0 / VISION
- [x] `npm test` inclut `test-phase-c0`
- [x] Push kit — 0 republish exe

## Suite

→ **C1–C3 livrées** : [PHASE-C1.md](PHASE-C1.md) · [PHASE-C2.md](PHASE-C2.md) ·
[PHASE-C3.md](PHASE-C3.md). Prochaine : **C4** (V2/V3) · **C5/C6** mounts.

## Verdict

**Phase C0 : TERMINÉE.**
