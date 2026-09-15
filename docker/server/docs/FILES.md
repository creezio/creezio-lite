# docker/server — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs docker/server` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## Racine

| Fichier | Rôle |
|---|---|
| [`Dockerfile`](../Dockerfile) | Image serveur marque headless générique (context = racine marque) : Meili + UI Next embarqués, cloudflared, CMD harness `startBrandKernelHarness`. |
| [`brand.dockerignore`](../brand.dockerignore) | Template ignore v2, posé/rafraîchi en `.dockerignore` côté marque. |
| [`creezio-open-url.sh`](../creezio-open-url.sh) | Opener navigateur robuste (firefox/gio/xdg-open…) installé dans `~/bin/` — utilisé par les raccourcis `{Product}-Server-{N}.desktop`. |
| [`creezio-server-docker-sudo.sh`](../creezio-server-docker-sudo.sh) | (à documenter) |
| [`docker-compose.yml`](../docker-compose.yml) | Legacy compose `server-1` + `server-2` (bind 127.0.0.1) — la voie nominale est le registre `creezio server-docker create`. |
| [`ensure-server-lock.mjs`](../ensure-server-lock.mjs) | (à documenter) |
