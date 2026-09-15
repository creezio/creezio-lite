# RUNBOOK AGENTS — opérer l'écosystème Creezio

> **Document de référence opérationnel.** Un agent ou un dev qui débarque lit
> CE fichier et sait opérer tout l'écosystème sans rien redécouvrir.
> Faits vérifiés dans le code et sur les serveurs (2026-08-16). Ton assertif,
> zéro aspiration : si un fait change, corriger ce fichier dans la même PR.

## 1. Topologie

### Serveurs

| Serveur | SSH (depuis le PC Windows) | User | Rôle |
|---|---|---|---|
| **fluxpro-vps** | `ssh fluxpro-vps` | `fidus` | marque **winhub** (+ admin), kit, 3 runners |
| **tempoflow-vps** | `ssh tempoflow-vps` | `deploy` | ce VPS Foove : kit, **foove2** (+ admin), **tempoflow3** (+ admin), runner, registry — **pas** les restos Lyon/Marseille |
| **restos-tf** | VPS `104.168.10.36` | — | restos Tempoflow **Lyon / Marseille** — **pas** ce VPS Foove |

### Chemins

| Chemin | Contenu |
|---|---|
| fluxpro : `/home/fidus/creezio` | clone du kit (branche `main`) |
| fluxpro : `/home/fidus/winhub` | monorepo marque winhub (`server/`, `client/`, `brand-spec/`, `docker-data/` gitignoré) |
| fluxpro : `/home/fidus/winhub-admin` | repo admin winhub (`server-admin.json`, `fleet-hosts.json`) |
| fluxpro : `/home/fidus/actions-runners/{creezio,winhub,winhub-admin}` | runners self-hosted (services systemd user `actions-runner-*.service`) |
| tempoflow : `/opt/docker/creezio` | clone du kit (branche `main`) |
| tempoflow : `/opt/docker/tempoflow3` | monorepo marque tempoflow3 |
| tempoflow : `/opt/docker/tempoflow3-admin` | repo admin `creezio/tempoflow3-admin` (pas `tempoflow-admin`) |
| tempoflow : `/opt/docker/foove2` | monorepo marque **foove2** (`server/`, `client/`, `brand-spec/`, `docker-data/` gitignoré) |
| tempoflow : `/opt/docker/foove2-admin` | repo admin foove2 (`creezio/foove2-admin`) |
| tempoflow : `/home/deploy/actions-runners/tempoflow3` | runner self-hosted (`actions-runner-tempoflow3.service`) |
| tempoflow : `127.0.0.1:5000` | registry d'images local (container `creezio-registry`) |

Tunnel Cloudflare : contrat depuis **0.10.3** (pin actuel **0.10.8**) — `CREEZIO_CF_*` + `CREEZIO_OWNER_*`,
auto-provision au boot, `update` préserve tunnel / hostname. Le provisioner
VPS + sidecar est **legacy** (le sidecar `foove-admin-tunnel` **existe
encore** sur ce VPS). Le contrat `CREEZIO_CF_API_TOKEN` /
`CREEZIO_CF_ACCOUNT_ID` / `CREEZIO_CF_ZONE_ID` (+/ `_ZONE_NAME`,
`_UNIVERSAL_SSL`) arrive au conteneur via `cf.env` (chmod 600, généré par
`server-docker create` — §7.3).

### Instances prod et domaines

| Instance | Serveur | Container | Port hôte (loopback) | URL |
|---|---|---|---|---|
| winhub `server-1` | fluxpro | `winhub-server-server-1` | auto→18791 | https://server-1.winhub.fr |
| tempoflow3 `resto-lyon` | **104.168.10.36** (pas ce VPS) | `tempoflow3-server-resto-lyon` | — | https://resto-lyon.tempoflow.fr |
| tempoflow3 `resto-marseille` | **104.168.10.36** (pas ce VPS) | `tempoflow3-server-resto-marseille` | — | https://resto-marseille.tempoflow.fr |
| foove2 `demo` | tempoflow | `foove2-server-demo` | 18901→18791 | https://foove2-demo.crm.foove.io |
| foove2 `recette` | tempoflow | `foove2-server-recette` | auto→18791 | https://recette.crm.foove.io |
| admin winhub | fluxpro | `winhubadmin-server-main` | 18801→18791 | console admin flotte (repo `winhub-admin`) |
| admin tempoflow3 | tempoflow | `tempoflowadmin-server-main` | 18801→18791 | https://admin.tempoflow.fr |
| admin foove2 | tempoflow | `foove2admin-server-main` | auto→18791 | https://foove2admin.crm.foove.io |

Registre d'instances : `{brand-root}/docker-data/servers.json` (gitignoré —
absent du checkout runner, présent sur le clone serveur).

> **État tunnel (constat 2026-08-16, toujours vrai en 0.10.8)** : le
> contrat officiel est in-process (`CREEZIO_CF_*` + `CREEZIO_OWNER_*`).
> **Ce n'est pas** « toutes les instances en app seule, plus de sidecar » :
> le sidecar `foove-admin-tunnel` tourne encore sur ce VPS. Un `update`
> **préserve** tunnel / hostname (sidecar historique inclus). Bascule
> sidecar → in-process = `migrate-stack` (volontaire). Provisioner VPS +
> `POST /reserve` = **legacy**, plus la voie officielle.

### Repos GitHub (org `creezio`, tous privés)

`creezio` (kit — source of truth plateforme) · `winhub` · `winhub-admin` ·
`tempoflow3` · `tempoflow3-admin` · `foove2` · `foove2-admin`.

## 2. Environnement provisionné (ne PAS re-chercher)

| Fait | Règle |
|---|---|
| `CREEZIO_NPM_TOKEN` | Exporté dans `~/.bashrc` des deux VPS (`fidus` et `deploy`), actif en shell non-interactif. Toujours `$CREEZIO_NPM_TOKEN` — **jamais en clair** (commande, log, fichier, commit). |
| Identité git | `Creezio <creezio@users.noreply.github.com>` configurée sur les deux VPS. Ne jamais toucher `git config` : committer avec `git -c user.name=Creezio -c user.email=creezio@users.noreply.github.com commit …`. |
| `gh` | Authentifié (compte `creezio`) sur les deux VPS. |
| Registre npm | GitHub Packages **privé** (décision assumée 2026-08-10) : toute installation (`npm ci` / `npm install`, kit ou app) exige un PAT `read:packages` d'un membre de l'org. Le `.npmrc` des repos est commité **sans** token et consomme `${CREEZIO_NPM_TOKEN}`. En CI apps : secret repo `CREEZIO_NPM_TOKEN` ; en CI kit : `GITHUB_TOKEN` (packages:read). |

