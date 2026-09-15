# Application Creezio Lite

Ce projet a été généré pour devenir une application indépendante dans **ChatGPT Sites**. Commencer par `AGENTS.md` et `brand.json`.

## Travailler dans ChatGPT

« Continue cette application Creezio Lite. Lis AGENTS.md et brand.json, développe [fonction demandée] et publie la mise à jour dans Sites. »

Le workflow Sites actuellement installé gère l'installation, le build et la publication du projet existant. Il doit conserver les bindings `DB` et `BUCKET` et réutiliser l'identifiant du Site lorsqu'il est déjà présent.

## Personnaliser

- `brand.json` : identité, modules, champs et permissions.
- `app/business-rules.ts` : validation métier avant une écriture.
- `app/api` : routes spécialisées ; elles doivent vérifier l'identité et l'espace côté serveur.
- `db/schema.ts` et `drizzle/` : tables et migrations persistantes.
- `app/globals.css` : thème de la marque.
- `creezio/` : socle commun verrouillé, à mettre à jour depuis le kit.

## Développement local

Le projet indique sa version de pnpm dans `package.json`. Utiliser Node 24 et ce gestionnaire. Le profil local non configuré utilise le mode portable ; dans ChatGPT, laisser Sites choisir le profil correspondant à l'environnement.

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm run db:generate
pnpm run build
pnpm run db:local
```

`db:local` applique exclusivement les migrations locales de `drizzle/` et conserve les données dans `.wrangler/state`. La publication Sites applique les migrations de production via son propre workflow.

La connexion locale du starter simule une identité de développement sur localhost, en mode portable uniquement. En production, le dispatcher Sites fournit l'identité signée. Aucun compte partagé de démonstration n'est publié.

## Limitations explicites

Ce socle utilise Sign in with ChatGPT. Les invitations applicatives n'accordent pas l'accès au Site : les paramètres de partage doivent permettre au destinataire de le visiter. Les rôles ne sont pas des rôles du workspace ChatGPT.

La recherche est une recherche textuelle D1, pas Meilisearch. Les modules déclaratifs stockent leurs champs en JSON ; des relations fortes et des opérations de stock/facturation nécessitent des tables et transactions métier dédiées. Aucun moteur de cron, IMAP/SMTP direct, processus permanent, MCP OAuth distant ou navigateur autonome n'est inclus.

Les fichiers sont limités à 10 Mo et téléchargés comme pièces jointes. Les données de l'app restent stockées dans D1/R2, jamais dans le navigateur.

Guide complet : https://github.com/creezio/creezio-lite.
