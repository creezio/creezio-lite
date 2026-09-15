---
name: creezio-fleet-ops
description: Runbook opérationnel de la flotte Creezio (serveurs Docker headless, comptes, login, publish/update/rollback, admin flotte, enrôlement VPS, client desktop thin, diagnostics boot). Utiliser dès qu'il faut créer/mettre à jour un serveur marque, créer un compte owner ou collaborateur sans UI, vérifier un login, publier une image, lancer l'admin, enrôler un hôte, builder le client, ou diagnostiquer un boot qui échoue.
---

# Creezio Fleet Ops — runbook flotte

Commandes **vérifiées** (code + prod VPS TempoFlow). Chaque section :
Objectif → Commande exacte → Vérification → Où est la vérité → Pièges.

## Conventions

```bash
export CREEZIO_KIT_ROOT=/opt/docker/creezio        # kit (SoT)
export BRAND_ROOT=/opt/docker/tempoflow3           # marque exemple
export ADMIN_ROOT=/opt/docker/tempoflow3-admin     # repo admin flotte
alias creezio='node $CREEZIO_KIT_ROOT/packages/factory/bin/creezio.js'
```

Containers : `<brandId>-server-<nom>` (ex. `tempoflow3-server-demo`).
Ports : loopback `127.0.0.1`, persistés dans `servers.json` (`hostPort`)
et **réutilisés** à chaque `update` (plus de 32774→32776→…). Exposition
publique = `--expose` / tunnel CF.

## Index « Je veux X → fais Y »

| Je veux… | Section |
|---|---|
| Créer un serveur (test ou prod) | 1 |
| Créer un compte owner/user sans UI | 2 |
| Me connecter / vérifier un compte | 3 |
| Vérifier une instance prod E2E (credentials canoniques + checks) | 3b |
| Publier une image, updater, rollback | 4 |
| Déployer sur toute la flotte (releases pull, canary, kill-switch) | 4b |
| Lancer l'admin flotte | 5 |
| Enrôler un VPS (agent hôte) | 6 |
| Builder / publier le client desktop | 7 |
| Diagnostiquer un boot qui échoue | 8 |
| Diagnostiquer Meili fail-closed (boot refusé, 503 catalogue) | 8b |
| Ne pas refaire un piège connu | 9 |
| n8n / Hermes : superadmin, clé API, webhooks, MCP | 11 |
| Intégrations / clés API tierces (OpenAI, Notion…) | 12 |
| Publier la landing page marque (lp.{zone}) | 13 |
| Cloner/booter un repo marque SANS le kit | 14 |

---

## 1. Créer un serveur

**Objectif** : instance headless (API + CRM web) dans le registre.

```bash
# Test local (image buildée si absente, port auto, attend le boot) :
CREEZIO_TUNNEL_LOCAL=1 creezio server-docker create demo --brand-root "$BRAND_ROOT"

# Prod flotte (warm n8n/Hermes + catalogue + tunnel public + owner) :
CREEZIO_CF_API_TOKEN=<token CF scopé compte+zone> \
CREEZIO_CF_ACCOUNT_ID=<account> \
CREEZIO_CF_ZONE_ID=<zone> \
CREEZIO_TUNNEL_SLUG=<slug> \
CREEZIO_OWNER_EMAIL=owner@<slug>.example \
CREEZIO_OWNER_PASSWORD=<mot de passe ≥6, jamais loggé> \
OPENAI_API_KEY=<clé LLM entreprise de la marque> \
creezio server-docker create <slug> --brand-root "$BRAND_ROOT" --profile prod

# Variantes : --browser (Chromium sidecar IA), --warm, --port N, --expose, --env K=V

# Assistant chat (serveur headless) : --profile prod forwarde OPENAI_API_KEY /
# ANTHROPIC_API_KEY depuis l'env hôte s'ils sont posés (clé TF3 : dans
# {BRAND_ROOT}/.env, gitignoré). Sans clé, POST /api/v1/assistant/chat répond
# 503 LLM_KEYS_MISSING. Vérif :
#   curl http://127.0.0.1:<port>/api/v1/assistant/llm-status  # assistantReady:true
# Serveur existant sans clé : ajouter "OPENAI_API_KEY" dans env de l'instance
# (docker-data/servers.json) puis re-POST update admin avec la même image —
# le recreate réapplique l'env du registre (§4).
```

**Vérification** :

```bash
creezio server-docker ls --brand-root "$BRAND_ROOT"
curl -sS http://127.0.0.1:<port>/api/v1/os/boot-status | head -c 300   # 200 dès le lancement
curl -sS http://127.0.0.1:<port>/api/v1/core/health                    # {"ok":true,"brandId":…}
# --profile prod : https://<slug>.tempoflow.fr répond (CRM 200)
```

**Vérité** : CLI `packages/factory/src/server-docker-cli.ts` ; registre
`{BRAND_ROOT}/docker-data/servers.json`
(`packages/factory/src/server-docker-registry.ts`) ; doc
`docker/server/README.md`. Data : `docker-data/servers/<nom>` → `/data`.
Tunnel : auto-provisionné au boot par l'instance (API CF, `cf.env` 600).
Instances déjà up (`recette`, `foove2-demo`, `foove2admin`) restent sur leur
stack actuel jusqu'à un `migrate-stack` dédié — ne pas les recréer ici.