### Versions — factory 0.6.6 ≠ lockstep 0.10.8

Les packages **publiés** (`@creezio/platform-core`, `app-runtime`,
`brand-spec`…) sont en **lockstep 0.10.8** (groupe `fixed` de changesets —
une version de kit = un ensemble cohérent). `@creezio/factory` (CLI
`creezio`, **privé**, hors groupe `fixed`) est en **0.6.6**.
`@creezio/propagation` est hors lockstep (0.1.6).

**CLI = `CREEZIO_KIT_ROOT`, pas le pin app.** Le pin `^0.10.8` est la
version **consommée** au runtime / dans l'image Docker.
`scripts/creezio-cli.mjs` résout
`$CREEZIO_KIT_ROOT/packages/factory/bin/creezio.js` **avant**
`node_modules/@creezio/factory`. Pour `server-docker` / `brand doctor` /
`brand apply` : toujours le clone kit du VPS
(`CREEZIO_KIT_ROOT=/opt/docker/creezio` ici, `/home/fidus/creezio` sur
fluxpro) — jamais « la factory pinnée dans l'app ».

### Contrat modules 0.10.8 (ops → MCP)

Lockstep publié **0.10.8**. `operations[]` = SoT → tools MCP générés via
`api.listOperations()`. `mcpTools` n'existe plus (`BrandModuleDef` n'a plus
ce champ). Un `mcpTools()` restant = doctor error `MODULE_MCP_TOOLS_DEPRECATED`
(fail-closed). Collision de nom = `MODULE_OP_MCP_OVERLAP`.

## 3. Release kit → apps (le flow exact)

1. **Changeset** — toute PR touchant `packages/` embarque un changeset
   (`npx changeset`, commit `.changeset/*.md`). Gate PR `changeset-status`
   (`node scripts/changeset-status-check.mjs`) : rouge sinon — sans
   changeset, la version ne bumpe pas et les apps ne verront JAMAIS le
   contenu. Sur `changeset-release/*` le check est « aucun changeset
   orphelin » (les files ont été consommés par `changeset version`).
2. **Merge sur `main`** → `publish.yml` ouvre/actualise la PR automatique
   « chore(release): version packages » (bump lockstep + CHANGELOG **+ regen
   `package-lock.json`** via `version:packages` = `changeset version && npm
   install --package-lock-only …` — sans ça les entrées workspace du lock
   restent à l'ancienne version et `npm ci` casse).
3. **Merge de la release PR** → `publish.yml` publie tous les `@creezio/*`
   en **lockstep fixed** (groupe `fixed` de changesets : une version de kit =
   un ensemble cohérent) sur GitHub Packages.
4. **Bump d'une app — RÈGLE D'OR : les DEUX manifests ensemble.**

```bash
npm install '@creezio/<pkg>@^X.Y.Z' --save           # racine / workspace server
npm install '@creezio/<pkg>@^X.Y.Z' --save --prefix server/ui
```

   Le hook prebuild `os-ui:materialize` lit les routes OS depuis le
   `node_modules` hoisted de la racine (workspace `server`), **pas** celui de
   `server/ui`. Un bump partiel laisse les pages OS matérialisées sur
   l'ancienne version et crée un `node_modules` nested (dual-package) — CI
   verte, deploy vert, mais ancienne page servie (incident login 0.6.0,
   2026-08-10). Détail : [PROPAGATION.md](./PROPAGATION.md), § « Règle d'or
   du bump côté apps ».
5. **CI app verte → deploy auto** : le `deploy.yml` de l'app écoute
   `workflow_run` (CI `success` sur `main`) et déploie **depuis le clone
   local du brand root** sur le runner self-hosted de l'app (jamais depuis le
   checkout `_work` — le registre `docker-data/` est gitignoré).

## 4. Runners CI self-hosted

- Layout : `~/actions-runners/<app>/_work/<repo>/<repo>/` — le `_work`
  **PERSISTE entre les runs**.
- Conséquence : la CI ne doit **jamais dépendre d'un fichier pré-existant**
  (node_modules, dist, .env laissés par le run précédent). Chaque job repart
  du checkout + `npm ci`.
- Résolution des scripts de packages consommés : via la **résolution de
  package npm** (`import.meta.resolve` / `createRequire`), jamais par sondage
  de chemins `node_modules/<pkg>/...` (le hoisting workspaces casse les
  chemins relatifs — vécu e2e, fix 200476c).
- **Hygiène — avant toute purge** (`_work`, `node_modules`, caches) :

```bash
ps aux | grep Runner.Worker | grep -v grep   # doit répondre 0 ligne
```

  Incident 2026-08-10 : restes de l'ère vendoring purgés sur les runners —
  toute purge se fait runner idle, sinon on supprime le workdir d'un job en
  cours.
- Pilotage : `systemctl --user status actions-runner-<app>.service`.

## 5. Gates CI — philosophie et mode d'emploi

**Philosophie** : une gate protège un contrat ; on ne l'affaiblit **jamais**
pour faire passer un commit — on corrige la cause. SoT des gates kit = la
ligne `test` du `package.json` racine : un fichier `scripts/test-*.mjs` non
listé n'est jamais exécuté (piège réel : `os-ui-scaffold` a existé non
branchée). Suites : `npm run test:kit` (pures kit, 100 % vertes partout),
`test:brands` (repos marque requis, skip auto sinon), `test:env` (lourdes,
opt-in).

