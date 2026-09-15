# @creezio/interactive-demo

Démo interactive **native** (module OS présent dans toutes les apps Creezio) :
un product tour « Storylane-like » mais joué **en live dans l'app** — un faux
curseur animé se déplace, clique et tape réellement dans l'interface pendant
que des cartes de narration présentent chaque fonctionnalité.

## Ce que fournit le package

- **Types de scénario déclaratifs** (`DemoScenario` / `DemoStep`) : étapes
  `say` (carte plein écran), `navigate`, `highlight` (spotlight + carte
  ancrée), `click` (faux curseur + vrai clic DOM), `type` (frappe caractère
  par caractère), `scroll`, `wait`. Format JSON-sérialisable : ajouter /
  enlever / réordonner des étapes = éditer un tableau.
- **Contenu hybride DB** (ADR-module-natif-hybride) : la marque déclare ses
  scénarios par défaut dans UN fichier explicite
  (`server/src/electron/brand-interactive-demo-content.ts`), les overrides
  vivent en `brand.db` (`interactive_demo_content`), le runtime sert
  `merge(défauts, overrides)`. Le « déjà vu » par utilisateur va dans
  `interactive_demo_preferences`.
- **Mount api-kernel** `/api/v1/modules/interactive-demo/*` : `GET/PUT/DELETE
  scenarios[/:id]` + `GET/PUT preferences`.
- **UI React** (`@creezio/interactive-demo/ui`) : `InteractiveDemoRoot`
  (auto-lancement première visite + lanceur flottant « Visite guidée »),
  `DemoPlayer` (lecteur bas niveau), `startInteractiveDemo()` (déclenchement
  programmatique), curseur/spotlight en Web Animations API + CSS
  (`ui/interactive-demo.css`) — zéro dépendance d'animation tierce.
- **Scénario générique OS** : `genericOsTourScenario({ productName })` —
  démo de base jour 1 (sidebar, tâches, mails, assistant) pour toute marque
  sans scénario produit.
- **Collecteur de contributions modules** : `collectInteractiveDemoDefaults(contributions)`
  agrège les scénarios `demo` des modules métier (validation
  `validateDemoScenario`, dédup par id, ordre stable, erreurs agrégées
  explicites) — la brique derrière `collectDemoScenarios()` du registre
  `modules/index.ts` généré par la factory.

## Défauts par modules (registre — câblage cible)

Chaque module métier **doit** déclarer ≥ 1 scénario dans son
`server/src/electron/modules/<id>.ts` (champ `demo` du `BrandModuleDef`).
Inclure `genericOsTourScenario({ productName })` (id `os-tour` partagé).
Une app Creezio sans démo interactive est invalide. La factory câble le
mount, les migrations et le CSS ; `BrandChrome` monte **un** `InteractiveDemoRoot`
dans `SessionProvider` (`CreezioUiBoot` ne remonte plus le lecteur).

```ts
export const promotionsModule: BrandModuleDef = {
  id: "promotions",
  // entitySpecs, navItems…
  demo: {
    scenarios: [
      {
        id: "promotions-tour",
        title: "Promotions",
        steps: [{ id: "intro", kind: "say", title: "Créez vos promos" }],
      },
    ],
  },
};
```

Le registre `modules/index.ts` (généré factory) agrège tout via
`collectDemoScenarios()` — le mount n'est alors qu'**une ligne** côté app :

```ts
// server/src/electron/brand-module-api.ts
import { collectDemoScenarios } from "./modules/index.js";
import { createInteractiveDemoMount } from "@creezio/interactive-demo";

api.registerModuleApi(
  "interactive-demo",
  createInteractiveDemoMount({ defaults: collectDemoScenarios() }),
);
```

`collectDemoScenarios()` délègue à `collectInteractiveDemoDefaults()` :
scénarios invalides ou ids en conflit entre modules = **erreur explicite au
boot** (liste complète module:scénario), jamais une démo tronquée servie en
silence.

## Un seul lecteur — dans SessionProvider

La factory pose **un** `InteractiveDemoRoot` dans `BrandChrome`, à
l'intérieur de `SessionProvider` (`useSession()` → `userKey` / `role`).
`CreezioUiBoot` ne remonte plus un second root (double curseur / Foove #101).
Pas de `brandDemoScenarios()` — SoT = `collectDemoScenarios()`.

```tsx
// ui/components/brand-chrome.tsx (généré factory)
const { me } = useSession();
<InteractiveDemoRoot
  launcher="sidebar"
  userKey={me?.user}
  role={me?.brandRole}
/>
```

PR kit #109 (curseur DOM unmount après Terminer) : **reste ouvert**, non
fusionné ici pour ne pas mélanger le lockstep 0.10.8.

Le scénario marqué `autoStart: true` se lance automatiquement à la première
visite (après le setup / l'onboarding) ; « déjà vu » est persisté par
utilisateur (preferences + localStorage). Le lanceur flottant permet de
rejouer la visite à tout moment.

## Scénarios par rôle

Un scénario peut restreindre sa visibilité avec `roles?: string[]` (lanceur
+ autoStart ; un lancement explicite `startInteractiveDemo(id)` ignore le
filtre). Le rôle courant est une **donnée de session**, pas une donnée
métier : la marque déclare `configureAuth({ resolveBrandRole })`
(`@creezio/auth`, callback qui résout le rôle depuis SA db — ex. lookup
`user_roles`), le kit sert `brand_role` dans `/api/v1/auth/me` (la valeur
suit la cible en impersonation) et `useSession().me.brandRole` côté UI.
Sans resolver : `brandRole` est `null` → aucun filtrage (comportement
historique).

## Éditer la démo (ajouter / enlever des étapes)

- **Défauts** : éditer le tableau `steps` du fichier marque
  `brand-interactive-demo-content.ts` (rebuild).
- **À chaud, sans code** : `PUT /api/v1/modules/interactive-demo/scenarios/<id>`
  avec `{ "steps": [ … ] }` (remplacement complet du tableau — pas de merge
  ambigu) ; `DELETE` pour revenir aux défauts. Un `PUT` sur un id inconnu
  avec `title` + `steps` crée un scénario supplémentaire.

## Commandes

```bash
npm run build -w @creezio/interactive-demo
node --test scripts/test-phase-interactive-demo.mjs   # gate kit
```

## Docs

- [AGENTS.md](./AGENTS.md) — frontières et pièges (agents IA)
- [docs/FILES.md](./docs/FILES.md) — inventaire des fichiers
- ADR : [docs/adr/ADR-module-natif-hybride.md](../../docs/adr/ADR-module-natif-hybride.md)


## Profil Creezio Lite / Sites

createInteractiveDemoMount accepte persistence pour le contenu et les préférences asynchrones ; merge, validation, player et stockage SQLite d’origine restent disponibles.
