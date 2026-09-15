# AGENTS — `docker/host-agent`

## Mission

Image de l'agent hôte flotte (VPS restaurant). Le code vit dans
`@creezio/fleet` (`packages/fleet/src/host-agent.ts`, `agent-updates.ts` —
wrappers fleet-collector retirés en 0.19.0) — ce dossier ne contient que le
`Dockerfile`.

## Ne pas faire

- Ajouter des dépendances npm : le fleet-collector est du Node pur.
- Exposer l'agent hors loopback/bridge sans l'ingress tunnel
  (`agent.{slug}.{zone}`) — le token d'agent est le seul rempart.
- Implémenter un push admin → agent : les updates sont en **pull**
  (gate `scripts/test-phase-fleet-releases.mjs`).

## Pièges connus

- Le code de l'agent est **embarqué au build de l'image** : après toute
  modif de `packages/fleet/src`, `npm run build:packages` puis re-runner
  `creezio server-docker agent up` (rebuild + recreate), sinon le container
  continue de servir l'ancien code.
- T7 : l'ingress `agent.{slug}.{zone}` vit sur un tunnel **dédié**
  (container frère `creezio-agent-tunnel`, provisionné par `enroll` /
  `agent up`). Token connecteur : `docker-data/agent-tunnel.env` (600)
  uniquement. `agent rm` est le seul geste qui retire ces ressources.

## Tests / gates

```bash
cd /opt/docker/creezio
node --test scripts/test-phase-fleet-agent.mjs
node --test scripts/test-phase-fleet-releases.mjs
node --test scripts/test-phase-fleet-heartbeat.mjs
node --test scripts/test-phase-agent-tunnel.mjs
```

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- [../../packages/observability/AGENTS.md](../../packages/observability/AGENTS.md)