| Gate | Où | Protège | Satisfaire | Relancer seule |
|---|---|---|---|---|
| `changeset-status` | PR kit | tout changement `packages/` a son changeset ; PR de version = plus aucun leftover | `npx changeset` + commit du `.changeset/*.md` | `node scripts/changeset-status-check.mjs` |
| deps-integrity | CI apps (`server/scripts/test-deps-integrity.mjs`) | packages `@creezio/*` installés : présents, **pas de symlink**, ranges `^` satisfaits, **même version partout**, `vendor/creezio` absent | `npm ci` racine ; aligner les versions des DEUX manifests | `npm run test:deps-integrity --prefix server` |
| docs-freshness | kit (`test-phase-docs-freshness`) | trio `README.md`/`AGENTS.md`/`docs/FILES.md` complet par zone (`packages/*`, `docker/*`, `apps/*`, `scripts`) et FILES.md exhaustif | après ajout/suppression de fichier : `node scripts/generate-files-md.mjs <cible>` — ou `--all` (vérif seule : `--all --check`) | `node --test scripts/test-phase-docs-freshness.mjs` |
| assert-runtime-dist | kit (`test-phase-runtime-dist-freshness`) + `server-docker publish\|build` | `dist/` (gitignoré) rebuildé après modif `packages/*/src` — sinon package/image **sans les routes** (vécu Admin Database). Compare le **hash sha256 des src** au manifest `dist/.creezio-src-hash.json` écrit au build (les mtimes ne sont pas fiables : src touchés à contenu propre bloquaient les deploys) | `npm run build:packages` avant toute release/publish | `node --test scripts/test-phase-runtime-dist-freshness.mjs` ; bypass urgence `CREEZIO_SKIP_RUNTIME_DIST_ASSERT=1` (déconseillé) |
| materialize anti-stale | apps — hooks `predev`/`prebuild` de `server/ui` | pages OS régénérées depuis `@creezio/os-ui` hoisted racine ; possession **exacte** par route (une page métier prime le wrapper kit, sans masquer les enfants kit) | bumper les deux manifests (§3) ; vérifier sans écrire : `npm run os-ui:check --prefix server` | `npm run os-ui:materialize --prefix server` |
| arch-codemod | kit (`test-phase-arch-codemod`) | un bump `ARCHITECTURE_VERSION` livre ses codemods de migration dans le MÊME commit | écrire le codemod (`scripts/codemods/`) avec le bump | `node --test scripts/test-phase-arch-codemod.mjs` |

**Templates d'apps** générés par la factory : `packages/factory/src/generators/`
— `brand-workflows.ts` (workflows CI + deploy des apps), `os-ui.ts`
(materialize des pages OS), `native-runtime.ts`, et `scaffold.ts` /
`scaffold-from-prd.ts` à la racine de `packages/factory/src/`. Un défaut qui
touche toute marque générée se corrige LÀ (+ publish npm), jamais en
workaround dans une seule app.

## 6. Deploy et instances

