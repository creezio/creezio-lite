# Phase A — Kit Creezio (livré)

## Objectif

Créer le monorepo `@creezio/*` **à côté** des apps (Fidu, Certivan, TempoFlow), sans les modifier ni republier d'exe.

## Chemin repo

| Item | Valeur |
|------|--------|
| Repo local | `/opt/docker/creezio` |
| Source lecture seule TF2 | `/opt/docker/creezio-kit-src` @ tag `v0.10.26` |
| Ignoré | `/opt/docker/tempoflow2-backup` (0.1.18 obsolète) |

## Packages

| Package | Rôle |
|---------|------|
| `@creezio/brand-config` | `AppManifest` + manifests `tempoflow` / `certivan` / `fidu` (client **et** serveur) |
| `@creezio/shell` | Canaux IPC, types preload, `DesktopBridge` |
| `@creezio/platform-core` | Paths / schema local-config paramétrés par manifest |

## Contraintes respectées

1. Aucune modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`, ni commit/push sur `creezio/tempoflow2`.
2. Multi-exe Client+Serveur = modèle standard dans `AppManifest` (pas optionnel).
3. Fidu : rien à purger ; manifest serveur = cible future (GUID UUID.v5).
4. Les apps ne consomment pas encore le kit (Phase G).

## Vérification

```bash
cd /opt/docker/creezio
npm install
npm run build
```

## Suite — Phase B

Porter le **runtime** Electron (main, preload, launchers, updater, app-kind, build-builder-config) depuis TF2 vers des packages kit, en s'appuyant sur la matrice `docs/PLATFORM-VS-VERTICAL.md`.
