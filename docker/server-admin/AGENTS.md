# AGENTS — `docker/server-admin`

## Mission

Image de l'admin web multi-serveurs (backend flotte). Le code vit dans
`@creezio/fleet` (`packages/fleet/src/server-admin.ts` + `docker.ts`,
`registry-pull-proxy.ts`, `server-lib.ts` — les wrappers fleet-collector ont
été retirés en 0.19.0) — ce dossier contient le `Dockerfile`.
`configure-admin-npm.sh` refuse (exit 1) : plus de NPM.

## Ne pas faire

- Ajouter des dépendances npm (Node pur, même esprit que le fleet-collector).
- Toucher `server.mjs` (fleet-collector prod) pour un besoin admin : le point
  d'entrée admin est séparé (`packages/fleet/dist/bin/server-admin-main.js`).
- Binder hors `127.0.0.1` par défaut : le socket Docker monté équivaut à root
  sur l'hôte. Le backend flotte reste loopback. Le public `admin.` / `lp.`
  est le tunnel in-process de l'app OS — jamais NPM.
- Autoriser une méthode push sur le proxy registre `/v2/*` (pull-only, F4 —
  gate `scripts/test-phase-registry-pull-proxy.mjs`).

## Piège connu

Le code est **embarqué au build de l'image** : après toute modif de
`packages/fleet/src`, `npm run build:packages` puis re-runner
`creezio server-docker admin up` (rebuild + recreate), sinon l'admin
continue de servir l'ancien code.

## Tests / gates

```bash
cd /opt/docker/creezio
node --test scripts/test-phase-registry-pull-proxy.mjs
node --test scripts/test-phase-fleet-releases.mjs
node packages/observability/fleet-collector/test-server-admin.mjs  # dist fleet requis
```

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
- [../../packages/observability/AGENTS.md](../../packages/observability/AGENTS.md)