CLI SoT : `packages/factory/src/server-docker-cli.ts` (**factory 0.6.6**,
hors lockstep 0.10.8). Depuis une app :
`node scripts/creezio-cli.mjs server-docker …` (`--brand-root` = racine du
monorepo marque ; **`CREEZIO_KIT_ROOT` = clone kit**, jamais le pin
`@creezio/*` de l'app).

| Geste | Commande |
|---|---|
| Créer une instance (stack M2 par défaut) | `creezio server-docker create <nom> --brand-root . [--profile prod] [--browser] [--host-port N]` (`--no-stack` = legacy `docker run`) |
| Lister / logs / cycle de vie | `ls --brand-root .` · `logs <nom> [--tail 500] [--follow]` · `start\|stop <nom>` · `rm <nom> [--purge-data]` |
| Update (recreate, même volume `/data`) | `update <nom> --image <ref> [--backup]` — **défaut = PAS de nouveau tar.gz** ; `--backup` = snapshot frais avant recreate (prod critique) |
| Backup one-shot | `backup <nom>` → `docker-data/backups/` — tar **en conteneur éphémère** (image de l'instance, socket docker seul privilège — lit les fichiers root-owned du volume, archive `chown`ée à l'appelant, vérifiée `gzip -t`) |
| Legacy → stack M2 | `migrate-stack <nom>` — backup `/data` obligatoire, ingress tunnel repointé `http://app:18791`, healthcheck URL publique, **rollback legacy automatique si KO** |
| Publier une image versionnée | `publish --tag <v> [--registry 127.0.0.1:5000] [--release]` (la garde assert-runtime-dist s'applique au build) |
| Admin flotte | `admin up --admin-root <repo-admin>` · `admin add-brand <brandRoot>` |

### One-line install — serveur vierge → app qui tourne

**Prérequis hôte (une fois)** : `docker` + `docker compose` (BuildKit), `git`,
les 2 clones (`creezio` kit + repo marque), `CREEZIO_NPM_TOKEN` dans l'env.
**Jamais** node/npm/builds sur l'hôte : `tsc`, `os-ui:materialize`,
`next build`, `npm ci` tournent **tous dans le `docker build`** (stage
`brand-build`, §7.1) — l'hôte ne fournit que les sources git.

```bash
cd <repo-marque> && node scripts/creezio-cli.mjs server-docker create <nom> --brand-root . --profile prod
```

`create` build l'image si absente (in-image, identique sur tout serveur),
provisionne le tunnel, écrit le stack M2, attend le boot. Update ensuite :
`server-docker build` puis `update <nom> --image creezio-server-<brand>:local
--backup`. Une app qui dévie de ce chemin = un bug du standard → corriger le
kit/factory (PR), jamais contourner sur une seule app.

**Modèle cible ports/tunnel (depuis 0.10.3, pin 0.10.8)** : 1 instance = 1 stack compose
autonome (`docker-data/stacks/<nom>/compose.yml`, généré — ne pas éditer) :
**app seule** (port interne fixe `18791`, healthcheck
`/api/v1/core/health`). **cloudflared tourne IN-PROCESS** dans le conteneur
de l'app (binaire `/opt/creezio/bin/cloudflared` pinné dans l'image) — le
sidecar est **legacy** (ex. `foove-admin-tunnel` encore vivant). Le tunnel
est **auto-provisionné au boot** via l'API Cloudflare
: GET tunnel du store `/data` → 404/token absent → recréation (idempotent,
le CNAME suit le nouvel id), PUT ingress (`http://127.0.0.1:18791` +
services), upsert DNS, sonde publique en arrière-plan (non fatale). Le
contrat CF arrive par **`cf.env` chmod 600** (écrit par `create`, jamais
dans `environment:` du compose) ; les secrets applicatifs partent dans
**`secrets.env` chmod 600** (règle d'audit généralisée). `CREEZIO_OWNER_*`
(et `CREEZIO_E2E_*` optionnels) sont **persistés** dans ce `secrets.env`
par `create` / `ensure-owner` — jamais dans le registre ni
`environment:`. Un `update` **ne droppe plus** ces clés. Port hôte
**loopback auto** (`127.0.0.1::18791`) pour debug/healthcheck seulement —
**zéro port public**, l'accès utilisateur passe par Cloudflare.

### Smoke login (agent) — sans logger le mot de passe

Un agent doit pouvoir ouvrir une session. `AUTH_DISABLED=1` = harness
**local uniquement** (gates métier) — **interdit en prod / VPS**.

```bash
# 1. Lire l'e-mail seulement (jamais echo du password) :
STACK=docker-data/stacks/<nom>
EMAIL=$(sudo awk -F= '$1=="CREEZIO_E2E_EMAIL"{print $2}' "$STACK/secrets.env")
# fallback owner si pas d'e2e :
# EMAIL=$(sudo awk -F= '$1=="CREEZIO_OWNER_EMAIL"{print $2}' "$STACK/secrets.env")
echo "login : $EMAIL"

# 2. Seed / rattrapage si secrets absents (génère e2e, persist 600, recreate app) :
creezio server-docker ensure-owner <nom> --brand-root "$BRAND_ROOT"
# log : « login : owner@<nom>.<marque>.local » — jamais le mot de passe

# 3. Login HTTP (password lu du fichier, pas imprimé) :
PORT=$(creezio server-docker ls --brand-root "$BRAND_ROOT" | awk -v n=<nom> '$1==n{print $3}' | tr -d '*')
# ou curl public https://<hostname>/api/v1/auth/login
```

Navigateur : `/login` → dashboard → parcours métier. Ne pas coller le
mot de passe dans le chat, un gist, ou un rapport.

**Healthchecks de déploiement** (pattern winhub `deploy.yml`) : après update,
`GET /health`, `/login`, `/inscription` sur l'URL publique → 200 exigé.
Diagnostics boot : `GET /api/v1/os/boot-status` (répond dès le lancement),
`/health`, `/version` ; transitions JSONL dans `docker logs <container>` ;
journal ops `/data/ops/*.jsonl`.

## 7. Mécaniques internes — image, create, tunnel, sandbox

> Ce que `server-docker` et l'auto-provisioning tunnel font sous le
> capot. Lu une fois ici = jamais redécouvert en pleine mission. SoT code :
> `docker/server/Dockerfile`, `packages/factory/src/server-docker-cli.ts`,
> `packages/fleet/src/instance-stack.ts`,
> `packages/platform-core/src/tunnel-cf{,-client}.ts` (client API CF +
> fonctions pures, zéro dépendance).

### 7.1 Build d'image app (`docker/server/Dockerfile`)

Multi-stage BuildKit, **contexte = racine marque**, Dockerfile = **kit**
(`$CREEZIO_KIT_ROOT/docker/server/Dockerfile` — le CLI/CI utilisent toujours
celui-là ; winhub conserve un `docker/server.Dockerfile` local d'ère
pré-standard, script `docker:build`, utile en sandbox §7.4).

| Stage | Rôle |
|---|---|
| `deps` | Copie **uniquement les manifests** : `package.json`, `package-lock.json`, `.npmrc` (racine) + `${SERVER_DIR}/package.json`, puis `npm ci --omit=dev -w server` (**strict** — pas de fallback) + `npm rebuild better-sqlite3`. Token via **secret BuildKit** (`--secret id=CREEZIO_NPM_TOKEN,env=CREEZIO_NPM_TOKEN`), jamais en ARG/ENV : invisible dans `docker history`. |
| `meili` / `cloudflared` | Binaires téléchargés (versions alignées `ensure-kit-binaries.ts`) → `/opt/creezio/bin/`. |
| `brand-build` | **Build 100% in-image** : `npm ci` complet du workspace serveur (dev inclus — `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, tsc seul compte), `COPY . .` des sources filtrées (v5), `npm ci` ui + `build:runtime` (tsc → `build/electron`) + `build:ui` (materialize os-ui → `next build` → `ui/.next/standalone`). Stage jetable : rien n'en part sauf les artefacts copiés par `runtime-base`. |
| `runtime-base` | `COPY . .` (sources filtrées par `brand.dockerignore` v5, copié en `.dockerignore` marque par le CLI) + `COPY --from=deps /app/node_modules` + `COPY --from=brand-build` de `build/` et `ui/.next/{standalone,static}` + `ui/public`. Version embarquée : `--build-arg SERVER_VERSION` (publish) → `GET /api/v1/core/version`. |
| `runtime-browser` | Variant `--browser` : + chromium/xvfb/fonts (`shm_size: 1g` appliqué au create). |

**Tout est buildé DANS l'image** (stage `brand-build`, depuis 2026-08-12) :
`build:runtime` (tsc → `server/build/electron`) et `build:ui` (materialize +
`next build` → `server/ui/.next/standalone`) tournent dans le `docker build`.
node/npm de l'hôte ne produisent **aucun** artefact consommé par l'image —
le dockerignore v5 exclut `**/node_modules`, `**/.next` et `build/` du
contexte, donc même un résidu de build hôte (ex. `.next/standalone` d'un
ancien flow) ne peut pas fuiter dans l'image. `server/ui` reste un projet
npm indépendant : ses deps ne vont pas dans l'image finale (le standalone
Next est self-contained — tracé). Seules la garde assert-runtime-dist (§5)
et l'hygiène des lockfiles (`ensureBrandStandalone`) touchent encore l'hôte
— donc `npm ci` + `npm run build:packages` à jour côté kit.

**PIÈGE MAJEUR — le stage `deps` ne copie QUE les manifests** : toute source
supplémentaire exigée par `npm ci` (ex. **tarballs locaux** en `file:`,
§7.4) doit être **copiée explicitement dans le stage deps** (avant le
`RUN npm ci`), sinon le build échoue sur un tarball absent alors que tout
est en place côté hôte. Même vigilance côté `brand-build` : ses `npm ci`
(racine full + ui) précèdent le `COPY . .` — une dep `file:` ui pointant
hors manifests exige un COPY dédié dans le Dockerfile de sandbox.

### 7.2 `server-docker create <nom>` — séquence exacte

1. Valide le nom (`[a-z0-9][a-z0-9-]*`) ; refuse si déjà au registre ou si
   le container `<brandId>-server-<nom>` existe.
2. **Image** : `creezio-server-<brandId>:local` (override env
   `SERVER_IMAGE` ; variant browser : suffixe `-browser`) — **buildée si
   absente** (séquence §7.1, `CREEZIO_NPM_TOKEN` requis, fail-fast sinon).
3. Entrées : `--host-port N` (loopback fixe — sinon **auto**), `--port N`
   (legacy), `--profile prod` (warm natif + catalogue + **forward d'une
   liste fixe d'env** tunnel/fleet/mails/LLM lues depuis l'env process PUIS
   le `.env` racine marque — rien n'est inventé), `--env K=V`, `--browser`,
   `--no-stack` (legacy `docker run`).
4. Crée `docker-data/servers/<nom>/` (futur `/data`).
5. **Stack (défaut)** : si `CREEZIO_CF_API_TOKEN` +
   `CREEZIO_CF_ACCOUNT_ID` + `CREEZIO_CF_ZONE_ID` sont posés (env process
   PUIS `.env` racine marque) → le token est **vérifié** (`GET
   /accounts/{id}/tokens/verify`, fallback `/user/tokens/verify`) puis le
   contrat CF complet (`CREEZIO_CF_*` + `CREEZIO_TUNNEL_SLUG` +
   `CREEZIO_DOMAIN` éventuels) est écrit dans
   `docker-data/stacks/<nom>/cf.env` **chmod 600** — **aucune** création de
   tunnel à ce stade : l'instance s'auto-provisionne au boot (§7.3). Puis
   écriture du `compose.yml` (**généré**, régénéré à chaque update — ne
   jamais éditer ; `env_file: cf.env` + `secrets.env` éventuel, jamais de
   secret dans `environment:`), `docker compose up -d`, port hôte réel relu
   via `docker inspect` et enregistré. Sans contrat CF : stack local sans
   tunnel (loopback seul).
6. Attend le boot (`GET /api/v1/os/boot-status` jusqu'à ready) puis affiche
   l'URL loopback.

Datas (tout gitignoré) : registre `docker-data/servers.json` · volume
`/data` = `docker-data/servers/<nom>` · stack `docker-data/stacks/<nom>/` ·
backups `docker-data/backups/<nom>-<stamp>.tar.gz`.

### 7.3 Tunnel Cloudflare auto-provisionné (0.10.0)

**Voie officielle (0.10.8), admins comprises** : le conteneur
crée/configure son tunnel lui-même via l'API Cloudflare au boot
(cloudflared in-process). Le provisioner VPS + sidecar est **legacy**
(le sidecar `foove-admin-tunnel` existe encore). Un tunnel CF par
instance, piloté par env.

**Contrat d'environnement** (livré via `cf.env` chmod 600, écrit par
`server-docker create` — jamais en clair dans `compose.yml`) :

| Variable | Rôle |
|---|---|
| `CREEZIO_CF_API_TOKEN` | **requis** — token CF scopé compte+zone (Zero Trust → Tunnels : edit ; DNS de la zone : edit) |
| `CREEZIO_CF_ACCOUNT_ID` | **requis** |
| `CREEZIO_CF_ZONE_ID` | **requis** |
| `CREEZIO_CF_ZONE_NAME` | optionnel — dérivé via `GET /zones/{zone_id}` |
| `CREEZIO_CF_UNIVERSAL_SSL` | optionnel — truthy → hostnames **nested** (`n8n.{slug}.{zone}`) ; défaut **flat** (`n8n-{slug}.{zone}`) |
| `CREEZIO_TUNNEL_SLUG` | optionnel — défaut nom d'instance/brandId |
| `CREEZIO_DOMAIN` | optionnel — hostname complet custom (défaut `{slug}.{zoneName}`) |
| `CREEZIO_TUNNEL_EXTRA_HOSTNAMES` | optionnel — multi-domaines D1 (virgules) : hostnames supplémentaires servis par le MÊME tunnel (ex. `console.winhub.fr` + `app.winhub.fr` sur le tunnel de l'admin) |

**Séquence de boot** (kernel, phase tunnel — `harness-server-phases.ts`) :
lecture du store `/data/<brand>-config.json` (`tunnelMeta` + `tunnelToken`,
format `{plain}` géré) → `GET cfd_tunnel/{id}` → 404 ou token absent →
**recréation** via API et persistance (un `/data` wipé aboutit à un tunnel
recréé proprement, CNAME mis à jour) → `PUT configurations` (ingress
`http://127.0.0.1:18791` + services selon le mode de hostnames + extras D1,
jamais de règle `agent`) → **upsert DNS idempotent** (CNAME
`{hostname}` → `{tunnelId}.cfargotunnel.com`, proxied — jamais d'échec si
déjà à la bonne cible) → spawn cloudflared in-process **supervisé**
(respawn borné + backoff si exit ≠ 0 ou mort inattendue ; même tunnel id
persisté, pas de recréation API) → sonde publique
`https://<domaine>/api/v1/core/health` en arrière-plan (retry borné, non
fatale).

**Mode flat (défaut)** : hostnames **plats** `n8n-{slug}.{zone}` /
`hermes-{slug}.{zone}` (CNAMEs plats, pas de `*.{slug}`) — Universal SSL
ne couvre qu'**un** niveau de wildcard. L'hostname agent
(`agent-{slug}.{zone}` / `agent.{slug}.{zone}`) appartient au tunnel
dédié host-agent, pas à l'instance. Poser
`CREEZIO_CF_UNIVERSAL_SSL=1` (certificat Advanced/Total) → mode **nested**
`n8n.{slug}.{zone}` + wildcard `*.{slug}.{zone}`. Détail :
[adr/ADR-tunnel-flat-hosts.md](./adr/ADR-tunnel-flat-hosts.md).

**Slugs réservés** (`RESERVED_SLUGS` dans
`packages/platform-core/src/tunnel-cf.ts`) : `demo`, `test`, `dev`,
`staging`, `sandbox`, `admin`, `app`, `api`… refusés tels quels.
`server-docker create` **ne skip pas le tunnel** : il dérive
`CREEZIO_TUNNEL_SLUG=<brand>-<slug>` (ex. `foove2-demo`), log + écriture
dans `cf.env`. Un hostname client libre reste `{slug}.{zone}`
(`acme.crm.foove.io`). Create VPS exige aussi `CREEZIO_CF_API_TOKEN` /
`_ACCOUNT_ID` / `_ZONE_ID` **et** `CREEZIO_OWNER_EMAIL` /
`CREEZIO_OWNER_PASSWORD` (first-run owner, même contrat cloud). Dev local :
`CREEZIO_TUNNEL_LOCAL=1` (owner optionnel).

**Cycle de vie** : `server-docker create` écrit `cf.env` (aucun appel CF
créateur — tout se fait au boot) ; `server-docker rm <nom>` **déprovisionne
via l'API CF directe** (DNS nested+flat+mail+extras de l'instance + tunnel
instance — **jamais** `agent.*` / `agent-*`) avant de retirer le stack ;
`server-docker enroll` / `agent up` provisionnent le tunnel **dédié**
agent et persistent l'URL publique canonique dans `host-agent.json` et
`fleet-hosts.json` (`agentUrl`) — si `fleet-hosts.json` est root:root 600,
écriture via `sudo -n` sinon POST admin (container), jamais chmod manuel ;
`server-docker agent rm` est le seul
geste qui retire DNS agent + tunnel dédié.

**Update et tunnels publics (0.10.8 — non négociable)** : `server-docker
update` (et tout recreate compose : agent flotte, apply image) **ne peut
plus** retirer un service `cloudflared*` ni changer le hostname. Un stack
historique (sidecar + `tunnel.env`, ex. `foove-admin-tunnel` sur ce VPS ;
restos Lyon/Marseille = VPS `104.168.10.36`) : l'update
**patch uniquement l'image app** — même token, même id, même adresse
publique ; `up` **sans** `--remove-orphans`. Si une adresse publique est
persistée (`tunnel.env` / kernel) **sans** sidecar et **sans** `cf.env`
in-process : l'update **refuse** (rien n'est publié). Dev local
`CREEZIO_TUNNEL_LOCAL=1` : inchangé. Seul `migrate-stack` retire un
sidecar, et **réutilise** le tunnel / hostname existants — jamais un 2e
hostname à l'update.

