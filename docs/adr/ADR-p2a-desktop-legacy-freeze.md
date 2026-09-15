# ADR P2.a — gel partiel du desktop legacy (pas de package `@creezio/legacy-desktop`)

Statut : accepté (2026-08-29), **clôturé par le retrait H10**
(2026-08-31 — voir « Clôture » en fin). Phase P2.a du plan de correction
d'architecture.

## Contexte

Le plan P2.a partait de la prémisse « deux runtimes desktop coexistent » :
la façade moderne `startBrandDesktop` (`@creezio/app-runtime`) et le
« monolithe legacy » `installBrandDesktopRuntime`
(`electron-shell/src/desktop/brand-desktop-runtime.ts`, ~4 400 lignes,
extrait mécanique de tempoflow2 en M12). L'option privilégiée était
d'isoler le monolithe dans un package `@creezio/legacy-desktop` gelé.

## Cartographie (preuves)

La prémisse est fausse : il n'y a **qu'un seul moteur desktop**, avec deux
points d'entrée.

- `startBrandDesktop` (chemin nominal factory/TF3, shell `runtime` par
  défaut P&P) appelle `installBrandOsDesktop`
  (`app-runtime/src/install-brand-os-desktop.ts`) qui appelle
  `installBrandDesktopRuntime` avec ~40 adaptateurs kit (hosts, paths,
  vertical no-op/kit). Tout boot desktop moderne passe par le monolithe.
- Les clients desktop legacy (repos hors kit, non migrés sur
  `startBrandDesktop`) appellent `installBrandDesktopRuntime` directement
  avec leurs verticaux réels (licence, loopback Google, deep-link join).
- Sur ce VPS, aucun repo marque (`tempoflow3`, `tempoflow-admin`) n'importe
  `installBrandDesktopRuntime` dans ses sources — seuls les `dist` npm du
  kit le contiennent. Le wiring généré par la factory (mode OS,
  `generators/wiring.ts`) ne le référence que par un `void` documentaire.

## Décision

**Gel intégral impossible** : déplacer le moteur dans un package
« explicitement mort » gèlerait le runtime desktop vivant de toutes les
marques modernes ; en extraire « les morceaux partagés » reviendrait à
extraire tout le fichier. **Suppression impossible** : les clients legacy
publiés en dépendent via `@creezio/electron-shell`.

À la place, **gel partiel à périmètre exact** :

1. La compat marque héritée fonctionnelle (défauts d'env legacy TF2,
   query param SiteLink, ordre des preloads historiques, alias
   `ensureTempoflowNode`) est extraite dans le module feuille
   `electron-shell/src/desktop/legacy-brand-compat.ts`.
2. Ce module est **GELÉ** : gate `test-phase-legacy-desktop-frozen`
   (empreinte SHA-256 versionnée dans `scripts/legacy-desktop-frozen.json`) —
   tout diff est rouge ; un fix sécurité met à jour l'empreinte dans le
   même commit, justifié. La gate refuse aussi tout nouveau consommateur
   kit du module (liste `allowedImporters`).
3. `brand-desktop-runtime.ts` est documenté comme **moteur partagé** (pas
   legacy) : les features y entrent via deps génériques, jamais via une
   branche marque.
4. Allowlist vocab F1.7 : compteur du périmètre desktop 33 → 21
   (déplacement pur + suppression de commentaires marque), jamais croissant.

## Pas de bump `ARCHITECTURE_VERSION` / pas de codemod H9 maintenant

Ce gel est kit-only : aucune API publique ne change, aucun geste n'est
requis côté marque (`installBrandDesktopRuntime` garde signature et
comportement). Le codemod H9 futur devra en revanche couvrir le **retrait**
du module gelé : migration des clients legacy vers des deps explicites
(`pluginsDirEnvKey`, `supplierFidQueryParam`, `apiKeyEnvName`,
`ensureDesktopNode`, preload `preload.js`) — voir `docs/BACKLOG.md`.

## Conséquences

- Aucune nouvelle entrée dans l'ordre de build ; pas de nouveau package.
- Toute évolution desktop se fait dans le moteur via deps injectées ; la
  gate rouge sur `legacy-brand-compat.ts` rappelle la politique.
- Les gates historiques pointant `desktop/brand-desktop-runtime.ts`
  (M12…N9, hybrid, desktop-server-parity, crash-reporter) restent valides —
  le fichier n'a pas bougé.

## Clôture (H10, 2026-08-31 — T9)

Le retrait prévu est exécuté au bump `ARCHITECTURE_VERSION` H9 → **H10** :

- `electron-shell/src/desktop/legacy-brand-compat.ts` **supprimé**, ainsi
  que la gate `test-phase-legacy-desktop-frozen` et son empreinte
  `scripts/legacy-desktop-frozen.json` (retirée de la ligne `test` du
  `package.json` racine).
- Le moteur `brand-desktop-runtime.ts` applique désormais les défauts
  génériques inline : `<PREFIX>_PLUGINS_DIR`, `<brandId>fid`,
  `<PREFIX>_API_KEY`, preload unique `preload.js` (vue CRM + fenêtre
  admin), contrat host `ensureDesktopNode` sans alias. Aucune branche
  marque ne subsiste.
- Les clients desktop legacy (repos hors kit appelant
  `installBrandDesktopRuntime` directement) migrent via le codemod
  `scripts/codemods/H10/h10-explicit-desktop-deps.mjs` (deps explicites
  aux valeurs historiques, renommage `ensureTempoflowNode` →
  `ensureDesktopNode`, rebascule `preload-app.js` → `preload.js`),
  appliqué par `creezio upgrade` — idempotent, fail-closed sur divergence
  non prouvable.
- L'allowlist vocab F1.7 décroît : les 8 occurrences du module gelé
  (tempoflow ×4, tf2 ×3, tf2fid ×1) sortent de
  `scripts/no-brand-vocab-allowlist.json`.
- Hors périmètre gelé d'origine : le fallback inline `preload-app.js` de
  `host-runtime/src/ai-workspace/manager.ts` (préload du workspace IA, kit
  moderne) est conservé — noté en BACKLOG comme nettoyage ultérieur.