**Pièges** : prérequis `npm run build:runtime` côté marque ; slug tunnel dans
`RESERVED_SLUGS` (`packages/platform-core/src/tunnel-cf.ts` : `admin`, `mcp`,
`api`, `agent`, `demo`, `test`, `registry`…) → `create` dérive `<brand>-<slug>`
(ex. `foove2-demo`), jamais de skip tunnel. Sans `CREEZIO_CF_API_TOKEN` /
`_ACCOUNT_ID` / `_ZONE_ID` **ou** sans `CREEZIO_OWNER_EMAIL`/`_PASSWORD`,
create VPS **échoue** (pas de loopback silencieux, pas d'instance sans owner).
Dev : `CREEZIO_TUNNEL_LOCAL=1` (owner optionnel).

## 2. Créer un compte owner / user en headless (sans UI)

**Objectif** : compte qui **se loggue** sur le CRM, sans wizard Electron.

**Voie canonique VPS** : poser `CREEZIO_OWNER_EMAIL` + `CREEZIO_OWNER_PASSWORD`
avant `server-docker create` (`.env` marque ou Runtime Secrets cloud — **pas**
`E2E_OWNER_*`). Le create appelle `POST /api/v1/os/setup` (qui enchaîne
`migrateBrandCredentialsToKit`), **persiste** owner dans
`docker-data/stacks/<nom>/secrets.env` (chmod 600, `env_file` — jamais le
registre) puis vérifie le login. Log : URL publique +
`login : $CREEZIO_OWNER_EMAIL`. Jamais le mot de passe.

Rattrapage (instance déjà up, secrets absents) / compte recette :

```bash
# Optionnel : CREEZIO_E2E_EMAIL=owner@<slug>.example.local CREEZIO_E2E_PASSWORD=…
creezio server-docker ensure-owner <nom> --brand-root "$BRAND_ROOT"
# → persist secrets.env 600 + recreate app (sidecar intact)
# log : login : owner@…  — jamais le mot de passe
```

`CREEZIO_E2E_*` est **optionnel** (smoke). S'il manque, `ensure-owner`
génère `owner@<nom>.<marque>.local` et le stocke uniquement dans
`secrets.env`. `AUTH_DISABLED=1` = harness local — **interdit** en prod.

**Permissions par module d'un compte (apps admin)** — bootstrap sans UI du
système « Rôles & accès » (`@creezio/access-control`) :

```bash
# État du compte (rôle + overrides) :
creezio server-docker access <nom> --brand-root "$ADMIN_ROOT" --user compta@marque.fr
# Restreindre un comptable à billing+clients (reset efface les overrides avant) :
creezio server-docker access <nom> --brand-root "$ADMIN_ROOT" \
  --user compta@marque.fr --reset --grant nav.billing,nav.clients --revoke nav.fleet
# → écrit core.db (access_user_overrides) via docker exec + audit
#   (actor server-docker-cli) ; effet ≤ 30 s (cache). Owner = bypass kit.
# UI équivalente : OS → Admin → Rôles & accès → Comptes.
```

Le curl ci-dessous reste le rattrapage pour une instance **déjà** créée
(LOCAL, ou create antérieur au fail-closed owner).

Deux stores distincts — il faut les DEUX pour un owner complet :

| Store | Contenu | Écrit par |
|---|---|---|
| `/data/{brand}-config.json` (local-config, valeurs scellées) | authUser/authPassword, recovery key, clé OpenAI, `setupComplete` | `POST /api/v1/os/setup` → `applyFirstRunSetup` |
| `/data/sqlite/core.db` table `creezio_users` (hash scrypt) | credentials **du login CRM** (kit-first) | `migrateBrandCredentialsToKit` |

```bash
PORT=18793; CT=tempoflow3-server-demo
USER=owner@resto.local; PASS=motdepasse-6car-min

# a) First-run local-config (marque setupComplete, génère la recovery key) :
curl -sS -X POST http://127.0.0.1:$PORT/api/v1/os/setup \
  -H 'content-type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}"
# → {"ok":true,"setupComplete":true,"recoveryKey":"…"} — NOTER la recoveryKey

# b) Credentials kit (login CRM) — dans le container :
docker exec -w /app -e CREEZIO_CORE_DB_PATH=/data/sqlite/core.db $CT node -e \
  "import('@creezio/auth').then(async a => { const r = await a.migrateBrandCredentialsToKit({username:'$USER', password:'$PASS', displayName:'Owner'}); console.log(JSON.stringify(r)); })"
# → {"ok":true,"action":"registered",…}
```

Collaborateur (human/ai) ensuite, avec le cookie owner (voir §3) — API
plateforme = **référentiel unique** (alias `/api/v1/users` ≡
`/api/v1/platform/users`, cycle de vie complet) :

```bash
# Création human : password OBLIGATOIRE (≥6) → login immédiat, permissions
# par défaut marque (configureAuth collaboratorDefaultPermissions) si omises.
curl -sS -X POST http://127.0.0.1:$PORT/api/v1/users \
  -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"username":"vendeur1","kind":"human","password":"S3cret-…"}'
# IA : {"username":"Jarvis","kind":"ai"} (pas de credentials).
# Reset mot de passe / permissions / désactivation :
curl -sS -X PATCH http://127.0.0.1:$PORT/api/v1/users/<id> \
  -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"password":"Nouveau-…","permissions":["nav.dashboard"],"active":true}'
# Meta ACL marque (assignables / owner-only / défauts) :
curl -sS http://127.0.0.1:$PORT/api/v1/users/meta -H "cookie: $COOKIE"
```

Les collaborateurs vivent dans `creezio_platform_users` (core.db) ; leurs
credentials dans `creezio_users` (créés par le POST). Le 1er inscrit
`creezio_users` reste « owner » (`ownerRow` = plus ancien). La page
Collaborateurs d'une marque (UI TF verbatim) parle directement à
`/api/v1/users` — le kernel intercepte ce préfixe AVANT le plane : ne
jamais créer une table `users` métier parallèle (comptes non logables).

**Vérité** : `packages/app-runtime/src/listen-brand-os-http.ts` (route setup),
`packages/electron-shell/src/host/local-config.ts` (`applyFirstRunSetup`),
`packages/auth/src/env-store.ts` (+ `password.ts` : scrypt N=16384),
`packages/app-runtime/src/brand-platform-store.ts` (owner/collaborateurs),
`mount-brand-platform-surface.ts` (routes `/api/v1/platform/users`).

**Pièges** : le `POST /api/v1/os/setup` du kernel actuel enchaîne
`migrateBrandCredentialsToKit` (login CRM). L'étape (b) manuelle n'est plus
nécessaire sur un kit à jour — elle reste le rattrapage si setup a été fait
sur un runtime trop vieux. Password ≥ 6 car., username e-mail. Ne PAS
re-POSTer setup sur un serveur déjà configuré (écrase compte + recovery key).
Gate de référence : `scripts/test-phase-platform-users.mjs` +
`scripts/test-phase-server-docker-owner.mjs`.

## 3. Login / vérifier un compte

```bash
COOKIE=$(curl -si -X POST http://127.0.0.1:$PORT/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$USER\",\"password\":\"$PASS\"}" \
  | rg -i '^set-cookie' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
echo "$COOKIE"          # tempoflow3_session=eyJ… sinon login KO (401)
curl -sS http://127.0.0.1:$PORT/api/v1/auth/me -H "cookie: $COOKIE"
# → {"ok":true,"user":"owner@…","role":"owner",…}
```

Payload = `{"email","password"}` (le champ s'appelle `email` même pour un
identifiant simple). Cookie `<brandId>_session` (JWT HS256 signé
`AUTH_SECRET`). Le cookie ou `Authorization: Bearer <token>` marchent sur
toutes les routes plateforme.

**Vérité** : `packages/auth/src/hono-routes.ts` (login kit-first),
`session.ts` (JWT), montage `/api/v1/auth` dans
`packages/app-runtime/src/mount-brand-platform-surface.ts`.

## 3b. Vérification E2E canonique (compte E2E + verify-prod)

**Objectif** : vérifier une instance prod (login, browse Meili, optimiser,
assistant) **sans redécouvrir des identifiants** — SoT unique des
credentials E2E, lue par tous les agents.

**SoT credentials** : compte E2E `CREEZIO_E2E_EMAIL` /
`CREEZIO_E2E_PASSWORD` dans le `secrets.env` (chmod 600) de la stack de
CHAQUE instance — posé automatiquement par
`server-docker create|ensure-owner` :

| Instance | Fichier |
|---|---|
| Serveur marque (ex. restos TF3) | `{BRAND_ROOT}/docker-data/stacks/<nom>/secrets.env` |
| App admin de la marque | `{ADMIN_ROOT}/docker-data/stacks/main/secrets.env` (ex. `/opt/docker/tempoflow-admin`) |

```bash
cd "$BRAND_ROOT" && node scripts/verify-prod.mjs --all   # ou <instance>
cd "$ADMIN_ROOT" && node scripts/verify-prod.mjs --all   # app admin (profil admin)
# Profil brand : core/version · login E2E · auth/me (role owner) · browse
#   d'un module à meiliIndexes engine:"meili" · assistant llm-status
#   (assistantReady) · checks MÉTIER du repo (verify-prod.local.mjs —
#   ex. TF3 : optimiser snapshot)
# Profil admin : version · login · auth/me seulement (pas de LLM ;
#   le compte E2E admin est role:"collaborator" — l'owner
#   canonique admin reste CREEZIO_OWNER_EMAIL)
# Sortie [OK]/[KO]/[SKIP] par check, exit ≠ 0 si au moins un KO.
```

**Généralisé (0.18.0)** : `scripts/verify-prod.mjs` est **matérialisé par la
factory dans toute app générée** (marque profil brand, repo admin profil
admin — générateur `packages/factory/src/generators/verify-prod.ts`, script
npm `verify:prod`, gate `test-phase-factory-two-repos`). `--all` découvre
les instances via `docker-data/stacks/`. Les checks métier vivent dans
`scripts/verify-prod.local.mjs` (export `localChecks(ctx)`, jamais régénéré
par la factory). Module Meili browsable : scaffoldé (`CONFIG.meiliModule`) ou
override env `CREEZIO_VERIFY_MEILI_MODULE`.

**(Re)provisionnement du compte** : `creezio server-docker ensure-owner
<nom> --brand-root "$BRAND_ROOT"` — génère/persiste les credentials dans
`secrets.env` puis recreate l'app (§2). Ne JAMAIS re-POSTer
`/api/v1/os/setup` sur une instance configurée (écrase owner + recovery
key).

**Règle flotte (obligatoire)** : tout agent qui crée ou reset un compte
E2E **DOIT persister les nouveaux identifiants dans le `secrets.env` de
l'instance** — jamais uniquement dans son journal de mission. Un futur
agent lit d'abord `secrets.env`, vérifie le login (§3), et ne
reprovisionne que si le login échoue réellement.

**Vérité** : `packages/factory/src/generators/verify-prod.ts` (générateur —
SoT du script matérialisé) ; `packages/factory/src/server-docker-cli.ts`
(`ensure-owner`, persistance `secrets.env`) ; checks métier :
`scripts/verify-prod.local.mjs` du repo (ex. `tempoflow3`).

**Pièges** : `secrets.env` / `cf.env` sont chmod 600 (souvent root:root).
Le CLI les lit/écrit via `sudo -n` puis
`/usr/local/sbin/creezio-server-docker priv-io` (fail-closed actionnable
si sudo impossible — ne PAS chmod/chown). Compte E2E admin = collaborateur
(permissions vides) : suffisant pour login/me, pas pour les gestes owner.

## 4. Publier une image, updater, rollback

**Objectif** : image versionnée dans le registre Docker local
(`creezio-registry`, `127.0.0.1:5000`), déployée via l'admin.

**Prérequis kit (fail-closed)** : si le runtime kit a changé, **rebuild le
dist avant** toute release / publish — sinon package ou image sans routes (dist stale) :

```bash
cd "$CREEZIO_KIT_ROOT" && npm run build:packages
# preuve : npm run test:kit -- --only runtime-dist-freshness
# (ou node --test scripts/test-phase-runtime-dist-freshness.mjs)
# Puis release npm (changeset → Version PR → publish), puis côté marque :
cd "$BRAND_ROOT" && npm update "@creezio/*"   # distribution npm (après publish kit)
```

`creezio server-docker publish|build` appelle
`scripts/lib/assert-runtime-dist.mjs` (contrats src↔dist + hash de contenu) et
**refusent** si le dist est plus vieux que le src. Bypass urgence seulement :
`CREEZIO_SKIP_RUNTIME_DIST_ASSERT=1`.

```bash
# Publish (build + push ; --browser pour la variante sidecar) :
creezio server-docker publish --brand-root "$BRAND_ROOT" \
  --tag 0.2.2 --registry 127.0.0.1:5000
# → 127.0.0.1:5000/creezio-server-tempoflow3:0.2.2
#   /api/v1/core/version affichera 0.2.2 (CREEZIO_APP_VERSION)
# Rétention auto après push : PAR FAMILLE — N derniers auto.* (défaut 2)
# ET au moins les 3 derniers semver (indépendants : une rafale auto.*
# n'évince jamais un semver). Jamais le tag référencé par servers.json /
# instances. Prune aussi le build cache (--max-used-space 5GB). Régler :
# --keep-tags N / CREEZIO_PUBLISH_KEEP_TAGS, CREEZIO_PUBLISH_KEEP_STORAGE ;
# désactiver ponctuellement : --no-retention. Voir §10.

# Tags dispo (auth Basic admin, voir §5) :
curl -sS -u "admin:$ADMPASS" \
  'http://127.0.0.1:18800/admin/api/registry/tags?image=creezio-server-tempoflow3'

# Update (défaut = PAS de nouveau backup — data stables / itération) :
creezio server-docker update <nom> --brand-root "$BRAND_ROOT" \
  --image 127.0.0.1:5000/creezio-server-tempoflow3:0.2.2
# ou : --tag 0.2.2 [--registry 127.0.0.1:5000]
# Opt-in snapshot frais (prod critique) : ajouter --backup

# Update via admin API (ASYNC : 202 immédiat) — backup opt-in seulement :
curl -sS -u "admin:$ADMPASS" -X POST \
  http://127.0.0.1:18800/admin/api/servers/tempoflow3/<nom>/update \
  -H 'content-type: application/json' \
  -d '{"image":"127.0.0.1:5000/creezio-server-tempoflow3:0.2.2"}'
# snapshot frais : … -d '{"image":"…","backup":true}'
# Suivi :
curl -sS -u "admin:$ADMPASS" \
  http://127.0.0.1:18800/admin/api/servers/tempoflow3/<nom>/update-status
# Hôte distant enrôlé : mêmes chemins sous /admin/api/hosts/<hostId>/servers/…
```

**GHCR (registre distant — E2E prouvé 2026-08-31, prod TF3)** : mêmes gestes
avec `--registry ghcr.io/creezio`. Credentials canoniques (SoT, hors de tout
repo git, **ne jamais committer ni logger la valeur**) :
`/opt/docker/creezio-secrets/ghcr.env` (root, chmod 600) — contient
`CREEZIO_REGISTRY=ghcr.io/creezio`, `CREEZIO_GHCR_USER`, `GHCR_TOKEN`
(PAT compte `creezio`, scope `write:packages`), `CREEZIO_REGISTRY_AUTH`
(base64 de `{"username","password","serveraddress"}` — consommé par
`registryAuthB64()` pour les pulls update/agent, header `X-Registry-Auth`)
et `CREEZIO_NPM_TOKEN` (requis par le `npm ci` des `@creezio/*` privés
pendant le build Docker). Le publish se loggue seul via `.github-token`
(gitignoré — miroir du même PAT à la racine du kit ET de la marque).
Chargement : `set -a; . /opt/docker/creezio-secrets/ghcr.env; set +a`.
Preuve E2E : publish `creezio-server-tempoflow3:auto.202608310248.674051e`
(1,04 Go compressés, build+push 318 s depuis le VPS) → pull GHCR → update
`resto-lyon`/`resto-marseille` `--backup` → `verify-prod` 7/7. La rétention
post-publish (§10) s'applique aussi à GHCR (API Packages versions : ≥ 3
semver, jamais un tag référencé `servers.json` / instances ; token
`GHCR_TOKEN` / `GITHUB_TOKEN` / `.github-token` obligatoire — fail-closed
si absent). `--no-retention` reste le bypass ponctuel, plus un passage
obligé GHCR.

