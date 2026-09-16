# Réception O01 — Standard d’orchestration Astra ⇄ Cursor Fable 5.1

Mission : docs/missions/O01-cursor-orchestration-standard.md. Base `2e3ee4bf59ba7f0d41fbb9f40526cdf91cdd860e` (v0.11.0), branche `agents/O01-cursor-orchestration-standard`, PR #19. Agent de réalisation : Cursor Cloud Agent `bc-97d59615-dc27-4977-a753-6a47d5ec8638` (https://cursor.com/agents/bc-97d59615-dc27-4977-a753-6a47d5ec8638), run créé par l’API (`source: api`), modèle effectif relevé par `cursor-cloud run-info` : `originalModelName = claude-fable-5-1-thinking-high` (l’outil ne renvoie pas l’identifiant du run). Aucune fusion, release, déploiement, autre agent ni appel payant.

## Inventaire préalable

Points d’entrée susceptibles de contredire le standard, relevés avant modification : `.cursor/rules/mission-handoff.mdc` (règle du kit, sans référence à une source commune) ; `template/AGENTS.md` (aucune consigne d’orchestration) ; `docs/MAINTENANCE.md` (routine du responsable et réception, sans rôle de réalisation défini) ; `template/.gitignore` (`/.codex/`, `/.agents/`) et `template/vite.config.ts` (`CODEX_SANDBOX`) — vestiges d’un environnement de prévisualisation local, sans effet sur le standard et laissés tels quels pour ne pas modifier le comportement des applications ; `runtime/core/agent-providers/*` (transport métier D03, non modifié). Les PR 16 et 17 étaient intégrées ; aucun run à reprendre.

## Livrables

| Fichier | Rôle |
|---|---|
| `.cursor/skills/lite-orchestration/SKILL.md` | Source canonique : compétence à chargement progressif (frontmatter `name`/`description`, rôles, flux de mission, ressources conditionnelles). |
| `.cursor/skills/lite-orchestration/CONTRACT.md` | Contrat compact : rôles et limites, modèle épinglé et preuve, brief, lancement/déduplication/réconciliation, checkpoints, réception, revue, adoption. |
| `.cursor/skills/lite-orchestration/cursor-model.json` | Modèle épinglé (`modelId`, `params`, `effectiveModelName`, `matching: exact-id`, `fallback: none`). |
| `.cursor/skills/lite-orchestration/scripts/cursor-agents.mjs` | `preflight`, `launch`, `reconcile`, `status`, `followup` ; imports `node:` uniquement ; clé lue dans `CURSOR_API_KEY` seulement ; sorties JSON sans clé, prompt ni corps fournisseur ; codes 0/2/3/4. |
| `template/.cursor/rules/lite-orchestration.mdc` | Règle des applications, renvoie à la compétence. |
| `bin/lite.mjs` | `create` installe la copie gérée et `manifest.json` (formatVersion 1, propriétaire `creezio-lite`, version du kit, empreintes) ; `adopt --app [--apply]` ; `doctor.orchestration` informatif. |
| `scripts/check-kit.mjs` | Vérifie la source unique : frontmatter, fichiers non vides, aucune donnée privée ni identifiant de tâche. |
| `tests/orchestration.test.mjs` | 10 tests (détail ci-dessous). `tests/factory.test.mjs` copie `.cursor` avec le kit de fixture. |
| Docs et règles | `AGENTS.md`, `template/AGENTS.md`, `START-HERE.md`, `docs/MAINTENANCE.md`, `docs/UPDATES.md` (§0.12.0), `.cursor/rules/mission-handoff.mdc`, `CHANGELOG.md`, `docs/missions/O01-…`. |
| Version 0.12.0 | `package.json`, `package-lock.json`, `template/package.json`, `runtime/core/{api,mcp,mcp-admin}.ts`, tests `factory`, `mcp-oauth`, `release-notifications`. |

Non modifiés : `runtime/core/agent-providers/*`, schéma, migrations, secrets, Sites, `template/.github/workflows/lite-update.yml` (aucun cron créé, aucun schedule retiré), fonctionnalités des applications. Diff `runtime/` limité aux trois chaînes de version.

## Comportements vérifiés (fetch simulé, aucun réseau)

