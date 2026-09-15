# CLOUD-HANDOFF — reprise du backlog dettes par agents cloud

> Instructions pour agents cloud Cursor reprenant le backlog de dettes du kit.
> L'orchestrateur local (VPS) garde : merges, releases changesets, deploys,
> vérifications prod. **Un agent cloud ne déploie jamais et ne merge jamais** —
> il livre une PR verte, c'est tout.

## Contexte au moment du handoff (2026-08-31)

- Kit `@creezio/*` en **0.20.0** (lockstep, groupe `fixed` changesets —
  `.changeset/config.json`). `factory`/`propagation` versionnent à part.
- `ARCHITECTURE_VERSION = H9`. Codemods H7/H8/H9 dans `scripts/codemods/`.
- Marques prod : `tempoflow3` (instances resto-lyon / resto-marseille) et
  `tempoflow3-admin` — bumps automatiques via `.github/workflows/propagate.yml`
  après chaque publish. **Hors de portée des agents cloud.**
- Vérification prod canonique : `scripts/verify-prod.mjs` (généré par la
  factory dans toute app) + skill `.cursor/skills/creezio-fleet-ops/SKILL.md`
  §3b. Réservé à l'orchestrateur (accès VPS requis).
- CI de release : les gates scaffold utilisent `--link-kit` (kit local, plus
  de dépendance au registre pour une version non publiée) — PR #172. Une PR
  de code avec CI rouge ne se merge JAMAIS.

## Règles non négociables (résumé AGENTS.md)

1. Lire `AGENTS.md` racine en premier — frontières kit/marque, ordre de
   build, pièges connus.
