# ADR — H7 : neutralisation des contrats au vocabulaire marque (P1.c)

Statut : accepté (P1.c). Bump `ARCHITECTURE_VERSION` H6 → **H7**
(`packages/platform-core/src/architecture-version.ts`) — premier bump exerçant
la chaîne codemods (`scripts/codemods/H7/`).

## Contexte

L'audit P1.a a inventorié 686 occurrences de vocabulaire marque
(TempoFlow/Certivan/Fidu/Winhub/TF2/TF3/chr-catalog) dans `packages/*/src|ui`,
ratchetées par la gate `test-phase-no-brand-vocab`. Plusieurs **contrats
publics** du kit énuméraient des marques ou des valeurs verticales : clés
Meili câblées (`produits`/`sites`/`fournisseurs`), env bridge Hermes
`TEMPOFLOW_*`, types `vertical`/`feedPreset` fermés, fallbacks env
`CERTIVAN_/FIDU_FLEET_STATE_DIR`, union de canaux `brand-pr-<marque>` avec
chemins absolus.

## Décision

1. **Meili (`@creezio/search`)** — clés de contrat libres :
   `countTables`/`CatalogSqlCounts` deviennent `Record<string, …>`, chaque
   index déclare son `countKey`. Le preset catalogue CHR sort du runtime kit :
   la factory l'inline dans le code marque via un **registre de presets**
   (`@creezio/factory` `generators/meili-feed-presets.ts`).
2. **Hermes (`@creezio/host-runtime`)** — l'env bridge est dérivé du manifest
   via `envKey` (`platform-core/env-brand.ts`) ; plus de noms `TEMPOFLOW_*`
   câblés dans le flux nominal.
3. **brand-spec** — `vertical?: string` (champ libre) et
   `feedPreset?: string` (id du registre factory, `none`/`custom` réservés).
   La factory PEUT connaître `chr` (générateur legacy TF3 assumé,
   `isChrModel`), le contrat OS ne l'énumère plus.
4. **observability** — `resolveFleetStateDir` lit `CREEZIO_FLEET_STATE_DIR`
   puis **tout** `${envPrefix}_FLEET_STATE_DIR` posé par le host (dérivé du
   manifest) — plus aucun préfixe marque câblé.
5. **propagation** — canaux data-driven : `UpdateChannelId = string`,
   canaux marque `brand-pr-<brandId>` dérivés d'une config
   (`configureBrandChannels`, défaut : registre de `brand-surfaces.ts`) ;
   plus de noms de marque ni de chemins absolus dans `channels.ts`.

## Politique de dépréciation (une version)

Aucune marque existante ne casse sans chemin de migration :

- alias dépréciés conservés **une version** :
  `createChrCatalogMeiliFeed`, `expectedMeiliCounts`, `countGedSql`,
  `clearTempoflowGeneratedWebuiPassword`, `UPDATE_CHANNELS` (snapshot) ;
- **dual-read** avec warning bruyant : env bridge `TEMPOFLOW_*`,
  `TF2_HERMES_REMOTE_KEY`, fichiers `~/.tempoflow-api-server-key` et
  variantes, valeur `feedPreset: <vertical>-catalog` (normalisée par la
  factory), clé de comptage `sites` (normalisée `fournisseurs` dans le
  fingerprint) ;
- retrait planifié au **prochain bump** d'architecture.

## Migration marque

`scripts/codemods/H7/h7-neutralize-brand-contracts.mjs` (idempotent,
`ROOT=<clone marque> node …`) : réécrit `feedPreset`, libère l'enum
`vertical` du schema d'interview, remplace les alias dépréciés et les env
bridge legacy par l'env dérivé du manifest. Gate d'accompagnement :
`test-phase-arch-codemod`.

## Comportements inchangés

Meili reste fail-closed (`MeiliRequiredError`, 503 `meili_unavailable`) —
aucun changement de sémantique, uniquement des clés de contrat génériques.