### 7.4 Build local sans GitHub (packages kit modifiés, zéro push/publish)

Prouvé sur `/home/fidus/sandboxes/` — image Docker d'une app embarquant des
`@creezio/*` modifiés localement :

```bash
# 1. Worktree kit (jamais le clone serveur) + dist à jour (garde §5 satisfaite)
git -C /home/fidus/creezio worktree add /home/fidus/sandboxes/kit-<xp> -b demo/<xp>
cd /home/fidus/sandboxes/kit-<xp> && npm ci && npm run build:packages
# 2. Tarballs des packages modifiés
npm pack -w @creezio/<pkg> --pack-destination packs   # → packs/creezio-<pkg>-<v>.tgz
# 3. Worktree app + tarballs DANS le contexte de build
git -C /home/fidus/winhub worktree add /home/fidus/sandboxes/winhub-<xp> -b demo/<xp>
mkdir -p /home/fidus/sandboxes/winhub-<xp>/server/vendor-demo
cp packs/*.tgz /home/fidus/sandboxes/winhub-<xp>/server/vendor-demo/
```

4. Références `file:` — `server/package.json` : `"@creezio/<pkg>":
   "file:vendor-demo/creezio-<pkg>-<v>.tgz"` ; `server/ui/package.json` :
   `"file:../vendor-demo/…"` si l'UI consomme le package. Un `@creezio/*`
   **transitif** à forcer : `overrides` dans le `package.json` racine. Les
   packages non patchés restent en `^` publiés → **`CREEZIO_NPM_TOKEN`
   reste requis** au build.
