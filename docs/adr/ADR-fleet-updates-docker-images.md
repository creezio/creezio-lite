# ADR — Updates de flotte par images Docker (jamais git-pull)

**Statut** : accepté (2026-08, chantiers F4-F6). **Câblé en prod** :
flotte TempoFlow3 (VPS 104.168.10.36 + hôtes enrôlés).

## Décision

Les serveurs marque déployés chez les clients sont mis à jour **par images
Docker versionnées** tirées d'un registre (`publish` → registre privé →
pull par les agents hôtes), jamais par `git pull` + rebuild sur le VPS
client.

## Contexte

Deux mécanismes candidats pour propager une nouvelle version du serveur
marque sur une flotte de VPS :

1. `git pull` du repo marque sur chaque hôte + `npm ci` + build + restart ;
2. build **une fois** sur le VPS opérateur (`creezio server-docker
   publish`), push d'une image taguée, pull + recreate côté hôtes.

## Justification

- **Atomicité + rollback** : une image est un artefact figé (tag + digest).
  L'update = backup `/data` → recreate → healthcheck → **rollback
  automatique** vers l'image précédente si KO (`server-lib.mjs
  updateServer`). Un git-pull raté laisse un arbre hybride sans retour
  arrière fiable.
- **Pas de toolchain client** : les VPS clients n'ont besoin ni de git, ni
  de Node/npm hôte, ni des secrets GitHub (repos marque privés). Surface
  d'attaque et de panne minimale : Docker + l'agent.
- **Build coûteux centralisé** : build UI Next + tsc + binaires fat (Meili,
  cloudflared) faits une fois côté opérateur — un rebuild par hôte (RAM
  limitée, OOM vécus à 2 Go) est non viable.
- **Version = fait observable** : `GET /api/v1/core/version` reflète le tag
  (`CREEZIO_APP_VERSION`), les rapports d'update et la comparaison « à
  jour » sont digest-aware (`fleetImageMatchesTarget`).
- **Rollout pilotable** : canary/vagues/pin/hold/kill-switch (F6)
  présupposent des artefacts identiques au bit près — impossible à
  garantir avec N builds locaux.

## Conséquences

- Distribution : registre privé loopback (`127.0.0.1:5000`) pour le push ;
  les hôtes distants pullent via le proxy **pull-only** `registry.{zone}`
  (F4, auth Basic `hostId:agentToken` — push distant → 405).
- Les updates arrivent en **pull** (F5) : agents hôtes → `fleet-releases`
  de l'app admin ; le push manuel admin (202 + update-status) reste le
  geste unitaire.
- Le clone git du repo marque reste le canal **développeur/opérateur**
  (VPS de build, clone autonome) — pas le canal de mise à jour des clients.
- Rétention disque nécessaire côté opérateur ET registre (2 tags par repo,
  GC — skill fleet-ops §10).

## Liens

- Skill [creezio-fleet-ops](../../.cursor/skills/creezio-fleet-ops/SKILL.md)
  §4 (publish/update), §4b (releases pull, kill-switch)
- `packages/admin/src/fleet-releases.ts` · `packages/observability/fleet-collector/agent-updates.mjs` · `registry-pull-proxy.mjs`
- Accès distant / partition des plans : [../../docker/server/REMOTE-ACCESS.md](../../docker/server/REMOTE-ACCESS.md)
