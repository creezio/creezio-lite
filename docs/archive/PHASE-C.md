# Phase C — Tooling publish générique + Console ops (livré)

## Objectif

1. **C1** — Porter le tooling publish / remote-build / after-pack / build-status
   depuis TempoFlow2 **v0.10.26** vers `@creezio/desktop-tooling`, paramétré
   par `AppManifest` (plus aucune marque hardcodée dans les scripts kit).
2. **C2** — Livrer une **console de pilotage** (`apps/console`) pour le parc
   TempoFlow / Certivan / Fidu : feeds Client+Serveur, versions, téléchargements,
   statut build, wrappers remote-build (dry-run par défaut).

Sans brancher les apps marques (Phase G) et sans modifier Fidu / Certivan / tempoflow2.

## Inventaire C1 — `@creezio/desktop-tooling`

| Module / script | Source TF2 0.10.26 | Notes |
|-----------------|-------------------|-------|
| `scripts/publish-desktop.sh` | `publish-desktop.sh` | `--brand` / `--kind` / `--dry-run` ; DL docker ou host |
| `scripts/remote-build-win.sh` | `remote-build-win.sh` | sync SSH, build win, pull, `--publish`, `--dry-run`, `--client-only` |
| `scripts/after-pack.cjs` | `after-pack.cjs` | déjà brand-agnostic (lit `app-kind.json`) |
| `src/desktop-build-status.ts` + CLI | `desktop-build-status.mjs` | hook JSON + feed client/serveur + process |
| `src/fetch-feed.ts` | (nouveau, pour console) | `latest.yml` HTTP multi-marque |
| `src/resolve-publish-config.ts` | — | pont bash ↔ `AppManifest.publish` |
| `scripts/resolve-config.mjs` | — | JSON / `--export-shell` |

### Extension `AppManifest.publish` (`@creezio/brand-config`)

Chaque marque expose désormais :

| Champ | Exemple TempoFlow | Exemple Certivan | Exemple Fidu |
|-------|-------------------|------------------|--------------|
| `dockerDlName` | `dl-tempoflow` | `dl-certivan` | `dl-fidu` |
| `hostDlDirDefault` | volume npm_data… | … | … |
| `remoteBuildHost` | `deploy@<vps-build>` | idem | idem |
| `remoteBuildRoot` | `/opt/docker/tempoflow2-build` | `…/certivan-build` | `…/fidu-build` |
| `statusFile` | `/tmp/tempoflow-build-status.json` | … | … |
| `buildServerArtifact` | `true` | `true` | `true` (G2) |
| `legacyClientAlias` | — | `Certivan-Setup-0.1.0.exe` | — |
| `defaultAppRoot` | `/opt/docker/creezio-kit-src/crm` | `/opt/docker/certivan-app/crm` | `/opt/docker/fidu/crm` |

Helpers ajoutés : `resolveArtifactFileName`, `resolveLatestAlias`, `latestYmlUrl`,
`feedBaseUrl`, `appKindEnvKey`, `serverPlatformEnvKey`, `distDirForKind`.

### URLs feed (source de vérité manifests)

| Marque | Client `latest.yml` | Serveur `latest.yml` |
|--------|---------------------|----------------------|
| TempoFlow | `https://crm.tempoflow.fr/dl-e660352fb04dbd5e2519f0e60897c548/latest.yml` | `…/server/latest.yml` |
| Certivan | `https://certivan.creez.io/dl-3c94d486b0efa7618fad5bdfff410c49/latest.yml` | `…/server/latest.yml` |
| Fidu | `https://fidu.creez.io/dl-e660352fb04dbd5e2519f0e60897c548/latest.yml` | `…/server/latest.yml` (**404** aujourd’hui = cible) |

### Scripts npm (racine kit)

```bash
npm run desktop:resolve-config -- --brand=tempoflow --kind=client --pretty
npm run desktop:build-status -- --brand=fidu
npm run desktop:publish -- --brand=certivan --kind=client --dry-run
npm run desktop:remote-build -- --brand=tempoflow --dry-run
```

Consommation depuis une app marque (Phase G) :

```json
{
  "scripts": {
    "electron:publish": "CREEZIO_BRAND=fidu bash node_modules/@creezio/desktop-tooling/scripts/publish-desktop.sh",
    "electron:remote-build": "CREEZIO_BRAND=fidu bash node_modules/@creezio/desktop-tooling/scripts/remote-build-win.sh",
    "electron:build-status": "CREEZIO_BRAND=fidu node node_modules/@creezio/desktop-tooling/scripts/desktop-build-status.mjs"
  }
}
```

`electron-builder.yml` :

```yaml
afterPack: node_modules/@creezio/desktop-tooling/scripts/after-pack.cjs
```

## Inventaire C2 — `@creezio/console`

App Next.js 15 (`apps/console`) — **ops**, pas CRM.

| Capacité | Implémentation |
|----------|----------------|
| Liste marques | TempoFlow, Certivan, Fidu |
| Artefacts Client + Serveur | cartes par feed |
| Versions live | `fetchBrandFeeds` → `latest.yml` |
| Liens DL | exe + `latest.yml` |
| Statut build | `collectDesktopBuildStatus` (fichier JSON si présent) |
| Remote-build | `POST /api/remote-build` — **dry-run par défaut** |
| Build réel via API | refusé sauf `CREEZIO_CONSOLE_ALLOW_BUILD=1` |

### Lancer la console

```bash
cd /opt/docker/creezio
npm install
npm run build
npm run console:dev    # http://127.0.0.1:3080
```

Voir aussi `apps/console/README.md`.

API :

- `GET /api/feeds`
- `GET /api/status?brand=fidu`
- `POST /api/remote-build` `{ "brandId":"certivan", "dryRun": true }`

## Vérification

```bash
cd /opt/docker/creezio
npm run build
npm test
```

Tests Phase C : `scripts/test-phase-c.mjs` (manifests publish, resolve-config,
scripts exécutables, feeds HTTP live, présence console).

## Contraintes respectées

1. Aucune modification de `/opt/docker/fidu`, `/opt/docker/certivan-app`, ni
   tempoflow2 GitHub.
2. Push uniquement `creezio/creezio`.
3. Lecture seule des feeds en premier ; triggers remote-build via wrappers
   implémentés (dry-run UI ; CLI documentée pour le réel).
4. Fidu serveur = **cible** affichée même si feed 404.

## Hors scope Phase C

- Branchement des apps sur le kit (Phase G)
- Factory `new-app` (Phase D)
- Publish npm registry des packages `@creezio/*`

## Suite — Phase D (Factory new-app)

Livré : voir [PHASE-D.md](PHASE-D.md) — `creezio new-app`, sandbox
`apps/demobrand`, tests `test-phase-d.mjs`.