5. **Régénérer les DEUX lockfiles** (`npm ci` strict) : `rm
   package-lock.json && npm install` à la racine — et dans `server/ui/` si
   son manifest a changé.
6. **PIÈGE §7.1** : copier les tarballs dans le stage `deps` du Dockerfile
   utilisé — kit worktree (`docker/server/Dockerfile`, build CLI avec
   `CREEZIO_KIT_ROOT=/home/fidus/sandboxes/kit-<xp>`) ou Dockerfile local
   marque (winhub : `docker/server.Dockerfile`) :

```dockerfile
COPY ${SERVER_DIR}/vendor-demo ./${SERVER_DIR}/vendor-demo   # avant RUN npm ci
```

7. Build avec tag local :
   `SERVER_IMAGE=creezio-server-<brandId>:test-<xp> node scripts/creezio-cli.mjs server-docker build --brand-root .`
   (`create` réutilise l'image si présente — sinon il rebuild via le
   Dockerfile de `CREEZIO_KIT_ROOT`).

**Rien de tout ça ne quitte le worktree** : manifests `file:`, lockfiles
régénérés, COPY Dockerfile = edits sandbox à marquer « ne pas pousser ».
`.dockerignore` v4 n'exclut pas `vendor-demo/` (mais exclut `**/src`,
`**/data`, `**/dumps`… — ne pas nommer le dossier ainsi).

### 7.5 Instance de test isolée (données réalistes → destruction propre)