Update = pull → recreate même volume/env → health → **rollback auto image**
si KO. **Pas de nouveau tar.gz par défaut.** Les archives déjà présentes
dans `{BRAND_ROOT}/docker-data/backups/` sont **conservées** (pas de prune
dans le flux update).

**hostPort stable** : le port loopback alloué au create est persisté dans
`docker-data/servers.json` (`hostPort` + `port`) et **réutilisé** au
recreate. Un 2ᵉ `update` garde le même `127.0.0.1:<hostPort>`. Un port
libre n'est alloué que s'il n'y en a aucun d'enregistré, ou si le port
enregistré est occupé par un *autre* process.

**Fichiers stack root:root 600** (`cf.env`, `secrets.env`, parfois
`fleet-hosts.json` / `servers.json`) : `update` / `migrate-stack` /
`ensure-owner` empruntent le même chemin privilégié que
`persistDedicatedAgentUrl` — lecture/écriture directe, sinon `sudo -n`,
sinon wrapper `/usr/local/sbin/creezio-server-docker priv-io`. Si sudo
est impossible : **fail-closed** avec le message d'install sudoers
(NOPASSWD sur le wrapper). Jamais un chmod one-shot, jamais « pense à
sudo ».

**GitHub ≠ backup runtime.** GitHub = **code** (image / repo). Les données
runtime vivent sous `docker-data/servers/<nom>` → `/data` (sqlite, config…).
Un backup tar.gz = filet si le volume est corrompu un jour — pas à refaire
à chaque update quand les data ne changent pas.

| Quand | Gestes |
|---|---|
| Dev / itération VPS (défaut) | `update` sans flag — zéro archive |
| Prod critique / doute | `update … --backup` ou API `"backup":true` |
| Référence one-shot (une fois) | `creezio server-docker backup <nom> --brand-root "$BRAND_ROOT"` |

**Où vivent les backups** : `{BRAND_ROOT}/docker-data/backups/<nom>-<stamp>.tar.gz`.

**Restore depuis un backup existant** (volume cassé — rare) :

```bash
# 1. Arrêter l'instance
creezio server-docker stop <nom> --brand-root "$BRAND_ROOT"
# 2. Remplacer le volume data par l'archive (exemple) :
DATA="$BRAND_ROOT/docker-data/servers/<nom>"
BAK="$BRAND_ROOT/docker-data/backups/<nom>-….tar.gz"
mv "$DATA" "${DATA}.broken-$(date +%s)"
mkdir -p "$(dirname "$DATA")"
tar -xzf "$BAK" -C "$(dirname "$DATA")"   # recrée le dossier <nom>/
# 3. Relancer
creezio server-docker start <nom> --brand-root "$BRAND_ROOT"
```

**Vérification** : `curl -sS http://127.0.0.1:<port>/api/v1/core/version` ;
`update-status` → `"status":"done"` ; steps contiennent
`pas de nouveau backup (défaut)` sauf si `--backup`.

**Vérité** : `packages/factory/src/server-docker-cli.ts` (`update`, `backup`),
`@creezio/fleet` `server-admin.ts` / `host-agent.ts` (`body.backup === true`),
`server-lib.ts` (`updateServer`, défaut `backup=false`). Env :
`CREEZIO_REGISTRY`, `CREEZIO_REGISTRY_BASIC`.

**Pièges** : update synchrone interdit côté admin/agent — Cloudflare coupe
les requêtes longues, d'où le contrat 202 + polling `update-status` (la CLI
`update` locale est synchrone OK). Registre requis pour publish
(`--registry` ou env), sinon erreur explicite. Le port loopback **ne
change plus** à l'update (persisté). Les fichiers 600 n'exigent plus un
sudo manuel — le CLI le fait (ou refuse avec le wrapper à installer).

## 4b. Déployer sur toute la flotte — releases en PULL (F4-F6)

**Objectif** : déployer une version sur N serveurs répartis sur plusieurs
VPS, sans geste par serveur ni push admin → agent : les agents hôtes
**pollent** l'app admin (~5 min + jitter) et appliquent eux-mêmes
(`updateServer` local : backup/recreate/rollback intacts).

```bash
# 1. Publier ET déclarer la release (status draft) dans l'app admin :
CREEZIO_FLEET_ADMIN_URL=http://127.0.0.1:18801 \
creezio server-docker publish --brand-root "$BRAND_ROOT" \
  --tag 0.3.0 --registry 127.0.0.1:5000 \
  --release [--channel stable] [--admin-app <url>]
# → image pullable via registry.{zone} (proxy pull-only F4)

# 2. Démarrer le rollout (canary 10 %) — session admin app (cookie §3
#    sur :18801) ou UI /flotte section « Releases » :
curl -sS http://127.0.0.1:18801/api/v1/modules/fleet-releases/releases \
  -H "cookie: $ADMIN_COOKIE"                          # lister → id
curl -sS -X PUT http://127.0.0.1:18801/api/v1/modules/fleet-releases/releases/<id> \
  -H "cookie: $ADMIN_COOKIE" -H 'content-type: application/json' \
  -d '{"status":"rolling","wave_pct":10}'
# 3. Promouvoir par vagues (monotones : un serveur servi le reste servi) :
#    wave_pct 25 → 50 → 100, puis {"status":"done"}.

# Kill-switch :
#   {"status":"paused"}   # doux — reprise possible (re-rolling)
#   {"status":"aborted"}  # définitif — toute sortie de rolling RÉVOQUE les
#                         # leases de téléchargement, les agents cessent au
#                         # poll suivant

# Par serveur (hold / pin / canal) :
curl -sS -X PUT http://127.0.0.1:18801/api/v1/modules/fleet-releases/servers/<serverId>/rollout \
  -H "cookie: $ADMIN_COOKIE" -H 'content-type: application/json' \
  -d '{"hold":true}'          # ou {"pinned_image":"…"} / {"channel":"beta"}
```

**Vérification** : `GET /api/v1/modules/fleet-releases` (releases + états),
rapports `admin_fleet_update_reports` (done|failed|rolled_back par
serveur) ; côté serveur : `curl http://127.0.0.1:<port>/api/v1/core/version`.

**Directives** (`GET next?hostId=` calculé par serveur) : `hold` → jamais
d'update ; `pinned_image` → cible prioritaire ; sinon release `rolling` ∧
channel du serveur ∧ vague (`hash(server_id) mod 100 < wave_pct`, bucket
stable). Slots de téléchargement = sémaphore (lease TTL 15 min) pour ne pas
saturer le registre. Garde-fou : ≥ 2 échecs (`failed`+`rolled_back`,
`CREEZIO_FLEET_AUTO_PAUSE_FAILURES`) → **auto-pause** + événement
`release_auto_paused` (janitor appelé par le poller du registre).

**Registre d'images pull-only (F4)** : l'ingress `registry.{zone}`
(slug `registry`, `kind=registry` côté tunnel CF) pointe sur le proxy `/v2/*` du backend
admin — GET/HEAD uniquement (push → 405, le push reste loopback
`127.0.0.1:5000`), auth Basic `hostId:agentToken` (credential d'enrôlement,
aucun nouveau cycle de vie). Les VPS distants pullent
`registry.{zone}/creezio-server-<brand>:<tag>`.

**Opt-in agent** : posé par `enroll` (`CREEZIO_AGENT_ADMIN_URL` +
`CREEZIO_AGENT_FLEET_KEY`) — sans ces env, l'agent ne polle pas et le push
manuel (§4) reste le seul geste.

**Vérité** : `packages/admin/src/fleet-releases.ts` (module, tables
`admin_005`), `packages/fleet/src/agent-updates.ts`
(boucle agent), `registry-pull-proxy.ts` (F4),
`packages/factory/src/server-docker-cli.ts` (`publish --release`). Gates :
`test-phase-fleet-releases.mjs`, `test-phase-fleet-rollout.mjs`,
`test-phase-registry-pull-proxy.mjs`.

**Pièges** : le geste manuel §4 et la boucle pull partagent le mutex
`updates` par container (pas de conflit, mais pas de parallélisme non
plus) ; une release sans digest est pullée par tag (préférer le digest —
posé automatiquement par `publish --release`) ; ADR du choix « images
Docker, jamais git-pull sur les VPS clients » :
`docs/adr/ADR-fleet-updates-docker-images.md`.

## 5. Admin flotte

Deux plans (ADR `docs/adr/ADR-admin-app-os.md`) :

