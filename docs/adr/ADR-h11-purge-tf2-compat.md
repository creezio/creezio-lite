# ADR — H11 : purge de la compat TF2-era

Statut : accepté. Bump `ARCHITECTURE_VERSION` H10 → **H11**
(`packages/platform-core/src/architecture-version.ts`) — codemods
`scripts/codemods/H11/`.

## Contexte

H7 a neutralisé les contrats au vocabulaire marque en **conservant une
version** de dual-reads / alias (`TEMPOFLOW_*`, `createChrCatalogMeiliFeed`,
`clearTempoflowGeneratedWebuiPassword`, alias `sites` → `fournisseurs`).
H8 a extrait les manifests prod du kit en les **dépréciant une version**
(`tempoflow` / `certivan` / `fidu`). H10 a retiré la compat desktop
legacy. Ces filets TF2-era n'ont plus de consommateur moderne : les
marques générées passent par `envKey` / `app-manifest.json` / feed
inliné / `preload.js`.

## Décision

Supprimer (pas déprécier) la compat TF2-era du kit :

1. **Env** — plus aucun dual-read `TEMPOFLOW_*`. Seules les clés
   `${envPrefix}_*` dérivées du manifest restent. Le catalogue Hermes
   verrouille les clés génériques (`CRM_*`, `PLUGINS_*`) + le préfixe
   marque injecté, jamais `TEMPOFLOW_*` en dur.
2. **Registre brand-config** — `tempoflow.ts` / `certivan.ts` / `fidu.ts`
   et leurs exports / entrées de registre sont **supprimés**. `demobrand`
   (sandbox kit) reste. `resolveManifest` lit le JSON marque hors
   registre. `createAppManifest` refuse toujours ces `brandId` réservés.
3. **`@creezio/search`** — `createChrCatalogMeiliFeed` retiré (le feed
   CHR est inliné par la factory depuis H7). `fingerprintCountKey` est
   l'identité de la clé déclarée : plus d'alias `sites` → `fournisseurs`.
4. **`@creezio/host-runtime`** — alias
   `clearTempoflowGeneratedWebuiPassword` retiré ;
   `AiWorkspaceManager` n'accepte plus `preload-app.js` : `preload.js`
   obligatoire, échec explicite si absent. Dual-reads fichiers / env
   Hermes (`~/.tempoflow-api-server-key`, `TF2_HERMES_REMOTE_KEY`)
   retirés. `legacyEnvAliases` retiré des bindings plugins.
5. **Factory** — `build-builder-config.mjs` généré ne retombe plus sur
   le registre kit : `src/electron/app-manifest.json` est obligatoire.

Aucune env de bypass, aucun fallback « au cas où ».

## Migration marque

`scripts/codemods/H11/h11-purge-tf2-compat.mjs` (idempotent,
`ROOT=<clone marque> node …`, `since: 0.23.0`) : réécrit les
`TEMPOFLOW_*` vers `${envPrefix}_*`, les alias restants, `countKey:
"sites"`, et retire le fallback registre des
`build-builder-config.mjs`. Fail-closed si un appel runtime
`createChrCatalogMeiliFeed` ou un import `*Manifest` prod reste — la
marque est intacte. Appliqué par `creezio upgrade`.

## Comportements inchangés

Meili reste fail-closed. Les helpers `envKey` / `productHubTokensFromManifest`
/ `resolveManifest` ne changent pas de contrat — seul le contenu marque
et les filets TF2 disparaissent.