2. Pas de vocabulaire marque dans `packages/*/src|ui` (gate
   `test-phase-no-brand-vocab`, allowlist ratchetée : on n'y AJOUTE jamais).
3. `npm run build:packages` puis `npm run test:kit` verts avant PR.
4. Changeset obligatoire pour tout changement runtime (patch/minor).
5. Trio doc `README.md` / `AGENTS.md` / `docs/FILES.md` à jour pour tout
   package touché (gate `test-phase-docs-freshness`).
6. Identité git : `git -c user.name=Creezio -c user.email=creezio@users.noreply.github.com`.
7. PR non-draft uniquement quand la CI est verte. Une PR = une dette.

## Backlog à reprendre (ordre de priorité)

### T4 — supprimer le hop HTTP interne admin→fleet
`@creezio/admin` appelle le backend flotte via HTTP interne alors que
`@creezio/fleet` est importable directement (voir `packages/fleet/AGENTS.md`,
décision P2.b). Faire dépendre admin de fleet (imports directs), garder le
backend HTTP pour les host-agents distants. Attention ordre de build
(`scripts/build-workspaces.mjs --packages-only --list`) et gate
`test-phase-build-order-imports`.

### T5 — contrat module volet 2 (F3.4)
~~Ouvert au handoff.~~ **Livré** : champs additifs `assistantSources` /
`onboarding` sur `BrandModuleDef`, collecteurs + consommation
assistant/onboarding, doctor warn `MODULE_ASSISTANT_SOURCES_MISSING`,
pas de bump `ARCHITECTURE_VERSION`.

### T6 — doctor : cohérence `meiliIndexes.table` ↔ migrations
Vérifier au doctor brand-spec que la table d'un index Meili déclaré existe
dans une migration. Piège documenté (BACKLOG) : tables créées par un autre
module ou par les migrations historiques `fromprd_brand_*` → résolution
cross-module du plan de données, pas de check textuel naïf.

### T7 — tunnel cloudflared dédié agent par VPS
`agent.{slug}` passe par le tunnel du serveur applicatif → agent injoignable
pendant l'update de ce serveur. Concevoir le tunnel dédié (slug hôte réservé).
Code + config kit seulement ; l'orchestrateur fera l'enrôlement réel.

### T8 — persister le suivi update-status de l'agent
La Map `update-status` du host-agent (`@creezio/fleet`) ne survit pas à un
restart pendant un update. Persister (fichier JSON état/disque), recharger au
boot, TTL raisonnable. Protocole v1 strict — champs additifs uniquement.

### T9 — H10 : retrait compat desktop legacy
Codemod de migration des clients legacy puis suppression de
`electron-shell/src/desktop/legacy-brand-compat.ts` + gate
`test-phase-legacy-desktop-frozen`. Lire
`docs/adr/ADR-p2a-desktop-legacy-freeze.md`. Bump `ARCHITECTURE_VERSION`
H9→H10 + codemod + manifest (gate arch-codemod).

### T10 — purge allowlist no-brand-vocab
`scripts/no-brand-vocab-allowlist.json` : faire décroître les compteurs
(tickets F1.x) en neutralisant les occurrences restantes dans
`packages/*/src|ui`. Par lots raisonnables (une PR par lot), jamais
d'augmentation.

### T11 — GC registry Docker local
Automatiser delete tags + `registry garbage-collect` (registry `127.0.0.1:5000`
du VPS). Livrer le script/geste CLI dans factory `server-docker` + doc ;
l'orchestrateur l'exécutera.

### T12 — divers
Gates `factory-prd` hors ligne (l'app générée n'a pas de `node_modules` —
piste : lien vers le `node_modules` du kit) ; retrait `appliedLimit`
(`assistant/src/runtime/run-sql.ts`) au prochain bump majeur assistant ;
remplir les rôles `(à documenter)` des FILES.md.

## Ce que l'orchestrateur fait après votre PR

1. Vérifie la CI, merge (squash).
2. Pilote la release changesets (lockstep) et la publication GitHub Packages.
3. Laisse `propagate.yml` ouvrir les bumps marque, les merge, déploie
   (TF3 auto, admin build+update), lance `verify-prod` sur les 3 instances.

Ne faites rien de tout ça vous-mêmes : si un doute nécessite un accès prod,
posez la question dans la PR au lieu de contourner.

## Prompts prêts à l'emploi (à coller au lancement d'un agent cloud)

Chaque prompt est autonome. Lancer l'agent depuis `main`.

### T4

> Repo kit Creezio. Lis `AGENTS.md` racine puis `docs/agents/CLOUD-HANDOFF.md`
> (branche `agents/cloud-handoff`). Livre UNE PR verte, sans merge ni deploy.
> Dette T4 : `@creezio/admin` appelle le backend flotte via un hop HTTP
> interne alors que `@creezio/fleet` est importable directement (lire
> `packages/fleet/AGENTS.md`, décision P2.b). Cartographie les fetch HTTP
> internes (`packages/admin/src/fleet-*.ts`), remplace-les par des imports
> directs de `@creezio/fleet` (ordre de build : gate
> `test-phase-build-order-imports`), garde le serveur HTTP intact pour les
> host-agents (protocole v1, header `x-creezio-fleet-protocol: 1`, ne pas
> toucher). Comportement identique, pas de refactor opportuniste.
> `build:packages` + `test:kit` verts, trio docs à jour, changeset minor,
> branche `t4-admin-fleet-direct`.

### T6

> Repo kit Creezio. Lis `AGENTS.md` racine puis `docs/agents/CLOUD-HANDOFF.md`
> (branche `agents/cloud-handoff`). Livre UNE PR verte, sans merge ni deploy.
> Dette T6 : le doctor brand-spec (`packages/brand-spec/src/doctor.ts`) doit
> vérifier que chaque `meiliIndexes.table` d'un module existe dans une
> migration. Piège (BACKLOG) : résolution cross-module obligatoire — tables
> créées par un autre module ou par les migrations historiques
> `fromprd_brand_*`. Construire l'ensemble des tables de TOUTES les
> migrations (parse `CREATE TABLE` robuste, `IF NOT EXISTS`, quotes), check
> `MODULE_MEILI_TABLE_UNKNOWN` (error) au message actionnable, échappatoire
> déclarative uniquement si cas légitime (pas d'env de bypass). Nouveaux cas
> dans `scripts/test-phase-brand-spec.mjs` (même module / autre module /
> historique / inconnue→error). `build:packages` + `test:kit` verts, trio
> docs, changeset minor, branche `t6-doctor-meili-table-coherence`.

### T8

> Repo kit Creezio. Lis `AGENTS.md` racine puis `docs/agents/CLOUD-HANDOFF.md`
> (branche `agents/cloud-handoff`). Livre UNE PR verte, sans merge ni deploy.
> Dette T8 : la Map `update-status` du host-agent (`@creezio/fleet`, Node pur)
> ne survit pas à un restart pendant un update. Persister sur disque dans le
> state dir existant de l'agent (écriture atomique tmp+rename), recharger au
> boot, TTL documenté pour les entrées terminées, flag « agent restarted » si
> l'issue réelle est inconnue. Protocole v1 intact (champs additifs
> uniquement). Tests persist/reload/TTL + restart simulé. Gate
> `test-phase-host-no-electron` respectée. `build:packages` + `test:kit`
> verts, trio docs fleet, changeset patch, branche
> `t8-agent-update-status-persist`.

Pour T5/T7/T9→T12 : partir de la description de la section « Backlog » et du
même gabarit (contexte AGENTS.md + handoff, une PR verte, changeset, trio
docs, pas de merge/deploy).