```bash
# Worktree sandbox — JAMAIS le clone deploy (son docker-data/ = registre prod).
git -C /home/fidus/winhub worktree add /home/fidus/sandboxes/winhub-<xp> -b demo/<xp>
cd /home/fidus/sandboxes/winhub-<xp> && npm ci && npm install --prefix server/ui
SERVER_IMAGE=creezio-server-winhub:test-<xp> npm run server-docker:build   # §7.4 si kit patché
# Le .env est gitignoré → ABSENT du worktree : sourcer celui du clone deploy.
set -a && . /home/fidus/winhub/.env && set +a
node scripts/creezio-cli.mjs server-docker create test-<xp> --brand-root . --profile prod
#   (slug tunnel = nom d'instance → non réservé, §7.3 ; port hôte loopback auto)
# Données réalistes : backup prod → volume du test (archive = dossier <nom>/).
node scripts/creezio-cli.mjs server-docker stop test-<xp> --brand-root .
rm -rf docker-data/servers/test-<xp> && mkdir -p docker-data/servers/test-<xp>
tar -xzf /home/fidus/winhub/docker-data/backups/server-1-<stamp>.tar.gz \
  -C docker-data/servers/test-<xp> --strip-components=1
node scripts/creezio-cli.mjs server-docker start test-<xp> --brand-root .
# Vérifs : curl http://127.0.0.1:<port>/api/v1/core/health ; https://test-<xp>.winhub.fr/login → 200
# Destruction PROPRE — un seul geste : `rm` déprovisionne le tunnel via
# l'API CF directe (DNS + tunnel) avant de retirer le stack (0.10.0).
node scripts/creezio-cli.mjs server-docker rm test-<xp> --brand-root . --purge-data
```

Isolation : registre `docker-data/servers.json` propre au worktree,
container `<brandId>-server-test-<xp>` nommé par instance (cloudflared
in-process — plus de conteneur sidecar), port hôte loopback auto — zéro
collision avec la prod. Ne
restaurer qu'un backup de la **même marque** (les secrets d'instance —
`AUTH_SECRET`… — vivent dans `/data`).

### 7.6 Environnements éphémères / cloud agents (zone sandbox)

Un cloud agent (ou toute CI éphémère) qui doit exposer une instance de test
utilise le MÊME chemin standard (`server-docker create`) — l'auto-
provisioning CF rend l'opération sans-touch côté VPS. **5 secrets minimum**
à poser dans l'environnement de l'agent :

| Secret | Rôle |
|---|---|
| `CREEZIO_NPM_TOKEN` | pull `@creezio/*` (GitHub Packages) au build |
| `CREEZIO_CF_API_TOKEN` | auto-provisioning tunnel (account token scopé) |
| `CREEZIO_CF_ACCOUNT_ID` | compte Cloudflare |
| `CREEZIO_CF_ZONE_ID` | zone du hostname éphémère |
| `CREEZIO_TUNNEL_SLUG` | slug unique de l'environnement (ex. `ci-<run>`) |