- Préflight : identifiant exact accepté (`matchedBy: id`, variante vide) ; modèle absent ⇒ `blocked/model_absent` avec `candidates` informatifs et un seul appel ; alias seul ⇒ `blocked/alias_only` + `canonicalId` ; variantes sans combinaison vide ⇒ `params_required` ; paramètre inconnu ⇒ `param_unsupported` ; combinaison hors variantes ⇒ `variant_unknown` ; combinaison listée ⇒ `ok`. Jamais de sélection de remplacement.
- Indisponibilité : 401/403 (`auth`), 429 (`quota`, `Retry-After` borné), 503 (`server`), 302 (`redirect`, non suivie), erreur réseau, délai (abort), corps non JSON, schéma inconnu, corps > 2 Mo. Un seul appel dans chaque cas ; marqueurs de corps, clé et `Bearer ` absents des rapports sérialisés et des piles.
- Lancement : préflight bloqué ⇒ aucun POST et aucune entrée de registre ; payload exact (`agentId` déterministe UUID v5 de `dépôt#mission`, `model.id` épinglé, `repos[0].startingRef`, `workOnCurrentBranch`, `autoCreatePR`, sans `envVars`/`mcpServers`) ; mission connue ⇒ `deduplicated` sans appel ; `409 agent_id_conflict` ⇒ lecture de l’existant, un seul POST ; POST perdu + 404 ⇒ `not_created` et relance autorisée ; POST perdu + 503 ⇒ `uncertain`, relance refusée jusqu’à `reconcile` ; identité divergente ⇒ `uncertain`. Prompt jamais présent dans le registre ni les rapports.
- Checkpoints : intervalles 15 → 30 → 60 → 120 → 300 s ; sortie uniquement au changement ; états terminaux ; résultat tronqué à 1 200 caractères ; aucun appel `/stream` ; `--follow` s’arrête au terminal (un seul sommeil dans le test).
- Reprise : `followup` sur le même agent ; `409 agent_busy` remonté sans relance ; envoi incertain ⇒ `uncertain` avec prochaine action.
- CLI : clé absente ⇒ code 4 sans appel ; codes 0/2/3 selon le préflight ; sortie JSON sans clé.
- Générateur : copie gérée identique à l’octet à la source, empreintes du manifeste exactes, `doctor.orchestration = current`, verrou runtime non concerné ; la copie `.cursor` seule (sans le kit) exécute `--help` et un préflight simulé ; frontmatter et règle présents ; `AGENTS.md` généré mentionne le standard.
- Adoption sur fixture existante (générée puis dépouillée de `.cursor`, avec règle métier `metier.mdc` et `AGENTS.md` propres) : inspection sans écriture (`missing`) ; `--apply` écrit 5 fichiers ; second passage `changed:false`, `applied:false` ; règle et `AGENTS.md` locaux intacts ; modification locale de `SKILL.md` ⇒ `conflict`, `--apply` refusé (« Aucune modification effectuée »), fichier et note non gérée préservés, conflit visible dans `doctor` ; manifeste d’une version antérieure ⇒ `outdated`, mise à jour du seul fichier concerné ; manifeste inconnu, kit lui-même et dossier non applicatif refusés.

## Contrôles réellement exécutés (Node 24.21.0, pnpm 11.25.0, `pnpm --dir template install --frozen-lockfile`)

| Commande | Résultat |
|---|---|
| `npm test` (synchronise le template puis `node --test tests/*.test.mjs`) | 121 tests, 0 échec (dont les 10 tests d’orchestration). |
| `npm run check` | `ok:true`, version 0.12.0, 2 exemples, `orchestrationFiles: 5`. |
| `pnpm --dir template run typecheck` | 0 erreur. |
| `pnpm --dir template run build` | « Build complete ». |
| `node scripts/validate-examples.mjs` | Atelier et Réserve générées, installées, typées et compilées. |
| CI GitHub `Lite` | Échec sur `73ee630` (test factory : kit de fixture sans `.cursor`), corrigé ; succès sur `bd07193`. La CI du head final est à relire par l’orchestrateur avant fusion. |

## Limites

- Aucun appel réel à l’API Cursor : aucune `CURSOR_API_KEY` n’est disponible dans l’environnement du run. L’identifiant `claude-fable-5-1-thinking-high` est le nom effectif observé sur ce run créé par l’API ; qu’il soit exactement l’`id` listé par `GET /v1/models` reste à confirmer par le préflight avec la clé autorisée. En cas d’écart, le rapport fournit `canonicalId` ou `candidates` ; l’épinglage se corrige dans `cursor-model.json` par PR, jamais automatiquement.
- L’API publique ne renvoie pas le modèle d’un run ; la preuve du modèle effectif repose sur `run-info.originalModelName` relevé par l’agent et comparé par Astra. Cursor documente un routage automatique vers Claude Opus lorsqu’une requête déclenche ses garde-fous ; ce routage par requête n’est pas observable.
- Aucune adoption réelle d’une application de production n’a été effectuée ; la fixture est une application générée par le kit. Les pilotes appliquent `lite adopt` depuis la version validée et ajoutent eux-mêmes la mention du standard à leur `AGENTS.md`.
- Le registre privé et les fichiers d’état sont fournis par l’orchestrateur hors dépôt ; le script ne l’impose pas techniquement.

## Prochaine action

Astra : exécuter le préflight réel avec la clé autorisée et confirmer ou corriger l’identifiant épinglé ; revue ciblée (droits, secrets, contrat), décision de fusion et publication 0.12.0 selon `docs/MAINTENANCE.md` ; notifier les pilotes pour `lite adopt`. Le contrôle des app owners et des releases reste à l’orchestrateur.
