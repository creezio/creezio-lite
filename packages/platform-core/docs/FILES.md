# packages/platform-core — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs platform-core` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/app-kind.ts`](../src/app-kind.ts) | Split Serveur / Client — logique PURE, testable depuis Node. Port brand-agnostic de electron/app-kind.ts (TF2 0.10.26). |
| [`src/app-require.ts`](../src/app-require.ts) | `createAppRequire` — résolution de modules en contexte packagé sans parsing de stack (les frames Windows `file:///C:/…` cassent les regex naïves) ; SoT anti-crash client, verrouillé par la gate `verify-pack-runtime`. |
| [`src/architecture-version.ts`](../src/architecture-version.ts) | Cadre architecture Creezio (Phase H0+). Bump uniquement au sign-off de phase (H0 → H1 → … → H5 ACL → H6 freeze I*). |
| [`src/connection-profile.ts`](../src/connection-profile.ts) | Profils de connexion desktop : serveur local embarqué vs API distante. Logique pure (pas d'import Electron) — port de electron/connection-profile.ts. |
| [`src/core-db-env.ts`](../src/core-db-env.ts) | Résolution chemin `core.db` côté process Next/CRM (sans PathsContext Electron). Ordre : 1. `CREEZIO_CORE_DB_PATH` (injecté par Electron server-launcher) 2. voisin de `DB_PATH` → `{userData}/sqlite/core.db` 3. `/data/sqlite/core.db` (cloud/docker) |
| [`src/core-migrations.ts`](../src/core-migrations.ts) | Migrations SQLite **cœur** plateforme (M11). Compose auth + Product Hub (ACL H5 + runtime) — SoT kit. Les marques ne doivent plus dupliquer cette liste ; elles gardent uniquement `brand-migrations` métier. N4 — couverture vs steps historiques brand.db : - `028/030/032` plugin_* → `PRODUCT_HUB_*_SQL` + `migrateLegacyBrandProductHubOnce` - auth utilisateurs kit → `AUTH_CORE_SQL` (`creezio_users`, pas table `users` legacy) - autres steps plateforme (api_keys, mcp, tasks brand, emails, analytics, …) → `platformHistoricalMigrations()` (brand.db / schema_version) Chargement SQL via `createRequire` |
| [`src/disk-space.ts`](../src/disk-space.ts) | Détection espace disque insuffisant (npm install n8n, cache userData). Testable sans I/O réseau. |
| [`src/env-brand.ts`](../src/env-brand.ts) | Helpers env marque pour launchers (Next / Meili / Hermes / n8n). Remplace les hardcodes TEMPOFLOW_* / TF2_* dans le runtime kit. |
| [`src/factory-reset.ts`](../src/factory-reset.ts) | Cibles factory-reset — logique PURE (chemins). Le wipe Electron (sessions) reste dans @creezio/electron-shell. Port paramétré de electron/factory-reset.ts (TF2 0.10.26). |
| [`src/fleet-telemetry.ts`](../src/fleet-telemetry.ts) | Consentement télémétrie flotte — extrait TempoFlow fleet-telemetry.ts (M4). Labels UI marque restent hors kit ; ici : types + sanitize/patch purs. |
| [`src/index.ts`](../src/index.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/installer-prefs.ts`](../src/installer-prefs.ts) | Préférences écrites par l'installeur NSIS (`installer-prefs.json` sous userData). Consommées une seule fois au boot packagé pour synchroniser `launchAtStartup` avec local-config marque + setLoginItemSettings. Module pur (pas d'import Electron) — testable depuis Node. |
| [`src/kit-os-resources.ts`](../src/kit-os-resources.ts) | (à documenter) |
| [`src/licensing.ts`](../src/licensing.ts) | Licence desktop hors-ligne (Ed25519) — gold TempoFlow paramétré. Format clé : `{keyPrefix}-<payload base64url>-<signature base64url>` où payload = { email, plan, exp }. Vérification avec clé publique PEM (env ou option) — aucune connexion serveur requise. |
| [`src/local-config-schema.ts`](../src/local-config-schema.ts) | Schéma local-config (userData-config.json) — aligné TF2 0.10.26. Le chiffrement safeStorage est dans @creezio/electron-shell. |
| [`src/node-spawn-env.ts`](../src/node-spawn-env.ts) | (à documenter) |
| [`src/paths.ts`](../src/paths.ts) | Utilitaires de chemins génériques — paramétrés par AppManifest. Pas d'import Electron ici (testable depuis Node). L'appelant fournit `userDataRoot` (ex. `app.getPath("userData")`) et `isPackaged`. Source d'abstraction : electron/paths.ts (TF2 0.10.26 / Certivan / Fidu). |
| [`src/platform-stores-contract.ts`](../src/platform-stores-contract.ts) | Contrat cutover stores plateforme (SoT kit core.db) — M8. Zéro dual-write runtime. Extensions brand (ACL, kanban, PJ) hors SoT. |
| [`src/ports.ts`](../src/ports.ts) | Helpers ports / health — purs Node (utilisés par launchers hôte). Extrait de electron/server-launcher.ts (TF2 0.10.26). |
| [`src/profile-launch.ts`](../src/profile-launch.ts) | Profils de lancement multi-instances — logique PURE. Port brand-agnostic de electron/profile.ts (TF2 0.10.26). |
| [`src/recovery-key.ts`](../src/recovery-key.ts) | Clé de récupération locale — port TF2 recovery-key.ts (pur crypto). |
| [`src/sqlite-driver.ts`](../src/sqlite-driver.ts) | Driver SQLite minimal (H2) — compatible node:sqlite DatabaseSync. Les apps Electron peuvent injecter better-sqlite3 via `openDatabase`. Pas d'`import.meta` — dual-build CJS (Electron) l'interdit. |
| [`src/sqlite-layout.ts`](../src/sqlite-layout.ts) | Layout SQLite multi-fichiers (Phase H1.0) — core / brand / plugin/<id>. Migration depuis `resolveDbPath` : - `resolveBrandDbPath` === `resolveDbPath` (même fichier `manifest.dbFileName`) pour ne pas casser les marques déjà branchées ; - `resolveCoreDbPath` / `resolvePluginDbPath` sont les nouveaux chemins sous `{userData}/sqlite/` ; - `resolveDbPath` reste un alias déprécié de la base métier (brand). Voir docs/archive/PHASE-H1.md et ARCHITECTURE-INTENTION.md. |
| [`src/sqlite-migrations.ts`](../src/sqlite-migrations.ts) | Migrations SQLite par couche (H2.1). Chaque fichier DB (core / brand / plugin/<id>) a sa propre table `_creezio_schema_migrations` — pas de versioning partagé entre couches. |
| [`src/sqlite-runtime.ts`](../src/sqlite-runtime.ts) | Runtime multi-DB SQLite (H2.0) — handles core / brand / plugin/<id>. Jour 0 serveur : ouvre **core + brand** uniquement. Plugin : `openPlugin(id)` à l'install (ensurePluginDb + migrations). |
| [`src/tunnel-cf-client.ts`](../src/tunnel-cf-client.ts) | Client API Cloudflare v4 (Node pur) : `ensureCfTunnel` (auto-provision instance au boot — jamais de règle/DNS agent), `ensureCfAgentTunnel`/`ensureCfAgentTunnelDns`/`removeCfTunnelAgentRule`/`deprovisionCfAgentTunnel` (T7 — tunnel dédié agent, seul geste qui touche DNS `agent.*`), DNS/e-mail, deprovision instance. |
| [`src/tunnel-cf.ts`](../src/tunnel-cf.ts) | Helpers purs tunnel (zéro réseau) : slugs réservés, règles ingress (`buildTunnelIngressRules` sans option agent, `buildAgentTunnelIngressRules` T7), specs DNS instance vs `agentTunnelDeprovisionDnsHosts`, hostnames agent, URLs publiques. |
| [`src/tunnel-urls.ts`](../src/tunnel-urls.ts) | URLs publiques embeds via tunnel Cloudflare (nested `n8n.{slug}.{zone}` ou flat `n8n-{slug}.{zone}` si `CREEZIO_TUNNEL_FLAT_HOSTS=1` / Universal SSL). CRM inchangé `{slug}.{zone}`. Voir ADR-tunnel-flat-hosts. |
| [`src/updater-state.ts`](../src/updater-state.ts) | État auto-update — logique PURE (reduce), sans Electron. Extrait de electron/updater.ts (TF2 0.10.26). |
| [`src/web-allowlist.ts`](../src/web-allowlist.ts) | Allowlist web des agents IA au niveau exécution (union des env `*_WEB_ALLOWED_HOSTS`, refus `web_host_not_allowed`, fail-closed sur URL non http(s)) — câblée prod dans browser-host et electron-shell ; défense en profondeur derrière la garde UX du runner tasks. |

## `src/embeds/`

| Fichier | Rôle |
|---|---|
| [`src/embeds/embed-env-catalog.ts`](../src/embeds/embed-env-catalog.ts) | Catalogue env embeds (n8n / Hermes) — port brand-agnostic TF2 0.10.26. Les libellés UI restent génériques ; le productName est injecté à l'affichage. |
| [`src/embeds/embed-stack-hooks.ts`](../src/embeds/embed-stack-hooks.ts) | Hooks partagés — stack d'outils embarqués (Hermes, n8n). Port brand-agnostic de electron/embed-stack-hooks.ts (TF2 0.10.26). |
| [`src/embeds/hermes-embed.ts`](../src/embeds/hermes-embed.ts) | Logique pure Hermes Agent — port brand-agnostic TF2 0.10.26 hermes-embed.ts. Aucun import Electron : testable depuis Node. |
| [`src/embeds/n8n-embed.ts`](../src/embeds/n8n-embed.ts) | Logique pure n8n — port brand-agnostic TF2 0.10.26 n8n-embed.ts. |

## `src/historical-migrations/`

| Fichier | Rôle |
|---|---|
| [`src/historical-migrations/index.ts`](../src/historical-migrations/index.ts) | Migrations historiques brand.db (schema_version) — plateforme SoT kit (N4). Hors scope : steps métier TF/CV/Fidu ; `platformCoreMigrations` (core.db). |
| [`src/historical-migrations/runner.ts`](../src/historical-migrations/runner.ts) | Runner de migrations SQLite historiques (brand.db / schema_version). IMPORTANT ABI : better-sqlite3 est compilé pour Node vanilla. Ce runner ne doit PAS être importé dans le process Electron : le main le lance en sous-process via le même binaire Node que le serveur : node …/runner.js <dbPath> Extrait TF gold (N4) — ops event optionnel via `@creezio/observability`. |
| [`src/historical-migrations/types.ts`](../src/historical-migrations/types.ts) | Contrat d'une migration SQLite historique (brand.db / schema_version). IMPORTANT ABI : ces migrations tournent dans un process Node VANILLA (spawn depuis le main Electron), jamais dans le process Electron lui-même, pour charger better-sqlite3 compilé pour Node. Extrait TF gold (N4) — ne pas inventer de DDL. |

## `src/historical-migrations/steps/`

| Fichier | Rôle |
|---|---|
| [`src/historical-migrations/steps/017_agent_todos.ts`](../src/historical-migrations/steps/017_agent_todos.ts) | Step 017 — todos agent synchronisés avec Hermes Kanban. Porté depuis scripts/migrate_v17_agent_todos.py. |
| [`src/historical-migrations/steps/020_api_keys.ts`](../src/historical-migrations/steps/020_api_keys.ts) | Step 020 — clés API publiques (Zapier / Make / n8n). Porté depuis scripts/migrate_v20_api_keys.py. |
| [`src/historical-migrations/steps/022_mcp_oauth.ts`](../src/historical-migrations/steps/022_mcp_oauth.ts) | Step 022 — OAuth 2.1 pour le serveur MCP (ChatGPT connectors). Porté depuis scripts/migrate_v22_mcp_oauth.py. |
| [`src/historical-migrations/steps/023_users.ts`](../src/historical-migrations/steps/023_users.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/024_users_kind.ts`](../src/historical-migrations/steps/024_users_kind.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/025_desktop_presence.ts`](../src/historical-migrations/steps/025_desktop_presence.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/026_collab_ia_kanban.ts`](../src/historical-migrations/steps/026_collab_ia_kanban.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/027_mcp_admin.ts`](../src/historical-migrations/steps/027_mcp_admin.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/028_plugin_product_hub.ts`](../src/historical-migrations/steps/028_plugin_product_hub.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/029_unified_tasks.ts`](../src/historical-migrations/steps/029_unified_tasks.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/030_plugin_prd_sections.ts`](../src/historical-migrations/steps/030_plugin_prd_sections.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/031_ai_recurrence_quotas.ts`](../src/historical-migrations/steps/031_ai_recurrence_quotas.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/032_plugin_acl.ts`](../src/historical-migrations/steps/032_plugin_acl.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/033_database_automations.ts`](../src/historical-migrations/steps/033_database_automations.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/034_emails.ts`](../src/historical-migrations/steps/034_emails.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/035_usage_analytics.ts`](../src/historical-migrations/steps/035_usage_analytics.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/historical-migrations/steps/index.ts`](../src/historical-migrations/steps/index.ts) | Registre des migrations historiques **plateforme** (TF gold N4). Versions = schema_version brand.db (chaîne TF / Certivan héritée). Les steps métier (catalogue, commandes, …) restent dans les marques. |

## `src/plugins/`

| Fichier | Rôle |
|---|---|
| [`src/plugins/plugin-events.ts`](../src/plugins/plugin-events.ts) | Bus d'événements CRM → plugins — logique pure (TF2 0.10.26 plugin-events.ts). |
| [`src/plugins/plugin-execution-grant.ts`](../src/plugins/plugin-execution-grant.ts) | Grants d'exécution plugins (product-hub) — port brand-agnostic TF2. Préfixe token paramétrable (défaut `exec_` ; TF2 utilisait `tf2_exec_`). |
| [`src/plugins/plugin-manifest.ts`](../src/plugins/plugin-manifest.ts) | Contrat manifest + découverte plugins — port TF2 plugin-runtime.ts (partie pure). Le spawn / control-api restent dans @creezio/electron-shell. |
