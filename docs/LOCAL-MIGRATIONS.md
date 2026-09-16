# Migrations D1 locales : préserver les triggers natifs

Le lanceur Wrangler 4.92 `d1 migrations apply --local` échoue sur la migration native `0003_search_index.sql` : son découpage SQL fragmente les triggers contenant `CASE … END` et perd le `END` externe. Reproduit dans Negocia et signalé indépendamment dans la PR Lite #16. Les migrations appliquées restent immuables ; ce correctif ne réécrit aucun SQL.

Le lanceur généré résout Miniflare dans la dépendance Wrangler déjà figée. Il utilise les frontières Drizzle `--> statement-breakpoint`, puis un `D1.batch` par migration avec son marqueur `d1_migrations`. Un échec annule schéma, données et marqueur de cette migration. Les migrations précédentes restent appliquées et le rejeu reprend après elles.

Le binding DB provient de `dist/server/wrangler.json` ; la persistance locale reste `.wrangler/state/v3/d1`. Construire l'application, puis lancer `pnpm db:local`. Aucune base distante n'est contactée. Aucun secret, schéma, runtime ou lockfile n'est modifié.

`tests/local-migrations.test.mjs` applique les onze migrations natives sur une D1 Miniflare vide, vérifie le trigger FTS avec un booléen, le rejeu sans modification et le rollback d'une migration volontairement invalide. Les dépendances du template doivent être installées avant ce test, comme dans la CI du kit.

Pour une application existante, fusionner explicitement `template/scripts/migrate-local.mjs` dans `scripts/migrate-local.mjs`. L'upgrade du seul runtime ne remplace pas cet outil. Ne pas réinitialiser l'application ni effacer sa base locale.

Origine : [Negocia PR #3](https://github.com/creezio/negocia/pull/3). Les contrôles complets de cette PR kit sont ceux de sa CI ; les preuves Negocia ne les remplacent pas.
