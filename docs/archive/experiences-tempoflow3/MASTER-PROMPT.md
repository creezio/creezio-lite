# Prompt maître — créer TempoFlow3

Copier-coller tel quel à un agent (Cloud / Cursor) ayant accès à :

- le repo kit `creezio` ;
- (lecture seule) `tempoflow2` **tip** comme *exemple de câblage kit* ;
- (lecture seule) `tempoflow2` tag **`v0.10.26` / `e36e4d0`** comme *oracle capacités* ;
- le droit de créer le repo / dossier `tempoflow3`.

---

## Prompt

```text
# Mission

Crée l’application **TempoFlow3** dans un nouveau dépôt `tempoflow3`
(ex. `/agent/repos/tempoflow3` + GitHub `creezio/tempoflow3`).

Tu prouves que l’OS **Creezio** permet de reconstruire TempoFlow :

## Deux références — ne les mélange pas

1. **Capacités / ce que l’app doit FAIRE**  
   Oracle = `tempoflow2` tag **v0.10.26** commit **e36e4d0** (27 juil. 2026).  
   C’est la dernière version qui marchait parfaitement **avant** le grand refactor.  
   TempoFlow3 doit offrir **au minimum** ces capacités (pages, parcours, test:shell
   comportemental, métier catalogue/panier/commandes…).  
   Checklist : `creezio/docs/experiences/tempoflow3/ORACLE-0.10.26.md`.

2. **Forme / comment le code doit RESSSEMBLER**  
   Modèle = **dernière** TempoFlow2 (tip `main`, conso `@creezio/*` via
   `crm/vendor/creezio`, `brand-runtime` / `host-stack` / `configure*`, modules
   métier séparés) — **en plus clean**.  
   TempoFlow3 ne doit **en rien** ressembler au monolithe 0.10.26 (87 launchers
   electron maison, pas de vendor creezio, auth/mcp/tasks dupliqués localement).

Interdit :
- cloner 0.10.26 puis « nettoyer » ;
- prendre 0.10.33 comme définition du succès fonctionnel ;
- recopier des fichiers natifs depuis 0.10.26 dans tempoflow3 ;
- réimplémenter auth, shell, mcp-oauth, plugin-control, hermes/n8n/meili launchers,
  tasks store, mails inbox, etc. dans la marque.

Si le kit ne suffit pas : STOP, documente un **gap creezio**, propose le fix
dans le kit — ne comble pas en copiant le monolithe.

## Produit (qu’est-ce que TempoFlow ?)

CRM desktop local **fournisseurs / catalogue** (CHR) :
Electron + Next.js, SQLite + Meilisearch, BYOK, tunnel `*.tempoflow.fr`, MCP
sur le tunnel, panier & commandes, optimiser/dispatch, tâches IA/Hermes, mails,
plugins org, admin plateforme.

Pas Fidu, pas Certivan, pas un SaaS cloud.

## PRD à respecter

Lis et suis intégralement :
`creezio/docs/experiences/tempoflow3/PRD.md`
`creezio/docs/experiences/tempoflow3/ALLOWLIST.md`
`creezio/docs/experiences/tempoflow3/ORACLE-0.10.26.md`

Doc kit : `creezio/AGENTS.md`, `creezio/docs/PACKAGES.md`, READMEs packages.

## Architecture cible (clean)

```
tempoflow3/crm/
  vendor/creezio/     # sync uniquement depuis tip creezio
  electron/           # wiring mince + modules/** métier only
  src/app/            # pages métier ; wrappers minces pour routes OS
  src/lib/            # queries métier + configure*
  src/server/         # mount api-kernel/mcp + routes métier
  scripts/            # tests (comportement 0.10.26, chemins kit)
```

Deps : `@creezio/*` en `file:vendor/creezio/*` (set H6 : brand-config, shell,
platform-core, electron-shell, api-kernel, mcp-facade, auth, shell-ui,
onboarding, cockpit, assistant, tasks, mails, product-hub, observability,
automations, database, desktop-tooling…).

Scaffold de départ : `creezio new-app` ou pattern `apps/demobrand` — **sans**
métier TF. Ensuite injecte le métier.

Inspire-toi du **câblage** TF2 tip (`electron/brand.ts`, `brand-runtime.ts`,
`host-stack.ts`, `plugin-host-bindings.ts`, `src/lib/configure-*.ts`,
`src/lib/assistant/configure-brand.ts`) pour brancher le kit correctement,
mais **réduis** tout gras / twin / fichier OS encore présent dans TF2 tip.

Identité : produit TempoFlow. Pour l’expérience, un `brandId` sandbox
(`tempoflow3`) est acceptable si `tempoflow` est réservé aux manifests prod
du kit — documente le choix. Ne recycle pas GUID/feeds prod tempoflow2.

## Plan d’exécution (commits `Pxx:`)

Suis `creezio/docs/experiences/tempoflow3/PROMPTS.md` :

- P0 scaffold repo
- P1 vendor sync
- P2 wiring OS (auth, shell-ui, onboarding, cockpit, host-stack)
- P3 api-kernel + mcp + public-origin/tunnel
- P4 assistant + tasks + mails (configure only)
- P5 plugins / product-hub
- P6 schéma + migrations **brand** MVP
- P7 modules electron métier MVP
- P8 routes + queries métier MVP
- P9 pages UI métier MVP
- P10 nav + aliases MCP métier
- P11 parity tests (comportement 0.10.26, impl kit)
- P12 audit allowlist + RAPPORT-EXPERIENCE.md

MVP métier avant extension (optimiser/dispatch/relevés/scan).

## Gates de succès

1. `test:shell` (équivalent) vert — capacités OS ≥ chaîne 0.10.26.  
2. Smokes métier MVP (panier, catalogue, commandes…) verts.  
3. Checklist opérateur ORACLE cochée (MVP).  
4. Audit allowlist : 0 launcher/store OS dans la marque.  
5. Un humain ouvrant le repo doit voir « TF2 tip clean », **pas** « dump 0.10.26 ».

## Livrables

- Repo tempoflow3 poussé
- `crm/docs/PARITY-0.10.26.md` (tableau pass/fail)
- `RAPPORT-EXPERIENCE.md` (template dans creezio/docs/experiences/tempoflow3/)
- Gaps kit listés avec fichiers/packages concernés

Commence par P0. Travaille en français dans les docs du repo.
```
