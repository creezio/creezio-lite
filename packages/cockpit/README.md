# @creezio/cockpit

## Rôle

`@creezio/cockpit` fournit l'interface de supervision serveur Creezio :

- configuration marque du cockpit (`configureCockpit`) ;
- types de contrats consommés par l'UI (`CockpitHealth`, users, sessions, logs, ACL plugins) ;
- `ServerCockpitShell`, console autonome côté serveur ;
- `CockpitClient`, panneau compact intégré au CRM owner ;
- hook `useCockpitDashboard` qui interroge les endpoints `/api/v1`.

Le cockpit est une UI kit : il affiche l'état du serveur, des services, du tunnel, des collaborateurs IA, des sessions desktop et des ACL plugins, sans définir les routes serveur lui-même.

## Périmètre kit vs marque

**Kit**

- Fournit les onglets natifs : Santé, Collaborateurs IA, Accès & sessions, Logs, Plugins / ACL, Invitations.
- Résout la config globale + overrides locaux (`resolveCockpitConfig`).
- Construit les liens de join desktop (`buildJoinLink`).
- Appelle les endpoints standards sous `apiBase` (`/api/v1` par défaut).
- Réutilise `@creezio/tasks/ui` pour l'activité IA live.

**Marque**

- Appelle `configureCockpit` au boot client/serveur.
- Monte les endpoints Hono/Next attendus par l'UI (`/cockpit/health`, `/users`, `/desktop/sessions`, etc.).
- Fournit le protocole deep-link, l'URL de téléchargement client et les onglets activés.
- Gère auth/ACL côté API, pas dans ce package.
- Fournit l'identité shell via `@creezio/shell-ui`.

## Installation/build

```bash
npm run build -w @creezio/cockpit
npm run typecheck -w @creezio/cockpit
```

Exports :

- `@creezio/cockpit` : config, types, constantes.
- `@creezio/cockpit/ui` : composants React, hook dashboard, parts UI.

## Configuration détaillée

### `configureCockpit`

```ts
import { configureCockpit } from "@creezio/cockpit";

configureCockpit({
  deepLinkProtocol: "mybrand",
  clientDownloadUrl: "https://example.com/download",
  apiBase: "/api/v1",
  refreshMs: 15_000,
  tabs: ["sante", "ia", "acces", "logs", "plugins", "invitations"],
});
```

Champs :

- `deepLinkProtocol` : protocole utilisé pour `mybrand://join/<host>`.
- `clientDownloadUrl` : CTA d'installation client.
- `tabs` : onglets natifs visibles. Défaut : `DEFAULT_COCKPIT_TABS`.
- `refreshMs` : intervalle de polling dashboard. Défaut : `15000`.
- `apiBase` : base des endpoints. Défaut : `/api/v1`.

### Brand bindings

Le package lit :

- `getShellUiBrand().productName` pour le libellé produit ;
- `getShellDesktopApi()` pour détecter l'environnement desktop et obtenir le tunnel live ;
- `openAiWorkspaceView` pour ouvrir les workspaces IA ;
- `isRemoteDesktopClient` pour masquer le cockpit serveur depuis une app Client.

### Env

`@creezio/cockpit` ne lit pas directement `process.env`. Les valeurs réseau et produit arrivent par `configureCockpit`, par `@creezio/shell-ui` ou par les réponses API marque.

## API publique avec exemples

### Config et helpers

```ts
import {
  DEFAULT_COCKPIT_TABS,
  buildJoinLink,
  configureCockpit,
  resolveCockpitConfig,
} from "@creezio/cockpit";

configureCockpit({
  deepLinkProtocol: "tempo",
  clientDownloadUrl: "https://download.example/client",
});

const cfg = resolveCockpitConfig({ refreshMs: 5_000 });
const join = buildJoinLink(cfg.deepLinkProtocol, "demo.example.com");
```

### Cockpit serveur autonome

```tsx
import { ServerCockpitShell } from "@creezio/cockpit/ui";

export default function ServerCockpitPage() {
  return (
    <ServerCockpitShell
      extraTabs={[
        {
          id: "brand-extra",
          label: "Métier",
          render: () => <div>Indicateurs marque</div>,
        },
      ]}
    />
  );
}
```

### Cockpit CRM

```tsx
import { CockpitClient } from "@creezio/cockpit/ui";

export function OwnerDashboard() {
  return <CockpitClient config={{ apiBase: "/api/v1" }} />;
}
```

### Endpoints consommés par `useCockpitDashboard`

Sous `apiBase` :

- `GET /cockpit/health`
- `GET /users`
- `GET /desktop/sessions`
- `GET /cockpit/plugin-acl`
- `GET /admin/request-logs?limit=40` si `includeLogs`
- `GET /tasks/activity/:userId`
- `POST /cockpit/ai-workspace/:userId/close`
- `PUT /cockpit/plugin-acl/:pluginId`
- `POST /users` pour créer humains/IA depuis le cockpit serveur

## Flux

1. La marque configure `configureCockpit`.
2. `ServerCockpitShell` ou `CockpitClient` appelle `useCockpitDashboard`.
3. Le hook fusionne la config globale et les props locales, puis poll les endpoints.
4. Le cockpit affiche santé, tunnel, IA, ACL, logs et invitations.
5. Les actions UI appellent les endpoints marque ou les APIs desktop (`openAiWorkspaceView`, tunnel live).
6. Le shell autonome vérifie qu'il n'est pas rendu dans un client distant.

## Intégration marques

- Appeler `configureCockpit` avant le premier rendu des composants.
- Monter `ServerCockpitShell` uniquement côté serveur/host desktop.
- Monter `CockpitClient` dans le CRM owner si un panneau plus compact est voulu.
- Fournir les endpoints `/api/v1` avec auth owner fail-closed.
- Garder `deepLinkProtocol` cohérent avec l'application desktop.
- Ajouter des onglets marque via `extraTabs`, pas en modifiant les onglets natifs.

## Dépendances

- Runtime : `@creezio/shell-ui`.
- Peer optionnels : `@creezio/tasks`, `next`, `react`, `lucide-react`, `sonner`.
- Build/typecheck : TypeScript.

## Voir aussi

- [AGENTS.md](./AGENTS.md)
- [docs/FILES.md](./docs/FILES.md)