1. **Backend flotte** (`creezio-server-admin`, Node pur, port 18800 loopback,
   Basic) — SoT des gestes flotte, API `/admin/api/*`, ancienne UI `/admin`.
2. **App admin** (repo dédié `{ADMIN_ROOT}`, ex. `creezio/tempoflow3-admin`) —
   app Creezio complète (mode admin) : login OS, sidebar, assistant, modules
   Flotte (`/flotte`, proxy `/api/v1/modules/fleet/*` → backend), Tickets,
   Prospects, Clients, Roadmap. Env : `CREEZIO_FLEET_BACKEND_URL` +
   `CREEZIO_FLEET_BACKEND_BASIC` (container `--network host`).

```bash
creezio server-docker admin up --admin-root "$ADMIN_ROOT" --brand-root "$BRAND_ROOT"
# (raccourci marque : npm run server-docker:admin)
# → http://127.0.0.1:18800/admin — backend flotte
ADMPASS=$(python3 -c "import json;print(json.load(open('$ADMIN_ROOT/docker-data/server-admin.json'))['pass'])")
curl -sS -u "admin:$ADMPASS" http://127.0.0.1:18800/admin/api/health
# → {"ok":true,"service":"creezio-server-admin",…}
```

Config **sans secrets** versionnée : `{ADMIN_ROOT}/server-admin.json`
(`port`, `user`, `brandRoots[]`) + `fleet-hosts.json` (hôtes enrôlés, tokens
**hashés**). Le `pass` runtime vit dans `{ADMIN_ROOT}/docker-data/server-admin.json`
(gitignoré). Attention : avec `--admin-root`, c'est bien le pass du repo
admin qui fait foi (pas un éventuel `docker-data/server-admin.json` de la
marque).

**Vérité** : `packages/fleet/src/server-admin.ts` (`@creezio/fleet`),
`docker/server-admin/README.md`, repo `creezio/tempoflow3-admin`.

### 5b. Support E2E (serveur marque → admin → réponse)

Chaîne : page OS `/support` du serveur marque (mount natif
`platform-support`, `@creezio/support`) → host-agent
`/agent/api/servers/:b/:n/support[/*]` → backend flotte
`/admin/api/(hosts/:h/)servers/:b/:n/support[/*]` → app admin module
`support` (`/tickets`, sync pull + réponse).

```bash
# Ticket côté serveur marque (ou via l'UI /support du client) :
curl -sS -X POST http://127.0.0.1:<port>/api/v1/platform/platform-support \
  -H 'content-type: application/json' -d '{"sujet":"…","corps":"…"}'

# Sync + lecture côté app admin (module support) :
curl -sS -X POST http://127.0.0.1:18801/api/v1/modules/support/sync
curl -sS http://127.0.0.1:18801/api/v1/modules/support
# Réponse admin (relayée au serveur marque — visible sur /support client) :
curl -sS -X POST http://127.0.0.1:18801/api/v1/modules/support/<id>/reply \
  -H 'content-type: application/json' -d '{"corps":"…"}'
```

Prouvé E2E (2026-08-06, prod TF3) : ticket UI `/support` resto-marseille →
sync app admin `/tickets` → réponse admin → visible côté restaurateur
(« Équipe support », statut `repondu`). **Piège** : les containers
`creezio-host-agent` et `creezio-server-admin` embarquent le code
le code flotte au build — après toute modif kit de `packages/fleet/src` (`host-agent.ts` /
`server-admin.ts` / `server-lib.ts`), `npm run build:packages` puis re-builder via
`creezio server-docker agent up` + `admin up` (sinon nouvelles routes → 404
et sync `tickets:0` sans erreur).

### 5c. Billing Stripe (app admin)

Endpoint signé : `POST /api/v1/modules/billing-webhook/stripe` — configurer
`STRIPE_WEBHOOK_SECRET` (env `.env` gitignoré de l'app admin, injecté au
container) et pointer le webhook Stripe sur
`https://admin.{zone}/api/v1/modules/billing-webhook/stripe`. Projections :
`admin_billing_customers|subscriptions|invoices` (+ journal
`admin_billing_events`, dédup id). Test sans clé : payload signé à la main
(HMAC-SHA256 `t=…` — voir `verifyStripeSignature` dans `@creezio/admin`).

**Section Facturation** (page `/billing`, `BillingAdminClient` de
`@creezio/admin/ui`) : stats (MRR, actifs, impayées), clients + abonnement
(montant, statut, prochaine échéance `periode_fin`), factures, événements
Stripe reçus. API : `GET /api/v1/modules/billing/overview`. Rapprochement
client ↔ serveur : `PATCH /api/v1/modules/billing-customers/<id>`
`{"host_id":"local","server_name":"resto-…"}` (ou page Clients).

**Réconciliation ACTIVE** (webhook manqué, démarrage) :
`POST /api/v1/modules/billing/reconcile` (bouton « Resynchroniser Stripe »)
relit `customers`/`subscriptions?status=all`/`invoices` de l'API Stripe et
resynchronise les projections (idempotent, pagination `starting_after`).

```bash
# Brancher la vraie clé : dashboard Stripe → Développeurs → Clés API →
# « Clé secrète » (sk_live_… / sk_test_…) → .env gitignoré de l'app admin,
# puis recréer le container avec -e STRIPE_API_KEY=…  (jamais commitée).
# Sans clé : reconcile → 503 explicite avec ce mode d'emploi en hint.
# Test sans vraie clé : mock HTTP local + STRIPE_API_BASE=http://127.0.0.1:18999
# (gate kit : scripts/test-phase-admin-billing.mjs — webhook signé, overview,
#  reconcile mock : statut resynchronisé + facture manquée rattrapée).
```

**Piège** : l'image serveur admin embarque `server/ui/.next` PRÉ-buildé de
l'hôte — après toute modif UI (pages, `@creezio/admin/ui` — bump npm), faire
`npm run build --prefix server` (ou `build:ui`) AVANT
`npm run server-docker:build`, sinon la nouvelle page → 404.

Prouvé E2E (2026-08-06, admin TF) : webhooks signés simulés (« Le Petit
Marseillais », 49 €/mois active, factures payées) → `/billing` rendu complet ;
reconcile exécuté contre mock API Stripe (nom client corrigé, `periode_fin`
2026-09-01 remplie, facture `open` manquée rattrapée → impayées=1).

## 6. Agent hôte + enrôlement d'un VPS

**Objectif** : un VPS distant piloté par l'admin (create/update/logs à
travers le tunnel `agent.{slug}.{zone}`).

```bash
# Sur le VPS à enrôler :
creezio server-docker agent up --brand-root "$BRAND_ROOT"     # :18810, bind 127.0.0.1+172.17.0.1

# Côté admin — générer un enrollToken (one-shot, hashé dans fleet-hosts.json) :
curl -sS -u "admin:$ADMPASS" -X POST \
  http://127.0.0.1:18800/admin/api/hosts/enroll-token \
  -H 'content-type: application/json' -d '{"label":"vps-resto-x"}'
# → {"ok":true,"enrollToken":"…"}  (affiché UNE fois)

# Sur le VPS — enrôlement (provisionne le tunnel DÉDIÉ agent via l'API CF) :
creezio server-docker enroll --brand-root "$BRAND_ROOT" \
  --admin https://admin.tempoflow.fr --token <enrollToken> --slug <slug>
```

