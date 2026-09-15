# ADR — H13 : résidu allowlist runtime (env, heuristique, UI)

Statut : accepté. Bump `ARCHITECTURE_VERSION` H12 → **H13**
(`packages/platform-core/src/architecture-version.ts`) — codemods
`scripts/codemods/H13/`. Changeset **minor** (convention 0.x du kit :
H10, H11 et H12 sont parties en minor, pas en major). Lockstep cible
`since: 0.26.0`.

## Contexte

H11 a retiré les dual-reads env première marque (`TEMPOFLOW_*`). H12 a
purgué les shims electron-shell et le workspace shell-ui. Après #201
(allowlist 270 → 117 / 493 → 173) il restait dans `packages/*/src|ui` :

- un dual-read crash env `TF2_*` / `CERTIVAN_*` / `FIDU_*` /
  `TEMPOFLOW3_*` dans `shell-ui` `reportServerIncident` ;
- une heuristique packagée `base.includes("tempoflow")` dans
  `envForNodeScriptSpawn` ;
- des commentaires / warnings scaffold `dl-tempoflow` / `dl-certivan` ;
- des classes / ids UI kit `tf2-fake-cursor`, `tf2-shell-*`,
  `.tempoflow-titlebar-*` (les défauts `configureShellUiBrand` étaient
  déjà `creezio-titlebar-*` — le CSS kit ne matchait plus).

## Décision

Purger ces résidus **sans** alias de compat, **sans** nouveau fichier
de compat, **sans** kill-switch env.

1. **Crash env** — plus aucun nom de première marque en dur. SoT =
   `CREEZIO_CRASH_ENDPOINT` / `CREEZIO_INSTALL_ID` / `CREEZIO_APP_VERSION`
   puis scan `*_CRASH_ENDPOINT` / `*_INSTALL_ID` (clé canonique
   `envKey(manifest, suffix)`). Si une marque pose encore l'ancien nom
   dans son `.env`, c'est son contrat, pas le kit.
2. **Heuristique packagée** — `looksElectron` ne teste plus un nom de
   marque. Restent `same` / `electron` / `creezio` / suffixe `-server`.
3. **UI** — ids / classes / caches SW kit → `creezio-fake-cursor`,
   `creezio-titlebar-*`, `creezio-shell-*`. Codemod
   `h13-ui-debrand.mjs` réécrit les occurrences marque.
4. **Scaffold** — le README généré ne cite plus de vhost `dl-<marque>`
   en dur : ne pas recycler un feed déjà en flotte.

## Conservé (volontaire)

Ces occurrences restent allowlistées — ce n'est pas de la dette à
« corriger » dans H13 :

| Résidu | Pourquoi |
|---|---|
| `createAppManifest` refuse `tempoflow` / `certivan` / `fidu` | IDs prod réservés, pas un dual-read |
| `safeBrandId("tempoflow")` → `tempoflow3` | garde factory, fixture `--from-prd` |
| Préfixes filaires `TF2EVENT` / `CertivanEVENT` / `tf2_live_` | contrat déjà déployé (IPC / clés API) |
| Fixture `docs/experiences/tempoflow3` | brief `--from-prd` legacy |
| `tempoflow-npm` (npm-cli + mkdir cache) | chemin disque déjà déployé — dual-read `${brandId}-npm` / `desktop-npm` **déjà en place** ; retrait du littéral au **H14** |
| `.tempoflow-plugin-api-key.json` (`PLUGIN_CRM_KEY_FILE`) | nom fichier déjà déployé ; le runtime dérive `.${brandId}-plugin-api-key.json` et **dual-lit** le nom historique en H13 — retrait du littéral au **H14** |

Dériver `tempoflow-npm` depuis `brandId` casserait les installs
`tempoflow3` (`tempoflow3-npm` ≠ `tempoflow-npm`). D'où le dual-read
H13 plutôt qu'un rename immédiat.

## Migration marque

`scripts/codemods/H13/h13-ui-debrand.mjs` (idempotent,
`ROOT=<clone marque> node …`, `since: 0.26.0`) : réécrit les classes
titlebar, l'id du faux curseur, le global `__tfFakeCursor`, et le
préfixe de cache SW. Appliqué par `creezio upgrade`.

Les env crash `${envPrefix}_CRASH_ENDPOINT` (déjà H11) ne changent pas.
Un `.env` qui n'a que `TF2_CRASH_ENDPOINT` / `TEMPOFLOW3_*` n'est plus
un contrat kit — poser `CREEZIO_CRASH_ENDPOINT` ou la clé `envKey`.

## Comportements inchangés

Meili reste fail-closed. Les helpers `envKey` / `configureCrashReporter`
/ `configureShellUiBrand` ne changent pas de contrat — seuls les filets
nommés marque et les sélecteurs UI disparaissent.
