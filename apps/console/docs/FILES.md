# apps/console — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs apps/console` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## Racine

| Fichier | Rôle |
|---|---|
| [`next.config.ts`](../next.config.ts) | Configuration Next : transpilation de packages workspace et limite server actions. |

## `src/app/`

| Fichier | Rôle |
|---|---|
| [`src/app/layout.tsx`](../src/app/layout.tsx) | Layout racine en français, métadonnées et chargement des fontes. |
| [`src/app/page.tsx`](../src/app/page.tsx) | Page serveur dynamique : charge les snapshots parc, kit, registry, factory et observabilité puis compose les panneaux. |

## `src/app/api/automations/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/automations/route.ts`](../src/app/api/automations/route.ts) | `GET/POST /api/automations` : lit règles/runs ou dispatch un trigger V3. |

## `src/app/api/feeds/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/feeds/route.ts`](../src/app/api/feeds/route.ts) | `GET /api/feeds` : retourne les feeds de marques via `fetchAllBrandFeeds()`. |

## `src/app/api/kit-versions/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/kit-versions/route.ts`](../src/app/api/kit-versions/route.ts) | `GET /api/kit-versions` : expose inventaire kit, version architecture, packages, gates et liens docs. |

## `src/app/api/observability/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/observability/route.ts`](../src/app/api/observability/route.ts) | `GET/POST /api/observability` : lit ou enregistre des événements V2 dans SQLite. |

## `src/app/api/org-plugins/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/org-plugins/route.ts`](../src/app/api/org-plugins/route.ts) | `GET/POST /api/org-plugins` : registre plugins org L3, actions `upsert` et promotions. |

## `src/app/api/plugin-factory/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/plugin-factory/route.ts`](../src/app/api/plugin-factory/route.ts) | `GET/POST /api/plugin-factory` : liste ou lance une session de fabrique plugins V1 persistée. |

## `src/app/api/remote-build/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/remote-build/route.ts`](../src/app/api/remote-build/route.ts) | `POST /api/remote-build` : valide la marque, résout le script `remote-build-win.sh` et exécute un dry-run par défaut. |

## `src/app/api/status/`

| Fichier | Rôle |
|---|---|
| [`src/app/api/status/route.ts`](../src/app/api/status/route.ts) | `GET /api/status` : collecte le statut build pour une marque ou toutes les marques, option `remote=1`. |

## `src/components/`

| Fichier | Rôle |
|---|---|
| [`src/components/ArtifactCard.tsx`](../src/components/ArtifactCard.tsx) | Rendu d'un artefact feed (`latest.yml`, version, taille, téléchargement). |
| [`src/components/BrandCard.tsx`](../src/components/BrandCard.tsx) | Carte marque : feeds Client/Serveur, statut build et bouton remote-build. |
| [`src/components/GatesPanel.tsx`](../src/components/GatesPanel.tsx) | Liens docs de propagation et ordre des gates G1/G2/G3. |
| [`src/components/KitVersionsPanel.tsx`](../src/components/KitVersionsPanel.tsx) | Table des packages kit, versions, couches, hints de publication et architecture. |
| [`src/components/ObservabilityPanel.tsx`](../src/components/ObservabilityPanel.tsx) | Agrégats V2 par org/plugin et derniers événements. |
| [`src/components/OrgPluginsPanel.tsx`](../src/components/OrgPluginsPanel.tsx) | Table du registre plugins org L3. |
| [`src/components/PluginFactoryPanel.tsx`](../src/components/PluginFactoryPanel.tsx) | Résumé des sessions V1 et chemin de persistance. |
| [`src/components/RemoteBuildButton.tsx`](../src/components/RemoteBuildButton.tsx) | Composant client qui appelle `/api/remote-build` en `dryRun:true` et affiche stdout/stderr. |

## `src/lib/`

| Fichier | Rôle |
|---|---|
| [`src/lib/automations-console.ts`](../src/lib/automations-console.ts) | Moteur automations SQLite console, règles DemoBrand par défaut et émission vers observabilité. |
| [`src/lib/kit.ts`](../src/lib/kit.ts) | Résout la racine kit, collecte l'inventaire `@creezio/*`, lit `ARCHITECTURE_VERSION` et expose les gates/docs. |
| [`src/lib/observability-console.ts`](../src/lib/observability-console.ts) | Store observabilité SQLite console, chemin override par `CREEZIO_OBS_CONSOLE_DB`. |
| [`src/lib/org-plugin-registry.ts`](../src/lib/org-plugin-registry.ts) | Registre JSON de plugins organisation (`var/org-plugin-registry.json` par défaut). |
| [`src/lib/parc.ts`](../src/lib/parc.ts) | Agrège manifests, labels, feeds et statuts build. Les sandboxes reçoivent un feed vide explicite. |
| [`src/lib/plugin-factory-demo.ts`](../src/lib/plugin-factory-demo.ts) | Fabrique plugins V1 console : Product Hub SQLite, scaffold FS, PRD déterministe/LLM optionnel. |