**Recommandation (D4)** : dédier une **zone Cloudflare sandbox** (ex.
`creezio-sandbox.dev`) aux environnements éphémères — séparée de la zone
prod (`winhub.fr` / `tempoflow.fr`). Avantages : aucun risque de collision
ou de fuite DNS vers la prod, nettoyage de masse sans peur (`rm` reste
idempotent), token CF scopé à la seule zone sandbox (blast radius minimal
si le token de l'agent fuite). Le mode flat (défaut) suffit — Universal SSL
couvre `*.{zone}`.

### Instance de démo/test — le chemin standard (depuis main)

Une instance de démo ou de test est une instance **comme les autres** :
créée par le chemin standard depuis `main`, build 100 % in-image, rien de
spécial. L'ère des tarballs `npm pack` / deps `file:` est révolue — un
correctif destiné à la démo entre dans le kit par une PR (changeset →
release → bump app, §3), jamais par un contournement local. **Toute
déviation de ce chemin est un bug du standard** → corriger le kit/factory
(PR), ne pas bricoler l'instance.

```bash
# Clone marque du serveur, sur origin/main frais :
cd /home/fidus/winhub && git checkout --detach origin/main
CREEZIO_KIT_ROOT=/home/fidus/creezio \
  node scripts/creezio-cli.mjs server-docker create <nom> --brand-root . --profile prod
# `create` build l'image si absente (§7.1), provisionne le tunnel, écrit le
# stack M2, attend le boot. Slug non réservé (§7.3) — rappel : `demo` est
# réservé, l'instance démo s'appelle `demo-1` (hostname demo-1.winhub.fr).
```

Aligner une démo existante sur main (données conservées — même volume
`/data`, backup frais avant recreate) :

```bash
CREEZIO_KIT_ROOT=/home/fidus/creezio \
  node scripts/creezio-cli.mjs server-docker build --brand-root .
CREEZIO_KIT_ROOT=/home/fidus/creezio \
  node scripts/creezio-cli.mjs server-docker update <nom> --brand-root . \
    --image creezio-server-<brand>:local --backup
```

**Checklist « une démo prête doit avoir »** — tout est natif au kit courant
(0.9.x), rien à câbler à la main. Un point manquant = un bug du wiring de
l'app sur main : le remonter (PR kit/app), ne pas le contourner.

- [ ] version du kit courante **dans le conteneur** (`docker exec
      <container> node -p "require('/app/node_modules/@creezio/platform-core/package.json').version"`)
- [ ] `/login` → 200 + lien « Créer un compte » → `/inscription` (slot
      `login.secondaryLink`)
- [ ] palette Ctrl+K native (classe `.creezio-search-palette` dans le bundle
      servi)
- [ ] visite guidée : entrée d'action en sidebar (`launcher: "sidebar"`),
      **aucun bouton flottant**, rien sur `/login`
- [ ] panneau démo interactive compact (carte `creezio-demo-card` bornée au
      viewport)
- [ ] écran « Rôles & accès » fonctionnel (matrice groupes × permissions —
      winhub : 6 groupes, 19 permissions)
- [ ] sidebar owner complète (toutes les permissions `nav.*` — winhub : 17)
- [ ] données de démo seedées (comptes de rôle + contenu métier —
      `GET /api/v1/modules/demo-data/status`)
- [ ] enregistrement flotte : l'instance apparaît sur la console admin avec
      heartbeat actif
- [ ] `/health` → 200 (pas 503 `degraded`) après restart à froid
      (`server-docker stop <nom>` puis `start <nom>`)

Pour expérimenter du kit **non publié** (zéro push, sandbox jetable) :
§7.4 — ce n'est **pas** le chemin d'une démo.

## 8. Règles d'or agents (les 8 commandements)

1. **Aucun fichier sur le PC local** — tout vit sur les VPS.
2. **SSH base64 pour le non-trivial** — toute commande ssh avec quotes, pipes
   ou boucles est encodée : `echo <b64> | base64 -d | bash`.
3. **2 échecs = stop + rapport** — on ne brute-force jamais une commande ;
   on rapporte ce qui bloque.
4. **Backup avant recreate** — `update --backup` / `backup <nom>` ; aucune
   exception en prod.
5. **Jamais de token en clair** — `$CREEZIO_NPM_TOKEN` partout ; zéro secret
   dans les commandes, logs, fichiers, commits.
6. **Jamais de pkill à pattern large** — tuer par PID précis ; vérifier le
   cycle de vie (`docker ps`, `ps aux`) avant toute action destructive.
7. **Bumper les deux manifests** — `server/package.json` ET
   `server/ui/package.json` (§3).
8. **Branche + PR + CI verte avant merge** — jamais de push direct sur
   `main` ; branche courte depuis un `origin/main` frais.

## 9. Cookbook incidents (cause → fix)

| Incident | Cause → fix |
|---|---|
| Bundle winhub stale (vendor vieux de 24 h) | deps `file:` vendored : contenu changé sans version = invisible pour npm et le cache webpack (`managedPaths`) → `managedPaths=[]` côté winhub, puis **fin du vendoring** : distribution npm versionnée (#49). |
| Heartbeat 404 desktop / tempête CPU | `POST /api/v1/desktop/heartbeat` métier re-proxifié OS→plane en boucle infinie → marqueur `kernel-fallthrough` partagé (kit `cab5273`). Une route métier sous `/api/v1/{auth,users,tasks,assistant,desktop}` qui renvoie 404 = version `@creezio/*` sans le fix. |
| Zombies next-server / meilisearch | cycle de vie : shutdown incomplet (keep-alive HTTP + tunnel restés) → shutdown complet avant reset (kit `80c526a`) ; côté gates, helper `gate-tmp.mjs` (arrêt harness SIGTERM→SIGKILL 10 s avant `rm`). |
| Collision ports 18790/18791 | attribution legacy `18790+n` à port hôte fixe → M2 : port **interne** fixe 18791 + port hôte loopback auto (`127.0.0.1::18791`), collisions impossibles (§6). |
| Lockfile désync après bump | `changeset version` ne régénérait pas `package-lock.json` (workspaces à l'ancienne version, `npm ci` cassé) → `version:packages` chaîne `npm install --package-lock-only` (publish.yml). |
| Escalade peer deps (release en 1.0.0) | changesets majorait tout peer-dependent dès qu'un peer bumpait (même satisfait) → `onlyUpdatePeerDependentsWhenOutOfRange` (`84dc367`) + peers internes en `>=0.4.0` (`d674c86`). |
| Gate mtime bloquait les deploys | mtimes non fiables (src touchés à contenu git propre pendant le build) → assert par **hash de contenu** `dist/.creezio-src-hash.json` (`5f023df`). |
| E401 GitHub Packages en CI kit | gates scaffold/factory résolvant `@creezio/*` sur le registre sans token → `CREEZIO_NPM_TOKEN: ${{ secrets.GITHUB_TOKEN }}` (packages:read) dans les jobs (`bf2fb3f`). |
| Gate à version figée rouge post-release | `test-phase-f` lisait `0.1.0` figé ; changesets bumpe aussi les packages privés → lecture dynamique depuis `package.json` (`1695e9a`). |
| « backup indisponible (tar) » en update | GNU tar sur `/data` vivant sort exit 1 avec une archive complète et valide → exit 0/1 acceptés + `gzip -t` (skill fleet-ops). |
| Update qui rollback toute seule | réindex Meili (86k produits, ~5 min) awaitée au boot → healthcheck update (180 s) expiré → `backgroundIndex: true` ; `/search` sert `source:"indexing"` pendant l'indexation. |
| Wrapper sudo refusait les tags auto | validation semver stricte des tags → charset sûr, tags `auto.*` acceptés (`411931a`). |
| E2E cassé par le hoisting npm | scripts résolus par sondage de chemins `node_modules` → résolution package npm `import.meta.resolve` (kit `200476c`). |
| docs-freshness rouge sur main | fichier ajouté dans un package sans regen du FILES.md → `node scripts/generate-files-md.mjs <pkg>` (`746ca43`). |
| Login resté en 0.5.x après bump 0.6.0 | bump partiel (`server/ui` seul) → pages OS matérialisées sur l'ancienne version → double manifest obligatoire (`d657798`, §3). |
| Gate jamais exécutée | `scripts/test-*.mjs` non listé dans la ligne `test` du `package.json` racine = jamais run → l'y ajouter (vécu : `os-ui-scaffold`). |

## 10. Liens — le détail par domaine

| Doc | Contenu |
|---|---|
| [docs/PROPAGATION.md](./PROPAGATION.md) | contrat kit → marques, semver, règle d'or du bump, modèle PULL |
| [docs/CONTRIBUTING-BRANDS.md](./CONTRIBUTING-BRANDS.md) | gouvernance apps : cycle de vie, app → kit, breaking changes, codemods |
| [docs/NPM-DISTRIBUTION.md](./NPM-DISTRIBUTION.md) | publication GitHub Packages, changesets, consommation côté app |
| [docs/ARCHITECTURE.md](./ARCHITECTURE.md) | 4 modes de déploiement, modèle M2, boot, admin |
| [docs/RUNBOOK-FLOTTE.md](./RUNBOOK-FLOTTE.md) → skill `.cursor/skills/creezio-fleet-ops` | gestes flotte vérifiés : créer serveur/compte, publish/update, enroll, diagnostics, pièges |
| [scripts/README.md](../scripts/README.md) + [scripts/AGENTS.md](../scripts/AGENTS.md) | matrice des gates, ajout/modification de gate |
| [docs/DOC-STANDARD.md](./DOC-STANDARD.md) | trio documentaire, format FILES.md |