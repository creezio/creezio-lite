# scripts — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs scripts` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## Racine

| Fichier | Rôle |
|---|---|
| [`build-cjs.mjs`](../build-cjs.mjs) | !usrbinenv node |
| [`build-workspaces.mjs`](../build-workspaces.mjs) | Build unifié des workspaces (tsc + dual CJS) — SoT du script npm build:packages. |
| [`changeset-status-check.mjs`](../changeset-status-check.mjs) | Gate PR changesets : leftover interdit sur `changeset-release/*`, sinon `changeset status --since`. |
| [`check-kit.mjs`](../check-kit.mjs) | Vérifie le profil Sites, sa documentation et la provenance upstream. |
| [`check-upstream.mjs`](../check-upstream.mjs) | Contrôle toutes les empreintes du monorepo et les seuls patchs autorisés. |
| [`clean.mjs`](../clean.mjs) | Supprime les `dist/` des packages et les caches `apps/console/.next` + `apps/demobrand/build` (équivalent Windows-safe de `rm -rf`). |
| [`generate-files-md.mjs`](../generate-files-md.mjs) | Générateur des inventaires `docs/FILES.md` — format standard du kit. |
| [`generate-kit-packages.mjs`](../generate-kit-packages.mjs) | Génère/vérifie packages/platform-core/kit-packages.json (manifeste des packages publiés, consommé par les apps) |
| [`kit-version.mjs`](../kit-version.mjs) | !usrbinenv node |
| [`propagate-brands.mjs`](../propagate-brands.mjs) | Rollout npm flotte (P3.b) — ouvre une PR de sync `@creezio/*` par marque configurée (`.github/propagate-brands.json`) : garde D7 (GET PR ouvertes / pin `package.json` / HTTP 422) puis bump + ajout des deps SoT manquantes via `planCreezioManifestSync` (@creezio/factory, logique partagée avec `creezio upgrade`), extras listés en warning dans la PR, rapport d'impact propagation en corps ; consommé par `propagate.yml`. |
| [`propagation-impact.mjs`](../propagation-impact.mjs) | !usrbinenv node |
| [`reset-tempoflow3.mjs`](../reset-tempoflow3.mjs) | Reset scripté TempoFlow3 : backup → brand apply --force → les fichiers creezio:owned-by-brand / creezio.ownedByBrand sont préservés. |
| [`sync-template.mjs`](../sync-template.mjs) | Synchronise le snapshot des vrais packages vers le template de travail. |
| [`test-fast.mjs`](../test-fast.mjs) | Runner gates fail-fast lisible (`npm run test:kit`/`test:brands`/`test:env`) — suites auto-détectées (matrice dans README), séquentiel, stop 1re rouge, `--from`/`--only`/`--skip`, JSONL /tmp/creezio-test-fast.log |
| [`test-kit.mjs`](../test-kit.mjs) | Exécute la suite propre au profil Sites. |
| [`test-mails-inbox.mjs`](../test-mails-inbox.mjs) | Tests inbox SoT @creezio/mails (insert/list/read/delete/PJ + configureMails). |
| [`test-meili-no-brand-legacy.mjs`](../test-meili-no-brand-legacy.mjs) | Gate — pas de vocabulaire marque legacy (`tf2_`) dans le module Meili natif. |
| [`test-os-ai-missions.mjs`](../test-os-ai-missions.mjs) | Gate OS — surface missions IA (tasks kit) : exports ai-task / Hermes, configureTasksBrand, SSE activity stream. |
| [`test-os-app-kind.mjs`](../test-os-app-kind.mjs) | appKind client/server — résolution kit (équivalent TF2 test:app-kind). |
| [`test-os-cold-warm.mjs`](../test-os-cold-warm.mjs) | Cold-start OS : userData vide + warm n8n réel + /os/ready. Hermes skip par défaut (install lourde) — CREEZIO_COLD_WARM_HERMES=1 pour inclure. |
| [`test-os-connection-profile.mjs`](../test-os-connection-profile.mjs) | Connection profile Héberger / Rejoindre via HTTP OS. Harness optionnel si probe brand (tempoflow3) résolu hors monorepo. |
| [`test-os-electron-runtime-smoke.mjs`](../test-os-electron-runtime-smoke.mjs) | Smoke shell runtime Electron — wiring kit + lancement court si electron/xvfb. |
| [`test-os-email-surface.mjs`](../test-os-email-surface.mjs) | Gate OS — surface `/api/v1/email` montée par app-runtime (Worker inbound). |
| [`test-os-embeds.mjs`](../test-os-embeds.mjs) | Gate OS — embeds Hermes/n8n + catalogue env (port TF2 hermes-embed / n8n-embed / embed-env). |
| [`test-os-fleet-compose.mjs`](../test-os-fleet-compose.mjs) | Gate OS — composeBrandOs branche fleet: depuis manifest.features.fleet. |
| [`test-os-mails-config.mjs`](../test-os-mails-config.mjs) | Gate OS — configureMails + file-sink send + schéma inbox prêt. |
| [`test-os-mcp-oauth.mjs`](../test-os-mcp-oauth.mjs) | MCP OAuth + admin — prouvable en local (sans Cloudflare). Harness si probe brand résolu hors monorepo kit. |
| [`test-os-native-pnp.mjs`](../test-os-native-pnp.mjs) | Gate OS native plug-and-play — multi-marques : prouve qu'une app neuve (brand apply) démarre avec embeds, DB et surfaces OS sans wiring manuel. |
| [`test-os-native-warm-flags.mjs`](../test-os-native-warm-flags.mjs) | Contrat warm n8n/Hermes indépendants en local ; VPS create/update ignore les skips ; GET `/plugin-approvals` 200 liste vide sans Product Hub. |
| [`test-os-open-external-tab.mjs`](../test-os-open-external-tab.mjs) | Gate OS — onglets externes + tool MCP `open_external_tab`. Unit-style (tab-url, preload path, contrats MCP) — pas de GUI Electron. |
| [`test-os-owned-by-brand.mjs`](../test-os-owned-by-brand.mjs) | brand apply --force ne doit pas wipe les fichiers creezio:owned-by-brand. |
| [`test-os-plugins.mjs`](../test-os-plugins.mjs) | Plugins control plane via compose OS — actifs par défaut, kill-switch CREEZIO_PLUGINS=0 (l'ancien opt-in =1 reste un no-op). |
| [`test-os-public-origin.mjs`](../test-os-public-origin.mjs) | Gate OS — public-origin / cookies Secure (port TF2 test:public-origin). |
| [`test-os-shell-contracts.mjs`](../test-os-shell-contracts.mjs) | Contrats shell OS kit (splash / tray / embeds / updater / vendors). |
| [`test-os-shell-more.mjs`](../test-os-shell-more.mjs) | Extensions shell kit — fonctions réellement exportées par @creezio/platform-core. |
| [`test-os-shell.mjs`](../test-os-shell.mjs) | Agrégat test:shell kit — contrats + surfaces BYOK/recovery/updater/tunnel. |
| [`test-os-updater.mjs`](../test-os-updater.mjs) | Gate OS — reduceur updater (port TF2 test:updater), sans Electron. |
| [`test-phase-access-control.mjs`](../test-phase-access-control.mjs) | Gate @creezio/access-control : résolution rôles+overrides, cache, garde API /access, matrice, comptes, audit |
| [`test-phase-admin-billing.mjs`](../test-phase-admin-billing.mjs) | Gate — module billing admin (@creezio/admin) : webhook + réconciliation. |
| [`test-phase-admin-database-runtime.mjs`](../test-phase-admin-database-runtime.mjs) | Gate Admin Database runtime : stores `core`+`brand` auto-enregistrés + `GET /database/dbs` |
| [`test-phase-admin-fleet-registry.mjs`](../test-phase-admin-fleet-registry.mjs) | Gate — module fleet-registry (@creezio/admin) : DB flotte centrale (F2). |
| [`test-phase-admin-prospects.mjs`](../test-phase-admin-prospects.mjs) | Gate CRUD prospects admin (PROSP-5) + validation nom requis (PROSP-3) sur `createAdminCrudMount`. |
| [`test-phase-admin-roadmap.mjs`](../test-phase-admin-roadmap.mjs) | Gate CRUD roadmap admin (ROAD-4) + validation titre requis (ROAD-3) + tri par position. |
| [`test-phase-agent-tunnel.mjs`](../test-phase-agent-tunnel.mjs) | Gate T7 — tunnel cloudflared dédié agent : politique respawn bornée + watch container (docker injecté) côté fleet, helpers container factory (token jamais en argv), ordre migration douce de l'enroll. |
| [`test-phase-api-entity-mount.mjs`](../test-phase-api-entity-mount.mjs) | Gate entity mounts — moteur CRUD déclaratif `@creezio/api-kernel` (`createEntityApiMount` / `registerEntityMounts`). |
| [`test-phase-api-fallthrough-loop.mjs`](../test-phase-api-fallthrough-loop.mjs) | Coupe-circuit anti-boucle 404 kernel→Next→kernel (`x-creezio-kernel-fallthrough` / `inflightApiFallthrough`). |
| [`test-phase-app-runtime.mjs`](../test-phase-app-runtime.mjs) | Gate app-runtime — façade exports + composeBrandOs smoke (sans apps/tempoflow3). |
| [`test-phase-arch-codemod.mjs`](../test-phase-arch-codemod.mjs) | Un bump `ARCHITECTURE_VERSION` livre ses codemods (`scripts/codemods/<ver>/manifest.json` + scripts présents + `node --check`). |
| [`test-phase-assistant-openai-tools.mjs`](../test-phase-assistant-openai-tools.mjs) | Gate assistant — payload tools OpenAI : dédup nom safe + plafond 128 (`selectOpenAiToolDefinitions`), pas d'alias Hermes dans `mcpFacadeToAssistantConfig`. |
| [`test-phase-auth-brand-role.mjs`](../test-phase-auth-brand-role.mjs) | Gate rôle métier en session — configureAuth.resolveBrandRole : absent→null, résolu via db brand, impersonation→rôle de la cible, resolver en échec→null (jamais de 500 sur /me). |
| [`test-phase-auth-secret.mjs`](../test-phase-auth-secret.mjs) | Gate sécurité AUTH_SECRET serveur (fix trou : serveurs Docker headless signaient les sessions avec le fallback dev public). |
| [`test-phase-b.mjs`](../test-phase-b.mjs) | !usrbinenv node |
| [`test-phase-b2.mjs`](../test-phase-b2.mjs) | !usrbinenv node |
| [`test-phase-brand-allowlist.mjs`](../test-phase-brand-allowlist.mjs) | Allowlist anti-dérive — brand create sans notes/crm/glue OS, registre + mount demo. |
| [`test-phase-brand-spec.mjs`](../test-phase-brand-spec.mjs) | Gate BrandSpec — load / doctor / init / onboarding decl. Extract P1.1 : package + ADR (+ CREATE-BRAND doc). |
| [`test-phase-build-order-imports.mjs`](../test-phase-build-order-imports.mjs) | Gate P1.a — graphe des imports `@creezio/*` RUNTIME (type-only ignorés, templates factory neutralisés) : zéro cycle + chaque import respecte l'ordre de build (`build-workspaces.mjs --list`). |
| [`test-phase-c.mjs`](../test-phase-c.mjs) | !usrbinenv node |
| [`test-phase-c0.mjs`](../test-phase-c0.mjs) | Phase C0 — docs/archive/gates/matrice = état réel + backlog C*. |
| [`test-phase-c1.mjs`](../test-phase-c1.mjs) | Phase C1 — schéma kit rich + docs cutover TF. |
| [`test-phase-c2.mjs`](../test-phase-c2.mjs) | Phase C2 — docs cutover Certivan. |
| [`test-phase-c3.mjs`](../test-phase-c3.mjs) | Phase C3 — fabrique V1 réelle : scaffold riche, console SQLite, PrdDrafter. |
| [`test-phase-c4.mjs`](../test-phase-c4.mjs) | Phase C4 — V2/V3 prod-ready : SQLite obs/automations + console + docs. |
| [`test-phase-c7.mjs`](../test-phase-c7.mjs) | Phase C7 — startHostPluginControlPlane unifié (4 boots + ACL). |
| [`test-phase-changeset-status.mjs`](../test-phase-changeset-status.mjs) | Source conservée du kit original. |
| [`test-phase-clone-autonomy.mjs`](../test-phase-clone-autonomy.mjs) | Gate — clone autonome des repos marque (distribution sans kit). |
| [`test-phase-cloudflared-respawn.mjs`](../test-phase-cloudflared-respawn.mjs) | Gate — superviseur cloudflared in-process : politique backoff/abandon, respawn même token/id, stop annule le timer, spawn sans POST cfd_tunnel. |
| [`test-phase-crash-reporter.mjs`](../test-phase-crash-reporter.mjs) | Gate crash-reporter kit — upload configurable + brandId + pending queue. |
| [`test-phase-create-brand.mjs`](../test-phase-create-brand.mjs) | Sonde E2E CREATE-BRAND — init → doctor → apply → smoke façade. |
| [`test-phase-creezio-manifest-align.mjs`](../test-phase-creezio-manifest-align.mjs) | Gate P1.a — manifests marque alignés : scaffold factory (specs `@creezio/*` identiques dans server / server/ui / client) + doctor brand-spec `CREEZIO_MANIFEST_MISALIGNED` (incident login 0.6.0). |
| [`test-phase-d.mjs`](../test-phase-d.mjs) | !usrbinenv node |
| [`test-phase-data-changed.mjs`](../test-phase-data-changed.mjs) | Bus réactivité `x-creezio-data-changed` (constantes shell-ui/api-kernel, parse header, infer tool, keep-alive, liens assistant navigate). |
| [`test-phase-desktop-server-parity.mjs`](../test-phase-desktop-server-parity.mjs) | Gate parité desktop Serveur TF2 0.10.26 : NSIS (démarrage auto, désinstall profonde), UI Configuration (tray / launchAtStartup / factory-reset), runtime. |
| [`test-phase-docs-freshness.mjs`](../test-phase-docs-freshness.mjs) | Gate D0 — fraîcheur documentaire (docs/DOC-STANDARD.md). Vérifie, pour chaque cible du périmètre (packages/*, docker/*, apps/*, scripts/) : 1. |
| [`test-phase-e.mjs`](../test-phase-e.mjs) | !usrbinenv node |
| [`test-phase-f.mjs`](../test-phase-f.mjs) | !usrbinenv node |
| [`test-phase-factory-docker-parity.mjs`](../test-phase-factory-docker-parity.mjs) | Gate héritage factory → Docker (env, opt-in CREEZIO_FACTORY_DOCKER=1). |
| [`test-phase-factory-lockfile.mjs`](../test-phase-factory-lockfile.mjs) | Cohérence `package-lock` marque (`isPackageLockInSync`) pour que `npm ci` Docker ne casse pas le layout `node_modules`. |
| [`test-phase-factory-prd-experience.mjs`](../test-phase-factory-prd-experience.mjs) | Gate expérience F5 — brief produit → `new-app --from-prd` (layout monorepo) + smoke, hors-ligne via lien `node_modules` kit. |
| [`test-phase-factory-prd.mjs`](../test-phase-factory-prd.mjs) | Gate F0–F5 — factory `--from-prd` natif (api-kernel + SQLite) ; smoke F3 hors-ligne via lien `node_modules` kit. |
| [`test-phase-factory-templates.mjs`](../test-phase-factory-templates.mjs) | Templates factory substituent les entités réelles du spec (pas de notes fantômes, pas de feed sur table absente, pas de chemin monorepo kit). |
| [`test-phase-factory-two-repos.mjs`](../test-phase-factory-two-repos.mjs) | Gate FLOTTE — factory 2-repos : chaque marque = monorepo (server/ client/) + repo ADMIN dédié `<brand>-admin` (pilotage flotte multi-VPS, sans secret). |
| [`test-phase-fleet-agent.mjs`](../test-phase-fleet-agent.mjs) | Gate FLOTTE — agent hôte + server-admin multi-VPS (`@creezio/fleet`, 409 sans header protocole). |
| [`test-phase-fleet-heartbeat.mjs`](../test-phase-fleet-heartbeat.mjs) | Gate — auto-inscription flotte + heartbeat (F3). Prouve, avec un VRAI serveur HTTP admin (mount fleet-registry @creezio/admin sur DB better-sqlite3) et le client kit (@creezio/app-runtime) : 1. |
| [`test-phase-fleet-releases.mjs`](../test-phase-fleet-releases.mjs) | Gate — updates en PULL de la flotte (F5). Prouve, sur DB brand réelle (better-sqlite3, migrations admin) + mocks admin/registre : 1. |
| [`test-phase-fleet-rollout.mjs`](../test-phase-fleet-rollout.mjs) | Gate — rollout piloté de la flotte (F6). Prouve, sur DB brand réelle (better-sqlite3, migrations admin) : 1. |
| [`test-phase-fleet-update-status-persist.mjs`](../test-phase-fleet-update-status-persist.mjs) | Gate FLOTTE T8 — persistance update-status (`@creezio/fleet`) : journal JSON atomique, reload + `agentRestarted`, TTL 24 h, restart simulé du host-agent. |
| [`test-phase-granola.mjs`](../test-phase-granola.mjs) | Gate — module natif hybride Granola (webhook Standard Webhooks, sync notes, proxys API). |
| [`test-phase-grokbot.mjs`](../test-phase-grokbot.mjs) | Gate — module natif hybride GrokBot (API Cursor v1, token masqué, miroir agents). |
| [`test-phase-h1.mjs`](../test-phase-h1.mjs) | !usrbinenv node |
| [`test-phase-h2.mjs`](../test-phase-h2.mjs) | !usrbinenv node |
| [`test-phase-h3.mjs`](../test-phase-h3.mjs) | Tests Phase H3 — cadre kit (métier reste dans tempoflow2). |
| [`test-phase-h4.mjs`](../test-phase-h4.mjs) | Tests Phase H4 — proxy MCP unifié (registry, namespaces, aliases, policies). |
| [`test-phase-h5.mjs`](../test-phase-h5.mjs) | !usrbinenv node |
| [`test-phase-harness-parity.mjs`](../test-phase-harness-parity.mjs) | Gate parité serveur Docker headless — phases TF2 portées dans le harness (`startBrandKernelHarness`), prouvées fonctionnellement en sandbox. |
| [`test-phase-hermes-computer-use.mjs`](../test-phase-hermes-computer-use.mjs) | H3/H4 « Hermes cerveau unique » — verbes navigateur directs + HITL async + skills sites auto-entretenus. |
| [`test-phase-hermes-mcp.mjs`](../test-phase-hermes-mcp.mjs) | H1 « Hermes cerveau unique » — Hermes pilote le runner de tâches. |
| [`test-phase-hermes-web-allowlist.mjs`](../test-phase-hermes-web-allowlist.mjs) | H0 « Hermes cerveau unique » — allowlist web appliquée AU NIVEAU EXÉCUTION. |
| [`test-phase-host-no-electron.mjs`](../test-phase-host-no-electron.mjs) | Gate P1.a — pureté host : zéro import statique d'`electron` dans `electron-shell/src/host/**` (valeurs via `loadElectron()`, seule exception `host/load-electron.ts`). |
| [`test-phase-hybrid.mjs`](../test-phase-hybrid.mjs) | Gate architecture hybride : browser-host (driver partagé, sans electron), surface plateforme + sidecar IA, client thin `requireRemoteProfile`, bridge session, `defaultServerUrl`, onglets réels install-brand-os-desktop, Hermes `--skip-browser` conditionnel |
| [`test-phase-i0.mjs`](../test-phase-i0.mjs) | Phase I0 — gouvernance : sync vendor contrat, ARCHITECTURE_VERSION, docs. |
| [`test-phase-i1.mjs`](../test-phase-i1.mjs) | Phase I1 — createSqliteAuthStore (core.db) + session après restart. |
| [`test-phase-i2.mjs`](../test-phase-i2.mjs) | Phase I2 — createSqliteAssistantStore (core.db) + persist after reopen. |
| [`test-phase-i3.mjs`](../test-phase-i3.mjs) | Phase I3 — tasks/mails sqlite + file-sink provider + vendor list. |
| [`test-phase-i4.mjs`](../test-phase-i4.mjs) | Phase I4 — control-plane unifié : helpers ACL + demobrand path. |
| [`test-phase-i5.mjs`](../test-phase-i5.mjs) | Phase I5 — Admin Plugins L3 : upsert caps + deny cross-org (API = UI). |
| [`test-phase-i6.mjs`](../test-phase-i6.mjs) | Phase I6 — createFileOrgPluginRegistry persisté + reopen. |
| [`test-phase-i7.mjs`](../test-phase-i7.mjs) | Phase I7 — createNavShellAdapter + demobrand conso. |
| [`test-phase-i8.mjs`](../test-phase-i8.mjs) | Phase I8 — freeze H6 : ARCHITECTURE_VERSION + factory scaffold + parity doc. |
| [`test-phase-instance-stack.mjs`](../test-phase-instance-stack.mjs) | Stack compose M2 autonome : port interne 18791, cloudflared in-process, secrets en `env_file` 600, labels fleet. |
| [`test-phase-integrations.mjs`](../test-phase-integrations.mjs) | Gate — intégrations / clés API tierces (ADR-integrations-store). |
| [`test-phase-interactive-demo.mjs`](../test-phase-interactive-demo.mjs) | Gate @creezio/interactive-demo : patron hybride (migrations, merge défauts/overrides, mount scenarios/preferences), validation de scénario, scénario générique OS, surface UI |
| [`test-phase-kit-packages-manifest.mjs`](../test-phase-kit-packages-manifest.mjs) | Gate : manifeste kit-packages.json à jour (rattrapage : generate-kit-packages.mjs) |
| [`test-phase-landing.mjs`](../test-phase-landing.mjs) | Gate — module natif hybride « landing page » (ADR-module-natif-hybride). |
| [`test-phase-link-kit-node-modules.mjs`](../test-phase-link-kit-node-modules.mjs) | Contrat lien `node_modules` kit → app générée (symlink, pas d'écrasement, recréation cassé) + factory-prd* hors-ligne. |
| [`test-phase-m0.mjs`](../test-phase-m0.mjs) | Phase M0 — baseline vision stricte : inventaire + freeze anti-stub. |
| [`test-phase-m1.mjs`](../test-phase-m1.mjs) | Phase M1 — cutover Database TF sans shims (vision stricte). |
| [`test-phase-m10.mjs`](../test-phase-m10.mjs) | !usrbinenv node |
| [`test-phase-m11.mjs`](../test-phase-m11.mjs) | !usrbinenv node |
| [`test-phase-m12.mjs`](../test-phase-m12.mjs) | !usrbinenv node |
| [`test-phase-m12p.mjs`](../test-phase-m12p.mjs) | !usrbinenv node |
| [`test-phase-m13.mjs`](../test-phase-m13.mjs) | !usrbinenv node |
| [`test-phase-m14.mjs`](../test-phase-m14.mjs) | !usrbinenv node |
| [`test-phase-m15.mjs`](../test-phase-m15.mjs) | !usrbinenv node |
| [`test-phase-m16.mjs`](../test-phase-m16.mjs) | !usrbinenv node |
| [`test-phase-m2.mjs`](../test-phase-m2.mjs) | Phase M2 — Admin UI Database hors TF (vision stricte). |
| [`test-phase-m2p.mjs`](../test-phase-m2p.mjs) | Phase M2p — Admin UI Database Certivan puis Fidu (vision stricte). |
| [`test-phase-m3.mjs`](../test-phase-m3.mjs) | Phase M3 — Product Hub / control-plane zéro façade TF (vision stricte). |
| [`test-phase-m3p.mjs`](../test-phase-m3p.mjs) | Phase M3p — Product Hub Certivan + Fidu (vision stricte). |
| [`test-phase-m4.mjs`](../test-phase-m4.mjs) | Phase M4 — Delete local-config TF (vision stricte). |
| [`test-phase-m5.mjs`](../test-phase-m5.mjs) | Phase M5 — Delete bootstraps hermes/n8n TF (vision stricte). |
| [`test-phase-m6p.mjs`](../test-phase-m6p.mjs) | !usrbinenv node |
| [`test-phase-m7.mjs`](../test-phase-m7.mjs) | !usrbinenv node |
| [`test-phase-m7p.mjs`](../test-phase-m7p.mjs) | !usrbinenv node |
| [`test-phase-m8.mjs`](../test-phase-m8.mjs) | !usrbinenv node |
| [`test-phase-m8p.mjs`](../test-phase-m8p.mjs) | !usrbinenv node |
| [`test-phase-m9.mjs`](../test-phase-m9.mjs) | !usrbinenv node |
| [`test-phase-mails-imap.mjs`](../test-phase-mails-imap.mjs) | MC1 — CRUD comptes IMAP + sync incrémentale contre mock IMAP local. |
| [`test-phase-mails-outbox.mjs`](../test-phase-mails-outbox.mjs) | MB1 — outbox durable : enqueue, worker, retries backoff, PJ, brouillons. |
| [`test-phase-mails-transports.mjs`](../test-phase-mails-transports.mjs) | MA2 — résolution transport, preset cloudflare, SMTP local, mock Resend. |
| [`test-phase-mails-ui.mjs`](../test-phase-mails-ui.mjs) | MD — webmail : exports, iframe sandbox (XSS), Tiptap, wrappers os-ui/factory. |
| [`test-phase-mails-webhooks.mjs`](../test-phase-mails-webhooks.mjs) | MB2 — webhooks Resend : signature Svix, delivered/bounced, inbound opt-in. |
| [`test-phase-mcp-tool-policy-guard.mjs`](../test-phase-mcp-tool-policy-guard.mjs) | Gate M1-M2 — garde d'enforcement réutilisable des policies MCP admin (`packages/mcp-facade/src/admin/tool-policy-guard.ts`). |
| [`test-phase-meili-browse.mjs`](../test-phase-meili-browse.mjs) | Gate Meili browse : q vide = Meili, 0 hit = meili, filtre rejeté = SQL visible ; factory sans piège 0-hit→SQL ; modules catalogue meiliIndexes ou horsIndexJustification. |
| [`test-phase-meili-feed.mjs`](../test-phase-meili-feed.mjs) | Gate Phase C — BrandMeiliFeed générique (pas de tf2_* dans le chemin feed). |
| [`test-phase-meili-smoke-polling.mjs`](../test-phase-meili-smoke-polling.mjs) | Gate — smokes compatibles cohérence éventuelle Meili : comportement du helper `meili-list-poll.mjs` (polling borné, fail-fast `engine:"meili"`, hydratation `?ids=`) + branchement dans e2e-browser-parcours et les templates factory. |
| [`test-phase-module-docs.mjs`](../test-phase-module-docs.mjs) | Standard module (prd/interview/TODO/CHANGELOG + `gate.mjs` si colocated) sur kit admin, marque sonde et admin-spec. |
| [`test-phase-module-mount-session.mjs`](../test-phase-module-mount-session.mjs) | Garde session HTTP sur `/api/v1/modules/*` et `/api/v1/admin/*` (401 anonyme, JWT, clé machine, allowlist public). |
| [`test-phase-module-ops.mjs`](../test-phase-module-ops.mjs) | Gate contrat 0.10.6 — ops EntitySpec auto, listTools `module.test.from-panier` via handle(), catalogue kernel, doctor MODULE_OP_*. |
| [`test-phase-n0.mjs`](../test-phase-n0.mjs) | !usrbinenv node |
| [`test-phase-n1.mjs`](../test-phase-n1.mjs) | !usrbinenv node |
| [`test-phase-n1p.mjs`](../test-phase-n1p.mjs) | !usrbinenv node |
| [`test-phase-n2.mjs`](../test-phase-n2.mjs) | !usrbinenv node |
| [`test-phase-n2p.mjs`](../test-phase-n2p.mjs) | !usrbinenv node |
| [`test-phase-n3.mjs`](../test-phase-n3.mjs) | !usrbinenv node |
| [`test-phase-n3p.mjs`](../test-phase-n3p.mjs) | !usrbinenv node |
| [`test-phase-n4.mjs`](../test-phase-n4.mjs) | !usrbinenv node |
| [`test-phase-n4p.mjs`](../test-phase-n4p.mjs) | !usrbinenv node |
| [`test-phase-n5.mjs`](../test-phase-n5.mjs) | !usrbinenv node |
| [`test-phase-n6.mjs`](../test-phase-n6.mjs) | !usrbinenv node |
| [`test-phase-n6p.mjs`](../test-phase-n6p.mjs) | !usrbinenv node |
| [`test-phase-n7.mjs`](../test-phase-n7.mjs) | !usrbinenv node |
| [`test-phase-n8.mjs`](../test-phase-n8.mjs) | !usrbinenv node |
| [`test-phase-n9.mjs`](../test-phase-n9.mjs) | !usrbinenv node |
| [`test-phase-nav-catalog.mjs`](../test-phase-nav-catalog.mjs) | Gate NAV-1 — catalogue nav OS : merge pur, collision id/href, feature-off, seed registre, factory chrome sans `const OS_NAV` ni literal `/granola`. |
| [`test-phase-nav-module.mjs`](../test-phase-nav-module.mjs) | Gate NAV-2 — module hybride `@creezio/nav` : migrations brand.db, GET/PUT overrides, feature-off, 403 sans permission, owner + hidden. |
| [`test-phase-no-brand-vocab.mjs`](../test-phase-no-brand-vocab.mjs) | Vocabulaire marque interdit dans `packages/*/src\|ui` — allowlist ratchetée décroissante (`brand-vocab.mjs`). |
| [`test-phase-o1.mjs`](../test-phase-o1.mjs) | !usrbinenv node |
| [`test-phase-o2.mjs`](../test-phase-o2.mjs) | !usrbinenv node |
| [`test-phase-o3.mjs`](../test-phase-o3.mjs) | !usrbinenv node |
| [`test-phase-o3p.mjs`](../test-phase-o3p.mjs) | !usrbinenv node |
| [`test-phase-o4.mjs`](../test-phase-o4.mjs) | !usrbinenv node |
| [`test-phase-o4p.mjs`](../test-phase-o4p.mjs) | !usrbinenv node |
| [`test-phase-o4r.mjs`](../test-phase-o4r.mjs) | !usrbinenv node |
| [`test-phase-o4r2.mjs`](../test-phase-o4r2.mjs) | !usrbinenv node |
| [`test-phase-o4r3.mjs`](../test-phase-o4r3.mjs) | !usrbinenv node |
| [`test-phase-o4r4.mjs`](../test-phase-o4r4.mjs) | !usrbinenv node |
| [`test-phase-o5.mjs`](../test-phase-o5.mjs) | !usrbinenv node |
| [`test-phase-o6.mjs`](../test-phase-o6.mjs) | !usrbinenv node |
| [`test-phase-o7.mjs`](../test-phase-o7.mjs) | !usrbinenv node |
| [`test-phase-o8.mjs`](../test-phase-o8.mjs) | !usrbinenv node |
| [`test-phase-o9.mjs`](../test-phase-o9.mjs) | !usrbinenv node |
| [`test-phase-onboarding-hybride.mjs`](../test-phase-onboarding-hybride.mjs) | Gate : @creezio/onboarding conforme au patron « module natif hybride » (docs/adr/ADR-module-natif-hybride.md). |
| [`test-phase-os-nav-catalog.mjs`](../test-phase-os-nav-catalog.mjs) | Gate NAV-3 — chaque `OS_UI_ROUTE_SEGMENTS` primaire ∈ catalogue ou `horsNavJustification` ; factory chrome = `NavCatalogLoader` sans literal `"/granola"` / `"/grokbot"`. |
| [`test-phase-os-ui-scaffold.mjs`](../test-phase-os-ui-scaffold.mjs) | Gate : factory --from-prd ne versionne PLUS de pages OS dans ui/app/ ; deps générées incluent `@creezio/granola` / `@creezio/grokbot` / `@creezio/nav` (vagues publish). |
| [`test-phase-p-cockpit.mjs`](../test-phase-p-cockpit.mjs) | !usrbinenv node |
| [`test-phase-p-onboarding.mjs`](../test-phase-p-onboarding.mjs) | !usrbinenv node |
| [`test-phase-p-shell-ui.mjs`](../test-phase-p-shell-ui.mjs) | !usrbinenv node |
| [`test-phase-p18-host-tools.mjs`](../test-phase-p18-host-tools.mjs) | !usrbinenv node |
| [`test-phase-p18-open-external-tab.mjs`](../test-phase-p18-open-external-tab.mjs) | !usrbinenv node |
| [`test-phase-p25.mjs`](../test-phase-p25.mjs) | !usrbinenv node |
| [`test-phase-p29.mjs`](../test-phase-p29.mjs) | !usrbinenv node |
| [`test-phase-pack-runtime-deps.mjs`](../test-phase-pack-runtime-deps.mjs) | Gate : config electron-builder embarque la clôture npm runtime (hono, better-sqlite3, …) + asarUnpack natifs. |
| [`test-phase-platform-native-mounts.mjs`](../test-phase-platform-native-mounts.mjs) | Gate montages natifs kit : Tasks autoconfig, Analytics admin, stub OpenAPI `/api/v1/openapi.json` |
| [`test-phase-platform-user-admin.mjs`](../test-phase-platform-user-admin.mjs) | `configureAuth({ userAdminPermission })` — collaborateurs POST/PATCH `/platform/users`, anti-escalade, owner inchangé. |
| [`test-phase-platform-users.mjs`](../test-phase-platform-users.mjs) | Gate — référentiel utilisateurs UNIQUE (API plateforme users). |
| [`test-phase-plugin-insights.mjs`](../test-phase-plugin-insights.mjs) | Gate P4 plugins natifs — plugin démo kit « insights-assistant ». |
| [`test-phase-plugin-tools.mjs`](../test-phase-plugin-tools.mjs) | Gate P2/P3 plugins natifs — tools MCP plugins + mounts API kernel. |
| [`test-phase-plugins-default.mjs`](../test-phase-plugins-default.mjs) | Gate P1 plugins natifs — activation par défaut. - PD1 : sans env ⇒ plugins ENABLED (défaut inversé, plus d'opt-in). |
| [`test-phase-propagate-pr-guard.mjs`](../test-phase-propagate-pr-guard.mjs) | Gate D7 — garde anti-doublon PR de propagate (`propagate-pr-guard`, mock gh : titre / head / pin / HTTP 422). |
| [`test-phase-r0.mjs`](../test-phase-r0.mjs) | Phase R0 — gel inventions + clarif lifecycle-only. |
| [`test-phase-r1.mjs`](../test-phase-r1.mjs) | Phase R1 — @creezio/database (port TempoFlow Admin Database). |
| [`test-phase-r2.mjs`](../test-phase-r2.mjs) | Phase R2 — Product Hub SoT unique core.db. |
| [`test-phase-r3.mjs`](../test-phase-r3.mjs) | !usrbinenv node |
| [`test-phase-r4.mjs`](../test-phase-r4.mjs) | !usrbinenv node |
| [`test-phase-registry-pull-proxy.mjs`](../test-phase-registry-pull-proxy.mjs) | Gate — exposition du registre Docker en pull authentifié (F4). |
| [`test-phase-resolve-manifest.mjs`](../test-phase-resolve-manifest.mjs) | Gate resolveManifest — registre + fallback app-manifest.json (from-prd). |
| [`test-phase-runtime-dist-freshness.mjs`](../test-phase-runtime-dist-freshness.mjs) | Gate ADR.1b généralisée — dist runtime = câblage src (content + mtime) ; fail-closed sync/publish. |
| [`test-phase-server-docker-ghcr-gc.mjs`](../test-phase-server-docker-ghcr-gc.mjs) | Gate D5 — rétention GHCR (API Packages versions, 3 semver + jamais in-use, fail-closed sans auth, mock HTTP). |
| [`test-phase-server-docker-owner.mjs`](../test-phase-server-docker-owner.mjs) | Gate — create VPS fail-closed sans `CREEZIO_OWNER_EMAIL`/`_PASSWORD` ; persist `secrets.env` ; `ensure-owner` + `CREEZIO_E2E_*` optionnels ; LOCAL=1 owner optionnel ; setup + login mockés ; jamais le mot de passe en log. |
| [`test-phase-server-docker-registry-gc.mjs`](../test-phase-server-docker-registry-gc.mjs) | Gate T11 — `server-docker registry-gc` : plan/rétention par famille `auto.*`, protections servers.json + releases fleet, dry-run par défaut + `--apply`, mock HTTP fail-closed ; live `registry:2` éphémère ou skip explicite si Docker absent. |
| [`test-phase-server-docker-tunnel.mjs`](../test-phase-server-docker-tunnel.mjs) | Gate — create VPS fail-closed sans contrat CF (`CREEZIO_CF_*`) + mapping slug réservé `demo` → `<brand>-demo`. |
| [`test-phase-server-docker-ufw.mjs`](../test-phase-server-docker-ufw.mjs) | Gate — préflight UFW flotte : parsing `ufw status` (172.16.0.0/12, jamais docker0 seul), pose auto avec re-vérification via `sudo -n`, fail-closed actionnable si pose impossible, ancrage des 3 appels CLI (`agent up`/`admin up`/`enroll`). |
| [`test-phase-server-docker.mjs`](../test-phase-server-docker.mjs) | Gate — artefacts docker/server + CLI creezio server-docker. |
| [`test-phase-shell-desktop-api.mjs`](../test-phase-shell-desktop-api.mjs) | Gate — `getShellDesktopApi` uniquement (pas de `window.*Desktop` hardcodé) + import obligatoire ; scan kit UI + TF3 si présent. |
| [`test-phase-single-data-plane.mjs`](../test-phase-single-data-plane.mjs) | Un seul plan de données métier `brand.db` — UI générée sans client SQLite, scan marque sonde + allowlist datée. |
| [`test-phase-sqlite-wal-resilience.mjs`](../test-phase-sqlite-wal-resilience.mjs) | Quarantaine WAL/SHM à l'open + checkpoint `close` + harness `closeKernel` avant sidecars (anti boot-loop SIGKILL). |
| [`test-phase-stack-update-preserve.mjs`](../test-phase-stack-update-preserve.mjs) | Gate — update ne peut plus retirer un sidecar cloudflared ni changer le hostname : preserve + fail-closed + LOCAL=1 + migrate explicite. |
| [`test-phase-tf3-chrome.mjs`](../test-phase-tf3-chrome.mjs) | Cutover chrome marque sonde (jumeaux layout/assistant absents + `configureSidebar`) — skip si repo absent. |
| [`test-phase-tunnel-self-provision.mjs`](../test-phase-tunnel-self-provision.mjs) | Auto-provisioning tunnel CF mocké (verify token, create/idempotence/404, DNS, deprovision) + §10 tunnel dédié agent T7 (`ensureCfAgentTunnel`, migration douce) — zéro réseau réel. |
| [`test-phase-upgrade-runner.mjs`](../test-phase-upgrade-runner.mjs) | Gate P3.a — `creezio upgrade` : dry-run no-op sur scaffold frais, chaîne multi-versions (H8→…→cible courante) dans l'ordre sur fixture en retard, application réelle idempotente. |
| [`test-phase-v1.mjs`](../test-phase-v1.mjs) | Phase V1 — fabrique plugins conversationnelle (demobrand E2E). |
| [`test-phase-v2.mjs`](../test-phase-v2.mjs) | Phase V2 — observabilité native (activité, usages plugins, control-plane). |
| [`test-phase-v3.mjs`](../test-phase-v3.mjs) | Phase V3 — automations data-driven (triggers lifecycle / données). |
| [`validate-examples.mjs`](../validate-examples.mjs) | Génère et construit deux applications indépendantes. |

## `codemods/H10/`

| Fichier | Rôle |
|---|---|
| [`codemods/H10/h10-explicit-desktop-deps.mjs`](../codemods/H10/h10-explicit-desktop-deps.mjs) | Codemod H10 (P2.a clôturé, T9) : clients desktop legacy → deps explicites au point d'appel `installBrandDesktopRuntime` (valeurs d'env historiques), renommage `ensureTempoflowNode` → `ensureDesktopNode`, rebascule preload historique → `preload.js`. Idempotent, fail-closed. |

## `codemods/H11/`

| Fichier | Rôle |
|---|---|
| [`codemods/H11/h11-purge-tf2-compat.mjs`](../codemods/H11/h11-purge-tf2-compat.mjs) | Codemod H11 : purge compat TF2-era — `TEMPOFLOW_*` → préfixe manifeste, asserts feed CHR, `countKey: "sites"`, retire fallback builder. Fail-closed si appel runtime `createChrCatalogMeiliFeed` ou import `*Manifest` prod. Idempotent. |

## `codemods/H12/`

| Fichier | Rôle |
|---|---|
| [`codemods/H12/h12-electron-shell-imports.mjs`](../codemods/H12/h12-electron-shell-imports.mjs) | Codemod H12 (1/2) : reclasse les imports `@creezio/electron-shell` (barrel + subpath `./meili`) vers les packages SoT host-runtime/search/platform-core ; renomme les alias host nommés marque (`ensureTempoflowNode` → `ensureDesktopNode`, pins `TF2_*` → `DESKTOP_*`…) et `nodeEnsure`. Idempotent. |
| [`codemods/H12/h12-workspace-debrand.mjs`](../codemods/H12/h12-workspace-debrand.mjs) | Codemod H12 (2/2) : dé-brande le workspace shell-ui — renommages `*Supplier*`/`fournisseurIdFromHref` → noms `ExternalSite*`/`siteId*`, `isOptimiserCanvasHref` → `isCanvasHref`, `configureFullscreenPaths` → `configureWorkspacePaths` (fullscreenPaths + canvases), constantes `TF_LEGACY_*`/`PANIER_PATH`/`OPTIMISER_PATH` → constantes de marque. Fail-closed si valeurs non littérales. Idempotent. |

## `codemods/H13/`

| Fichier | Rôle |
|---|---|
| [`codemods/H13/h13-ui-debrand.mjs`](../codemods/H13/h13-ui-debrand.mjs) | Codemod H13 : classes / ids UI kit nommés marque → `creezio-*` (`tempoflow-titlebar-*`, `tf2-fake-cursor`, `__tfFakeCursor`, cache SW `tf2-shell-`). Idempotent. |

## `codemods/H7/`

| Fichier | Rôle |
|---|---|
| [`codemods/H7/h7-neutralize-brand-contracts.mjs`](../codemods/H7/h7-neutralize-brand-contracts.mjs) | Codemod H7 — neutralise les contrats marque (feedPreset, enum vertical, alias H6, env `TEMPOFLOW_*` → préfixe manifeste). |

## `codemods/H8/`

| Fichier | Rôle |
|---|---|
| [`codemods/H8/h8-materialize-brand-manifest.mjs`](../codemods/H8/h8-materialize-brand-manifest.mjs) | Codemod H8 (P1.d) : build-builder-config marque en « manifest local d'abord » + matérialisation app-manifest.json depuis le registre kit déprécié. |

## `codemods/H9/`

| Fichier | Rôle |
|---|---|
| [`codemods/H9/h9-import-module-contract.mjs`](../codemods/H9/h9-import-module-contract.mjs) | Migration H9 (P2.c) : modules/types.ts → ré-export kit + accessJustification "à qualifier" sur les mounts sans permission |

## `codemods/lib/`

| Fichier | Rôle |
|---|---|
| [`codemods/lib/skip-dirs.mjs`](../codemods/lib/skip-dirs.mjs) | SKIP_DIRS partagé de tous les codemods H* : `node_modules`, `dist`, `dist-electron-server`, `win-unpacked`, `release`, `out`, … |

## `lib/`

| Fichier | Rôle |
|---|---|
| [`lib/assert-runtime-dist.mjs`](../lib/assert-runtime-dist.mjs) | Assert fail-closed dist runtime (contrats src↔dist + mtime) — CLI + import gate/sync/publish. |
| [`lib/brand-roots.mjs`](../lib/brand-roots.mjs) | Resolve brand CRM roots across VPS (/opt/docker/…) and sibling layouts (e.g. |
| [`lib/brand-vocab.mjs`](../lib/brand-vocab.mjs) | Scanner vocabulaire marque (SoT patterns + allowlist) — CLI `--print` / `--write-allowlist` (rétrécit uniquement, refuse ajout/incrément). |
| [`lib/link-kit-node-modules.mjs`](../lib/link-kit-node-modules.mjs) | Pose un symlink `node_modules` kit → app générée (tsc hors ligne, sans npm install ni `--link-kit`). |
| [`lib/propagate-pr-guard.mjs`](../lib/propagate-pr-guard.mjs) | Garde anti-doublon des PR de bump kit (GET PR ouvertes, pin `package.json`, HTTP 422) — D7. |
| [`lib/resolve-probe-brand.mjs`](../lib/resolve-probe-brand.mjs) | Résout la marque sonde TempoFlow3 hors monorepo kit. Layout nominal : 2 repos — monorepo marque (`server/`, `client/`) + repo admin dédié `<brand>-admin`. |
