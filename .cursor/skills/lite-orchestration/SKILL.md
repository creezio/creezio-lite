---
name: lite-orchestration
description: Standard d’orchestration des applications Creezio Lite — Astra orchestre et décide, Cursor réalise avec un modèle choisi une fois à l’attribution (Fable 5.1 par défaut). Utiliser pour rédiger un brief, choisir la sélection de modèle, lancer ou reprendre une mission Cursor, écrire un checkpoint ou une réception, ou adopter ce standard dans une application. Ne pas utiliser pour le métier de l’application ni pour changer de modèle en cours de mission.
---

# Orchestration Creezio Lite

Source canonique : ce dossier, distribué par `node bin/lite.mjs create` puis `node bin/lite.mjs adopt`. Ne pas éditer une copie ; corriger le kit et réadopter.

## Rôles

- **Astra** (orchestrateur) : architecture, priorités, briefs, choix de la sélection de modèle à l’attribution, revue ciblée des risques et des preuves, décision finale, fusion et release autorisées, registre privé des missions.
- **Cursor** (réalisation) : tout développement délégable — développement, corrections, nouveaux tests, investigations volumineuses, préparation d’upgrade, revues mécaniques. Il livre une branche et une PR ; il ne fusionne pas, ne déploie pas, ne lance pas d’autre mission.
- Aucun développement local ni sous-agent Codex. Cursor indisponible ou sélection refusée ⇒ blocage explicite ; Astra poursuit l’orchestration indépendante sans changer de modèle.

## Sélection du modèle

Choisie **une fois** à l’attribution parmi `cursor-model.json`, puis conservée toute la mission, corrections et reprises comprises. `fable` (Fable 5.1) pour la majorité des missions ; `opus` ou `grok` seulement si la mission est clairement plus simple et bornée dès l’attribution. Si le périmètre déborde, Astra recadre la mission ; il ne change pas de modèle. Détail §2 du contrat.

## Flux d’une mission

1. **Préflight** : `node .cursor/skills/lite-orchestration/scripts/cursor-agents.mjs preflight [--select clé]` avec `CURSOR_API_KEY` en environnement. Code 0 seulement si l’identifiant exact est listé et qu’une variante complète du catalogue correspond.
2. **Brief** compact (§3 du contrat) : mission, base SHA, branche réservée, sélection, périmètre et fichiers attribués, tests attendus, interdits, prochaine action.
3. **Lancement dédupliqué** : `cursor-agents.mjs launch --select clé` avec la clé de mission et le registre privé hors dépôt. Identifiant d’agent déterministe ; 409 ou appel incertain ⇒ réconciliation, jamais de second agent.
4. **Checkpoints** : `cursor-agents.mjs status --mission K --follow` ; polling progressif, résumé au changement, sélection initiale rappelée, aucun journal complet.
5. **Reprise** : `cursor-agents.mjs followup --mission K` sur le même agent, seulement après un run terminal ; aucun champ `model` envoyé.
6. **Réception** compacte (§6 du contrat) écrite par l’agent dans la PR, puis **revue et décision** : revue Cursor indépendante proportionnée au risque, Astra tranche. Une CI verte seule ne suffit pas.

## Ressources

- `CONTRACT.md` — contrat complet : sélection, brief, lancement, checkpoints, réception, revue, adoption. À lire avant de rédiger un brief ou une réception.
- `cursor-model.json` — sélections autorisées (`fable` par défaut, `opus`, `grok`), options désactivées par défaut quand exposées (`fast`, `cyber`), aucun repli. Modifié seulement par le kit, après préflight réel.
- `scripts/cursor-agents.mjs` — `preflight`, `launch`, `reconcile`, `status`, `followup`. Sorties JSON sans secret ; codes 0 ok, 2 bloqué, 3 indisponible ou incertain, 4 usage.
- Adoption dans une application existante : `node bin/lite.mjs adopt --app <dossier>` (inspection), puis `--apply`. Conflit local ⇒ refus, aucune écriture.
