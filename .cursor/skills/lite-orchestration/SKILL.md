---
name: lite-orchestration
description: Standard d’orchestration des applications Creezio Lite — Astra orchestre et décide, Cursor Fable 5.1 réalise. Utiliser pour rédiger un brief, lancer ou reprendre une mission Cursor, écrire un checkpoint ou une réception, vérifier le modèle épinglé, ou adopter ce standard dans une application. Ne pas utiliser pour le métier de l’application ni pour choisir un autre modèle.
---

# Orchestration Creezio Lite

Source canonique : ce dossier, distribué par `node bin/lite.mjs create` puis `node bin/lite.mjs adopt`. Ne pas éditer une copie ; corriger le kit et réadopter.

## Rôles

- **Astra** (orchestrateur) : architecture, priorités, briefs, revue ciblée des risques et des preuves, décision finale, fusion et release autorisées, registre privé des missions.
- **Cursor Fable 5.1** (réalisation) : développement, corrections, nouveaux tests, investigations volumineuses, préparation d’upgrade, revues mécaniques. Il livre une branche et une PR ; il ne fusionne pas, ne déploie pas, ne lance pas d’autre mission.
- Aucun développement local ni sous-agent Codex. Cursor indisponible ou modèle refusé ⇒ blocage explicite ; Astra poursuit l’orchestration indépendante. Jamais de substitution de modèle.

## Flux d’une mission

1. **Préflight** du modèle épinglé (`cursor-model.json`) : `node .cursor/skills/lite-orchestration/scripts/cursor-agents.mjs preflight` avec `CURSOR_API_KEY` en environnement. Code 0 seulement si l’identifiant exact est accepté avec ses paramètres.
2. **Brief** compact (§3 du contrat) : mission, base SHA, branche réservée, périmètre et fichiers attribués, tests attendus, interdits, prochaine action.
3. **Lancement dédupliqué** : `cursor-agents.mjs launch` avec la clé de mission et le registre privé hors dépôt. Identifiant d’agent déterministe ; 409 ou appel incertain ⇒ réconciliation, jamais de second agent.
4. **Checkpoints** : `cursor-agents.mjs status --follow` ; polling progressif, résumé uniquement au changement, diff depuis la dernière réception, aucun journal complet.
5. **Réception** compacte (§6 du contrat) écrite par l’agent dans la PR : head SHA, agent/run, modèle effectif relevé par `run-info`, tests réellement exécutés, CI, risques, blocage, prochaine action.
6. **Revue et décision** : revue Cursor indépendante proportionnée au risque, puis Astra tranche. Une CI verte seule ne suffit pas.

## Ressources

- `CONTRACT.md` — contrat complet : champs du brief et de la réception, déduplication, réconciliation, secrets, adoption. À lire avant de rédiger un brief ou une réception.
- `cursor-model.json` — modèle épinglé, paramètres et nom effectif attendu. Modifié seulement par le kit, après préflight prouvé.
- `scripts/cursor-agents.mjs` — `preflight`, `launch`, `reconcile`, `status`, `followup`. Sorties JSON sans secret ; codes 0 ok, 2 bloqué, 3 indisponible, 4 usage.
- Adoption dans une application existante : `node bin/lite.mjs adopt --app <dossier>` (inspection), puis `--apply`. Conflit local ⇒ refus, aucune écriture.
