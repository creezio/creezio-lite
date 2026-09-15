# packages/interactive-demo — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs interactive-demo` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/content.ts`](../src/content.ts) | Contenu hybride DB (ADR-module-natif-hybride) : `interactiveDemoMigrations` (tables `interactive_demo_content` + `interactive_demo_preferences`), `mergeDemoScenarios` (merge pur défauts/overrides — `steps` = remplacement), `createInteractiveDemoMount` → `/api/v1/modules/interactive-demo/*` (câblé en prod : WinHub) |
| [`src/contributions.ts`](../src/contributions.ts) | `DemoModuleContribution` + `collectInteractiveDemoDefaults` : agrégation des scénarios `demo` des modules du registre marque (validation `validateDemoScenario`, dédup par id, ordre stable, erreurs agrégées) — brique derrière `collectDemoScenarios()` du `modules/index.ts` généré factory |
| [`src/generic.ts`](../src/generic.ts) | `genericOsTourScenario({ productName })` — démo de base jour 1 des surfaces OS (sidebar, tâches, mails, assistant), sans texte métier marque (disponible pour toute marque) |
| [`src/index.ts`](../src/index.ts) | Surface publique runtime (types + contenu + scénario générique) |
| [`src/types.ts`](../src/types.ts) | Contrat déclaratif : `DemoScenario`, `DemoStep` (say/navigate/highlight/click/type/scroll/wait), `DemoTarget` (sélecteur → `data-aid` → libellé) et `validateDemoScenario` (pur, sans DOM) |

## `ui/`

| Fichier | Rôle |
|---|---|
| [`ui/demo-player.tsx`](../ui/demo-player.tsx) | Lecteur de démo : exécution des étapes, spotlight suivi en rAF, cartes de narration ancrées/centrées, barre de contrôle (progression, quitter) — cible introuvable = étape sautée, jamais bloquant |
| [`ui/demo-root.tsx`](../ui/demo-root.tsx) | `InteractiveDemoRoot` : fetch scénarios + « déjà vu » (localStorage + preferences), auto-lancement première visite du scénario `autoStart`, lanceur flottant « Visite guidée », événement `creezio-interactive-demo` (`startInteractiveDemo`) |
| [`ui/dom.ts`](../ui/dom.ts) | Résolution des `DemoTarget` (polling, exclusion `data-creezio-demo-ui`) + événements synthétiques compatibles React (clic pointeur complet, frappe caractère par caractère, submit) + scroll racine |
| [`ui/fake-cursor.ts`](../ui/fake-cursor.ts) | Singleton DOM du faux curseur (Web Animations API : déplacement proportionnel, halo de clic) — indépendant du curseur assistant, badge configurable |
| [`ui/index.ts`](../ui/index.ts) | Surface publique React |
