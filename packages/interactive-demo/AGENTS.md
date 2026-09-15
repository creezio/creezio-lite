# AGENTS — @creezio/interactive-demo

## Mission

Maintenir le moteur générique de démo interactive (product tour live) :
types de scénario déclaratifs, contenu hybride DB (migrations + merge +
mount), lecteur React avec faux curseur. Le package doit rester réutilisable
par toutes les marques — le contenu des démos vit chez la marque.

## Ne pas faire

- Ne pas ajouter de scénario métier marque dans le kit (le seul scénario
  embarqué est `genericOsTourScenario`, surfaces OS uniquement).
- Ne pas dépendre de `@creezio/assistant` : le curseur de la démo
  (`ui/fake-cursor.ts`) est volontairement indépendant du curseur LLM
  (scénario scripté ≠ action assistant) — ne pas les fusionner sans ADR.
- Ne pas introduire de lib d'animation (framer-motion…) : Web Animations
  API + CSS (`ui/interactive-demo.css`) suffisent et restent
  dépendance-neutres pour les apps Next consommatrices.
- Ne pas faire de merge « intelligent » des `steps` dans
  `mergeDemoScenarios` : un override `steps` REMPLACE le tableau (contrat
  d'édition explicite — réordonner/supprimer sans règles ambiguës).
- `src/content.ts` : imports type-only `@creezio/api-kernel` /
  `@creezio/platform-core` — ne pas y ajouter d'import runtime (cycle).
- `docs/FILES.md` est maintenu via
  `node scripts/generate-files-md.mjs interactive-demo` (gate
  `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main.

## Points d'entrée

- `src/index.ts` : surface publique runtime.
- `src/types.ts` : contrat `DemoScenario` / `DemoStep` / `DemoTarget` +
  `validateDemoScenario` (pur, sans DOM).
- `src/contributions.ts` : `DemoModuleContribution` +
  `collectInteractiveDemoDefaults` — agrège les `demo` des modules du
  registre marque (validation, dédup par id, ordre stable, erreurs
  agrégées). Utilisé par `collectDemoScenarios()` du `modules/index.ts`
  généré factory.
- `src/content.ts` : hybride DB — `interactiveDemoMigrations`,
  `mergeDemoScenarios`, `createInteractiveDemoMount` →
  `/api/v1/modules/interactive-demo/*` (tables `interactive_demo_content`
  + `interactive_demo_preferences`).
- `src/generic.ts` : `genericOsTourScenario` (démo de base OS).
- `ui/index.ts` : surface publique React.
- `ui/demo-root.tsx` : `InteractiveDemoRoot` (fetch scénarios, auto-start
  première visite, lanceur flottant, événement `creezio-interactive-demo`).
- `ui/demo-player.tsx` : lecteur (spotlight, cartes, contrôles, exécution
  des étapes).
- `ui/dom.ts` : résolution de cibles (sélecteur → `data-aid` → libellé) et
  événements synthétiques (mêmes séquences pointer que l'assistant).
- `ui/fake-cursor.ts` : singleton DOM du curseur (survit aux navigations).

## Modifier sans casser

- Garder `DemoStep` rétrocompatible : les scénarios marque (fichiers
  défauts) ET les overrides DB en dépendent — un nouveau kind d'étape doit
  être additif, `validateDemoScenario` mis à jour en même temps.
- Une démo ne bloque JAMAIS l'utilisateur : cible introuvable → étape
  sautée avec note (`optional` défaut tolérant), erreurs de fetch
  silencieuses, `Quitter` toujours accessible.
- Tout l'overlay porte `data-creezio-demo-ui` : `ui/dom.ts` exclut ces
  éléments de la résolution de cibles — préserver l'attribut sur tout
  nouvel élément UI.
- Les événements synthétiques (`synthClick`, `setNativeValue`) doivent
  rester compatibles React (setter natif + `input` bubbles) — tester sur
  une page marque réelle après modification.
- `pointerId: 9002` distinct de l'assistant (9001) — ne pas les confondre.

## Config brand

- Défauts : au choix champ `demo` des modules du registre
  (`collectDemoScenarios()` — câblage cible) ou UN fichier explicite
  `server/src/electron/brand-interactive-demo-content.ts` ; migrations
  composées dans `brand-migrations.ts` ; mount enregistré sous l'id
  `interactive-demo` dans `brand-module-api.ts`.
- UI : `<InteractiveDemoRoot navigate={router.push} userKey={…} />` monté
  une fois dans le chrome + import du CSS. `autoStart` scénario-level +
  prop pour couper le lancement auto. Accent : var CSS
  `--creezio-demo-accent`.
- Rôle courant : prop `role={me?.brandRole}` lue via `useSession()`
  (`@creezio/auth/ui`) — côté serveur la marque déclare
  `configureAuth({ resolveBrandRole })` (callback sur SA db, ex.
  `user_roles`) ; le kit sert `brand_role` dans `/me` (suit la cible en
  impersonation). Ne pas réintroduire de fetch d'endpoint rôle custom dans
  le chrome (approche obsolète).
- Pas d'env direct dans le package.

## Tests/gates

```bash
npm run build -w @creezio/interactive-demo
node --test scripts/test-phase-interactive-demo.mjs
```

Pour une modification du lecteur, vérifier dans une marque hôte que :

- le scénario `autoStart` se lance à la première visite puis plus jamais ;
- clic/frappe agissent réellement (navigation sidebar, recherche) ;
- « Quitter la visite » interrompt proprement (curseur masqué, overlay
  démonté) ;
- une cible introuvable saute l'étape sans bloquer.

## Fichiers sensibles

- `src/types.ts` : contrat des scénarios (marques + overrides DB).
- `src/content.ts` : sémantique du merge et du mount (édition à chaud).
- `ui/dom.ts` : résolution de cibles — tout changement impacte les
  scénarios existants des marques.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
