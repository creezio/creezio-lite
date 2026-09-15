# Application Creezio Lite — profil Sites

Cette application utilise le vrai shell Creezio et un snapshot des packages dans `creezio/packages`. Lire `AGENTS.md` avant modification.

- Identité et métier web : `brand.json`, `app/app-definition.ts`, `app/business-rules.ts`.
- Shell original : `app/brand-chrome.tsx` importe `WorkspaceRoot` et les providers natifs. Ne pas le reconstruire.
- API native D1 : `creezio/packages/sites-adapter` ; API des extensions web : `creezio/core`.
- Données : `DB` (D1), `BUCKET` (R2), migrations `drizzle/`.
- Authentification : connexion ChatGPT du Site, avec interface LoginPage originale.

Les 36 packages sont conservés en source, mais le backend entier n’est pas porté. Consulter la [matrice de compatibilité](https://github.com/creezio/creezio-lite/blob/main/docs/COMPATIBILITY.md) avant d’annoncer une fonctionnalité native.

Dans ChatGPT, utiliser les compétences Sites pour préparer, construire et publier ce projet existant. Préserver `pnpm-lock.yaml` et `.openai/hosting.json.project_id`. Ne pas réinitialiser l’application avec un autre starter.

Commandes locales : `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run build`. Les liens locaux de résolution des packages sont préparés automatiquement. `pnpm run db:generate` génère une nouvelle migration ; ne pas modifier les migrations déjà appliquées.
