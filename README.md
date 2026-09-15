# Creezio Lite

Un fork du **vrai kit Creezio**, avec un profil web pour ChatGPT Sites.

Les **36 packages Creezio 0.26.0** sont présents avec leurs sources, manifests et dépendances. La factory, les scripts, les applications et les documents du monorepo sont conservés. La référence est le commit [`6bd6507`](https://github.com/creezio/creezio/tree/6bd6507633b4c17bfc31206d82d1caa9a8af19af).

La première version Lite avait remplacé l’essentiel du kit par une implémentation différente. **La version 0.2 corrige cette erreur**, réutilise le shell original et distingue le code restauré des fonctionnalités effectivement adaptées à Sites.

## Créer une app dans ChatGPT Sites

Copier ce message dans une conversation où GitHub et Sites sont disponibles :

> Je veux créer une app à partir de Creezio Lite : https://github.com/creezio/creezio-lite. Lis START-HERE.md. Garde le vrai shell et le design Creezio, puis crée une application indépendante dans Sites. Mon application doit permettre de : [décrire le besoin].

Le nom seul n’installe pas le dépôt dans ChatGPT. Transmettre le lien rend le point de départ explicite. [Commencer →](START-HERE.md)

## Ce qui fonctionne dans le profil Sites

- **Shell natif** : WorkspaceRoot, sidebar, onglets persistants, navigation, recherche de pages, thème et primitives du package `@creezio/shell-ui`.
- **Pages natives** : kanban Tâches humaines, Support, administration Navigation, moteur de visites interactives.
- **API natives conservées** : `api-kernel`, handlers nav/support/interactive-demo avec persistance D1 injectable. Les signatures SQLite historiques restent disponibles.
- **Connexion Sites** : interface LoginPage native et authentification ChatGPT ; contrôle des droits et isolation des espaces côté serveur.
- **Fonctions web ajoutées** : modules métier déclaratifs, grilles DataTable natives, fichiers privés R2, invitations, espaces et journal D1. Ces ajouts ne sont pas présentés comme le module Database ou l’ACL complète du kit.
- **Réutilisation** : génération de projets indépendants, sources épinglées et contrôle d’intégrité.

**Ce n’est pas encore une parité complète du backend Creezio sur Sites.** Les sources des autres packages sont restaurées, mais certains services demandent encore un portage D1, un service externe ou un environnement desktop/serveur. Hermes et n8n sont désactivés à la demande du propriétaire. Le détail des 36 packages est dans [COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Repères

| Chemin | Contenu |
|---|---|
| `packages/<package natif>` | Vrais packages upstream ; changements ciblés et inventoriés |
| `packages/sites-adapter` | Adaptateurs D1 des modules natifs |
| `packages/core` et `packages/ui` | Extensions web Lite pour les données métier et les espaces |
| `template` | Profil Sites, branchement du vrai shell et des routes |
| `packages/factory`, `apps`, `docker`, scripts upstream | Outillage original conservé |
| `bin/creezio-lite.mjs` | Générateur spécifique au profil Sites ; distinct de la factory desktop |
| `upstream-packages.lock.json`, `upstream-patches.json` | Empreintes de l’amont et différences auditées |
| `upstream-workflows` | Workflows upstream archivés, sans publication npm ni propagation automatique |

[Architecture Sites](docs/SITES-ARCHITECTURE.md) · [API](docs/API.md) · [Vérifications](docs/VALIDATION.md) · [README upstream intégral](docs/UPSTREAM-README.md)

## Vérifier le profil Sites

```bash
npm run sync:template
pnpm --dir template install --frozen-lockfile
npm run test:sites
npm run check
pnpm --dir template run typecheck
pnpm --dir template run build
node scripts/validate-examples.mjs
```

Dans ChatGPT, suivre la compétence Sites pour installer, construire et publier le projet existant. L’installation à la racine concerne le monorepo natif ; elle n’est pas nécessaire pour générer une app Sites. `npm test` conserve la suite upstream ; `npm run test:sites` vérifie le profil Sites.

Licence et mentions upstream conservées (`UNLICENSED`). Aucune publication npm de ce fork n’est effectuée.
