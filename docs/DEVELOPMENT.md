# Développer et vérifier le kit

## Dans ChatGPT

Le dépôt du kit n'est pas un projet Sites. Son dossier `template` contient le squelette, tandis que les apps générées sont des projets Sites autonomes. Utiliser les compétences Sites installées pour configurer le profil et installer les dépendances d'un projet existant. Les chemins des outils Sites ne doivent pas être codés en dur dans l'application.

## Hors ChatGPT

Node.js 24, Git et le gestionnaire indiqué dans `template/package.json` sont nécessaires. Le CLI de génération n'a aucune dépendance npm. Le template utilise pnpm et un lockfile committé.

```bash
cd template
pnpm install --frozen-lockfile
cd ..
npm test
npm run check
cd template
pnpm run typecheck
pnpm run build
pnpm run db:local
pnpm run dev
```

`db:local` applique exclusivement les migrations locales après un build et conserve l'état dans `.wrangler/state`. Le script ne possède aucun mode distant. En hébergement Sites, le workflow de publication gère les migrations de production.

Les dépendances du template sont requises pour les tests Miniflare. Le lanceur `npm test` synchronise d'abord les sources communes. Ne pas remplacer un test d'intégration manquant par un skip silencieux.

## Tests utiles

- Authentification et refus des identités forgées côté requête.
- Isolation entre espaces et entre applications.
- Rôles, invitations liées à l'e-mail, révocation et protection du propriétaire.
- Validation des données, pagination, recherche et filtres SQL paramétrés.
- Conflits de version et rollback du journal/écriture.
- Stockage R2, téléchargement forcé, taille et refus d'accès entre espaces.
- Exécution sur les bindings D1/R2 de Miniflare.
- Génération depuis deux briefs, nettoyage des identités/secrets du template, doctor et upgrade.
- Contrat des outils WebMCP avec lecture réelle du backend après écriture. Ce test simulé ne prouve pas à lui seul le support dans un navigateur donné.

Les builds doivent être exécutés sur les deux exemples générés, en gardant le package manager et le lockfile. Les vérifications de publication et leurs limites sont consignées dans `docs/VALIDATION.md`.
