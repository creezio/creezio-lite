# BACKLOG — dettes restantes assumées

Liste unique et honnête des dettes connues du kit. Une dette listée ici est
**assumée** : pas de contournement caché dans le code, pas d'assert de gate
affaibli pour la masquer. (Backlogs d'époque : `docs/archive/BACKLOG-*.md`.)

## Produit / distribution

- **Validation packagée Windows réelle** : la chaîne updater / preload
  onglets / NSIS est couverte par gates statiques (`after-pack`, `test:kit`),
  mais aucun E2E sur machine Windows n'est exécuté — machine requise.
- **Widevine/DRM** : les onglets externes (Electron) et le navigateur IA
  (Chromium serveur) ne lisent pas les contenus DRM.
- **Rotation du token feed `dl-e660352…`** : décision utilisateur — on ne
  touche ni la rotation ni la sortie du code pour l'instant.
- **Licence** : repos privés, pas de fichier LICENSE (décision utilisateur).

## Desktop

- ~~**Compat desktop héritée gelée (P2.a)**~~ **FAIT (H10, T9)** : le module
  `electron-shell/src/desktop/legacy-brand-compat.ts`, sa gate
  `test-phase-legacy-desktop-frozen` et le snapshot
  `scripts/legacy-desktop-frozen.json` sont supprimés. Les défauts du moteur
  desktop sont génériques (`<PREFIX>_PLUGINS_DIR`, `<brandId>fid`,
  `<PREFIX>_API_KEY`, preload `preload.js`, `ensureDesktopNode`) ; les
  clients desktop legacy migrent via le codemod `scripts/codemods/H10/`
  (deps explicites), appliqué par `creezio upgrade` lors du bump
  `ARCHITECTURE_VERSION` H9 → H10 (ADR
  `docs/adr/ADR-p2a-desktop-legacy-freeze.md`, note de clôture). Le
  fallback inline `preload-app.js` du workspace IA a été retiré en H11
  (`host-runtime/src/ai-workspace/manager.ts` : `preload.js` obligatoire,
  échec explicite si absent — ADR `docs/adr/ADR-h11-purge-tf2-compat.md`).

## Navigateur IA (`browser-host`)

- **Proxy résidentiel** : `CREEZIO_BROWSER_PROXY` est plombé jusqu'à
  `--proxy-server=`, mais une IP datacenter (VPS/cloud) reste détectée par
  beaucoup de sites ; aucune offre proxy résidentiel n'est incluse.
- **Chiffrement au repos des profils** : les profils Chromium (cookies,
  sessions) sont en clair sur disque (créés `0700`). Le chiffrement volume
  (LUKS/fscrypt) est à la charge de l'hébergeur — non fourni par le kit.
  Voir « Modèle de menace » dans `packages/browser-host/README.md`.

## Tests / environnement

- **`test:brands` sur ce VPS** : l'oracle `tempoflow2` local est en état
  pré-cutover (pas de `crm/vendor/creezio`) et `certivan-app`/`fidu` sont
  absents — les gates marques historiques skippent (raison affichée). Les
  exécuter sur un poste avec les repos marque d'époque synchronisés.
- **`test:env`** : `test-os-cold-warm` (réseau embeds + ~4 Go /tmp),
  `test-phase-factory-prd*` (npm install d'une app générée, binaire Electron
  téléchargeable) et `test-phase-factory-docker-parity` (app neuve factory →
  image Docker, preuve d'héritage parité TF2) sont opt-in
  (`CREEZIO_COLD_WARM=1` / `CREEZIO_FACTORY_PRD=1` / `CREEZIO_FACTORY_DOCKER=1`).
  ~~Les gates factory-prd échouent hors ligne (app générée sans
  `node_modules`, types introuvables au `tsc`)~~ **fait** : les gates
  lient le `node_modules` du kit (`scripts/lib/link-kit-node-modules.mjs`)
  + `CREEZIO_SKIP_BRAND_DIST=1` + `npm_config_offline=true`. `--link-kit`
  (PR #172) pinne les `@creezio/*` en `file:` pour un install registre —
  ça ne règle pas le hors-ligne (electron / typescript / lock restent
  téléchargés). Compile via `electron-shim.d.ts` + `@types/node` du kit.

## Flotte multi-VPS

- ~~GHCR non branché~~ **FAIT (E2E prouvé 2026-08-31, prod TF3)** :
  `server-docker publish --registry ghcr.io/creezio` → push
  `creezio-server-tempoflow3:auto.202608310248.674051e` (1,04 Go compressés,
  build+push 318 s depuis le VPS — l'hypothèse « ~3,7 Go impraticable »
  était périmée) → pull GHCR → `update resto-lyon|resto-marseille --backup`
  → `verify-prod` 7/7 sur les deux instances.   Credentials canoniques :
  `/opt/docker/creezio-secrets/ghcr.env` (root/600, hors git) + miroirs
  `.github-token` gitignorés kit/marque — voir skill fleet-ops §4.
  ~~Rétention post-publish GHCR~~ **fait (D5)** : `publish` vers
  `ghcr.io` appelle l'API GitHub Packages (versions) — garde ≥ 3 semver
  + tout tag in-use / `servers.json` / instances ; auth manquante =
  fail-closed (`GHCR_TOKEN` / `GITHUB_TOKEN` / `.github-token`).
  `registry-gc --registry ghcr.io/<owner>` suit la même politique
  (dry-run par défaut, `--apply`). Le registre de prod TempoFlow peut
  rester loopback (`127.0.0.1:5000`) : le chemin GHCR s'active seulement
  quand la cible EST `ghcr.io`.
- ~~**Propagate PR doublon (D7)**~~ **fait** : avant d'ouvrir une PR de
  bump, `scripts/propagate-brands.mjs` GET les PR ouvertes (même titre /
  même head / `package.json` déjà au pin) et skip si `main` est déjà au
  pin ; POST `/pulls` HTTP 422 = skip (plus de TF3 #73 après #72 mergée).
  Helper `scripts/lib/propagate-pr-guard.mjs`, gate
  `test-phase-propagate-pr-guard`.
- **Ingress agent porté par le tunnel d'un serveur** : `agent.{slug}` passe
  par le cloudflared du container serveur `{slug}` — pendant l'update de CE
  serveur, l'agent est injoignable de l'extérieur (le poll `update-status`
  de l'admin tolère les trous et se resynchronise). Piste propre : tunnel
  dédié agent par VPS (slug hôte réservé) au lieu de réutiliser celui d'un
  serveur applicatif.
- ~~**Suivi update en mémoire**~~ **fait (0.20.1, T8)** : le suivi
  `update-status` de l'agent (et de l'admin local) est persisté sur disque
  (`@creezio/fleet` `update-status-store` — journal JSON atomique dans le
  répertoire d'état, reload au boot avec flag additif `agentRestarted` +
  résolution via `servers.json`, TTL 24 h). Gate
  `test-phase-fleet-update-status-persist`.
- ~~**Registry local sans GC**~~ **fait (T11)** : `creezio server-docker
  registry-gc` (`packages/factory/src/server-docker-registry-gc.ts`) —
  API v2 list/delete + `registry garbage-collect` dans `creezio-registry`,
  rétention `--keep N` (défaut 2) par famille `auto.*`/manuels, tags
  protégés jamais supprimés (conteneurs en cours, `docker-data/servers.json`
  — instances arrêtées incluses —, releases fleet de l'app admin), dry-run
  par défaut + `--apply`. Gate : `test-phase-server-docker-registry-gc`.
  Doc : skill fleet-ops §10.
- ~~**Scaffold `verify-prod` factory (vérification E2E canonique de toute
  app générée)**~~ **fait (0.18.0)** : la factory matérialise
  `scripts/verify-prod.mjs` dans toute app générée (générateur
  `packages/factory/src/generators/verify-prod.ts` — profil brand :
  version / login E2E / `auth/me` role owner / browse d'un module à
  `meiliIndexes` `engine:"meili"` / `llm-status` ; profil admin :
  version / login / me), script npm `verify:prod`, mention dans les smokes
  générés, extension métier `scripts/verify-prod.local.mjs`
  (`localChecks(ctx)`, jamais régénéré — ex. optimiser TF3). Gate
  d'inventaire : `test-phase-factory-two-repos` (existence + `node --check`
  + profils dans les 2 repos). Réf : skill fleet-ops §3b.
- ~~**Automatiser les règles UFW dans les procédures compose/enrôlement
  (`creezio server-docker`)**~~ **fait (0.18.0)** : préflight UFW
  fail-closed dans `agent up`, `admin up` et `enroll`
  (`packages/factory/src/server-docker-ufw.ts`) — UFW actif + règle
  `172.16.0.0/12 → 172.17.0.1:<port>` absente → règle posée (root /
  `sudo -n`) avec re-vérification, sinon échec explicite avec la commande
  exacte (jamais silencieux). Gate : `test-phase-server-docker-ufw`.
  Incident d'origine : 10–30/08 (18810 resté scoped `172.17.0.0/16`,
  host-agent droppé 20 jours).
- ~~**admin.tempoflow.fr via NPM + cert Origin**~~ **retiré** :
  `configure-admin-npm.sh` exit 1. Public admin+lp = tunnel in-process.
- ~~**Mounts modules sans session HTTP (plateforme-wide)**~~ **fait** (garde
  `assertModuleMountSession` dans `listenBrandOsHttp`, allowlist
  webhook/register/heartbeat/releases/landing public ; gate
  `test-phase-module-mount-session.mjs`). Adoption / preuve côté marques :
  tâche TF3 DASH-5 (`tempoflow3/brand-spec/modules/dashboard/TODO.md`) —
  `npm update "@creezio/*"` après publication npm du kit.

## Admin app OS (ADR-admin-app-os) — suites

- ~~`@creezio/support` côté serveur marque~~ **fait** : package
  `@creezio/support` (mount natif `platform-support` via app-runtime, page OS
  `/support`, routes agent/backend `…/servers/:b/:n/support[/*]`, sync pull +
  réponse admin dans `@creezio/admin`).
- ~~Billing Stripe (webhook)~~ **fait** : endpoint signé
  `/api/v1/modules/billing-webhook/stripe` → projections `admin_billing_*`
  (journal `admin_billing_events`).
- ~~UI billing dédiée~~ **fait** : `BillingAdminClient` (`@creezio/admin/ui`),
  page `/billing` — stats MRR/actifs/impayées, clients + abonnement (montant,
  statut, prochaine échéance `periode_fin`), factures, événements Stripe,
  rapprochement client ↔ serveur. API `GET /api/v1/modules/billing/overview`.
- ~~Réconciliation active `STRIPE_API_KEY`~~ **fait** :
  `POST /api/v1/modules/billing/reconcile` (bouton « Resynchroniser Stripe »)
  relit l'API Stripe (customers/subscriptions/invoices, pagination) et
  resynchronise les projections — gate `test-phase-admin-billing.mjs`
  (webhook signé, overview, reconcile contre mock : facture manquée
  rattrapée). Clé par marque en `.env` gitignoré (skill §5c).
- ~~Factory : repo admin en app OS complète~~ **fait** : `scaffoldAdminApp`
  (modules natifs flotte/support/prospects kanban/roadmap/billing) — gate
  `test-phase-factory-two-repos.mjs`.
- ~~Prospection kanban drag & drop~~ **fait** : `ProspectsKanbanClient`
  (`@creezio/admin/ui`, DnD HTML5 natif, PATCH colonne/position).
- ~~Fleet natif TS~~ **fait autrement (P2.b, 0.15.0)** : backend flotte porté
  en TS strict dans le NOUVEAU package `@creezio/fleet` (pas dans
  `@creezio/admin` : l'agent hôte doit rester Node pur sans tirer admin/UI —
  décision sur graphe de deps, voir `packages/fleet/AGENTS.md`). Les `.mjs`
  de fleet-collector = wrappers compat `[deprecated]` une version. Reste
  ouvert : supprimer le hop HTTP interne admin app → server-admin en faisant
  dépendre `@creezio/admin` de `@creezio/fleet` (imports directs) — le
  backend HTTP reste pour les host-agents.
- ~~Retrait wrappers fleet-collector (0.16)~~ **fait (0.19.0)** : les 7
  wrappers `.mjs` + le bin `creezio-server-admin` supprimés, CLI factory et
  gates repointés sur `packages/fleet/dist`.
  `FLEET_PROTOCOL_ACCEPT_MISSING=false` (strict) SANS bump v2 : le format
  filaire n'a pas changé et l'API flotte a confirmé (2026-08-31) que tous
  les composants déployés (host-agents enrôlés inclus) annoncent v1 ;
  l'app admin pose désormais aussi le header sur les réponses
  `fleet-releases` (`@creezio/admin` → dép `@creezio/fleet`).
- **Rôles/permissions mode admin — LIVRÉ (0.18.0, P4)** : permissions PAR
  MODULE sur les comptes des apps admin via `@creezio/access-control`
  (overrides par compte `access_user_overrides`, UI « Rôles & accès »
  onglet Comptes) + mounts `@creezio/admin` gardés (`nav.fleet`,
  `nav.support`, `nav.billing`…), preset `adminAccessControlPreset`
  (migration sans lockout : collaborateur = tous les modules par défaut,
  l'owner restreint ensuite), geste CLI `server-docker access`, pages
  générées avec `AdminModuleGate`. Reste ouvert : rôles nommés prêts à
  l'emploi (« comptable », « community manager ») = simples presets de
  rôles supplémentaires à ajouter dans `adminAccessControlPreset` si le
  besoin réel apparaît (aujourd'hui rôle unique collaborator + overrides
  par compte suffisent).

## Contrat de module (P2.c — suites)

- ~~**Sources assistant + contenu onboarding dans `BrandModuleDef`**~~
  **fait (T5 / volet 2 F3.4)** : champs additifs `assistantSources` /
  `assistantSourcesJustification` / `onboarding` sur `BrandModuleDef`,
  collecteurs `collectAssistantSources` / `collectOnboardingContent`,
  consommation réelle `@creezio/assistant` (`moduleSources` +
  `applyModuleAssistantSources`) et `@creezio/onboarding`
  (`composeOnboardingFromModules`), templates factory, doctor warn
  `MODULE_ASSISTANT_SOURCES_MISSING`. Pas de bump `ARCHITECTURE_VERSION`.
  ADR `docs/adr/ADR-p2c-module-contract.md`.
- ~~**Cohérence `meiliIndexes.table` ↔ migrations**~~ **fait** : doctor
  brand-spec `MODULE_MEILI_TABLE_UNKNOWN` (error) — ensemble des tables
  `CREATE TABLE` de **toute** l'app (tous modules + historiques
  `fromprd_brand_*` / `brand-migrations.ts`), parse robuste (`IF NOT
  EXISTS`, quotes). Échappatoire déclarative `tableProvisionedBy` sur
  `BrandMeiliIndexSpec` (`@creezio/search`) si la table est provisionnée
  à l'exécution — pas d'env de bypass.
- **Qualifier les `accessJustification: "à qualifier"` TF3** : le codemod
  H9 pose la dette explicite sur les mounts manuscrits sans `permission` —
  chaque module TF3 doit qualifier sa permission réelle (`nav.*`) ou
  justifier la route publique (doctor warn `MODULE_PERMISSION_UNQUALIFIED`
  en attendant).

## Documentation

- ~~`@creezio/brand-spec` sans `README.md` / `docs/FILES.md`~~ **fait** :
  trio complet, couvert par la gate `test-phase-docs-freshness`
  (standard : `docs/DOC-STANDARD.md`).
- ~~**Rôles `(à documenter)` dans les FILES.md**~~ **fait** pour
  `scripts/`, `factory`, `desktop-tooling` (régénération = colonne
  préservée). Les autres packages se remplissent au fil des chantiers.
- **Liens internes des docs archivées** : les documents de
  `docs/archive/` gardent leurs liens d'époque (certains pointent vers des
  emplacements déplacés) — assumé, l'archive est un journal.

## Images serveur

- **`electron` / `electron-shell` dans l'image serveur** : **clos P1.c
  (0.20)** — `resources/{vendor,scripts,bin}` vivent dans
  `@creezio/host-runtime` ; le Dockerfile PURGE `electron`,
  `electron-updater` et `@creezio/electron-shell` après `npm ci` (gate
  `test-phase-server-docker`). Les marques existantes peuvent encore lister
  `electron-shell` en dep serveur (desktop pack) : la purge image les
  retire du runtime headless.

## Divers

- **`appliedLimit` dans `RunSqlResult`** (`packages/assistant/src/runtime/run-sql.ts`) :
  champ dupliqué de `limit`, conservé pour compat des clients existants
  (payloads run-sql déjà consommés par les marques) — à retirer lors d'un
  prochain bump majeur de l'API assistant.
- **`packages/observability/fleet-collector/configure-fleet-npm.sh`** et les
  manifests `brand-config` contiennent l'IP du collector fleet historique
  (`104.168.10.36`) — c'est de la config fonctionnelle (tf2-fleet-collector
  en prod), pas une fuite doc ; à paramétrer proprement le jour où le
  collector bouge.
