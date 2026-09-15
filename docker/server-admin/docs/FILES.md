# docker/server-admin — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs docker/server-admin` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## Racine

| Fichier | Rôle |
|---|---|
| [`Dockerfile`](../Dockerfile) | Image admin web multi-serveurs (backend flotte) — sert `@creezio/fleet` (`dist/bin/server-admin-main.js`, Node pur, zéro dépendance npm runtime). |
| [`configure-admin-npm.sh`](../configure-admin-npm.sh) | REFUS (exit 1). L'admin publique est le tunnel in-process de l'app OS (`CREEZIO_DOMAIN` + `EXTRA_HOSTNAMES`), pas NPM. |
