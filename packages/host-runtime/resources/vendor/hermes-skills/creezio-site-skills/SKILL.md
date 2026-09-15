---
name: creezio-site-skills
description: Créer et entretenir un skill par site fournisseur (namespace site-*) — format imposé (domaine, parcours login, sélecteurs stables, pièges, date de vérification) ; mise à jour OBLIGATOIRE après chaque run computer-use.
version: 1.0.0
metadata:
  hermes:
    tags: [creezio, computer-use, sites, memory]
---

# creezio-site-skills — Mémoire des sites fournisseurs

Tu entretiens **un skill par site web** utilisé dans les missions
navigation/clics (voir `creezio-computer-use`). Ces skills vivent dans
`{HERMES_HOME}/skills/site-<domaine>/SKILL.md` et **survivent aux boots** :
le namespace `site-*` est réservé aux skills appris — aucun vendor ne peut
les écraser.

## Nommage (OBLIGATOIRE)

`site-<domaine sans TLD ni points>` — ex. `site-metro-fr` pour
`www.metro.fr`, `site-transgourmet-fr` pour `shop.transgourmet.fr`.

## Format imposé du SKILL.md

```markdown
---
name: site-<domaine>
description: Parcours et sélecteurs vérifiés pour <domaine> (skill appris).
version: <incrémenter à chaque mise à jour>
metadata:
  site:
    domaine: <hôte principal, ex. www.metro.fr>
    parcours_login: <URL de login + étapes en une ligne>
    verifie_le: <YYYY-MM-DD — date du dernier run qui a confirmé ces infos>
---

# site-<domaine>

## Parcours login
1. <étape par étape : URL, champs, boutons (libellés exacts)>

## Sélecteurs stables
| Élément | Sélecteur / libellé | Note |
|---------|--------------------|------|
| <ex. champ recherche> | <ref/label vérifié> | <depuis quand stable> |

## Parcours métier vérifiés
- <ex. « ajouter un produit au panier » : étapes numérotées>

## Pièges connus
- <popup cookies, iframe, pagination lente, anti-bot, textes ambigus…>
```

## Règle d'entretien (OBLIGATOIRE)

**Après CHAQUE run computer-use** (tâche déléguée via `create_ai_task` ou
pilotage direct `workspace.*`) :

1. Relis les logs du run (`get_ai_run_logs(run_id)`).
2. Mets à jour le skill du site :
   - nouveaux sélecteurs/libellés découverts → table « Sélecteurs stables » ;
   - parcours qui a fonctionné → « Parcours métier vérifiés » ;
   - échec/surprise (popup, changement de page, captcha) → « Pièges connus » ;
   - bump `version` + `verifie_le` à la date du jour.
3. Si le skill n'existe pas encore : crée-le (format ci-dessus) dès la
   première mission sur un site.

## Utilisation

Avant toute mission sur un site : charge `site-<domaine>` s'il existe et
**injecte ses extraits utiles dans le brief** `create_ai_task` (le runner ne
lit pas tes skills). Ne mets JAMAIS de secrets (mots de passe, clés) dans un
skill — les credentials restent dans le gestionnaire d'intégrations
(`creezio-integrations`).
