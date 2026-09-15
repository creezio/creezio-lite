# AGENTS — @creezio/cockpit

## Mission

Maintenir le cockpit serveur/CRM générique : config marque, shell autonome, panneau client et hook de dashboard. L'UI doit rester marque-agnostique et consommer des contrats API stables.

## Ne pas faire

- Ne pas ajouter d'auth serveur dans les composants React ; elle appartient aux routes marque.
- Ne pas hardcoder de protocole deep-link, domaine, URL de téléchargement ou nom produit.
- Ne pas importer de fichiers d'application (`@/lib/*`, routes Next marque).
- Ne pas remplacer `@creezio/tasks/ui` par une copie locale pour l'activité IA.
- `docs/FILES.md` est maintenu via `node scripts/generate-files-md.mjs cockpit` (gate `test-phase-docs-freshness`) — la colonne Rôle s'édite à la main, ne pas inventer d'autre format.

## Points d'entrée

- `src/config.ts` : `CockpitConfig`, `configureCockpit`, `resolveCockpitConfig`, `buildJoinLink`.
- `src/types.ts` : contrats des réponses API.
- `src/index.ts` : exports non React.
- `ui/index.ts` : exports React.
- `ui/server-cockpit-shell.tsx` : cockpit autonome serveur.
- `ui/cockpit-client.tsx` : cockpit intégré CRM.
- `ui/hooks/use-cockpit-dashboard.ts` : polling et actions API.
- `ui/parts/*` : composants visuels partagés.

## Modifier sans casser

- Garder les `CockpitTabId` existants et `DEFAULT_COCKPIT_TABS` compatibles.
- Ne changer les URLs consommées par `useCockpitDashboard` qu'avec une migration coordonnée des marques.
- Préserver la logique `buildJoinLink(protocol, tunnelHost)` : nettoyage du protocole et retour `null` si incomplet.
- Les actions desktop doivent rester facultatives : hors desktop, l'UI doit se dégrader proprement.
- Les `extraTabs` doivent rester indépendants des onglets natifs.

## Config brand

```ts
configureCockpit({
  deepLinkProtocol: "brand",
  clientDownloadUrl: "https://...",
  apiBase: "/api/v1",
  refreshMs: 15_000,
  tabs: ["sante", "ia", "acces", "logs", "plugins", "invitations"],
});
```

Bindings requis côté marque :

- endpoints `/api/v1/cockpit/*`, `/api/v1/users`, `/api/v1/desktop/sessions`, `/api/v1/tasks/activity/*` ;
- `@creezio/shell-ui` configuré pour `productName` et l'API desktop ;
- `@creezio/tasks/ui` disponible si l'onglet IA est utilisé.

## Tests/gates

```bash
npm run typecheck -w @creezio/cockpit
npm run build -w @creezio/cockpit
```

Vérifications manuelles utiles :

- rendu `ServerCockpitShell` côté serveur host ;
- rendu `CockpitClient` dans le CRM owner ;
- endpoints absents ou down n'entraînent pas de crash React ;
- invitation deep-link correcte avec tunnel configuré.

## Fichiers sensibles

- `ui/hooks/use-cockpit-dashboard.ts` : liste des endpoints et mutations.
- `ui/server-cockpit-shell.tsx` : UX host/client et création comptes.
- `src/config.ts` : defaults globaux et protocole join.
- `src/types.ts` : contrats partagés avec les routes marque.

## Liens

- [README.md](./README.md)
- [docs/FILES.md](./docs/FILES.md)