**Tunnel dédié agent (T7)** : l'ingress public `agent-{slug}.{zone}`
(défaut flat) / `agent.{slug}.{zone}` (nested si Universal SSL) vit
exclusivement sur un tunnel Cloudflare propre à l'agent (nom CF
`creezio-agent-<slug>`, container **`creezio-agent-tunnel`**, token
`{BRAND_ROOT}/docker-data/agent-tunnel.env` chmod 600). `enroll --slug` le
provisionne ; **`agent up` (chaque update de l'agent) détecte un hôte déjà
enrôlé sans tunnel dédié et exécute lui-même la migration** (provision →
connecteur → bascule CNAME → retrait d'une règle résiduelle sur un tunnel
d'instance) **et persiste l'URL publique canonique dans toutes les SoT
`agentUrl`** (`host-agent.json` + `docker-data/fleet-hosts.json` +
`POST /admin/api/hosts/agent-url`). Idempotent. Fail-closed si l'URL ne
peut pas être dérivée (ou si l'hôte est enrôlé sans SoT admin joignable).
`docker-data/fleet-hosts.json` est souvent **root:root 600** (écrit par
`creezio-server-admin`) : `agent up` tente l'écriture directe, puis
`sudo -n tee` (même wrapper que le préflight UFW), puis le POST admin
(le container écrit le fichier — même chemin que `enroll` / `update`).
Ne **pas** chmod/chown à la main. Si sudo et admin échouent : message
actionnable (`admin up` puis relancer `agent up`).
Sans `CREEZIO_CF_*` : refus fail-closed avec la liste des clés manquantes.
Respawn : Docker `unless-stopped` + surveillance bornée par le host-agent
(`@creezio/fleet` `agent-tunnel.ts`). État : `agent status` et
`GET /agent/api/health` (champ `agentTunnel`).

**Ownership DNS** : `server-docker rm <instance>` ne touche jamais
`agent.*` / `agent-*`. Le seul geste qui les retire :

```bash
creezio server-docker agent rm --brand-root "$BRAND_ROOT" [--slug <slug>]
```

**Firewall UFW — posé automatiquement (0.18.0+)** : tout port hôte consommé
depuis les conteneurs (18800 backend flotte, 18810 host-agent) doit être
autorisé par UFW depuis `172.16.0.0/12` (**tous** les réseaux Docker, y
compris les stacks compose en 172.25.x), pas seulement `172.17.0.0/16`
(docker0). `agent up`, `admin up` et `enroll` embarquent un **préflight UFW
fail-closed** (`packages/factory/src/server-docker-ufw.ts`, gate
`test-phase-server-docker-ufw`) : UFW actif + règle absente → règle posée
(droits root / `sudo -n`), sinon le geste **échoue** avec la commande exacte
(jamais silencieux ; UFW absent/inactif = OK loggé). Fallback manuel :

```bash
sudo ufw allow proto tcp from 172.16.0.0/12 to 172.17.0.1 port 18810   # host-agent
sudo ufw allow proto tcp from 172.16.0.0/12 to 172.17.0.1 port 18800   # backend flotte
```

Symptôme historique (kits < 0.18.0) : `[UFW BLOCK] … DPT=188xx` dans le
journal kernel (`sudo journalctl -k | rg 'UFW BLOCK.*DPT=188'`) et
`https://agent.{slug}.{zone}` en **timeout** alors que le CRM
(`https://{slug}.{zone}`) répond — le cloudflared in-process du conteneur
qui porte l'ingress `agent.*` est droppé par UFW. Vécu 10–30/08/2026
(migration stacks compose) : règle 18800 élargie à `172.16.0.0/12` mais
18810 restée scoped docker0 → pilotage host-agent cassé silencieusement
20 jours — incident qui a motivé l'automatisation.

**Vérification** : `curl -sS -u admin:… http://127.0.0.1:18800/admin/api/hosts`
→ l'hôte avec `"online":true` et son `agentUrl` `https://agent-<slug>.<zone>`
(URL du tunnel dédié, persistée par `agent up` / `enroll` dans
`host-agent.json` et `fleet-hosts.json`).

**Vérité** : `packages/factory/src/server-docker-cli.ts` (agent/enroll) +
`server-docker-agent-tunnel.ts` (container tunnel dédié),
`packages/platform-core/src/tunnel-cf-client.ts` (`ensureCfAgentTunnel`,
`deprovisionCfAgentTunnel`),
`packages/fleet/src/agent-tunnel.ts` (surveillance respawn),
`packages/fleet/src/server-admin.ts` (`/admin/api/enroll` — auth par enrollToken, pas Basic),
tokens agent : `docker-data/host-agent.json` (hashés, `agent token new|revoke`).
Gates : `test-phase-agent-tunnel`, `test-phase-tunnel-self-provision` (§10),
`test-phase-server-docker` (rm instance ≠ DNS agent).

## 7. Client desktop thin (remote-only)

**Objectif** : binaire client (AppImage/NSIS) sans services locaux —
picker « Rejoindre un serveur ».

```bash
cd "$BRAND_ROOT"
npm run pack:win            # NSIS x64 (livrable client/)
npm run electron:publish:dry   # contrôle feed/kind sans pousser
npm run electron:publish       # → feed https://crm.tempoflow.fr/dl-…/tf3/
npm run electron:verify-pack   # vérifie kind=client dans l'artefact
```

URL serveur pré-provisionnée : env `TF3_DEFAULT_SERVER_URL` (prefixe env de
la marque) ou `defaultServerUrl` dans le BrandSpec/manifest — ne remplace
jamais le dernier choix utilisateur.

**Vérité** : `client/package.json` + `client/electron-builder.client.json`
(GUID NSIS propre TF3, feed `…/tf3/`),
`node_modules/@creezio/desktop-tooling/scripts/publish-desktop.sh`,
picker : `packages/electron-shell/src/desktop/brand-desktop-runtime.ts`.

**Pièges** : publish détecte le feed **local** (container nginx-proxy-manager
sur le même VPS) → `docker cp` direct, PAS de ssh-vers-soi ; feed TF2
(`…/dl-…/` racine ou GUID TF2) à ne jamais polluer — TF3 = sous-dossier
`/tf3/` + GUID dédié.

## 8. Diagnostics — boot qui échoue

Dans l'ordre :

```bash
curl -sS http://127.0.0.1:<port>/api/v1/os/boot-status   # étapes + % + détail erreur (200 même pendant le boot)
curl -sS http://127.0.0.1:<port>/api/v1/core/health      # 503 pendant le boot, 200+brandId après
curl -sS http://127.0.0.1:<port>/api/v1/core/version     # version image (update OK ?)
curl -sS http://127.0.0.1:<port>/api/v1/os/ready         # agrégat hosts n8n/Hermes/Meili
creezio server-docker logs <nom> --brand-root "$BRAND_ROOT" --tail 200
docker logs <container> 2>&1 | rg '"creezio":"boot-step"' | tail   # une ligne JSONL par transition
docker exec <container> sh -c 'ls -t /data/ops/*.jsonl | head -2'  # journal ops (mêmes kinds que desktop)
npm run crash:list --prefix "$BRAND_ROOT/server"                   # crash reports
```

L'admin (§5) montre boot-status live, logs et ops par serveur sans SSH.

Agent hôte injoignable (`https://agent.{slug}.{zone}` en timeout) alors que
le CRM répond : vérifier UFW — `sudo journalctl -k | rg 'UFW BLOCK.*DPT=188'`
(règle `172.16.0.0/12` → 18800/18810 manquante, voir §6) — puis le
connecteur dédié : `docker ps -a --filter name=creezio-agent-tunnel` +
`docker logs creezio-agent-tunnel --tail 50` (T7 ; le host-agent le
redémarre seul, backoff borné — un abandon est loggué dans
`docker logs creezio-host-agent`).

**Vérité** : `packages/app-runtime/src/listen-brand-os-http.ts` (routes os),
`start-brand-kernel-harness.ts` (étapes boot),
`packages/observability/src/ops/journal.ts`.

## 8b. Meili fail-closed (kit ≥ 0.10.13/0.10.14) — symptôme → cause → geste

Meili est un composant **CORE fail-closed** (comme SQLite) dès qu'un feed
marque déclare ≥ 1 index : plus de `engine:"sql-fallback"` silencieux,
**zéro LIKE SQL de secours** sur le catalogue (browse/filtre/pagination,
y compris sans `q`).

| Symptôme | Cause | Geste |
|---|---|---|
| Boot refuse de démarrer, `MeiliRequiredError` dans les logs | Binaire Meili absent / ne démarre pas alors que le feed déclare des index | Vérifier le binaire embarqué (`ensure-kit-binaries`, image à jour), `docker logs … \| rg boot-step`, relancer ; ne PAS contourner |
| Browse **et** search catalogue → **503 `{"error":"meili_unavailable"}`** | Meili KO à chaud (process mort, disque plein) | `curl /api/v1/os/ready` (host Meili), redémarrer l'instance ; le 503 est le contrat, pas un bug |
| Listes vides + `engine:"indexing"` (browse) / `source:"indexing"` (/search), HTTP 200 | Indexation initiale en arrière-plan (normal après create/update, ~5 min pour 86k produits) | Attendre `docker logs … \| grep index.done` ; ne jamais awaiter l'indexation dans le boot (§9) |

Échappatoire `CREEZIO_ALLOW_NO_MEILI=1` : dev/tests **hors-browse**
uniquement (warning bruyant) — **interdit en prod**. Chaque module métier
déclare `meiliIndexes` **ou** `horsIndexJustification` (doctor brand-spec
fail-closed `MODULE_MEILI_MISSING`, 0.10.13+).

**Vérité** : `packages/api-kernel/src/meili-browse.ts` + `entity-mount.ts`
(503/`engine`), `packages/electron-shell/src/host/brand-meili-boot.ts`
(`MeiliRequiredError`), section Meili de
`packages/electron-shell/AGENTS.md`.

## 9. Pièges connus (ne pas les refaire)

| Piège | Règle |
|---|---|
| Ordre catalogue vs listen | L'import catalogue doit tourner **après** le listen HTTP (`METIER_BASE_URL` posé), sinon « skipped ». Déjà corrigé dans le harness — ne pas réintroduire d'étape catalogue pré-listen. |
| AUTH_SECRET | Généré/persisté **par instance** (`/data/{brand}-config.json`) au boot ; jamais le fallback dev en prod ; ne pas partager entre serveurs. |
| Setup ≠ login | `POST /api/v1/os/setup` n'écrit pas `creezio_users` → faire aussi `migrateBrandCredentialsToKit` (§2). |
| Packages npm | `browser-host` est publié (`@creezio/browser-host`) — consommé via `npm update "@creezio/*"`. |
| dist stale → routes manquantes | Après modif `packages/*/src` : **`npm run build:packages`** avant sync/publish. Gate `test-phase-runtime-dist-freshness` + assert dans sync et `server-docker publish\|build`. Vécu : Admin Database monté en src, dist non rebuild → « Route inconnue ». |
| Symlinks electron-builder | Refuse les symlinks hors racine projet (leçon de l'ancien layout `client/vendor` — copie hardlink, pas un symlink ; layout npm = `node_modules` standard). |
| Publish desktop | Feed sur le même VPS → flux Docker local (`docker cp`), pas de SSH vers soi-même. |
| Feed TF2 | Ne pas écrire dans le feed/GUID TempoFlow2 — TF3 a son sous-dossier `/tf3/` et son GUID. |
| Collector TF2 | `tf2-fleet-collector.service` loopback **:8665** = prod TF2, ne pas toucher (ni élargir son `ALLOWED_REMOTE`). |
| Slugs réservés | `admin`, `mcp`, `api`, `agent`, `demo`, `test`, `registry`… (`packages/platform-core/src/tunnel-cf.ts`) — jamais pour un serveur client. |
| Cloudflare timeouts | Toute opération longue exposée via tunnel = async (202 + route de statut), jamais une requête bloquante. |
| Compose vs registre | Instances Compose = `server-1`, `server-2` (chiffres) ; instances registre (`create <nom>`) = libres. Projet Compose `creezio-servers`/`tf3-servers`, jamais `tempoflow`/`n8n`. |
| UFW vs réseaux compose | Les stacks compose créent des réseaux dédiés (172.25.x) hors docker0 : une règle UFW scoped `172.17.0.0/16` cesse de couvrir les conteneurs migrés. Règle : tout port hôte consommé depuis les conteneurs (18800 backend flotte, 18810 host-agent) autorisé depuis `172.16.0.0/12` — **posée automatiquement par le préflight fail-closed de `agent up`/`admin up`/`enroll` (0.18.0+, §6)**. Symptôme (kits < 0.18.0) : `[UFW BLOCK] … DPT=188xx` (journal kernel), `agent.*` en timeout alors que le CRM répond. Vécu 10–30/08 : 18800 élargi, 18810 oublié → host-agent droppé 20 jours. |
| Résolution module packagé | Jamais de parsing de stack pour retrouver `file://` (les frames Windows `file:///C:/…` cassent tout regex naïf → crash client). SoT : `createAppRequire` (`@creezio/platform-core`) ; gate `verify-pack-runtime` refuse le pattern. |
| UI marque = chrome kit + Tailwind | La factory génère `ui/tailwind.config.ts` (scan `node_modules/@creezio/*/ui` + routes OS), `postcss.config.js`, `globals.css` (tokens) et `components/brand-chrome.tsx` (WorkspaceRoot/configureSidebar). App qui rend du HTML brut sans sidebar = Tailwind/chrome manquant, corriger la factory (gate `test-phase-os-ui-scaffold`). |
| Gros catalogues (85k+ skus) | Jamais une requête SQL par ligne dans un handler liste (N+1 = event loop bloqué, tout le serveur pend, même `/health`). Agréger en SQL (CTE + window), indexer (`produits(sku_id)`, `prix(produit_id)`), capper les listes génériques. |
| Login API | `POST /api/v1/auth/login` body JSON `{"email": <username>, "password": …}` (champ `email` même pour un username) ; cookie de session, contrôle via `/api/v1/auth/me`. |
| Permissions owner | La marque DOIT déclarer `configureAuth({ cookieName, ownerPermissions })` au beforeBoot (bindings plateforme) — sinon les sessions owner sont signées avec `permissions: []`, `/api/v1/auth/me` renvoie une liste vide et la sidebar métier est amputée (seules les entrées non gardées restent). Collaborateurs : permissions stockées par user (`creezio_platform_users.permissions`) ; défauts/assignables/owner-only déclarés via `configureAuth({ collaboratorDefaultPermissions, collaboratorAssignablePermissions, ownerOnlyPermissions })`. |
| Référentiel users unique | `/api/v1/users` est une route PLATEFORME (alias de `/api/v1/platform/users`, interceptée par le kernel avant le plane). Un `POST` human exige `password` et crée les credentials kit → login immédiat. Jamais de table `users` métier in-plane pour les comptes (l'ancienne route TF2 in-plane est shadowée, code mort inoffensif). |
| Enregistrement des gates | La SoT des gates est le script `npm test` du `package.json` racine (test-fast la parse) — un fichier `scripts/test-*.mjs` NON listé n'est **jamais** exécuté par `test:kit`/CI. Toute nouvelle gate doit y être ajoutée (piège réel : `test-phase-os-ui-scaffold` a existé non branchée). |
| Design system généré | La factory ne DOIT générer que des pages avec composants kit (`@/components/ui/*` = re-exports `@creezio/shell-ui/ui/primitives/*`, tables via `EntityTable`/DataTable kit). `renderNextLayoutTsx` (layout HTML brut) est supprimé — gate `test-phase-os-ui-scaffold` verrouille. |
| Page métier vs wrapper os-ui | `materialize.mjs` (os-ui) skippe toute route que la marque possède (`ui/app/<route>/page.*`) — la page métier verbatim (ex. `/onboarding`, `/parametres` TF) prime sur le wrapper kit. Ne jamais supprimer une page métier pour « résoudre » un conflit parallel pages : c'est le wrapper qui cède. La possession est **exacte, pas récursive** : `/parametres` marque ne doit pas emporter l'enfant kit `/parametres/email` (vécu TF3 : page email absente du build, lien « Paramètres email » en 404). Gate : `test-phase-os-ui-scaffold`. |
| Réindexation Meili vs update | Une réindexation complète (bump `schemaVersion` du feed marque, gros catalogue : ~5 min pour 86k produits) ne doit JAMAIS être awaitée dans le boot — sinon le healthcheck d'update (180 s) expire et l'update **rollback automatiquement** (vécu sur 0.3.4). SoT : `maybeBootBrandMeili({ backgroundIndex: true })` dans le harness et le desktop ; `/search` sert `source:"indexing"` pendant l'indexation, boot-step `index` passe à done à la fin (`docker logs … \| grep index.done`). |
| Feed Meili riche marque | UIDs marque legacy (`tf2_*`) interdits — le kit impose `catalog_*`. Pour des documents riches (jointures/provenance/taxonomie), la marque fournit `loadDocs` dans son `BrandMeiliIndexSpec` (SQL marque côté marque, jamais dans le kit) + fallback documents simples si le schéma catalogue n'est pas encore matérialisé (serveur neuf). L'UI doit interroger les mêmes UIDs (`lib/meilisearch.ts`, `queries.ts`, `meili-rag.ts`). |
| Sous-routes plateforme in-plane | Les préfixes plateforme (`/api/v1/{auth,users,tasks,assistant,desktop}`) sont interceptés par la surface kit AVANT le kernel ; une sous-route inconnue (ex. `POST /api/v1/desktop/heartbeat` métier) fallthrough vers le plane UI via le marqueur `platform_route_not_found` (notFound de `mountBrandPlatformSurface`). Si une route métier sous ces préfixes renvoie un 404 texte : vérifier que la version `@creezio/*` consommée porte ce fix. |
| E2E parité marque | `tempoflow3/server/scripts/test-e2e-parite.mjs` (env `TF3_BASE` — pas `TF3_BASE_URL` —, `TF3_OWNER_USER/PASS`, `TF3_STAFF_USER/PASS`, `--full` pour le volet mutant étude→optimiser→dispatch). CDP : les sleeps fixes flakent à froid post-update — toujours des attentes actives (`waitEv` sur sélecteur) + retry de page ; `document.body` peut être null pendant une transition. La sidebar SSR est NON filtrée (le filtre ACL est client après `/auth/me`) : attendre l'hydratation avant d'asserter. |
| Owner n8n = setup VÉRIFIÉ | n8n vierge répond **200 à `/rest/login` SANS cookie** (shell user) et monte `/rest/*` AVANT la fin de l'init DB : un `POST /rest/owner/setup` trop tôt renvoie 200 mais l'écriture est **perdue** (vécu : « owner: login OK »/« setup OK » sur instance demo/proof vierges, DB sans owner, login 401 ensuite). Règles kit (`n8n/launcher.ts`) : login réussi = 2xx **ET** cookie `n8n-auth` (`n8nLoginSucceeded`) ; readiness = `/rest/settings` avec `userManagement.showSetupOnFirstLoad` présent ; setup conclu seulement après login vérifié (retries). Gate : `test-os-embeds` (prédicats). |
| Install Hermes root Linux = FHS | L'`install.sh` amont récent en **root Linux** (containers server-docker) installe en layout FHS `/usr/local/lib/hermes-agent` + `/usr/local/bin/hermes` — hors sandbox, le launcher ne trouve jamais le CLI (« CLI toujours introuvable après install », vécu demo). Verrou kit : `HERMES_INSTALL_DIR={profile}/.hermes/hermes-agent` dans l'env d'install (`hermesInstallLayoutEnv`) + fallback lecture FHS root-only (`hermesFhsFallbackDirs`) pour les instances installées avant le verrou. Les instances FHS existantes (demo) retrouvent leur CLI au prochain boot d'une image à jour. |
| Backup update = tar exit 1 OK | GNU tar sur un volume `/data` **vivant** sort en exit 1 (« file changed as we read it ») avec une archive complète et valide — ne JAMAIS traiter exit 1 comme échec (vécu : « backup indisponible (tar) » avec .tar.gz de 2,4 Go pourtant intègre). SoT `@creezio/fleet` `server-lib.ts` `backupInstanceData` : exit 0/1 acceptés, `gzip -t` vérifie l'archive, log `backup … (N Mo, gzip vérifié)` ; si le backup demandé est réellement impossible, l'update **échoue proprement AVANT recreate** (plus de warning silencieux). Le fix vit dans les images `creezio-server-admin:local`/`creezio-host-agent:local` → re-runner `admin up` + `agent up` après un pull kit pour l'embarquer. |
| Backup ≠ GitHub | Le tar.gz sauve les **données** `/data` (sqlite…), pas le code. Défaut update = **pas** de nouveau backup (opt-in `--backup` / `backup:true`). One-shot : `server-docker backup <nom>`. Archives dans `docker-data/backups/` conservées. |
| Onglet workspace ≠ refetch RSC | Réactiver un onglet workspace (`router.replace` vers une route déjà visitée) ne refetch **JAMAIS** le payload RSC en Next 14 — cache client de session resservi tel quel, zéro requête réseau (prouvé CDP, même après 35 s). Une page RSC en pane keep-alive mutée depuis une autre page reste figée jusqu'au reload dur. Toute mutation hors page doit être couplée à une invalidation : compteur de mutations module-scope + `router.refresh()` quand la pane est/redevient visible (pattern TF3 `panier-live-refresh.tsx` + `notifyPanierChanged`, bug panier 0.3.6). Vaut pour le workspace marque TF verbatim ET la copie kit `shell-ui/ui/workspace`. |
| Lockfile Docker marque neuve | Empêché structurellement : `prepareBrandDistribution` (locks npm) tourne à chaque `new-app`/`brand apply`/push ; `docker:build` appelle `ensure-server-lock.mjs` avant `docker build` ; Dockerfile `npm ci \|\| npm install --omit=dev` ; `server-docker create\|build` régénère si stale. **Interdit** de régénérer le lock Docker à la main hors `ensure-server-lock` / `ensureBrandPackageLocks`. Clone hôte : `npm ci` racine (workspace — layout = Docker). Gate : `test-phase-factory-lockfile` + `test-phase-clone-autonomy`. |

## 10. Entretien disque Docker (VPS hôte)

**Objectif** : ne plus jamais saturer le disque du VPS avec les builds
répétés du kit (build cache BuildKit + vieilles images versionnées dans le
daemon et le registre `registry:2`). Quatre mécanismes standard, en couches :

1. **GC BuildKit native** (`/etc/docker/daemon.json`, appliquée au restart
   du daemon) :

```json
{
  "builder": {
    "gc": {
      "enabled": true,
      "defaultReservedSpace": "10GB",
      "defaultMaxUsedSpace": "15GB",
      "defaultMinFreeSpace": "25GB"
    }
  }
}
```

   (Docker ≥ 25 : `defaultReservedSpace`/`defaultMaxUsedSpace`/`defaultMinFreeSpace` ;
   l'ancien `defaultKeepStorage` reste accepté = `defaultReservedSpace`.)
   Valider avant restart : `sudo dockerd --validate --config-file /etc/docker/daemon.json`.

**Politique (2026-09, rollback semver)** : après chaque publish, rétention
**par famille** — N=2 tags `auto.*` (CI) **et** au moins les **3** derniers
semver (fenêtre indépendante : une rafale `auto.*` n'évince jamais un
semver). Jamais le tag référencé par `servers.json` / instances. Les
backups `/data` ne sont **plus** créés à chaque update (défaut skip) —
les archives de référence dans `docker-data/backups/` se gardent. Build
cache plafonné à **5GB**.

2. **Timer systemd quotidien** (VPS TempoFlow : `docker-disk-maintenance.timer`,
   04h30 UTC, script `/usr/local/sbin/docker-disk-maintenance.sh`) :
   - alerte journal (`logger`, prio warning) si usage disque `/` ≥ 85 % ;
   - **garde-fou** : purge sautée si un `docker build|push` ou
     `server-docker publish` est en cours ;
   - `docker system prune -f` (**sans `-a`** : ne supprime jamais une image
     taguée, donc les images des serveurs à l'arrêt restent rollbackables) ;
   - `docker builder prune --max-used-space 5GB -f` (**pas** `--keep-storage`
     = reserved-space : plancher qui ne purge JAMAIS sous le budget — vécu
     cache 23,5 Go et « Total: 0B ») ;
   - rétention registre : garde les N derniers `auto.*` **et** au moins
     les 3 derniers semver par repo (familles indépendantes),
     DELETE des manifests plus vieux (digests partagés avec un tag conservé
     protégés), **purge des révisions orphelines** (les publish buildx
     poussent un index OCI + attestation : supprimer le seul index laisse
     des révisions enfants qui retiennent tous les blobs — vécu 17 Go pour
     3 tags ; `--delete-untagged` est bugué avec ces index, ne pas l'utiliser)
     puis `registry garbage-collect` dans le container `creezio-registry`
     (blobs). Pré-requis : `REGISTRY_STORAGE_DELETE_ENABLED=true`.
   - backups `/data` : **ne pas purger** les archives de référence dans
     `docker-data/backups/` (politique : un backup stable gardé ; les updates
     n'en créent plus par défaut) ;
   - rétention daemon : 2 tags par repo du registre local
     (`DOCKER_MAINT_KEEP_DAEMON_TAGS`, images utilisées épargnées par rmi).
   - Réglages : `/etc/default/docker-disk-maintenance` — sourcé AVANT les
     défauts (`DOCKER_MAINT_KEEP_TAGS=2`, `_KEEP_DAEMON_TAGS=2`,
     `_BACKUP_KEEP=1`, `_KEEP_STORAGE=5GB`, `_ALERT_PCT`, `_REGISTRY_URL`).
   - Suivi : `systemctl list-timers docker-disk-maintenance.timer` ;
     `sudo journalctl -u docker-disk-maintenance.service -n 50`.

3. **Rétention dans le flux publish** (§4) : après chaque push réussi,
   `server-docker publish` applique la même politique par famille
   (`selectTagsToPrune` : ≥ 3 semver, N auto.*, jamais un tag
   `servers.json`) — daemon + registre privé — puis prune le build cache
   (`--max-used-space 5GB`, fallback `--keep-storage` daemons anciens).
   Best-effort : ne fait jamais échouer le publish.

4. **Flux update** : plus de backup automatique ni de `pruneBackups` —
   opt-in `--backup` seulement. Les `.tar.gz` de référence restent dans
   `docker-data/backups/` (re-runner `admin up` + `agent up` après pull kit
   pour embarquer le défaut `backup=false`).

**Vérification** : `docker system df` (Build Cache ≤ 5GB),
`df -h /` < 85 %, `curl -s http://127.0.0.1:5000/v2/<repo>/tags/list` :
au moins les 3 derniers semver encore listés (une rafale `auto.*` ne
doit pas les avoir évincés), archives de référence intactes sous
`docker-data/backups/`.

**GC registre à la demande (T11)** — geste CLI fail-closed, indépendant du
timer. À lancer **hors push** (même garde-fou que le timer) :

```bash
# Plan (DÉFAUT — aucune mutation) :
creezio server-docker registry-gc
# Défaut : registre 127.0.0.1:5000, container creezio-registry, --keep 2
# (env CREEZIO_REGISTRY_GC_KEEP / CREEZIO_PUBLISH_KEEP_TAGS / --keep N)

# Purge réelle (--apply) : DELETE des manifests hors rétention, puis
# `registry garbage-collect` dans le container.
creezio server-docker registry-gc --apply --keep 2 \
  --brand-root /opt/docker/tempoflow3 --admin-app https://admin.<zone>
# Options : --registry 127.0.0.1:5000 --container creezio-registry --repo <name>
```

Politique : garde les N tags les plus récents **par repository et par
famille** (tri version — les tags `auto.*` de l'auto-publish CI d'un côté,
les tags **semver** de l'autre avec une fenêtre **indépendante ≥ 3** :
une rafale d'auto-publish n'évince jamais un semver) **et** tout tag
PROTÉGÉ :

- conteneur en cours (`docker ps` / images utilisées) ;
- `docker-data/servers.json` (`--brand-root` explicite + découverte
  automatique via les labels `creezio.brand-root` de tous les conteneurs,
  même arrêtés) — image du registre + image de chaque instance déclarée ;
- releases fleet déclarées dans l'app admin, tous statuts (`--admin-app`
  ou env `CREEZIO_FLEET_ADMIN_URL`) — admin posée mais injoignable =
  **refus** (jamais de GC en aveugle).

Jamais de suppression d'un tag en usage ou référencé. Digest partagé avec
un tag conservé → skip (pas de DELETE). **Dry-run par défaut** : liste
KEEP/DELETE sans mutation ni GC — seul `--apply` exécute.

Fail-closed (exit ≠ 0, message actionnable) : docker absent, registre down
(`/v2/` KO), `servers.json` illisible, app admin posée mais injoignable,
DELETE manifeste KO (`REGISTRY_STORAGE_DELETE_ENABLED=true` requis),
container registry arrêté, `garbage-collect` KO.

**GHCR** (`--registry ghcr.io/<owner>`) : même geste `registry-gc`, autre
backend — API GitHub Packages `…/packages/container/<image>/versions`
(jamais l'API v2, `privateRegistryBases("ghcr.io")` reste `[]`). Garde
≥ 3 semver + tout tag in-use / `servers.json` / instances / releases ;
dry-run par défaut, `--apply` DELETE la version. Auth manquante =
fail-closed (`GHCR_TOKEN` / `GITHUB_TOKEN` / `.github-token`, scope
`delete:packages`). Le registre de prod TempoFlow peut être loopback
(`127.0.0.1:5000`) : ce chemin ne s'active que si la cible EST `ghcr.io`.

**Vérité** : `packages/factory/src/server-docker-registry-gc.ts` (geste
`registry-gc` local) ; `packages/factory/src/server-docker-ghcr-gc.ts`
(rétention GHCR + `publish`) ; `packages/factory/src/server-docker-cli.ts`
(`runPublishRetention`, `selectTagsToPrune` / `selectGhcrTagsToPrune`) ;
hôte : `/etc/docker/daemon.json`,
`/usr/local/sbin/docker-disk-maintenance.sh`,
`/etc/systemd/system/docker-disk-maintenance.{service,timer}`.
Gates : `scripts/test-phase-server-docker-registry-gc.mjs`,
`scripts/test-phase-server-docker-ghcr-gc.mjs`.

**Pièges** : `daemon.json` exige un **restart** de `docker.service` (pas un
reload) → jamais pendant un build/publish ; re-vérifier ensuite la santé des
containers prod (restos, TF2 `crm.tempoflow.fr`, collector :8665). Ne jamais
lancer `registry garbage-collect` pendant un push (risque de blobs
manquants) — le timer s'en garde via son garde-fou ; `registry-gc` non plus
pendant un push. `docker system prune -a`
interdit en cron : il supprimerait les images des serveurs arrêtés.

## 11. n8n & Hermes embarqués (superadmin, clé API, webhooks, MCP, skills)

**Objectif** : chaque serveur Docker embarque n8n + Hermes provisionnés
automatiquement, avec un superadmin flotte uniforme.

**Superadmin flotte** : env `CREEZIO_SUPERADMIN_EMAIL` /
`CREEZIO_SUPERADMIN_PASSWORD` (≥ 12 chars) posés dans le `.env` racine de la
marque (gitignoré) — `server-docker create --profile prod` les forward dans
chaque container (avec `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`). Valeurs de la
flotte TF3 : `/home/deploy/.tf3-demo-credentials`.

- **n8n owner** : créé au premier boot par `ensureOwnerSilent`
  (`electron-shell/src/host/n8n/launcher.ts`) — attend `waitForN8nRestReady`
  (`/rest/settings` ≠ 404 : sur n8n ≥ 2.x healthz répond AVANT le montage des
  routes REST, un setup trop tôt part en 404 silencieux → page /setup vierge).
  Login = superadmin env ; fallback creds fichier
  (`/data/n8n-home/.{brand}-n8n-owner.json`) si l'instance a été initialisée
  avant, avec rotation best-effort du password vers le superadmin.
- **Clé API n8n** : provisionnée après l'owner (`ensureN8nApiKey`, scopes
  workflow/credential/tag), stockée `/data/n8n-home/.{brand}-n8n-api-key.json`,
  injectée dans l'env Hermes (`N8N_API_KEY` + `N8N_API_URL` + `N8N_BASE_URL`)
  via `getHermesBridgeEnv` → skill `creezio-n8n` : Hermes crée des workflows
  n8n directement (POST `{N8N_API_URL}/workflows`, header `X-N8N-API-KEY`).
- **Webhooks publics** : `WEBHOOK_URL`/`N8N_EDITOR_BASE_URL` =
  `https://n8n.{slug}.{domaine}` dès que le tunnel est up (log
  `[n8n] WEBHOOK_URL / N8N_EDITOR_BASE_URL = …`). Test :
  workflow webhook activé → `curl https://n8n.{slug}.{domaine}/webhook/<path>`.
- **MCP n8n** : `N8N_MCP_ACCESS_ENABLED` posé par le launcher (parité TF2).
- **Hermes WebUI protégé (mode serveur)** : `serverWebuiPassword()` —
  `HERMES_WEBUI_PASSWORD` explicite sinon superadmin flotte ; sans auth :
  302 `/login` + API 401. Desktop loopback reste sans prompt (contrat gold).
- **Skills seedés au boot** (`seedHermesSkillsFromDirs`) : génériques kit
  (`electron-shell/resources/vendor/hermes-skills/` : `creezio-n8n`,
  `creezio-plugins` = workflow de création de plugins) + skills marque
  (`{brandRoot}/server/vendor/hermes-skills/`, ex. `tempoflow3-context/crm`)
  → `/data/hermes-home/skills/`.

**Pièges** :

| Piège | Règle |
|---|---|
| Segments home embeds | Les launchers utilisent `{userData}/n8n-home` et `{userData}/hermes-home` (SoT `platform-core/paths.ts`). `compose-brand-os` doit passer LES MÊMES segments — un `n8n`/`hermes` recomposé à la main casse silencieusement le bridge (clé API introuvable → `N8N_API_KEY` absent de l'env Hermes, vécu 0.3.6). |
| Clé LLM serveur headless | `store.getLlmKeys()` = BYOK prioritaire, fallback env `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` du container. Une clé placeholder posée au setup MASQUE la clé opérateur → supprimer `openaiApiKey` du `/data/{brand}-config.json` de l'instance. |
| Env superadmin instances existantes | `servers.json` est root-owned : patcher le bloc `env` en sudo puis re-POST update admin (le recreate réinjecte l'env). |

## 12. Intégrations / clés API tierces (OpenAI, Notion…)

**Objectif** : enregistrer les clés d'outils externes d'un serveur et les
consommer **par référence** (`integration://<slug>`) depuis Hermes/plugins,
avec push automatique vers le n8n embarqué (ADR
`docs/adr/ADR-integrations-store.md`, package `@creezio/integrations`).

UI : page CRM `/admin/integrations` (owner). API (mêmes gestes) :

```bash
# CRUD (session owner — voir §3 pour le cookie) :
curl -sS http://127.0.0.1:$PORT/api/v1/platform/integrations -H "cookie: $COOKIE"
curl -sS -X POST http://127.0.0.1:$PORT/api/v1/platform/integrations \
  -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"provider":"openai","label":"OpenAI (compte client)","secret":"sk-…"}'
# → {"integration":{"reference":"integration://openai","secretHint":"sk-…",
#    "n8nCredentialId":"…"}} — credential n8n `creezio:openai` créée si n8n up.
# PATCH /:id {label|secret|meta} (re-push n8n si secret/meta) ; DELETE /:id
# (supprime aussi la credential n8n) ; POST /:id/sync-n8n (re-push manuel).

# Résolution par référence — canal service (ce que fait un plugin Hermes,
# clé CRM de l'env Hermes = /data/.{brand}-hermes-crm-api-key.json) :
curl -sS -X POST http://127.0.0.1:$PORT/api/v1/platform/integrations/resolve \
  -H "authorization: Bearer $CRMKEY" -H 'content-type: application/json' \
  -d '{"reference":"integration://openai"}'
# → {"integration":{"secret":"sk-…"}} — seul endpoint qui rend la valeur.
```

**Vérification** : liste = `secretHint` seulement (jamais de secret) ;
`n8nAvailable:true` quand la clé API n8n est provisionnée ; credentials
visibles côté n8n : `GET {N8N_API_URL}/credentials` (header `X-N8N-API-KEY`)
— métadonnées seulement, n8n **ne réexpose jamais** la valeur (raison d'être
du store natif).

**Vérité** : `packages/integrations/` (store chiffré AES-256-GCM/AUTH_SECRET
dans `core.db`, routes, sync n8n), montage
`app-runtime/src/mount-brand-platform-surface.ts`, page kit
`os-ui/routes/admin/integrations/`, skill Hermes `creezio-integrations`.

**Pièges** :

| Piège | Règle |
|---|---|
| Table `api_keys` requise | Le canal service (resolve Hermes/plugins) lit `api_keys` dans la **brand db** — migration marque `fromprd_brand_012_api_keys` (TF3) / `fromprd_brand_api_keys` (factory). Sans elle : resolve 401 et `crm-key Hermes: table api_keys absente` au boot. |
| n8n down ≠ erreur | La sync n8n est best-effort : l'intégration est créée même si n8n est indisponible (`n8nCredentialId` null) — re-push via `POST /:id/sync-n8n`. |
| Secrets | Jamais de secret réel dans un commit/gate — valeurs de test uniquement ; les vraies clés vivent dans le store chiffré de l'instance. |

## 13. Landing page publique de marque (`lp.{zone}` — @creezio/landing)

**Objectif** : exposer la landing page de la marque (module natif hybride,
ADR `docs/adr/ADR-module-natif-hybride.md`) sur `lp.{zone}` — contenu 100 %
en DB brand, édité sur la page `/landing` de l'app **admin** de la marque,
rendu public `/lp` (sans session) sur le même plane Next.

```bash
# 1. Le serveur admin de la marque doit embarquer le module (factory : natif ;
#    marque existante : landingMigrations + createLandingMount + pages
#    /landing, /lp, /lp-media + middleware — voir packages/landing/README.md).
curl -s http://127.0.0.1:$ADMIN_PORT/api/v1/modules/landing/public | head -c 200

# 2. Réserver le hostname zone-level (kind=brand-web : UN ingress, pas
#    d'embeds n8n/hermes, pas de wildcard DNS, pas d'e-mail) :
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"lp","kind":"brand-web","crmPort":'$ADMIN_PORT'}' \
  http://127.0.0.1:8666/reserve
# → tunnelToken (240 chars). Slugs autorisés : BRAND_WEB_SLUGS (lib.mjs).

# 3. cloudflared sur l'hôte — unit systemd dédiée, token dans un env file
#    root-only (TUNNEL_TOKEN=…), et **--protocol http2** (QUIC/UDP instable
#    sur les VPS OVH → 500 intermittents sinon) :
#    ExecStart=…/cloudflared tunnel --no-autoupdate --protocol http2 run
sudo systemctl enable --now creezio-lp-tunnel

# 4. Vérifier :
curl -s -o /dev/null -w "%{http_code}\n" https://lp.$ZONE/        # 200
curl -s https://lp.$ZONE/api/v1/modules/landing/public | head -c 120
```

**Édition** : admin OS → nav « Landing page » (`/landing`) — textes, images
(upload → `/lp-media/<file>`), ordre/activation des sections. Chaque PUT est
immédiatement visible sur `https://lp.{zone}`.

**Pièges** :

| Piège | Règle |
|---|---|
| 500 + `EPROTO wrong version number` dans les logs Next | Le middleware doit forcer `url.protocol = "http:"` sur le rewrite `/lp` (le plane Next sert en http clair derrière le tunnel TLS). |
| Chrome OS (sidebar/onglets) visible sur la page publique | `WorkspaceRoot` (shell-ui) rend « bare » `/lp` et tout host `lp.*` — bump `@creezio/shell-ui` si la marque a une version antérieure. |
| QUIC flap (`timeout: no recent network activity`) | Toujours `--protocol http2` pour les tunnels hôte. |
| Slug `lp` volé par un serveur client | `lp` est dans `RESERVED_SLUGS` — seuls les reserves `kind=brand-web` peuvent le prendre. |

**Vérité** : `packages/landing/` (moteur + prefabs + admin client),
`packages/platform-core/src/tunnel-cf.ts` (`BRAND_WEB_SLUGS`, mode sans embeds),
factory `packages/factory/src/admin-repo.ts` (câblage généré), gate
`scripts/test-phase-landing.mjs`.

## 14. Clone autonome d'un repo marque (sans kit)

Les monorepos marque GitHub consomment le kit en **packages npm publiés**
(`@creezio/*` GitHub Packages) + artefacts matérialisés
(`scripts/ensure-server-lock.mjs`, `docker/server.Dockerfile`, `.dockerignore`,
`.npmrc`). Sur une machine SANS `/opt/docker/creezio` :

```bash
git clone https://github.com/creezio/<brand>.git && cd <brand>
export CREEZIO_NPM_TOKEN=…      # PAT read:packages (org creezio)
npm ci                          # workspace racine (deps @creezio/* npm)
npm ci --prefix server/ui && npm ci --prefix client
npm run build:runtime && npm run build:ui
npm run docker:build            # ensure-server-lock + image via docker/server.Dockerfile
docker run -d --name <brand>-proof -p 127.0.0.1:18791:18791 \
  -v "$PWD/docker-data/proof:/data" <brand>-server:local
curl -sS http://127.0.0.1:18791/api/v1/os/boot-status | head -c 200
```

- Binaires fat (Meili/cloudflared) hors git : téléchargés au build de l'image
  / au premier run desktop (`ensure-kit-binaries`) ; pack Win :
  `electron:stage-win-bins`.
- Les gestes riches `server-docker:*` (registre, admin, enroll) exigent le kit.
- Si une dep `@creezio/*` manque au clone : l'ajouter au `package.json`
  marque + `npm install` (lockfile commité). Gates :
  `test-phase-clone-autonomy` (kit) / `test:clone-autonomy` (marque).
- Le push GitHub factory prépare les locks npm avant push
  (`maybePushBrandRepos` → `prepareBrandDistribution`).

## Ressources

- Doc serveur Docker : `docker/server/README.md` (+ `REMOTE-ACCESS.md` ; historique parité : `docs/archive/PARITE-TF2.md`)
- Admin : `docker/server-admin/README.md` · Tunnel : `docs/RUNBOOK-AGENTS.md` §7.3
- Miroir doc : `docs/RUNBOOK-FLOTTE.md`
