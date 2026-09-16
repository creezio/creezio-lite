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

1. **Préflight** : `node .cursor/skills/lite-orchestration/scripts/cursor-agents.mjs preflight [--select clé]` avec `CURSOR_API_KEY` en environnement, ou sans clé avec le pool commun de comptes (§9 du contrat : coffre local DPAPI, `pool-state.json`, compte décidé de façon déterministe à chaque appel). Code 0 seulement si l’identifiant exact est listé et qu’une variante complète du catalogue correspond.
2. **Brief** compact (§3 du contrat) : mission, base SHA, branche réservée, sélection, périmètre et fichiers attribués, tests attendus, interdits, prochaine action.
3. **Lancement dédupliqué** : `cursor-agents.mjs launch --select clé` avec la clé de mission et le registre privé hors dépôt. Identifiant d’agent déterministe ; 409 ou appel incertain ⇒ réconciliation, jamais de second agent.
4. **Checkpoints** : `cursor-agents.mjs status --mission K --follow` ; polling progressif, résumé au changement, sélection initiale rappelée, aucun journal complet.
5. **Reprise** : `cursor-agents.mjs followup --mission K --registry f` sur le même agent : lecture de l’agent réel et de son dernier run, terminal exigé, un seul POST sans champ `model`, tentative persistée. Livraison inconnue ⇒ `reconcile --mission K` avant toute réémission (il distingue run d’avant tentative et nouveau run accepté). `followup --agent` sans registre : garde minimale, aucune idempotence.
6. **Réception** compacte (§6 du contrat) écrite par l’agent dans la PR, puis **revue et décision** : revue Cursor indépendante proportionnée au risque, Astra tranche. Une CI verte seule ne suffit pas.

## Comptes (pool commun)

Un compte est attaché à chaque mission ; ses `status`, `reconcile` et `followup` utilisent toujours la clé du propriétaire, même si ce compte est inactif pour la dépense (un autre compte ne voit pas ses agents). Le compte épuisé (signature exacte 429 « usage inclus ») ne change pas la sélection : `launch` relancé choisit le compte premium suivant de l’ordre configuré avec les mêmes modèle et paramètres ; une mission déjà lancée continue par `successor --mission K --checkpoint <SHA poussé>` seulement quand son dernier run est terminal et réconcilié. Repli Grok 4.6 : exception décidée par le pool uniquement si tous les comptes premium sont confirmés indisponibles et qu’une preuve datée d’accès standard réel existe sur ce compte et pour ce modèle (un lancement explicite `--select grok --account id`, jamais `GET /models`), non invalidée par un refus, un `recheck_required` ou un blocage postérieurs — la preuve est toujours exigée, `requireStandardValidation` n’est pas un interrupteur —, jamais Composer ; sinon blocage expliqué (`accounts` montre l’état et la décision à blanc). Un refus de plafond (400 « hard limit » exact) bloque les nouveaux départs sur le compte (`startBlock`) sans rien inférer du solde ni toucher au plafond ; relever la limite à la main puis valider par `launch --account id` ou `followup --mission K --account <propriétaire>`. Aucun daemon, aucune sonde automatique, aucun quota supposé.

## Ressources

- `CONTRACT.md` — contrat complet : sélection, brief, lancement, checkpoints, réception, revue, adoption. À lire avant de rédiger un brief ou une réception.
- `cursor-model.json` — sélections autorisées (`fable` par défaut, `opus`, `grok`) avec leur combinaison complète de paramètres relevée dans le catalogue authentifié (`fast`/`cyber` à `false` là où le modèle les expose), aucun repli. Modifié seulement par le kit, après relevé du catalogue.
- `scripts/cursor-agents.mjs` — `preflight`, `launch`, `reconcile`, `status`, `followup`, `successor`, `accounts`. Sorties JSON sans secret ; codes 0 ok, 2 bloqué, 3 indisponible ou incertain, 4 usage. Le pool de comptes passe par l’adaptateur `scripts/cursor-account-pool.mjs`, distribué avec la compétence à côté de ce script (ou `CURSOR_ACCOUNT_POOL_MODULE`) ; sans lui, `CURSOR_API_KEY` reste la seule voie. Coffre : `credentials.json` avec des sorties `ConvertFrom-SecureString` (DPAPI CurrentUser, hexadécimal), déchiffrées par PowerShell via l’entrée standard, jamais réécrites.
- Adoption dans une application existante, depuis un checkout du kit (l’application ne contient pas `bin/lite.mjs`) : `node <checkout-kit>/bin/lite.mjs adopt --app <dossier>` (inspection), puis `--apply`. Conflit local ou lien symbolique sur un chemin géré ⇒ refus, aucune écriture.
