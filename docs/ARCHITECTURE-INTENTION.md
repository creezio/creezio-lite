# Architecture intention — Creezio

> Décisions **verrouillées** par l’utilisateur (2026-07-29). Ce document fixe
> le *pourquoi* et le *où* ; l’architecture opérationnelle est dans
> [ARCHITECTURE.md](./ARCHITECTURE.md).  
> Constante runtime : `ARCHITECTURE_VERSION` dans `@creezio/platform-core`
> (`"H6"` — historique des paliers dans [archive/](./archive/)).

---

## 1. Intention (non-technique)

### Qu’est-ce que Creezio ?

Creezio est une **base stable type CMS** pour lancer rapidement un produit
desktop Client + Serveur sous une marque (TempoFlow, Fidu, Certivan…).

On démarre avec :

- une identité marque (nom, feeds, tunnel, bridge) ;
- un cœur technique partagé (auth, shell, assistant, API, MCP, hosts n8n/Hermes,
  recherche, Product Hub / plugins) ;
- un **espace métier vide** prêt à accueillir les modules de la marque.

La marque évolue souvent (catalogue, dispatch, GED…). Le kit Creezio évolue
plus lentement : c’est le socle, pas le métier.

### Trois couches à retenir

| Couche | Qui la possède | Exemples |
|--------|----------------|----------|
| **Natif Creezio** | Kit `@creezio/*` | Auth, nav + slots, shell CRM (sidebar/workspace/cockpit/setup/onboarding/search), chat, API façade, MCP, splash, **tasks/kanban/AI**, mails, Product Hub/fabrique, fleet, database UI, tunnel, Meili, hosts n8n/Hermes |
| **Modules métier** | **Repo de la marque** | Panier, dispatch, relevés, optimiser, catalogue (TempoFlow) ; GED / Pennylane (Fidu) ; RTI / VASP (Certivan) — **jamais** une surface présente dans les 3 marques |
| **Plugins** | Organisation cliente (ACL) | Sidecars créés / installés par users, visibles selon droits org |

### Analogie simple

- Creezio ≈ WordPress **core** + admin + API.
- Modules métier ≈ thème + plugins **officiels** livrés avec le produit marque.
- Plugins orga ≈ extensions installées chez le client, avec qui peut les voir.

### Promotion plugin → module natif marque

Ce n’est **pas** un bouton magique. C’est un **processus humain / produit** :

1. revue (qualité, sécurité, valeur) ;
2. intégration dans le **repo de la marque** ;
3. release Client/Serveur de la marque ;
4. les données rejoignent alors le **SQLite métier** (plus le fichier plugin).

---

## 2. Intention technique

### SQLite multi-fichiers

Une instance Serveur (jour 0) ouvre **deux** bases, pas une seule monolithe :

| Fichier | Contenu | Création |
|---------|---------|----------|
| **`core`** | Cœur Creezio (auth, sessions, tasks/mails plateforme, Product Hub registry, config…) | Jour 0 |
| **`brand` / métier** | Schéma des modules natifs de la marque | Jour 0 (schéma modules, même vide) |
| **`plugin/<id>`** | Données d’un plugin installé | **À l’install** du plugin uniquement |

Chemins + runtime (H1 paths, H2 handles) :

- `resolveCoreDbPath` / `resolveBrandDbPath` / `resolvePluginDbPath` ;
- `createSqliteRuntime` — open core+brand jour 0 ; `openPlugin` à l'install ;
- `resolveDbPath` reste alias déprécié de brand (soft-compat marques).

### Modules métier = repo marque

- **Pas** dans le kit Creezio.
- Le kit expose des **contrats** (nav slots, façade API/MCP, stores, hooks).
- La marque implémente et versionne son métier indépendamment.

### Nav = nav Creezio + slots

- La navigation principale est celle des **fonctionnalités natives Creezio**.
- Le package nav expose des **slots** où la marque branche onglets / vues métier.
- Ce n’est **pas** « la nav TempoFlow générique » — TempoFlow (ou Fidu…) *remplit*
  les slots.

Implémentation : `@creezio/shell-ui` (contrat de slots typé,
`registerBrandNav`) ; la factory scaffolde `vertical-slot.ts` côté marque.

### Runtime marque : une façade desktop

Les marques from-prd / BrandSpec démarrent via **`@creezio/app-runtime`**
(`startBrandDesktop` / `startBrandKernelHarness`).  
`main.ts` = déclaration (manifest, `bootKernel`, feed, nav) — **pas** une
copie de l’orchestration OS. Voir ADR `docs/adr/ADR-brand-spec-app-runtime.md`
et `docs/agents/CREATE-BRAND.md`.

### API + MCP : une façade unique

Un seul domaine / une seule API d’entrée qui **proxifie** :

1. API cœur Creezio ;
2. APIs modules métier (découvertes) ;
3. APIs plugins (découvertes).

Même principe MCP : **tools cœur (admin)** + **tools métier / modules / plugins**
découverts. Pas de « produit MCP Creezio » séparé du MCP de l’app.

### Plugins = organisation + ACL

- Créés éventuellement par des users, mais ce sont des **plugins d’organisation**.
- Granularité ACL (qui voit / installe / exécute) — Product Hub L3/L4 **H5**
  (`decidePluginAccess`, deny cross-org, binding `ownerOrgId`).
- Pas d’univers perso totalement séparé (pas de silo user hors org).

### Multi-exe Client + Serveur par marque

Chaque `AppManifest` expose **toujours** `client` + `server` + `publish`.

### Serveur neuf — jour 0

1. SQLite **core** Creezio ;
2. SQLite **métier** (schéma modules marque) ;
3. SQLite **plugins** : aucun fichier tant qu’aucun plugin n’est installé.

---

## 3. Schéma des 3 couches

```text
┌─────────────────────────────────────────────────────────────────┐
│  Produit marque (exe Client + Serveur)                            │
│  TempoFlow / Fidu / Certivan / DemoBrand…                         │
├─────────────────────────────────────────────────────────────────┤
│  Couche 2 — MODULES MÉTIER          (repo marque)                 │
│  panier · dispatch · relevés · optimiser · catalogue · …        │
│  → SQLite brand                                                     │
├─────────────────────────────────────────────────────────────────┤
│  Couche 1 — NATIF CREEZIO           (kit @creezio/*)              │
│  auth · shell-ui/nav+slots · assistant · api-kernel · mcp-facade  │
│  splash/host · tasks · mails · product-hub · tunnel · meili       │
│  n8n/hermes hosts · brand-config · platform-core · tooling…       │
│  → SQLite core                                                      │
├─────────────────────────────────────────────────────────────────┤
│  Couche 3 — PLUGINS ORGA            (ACL Product Hub)             │
│  sidecars installés · tools MCP découverts · data isolée          │
│  → SQLite plugin/<id> (créé à l’install)                          │
└─────────────────────────────────────────────────────────────────┘

                    ▲ une façade API + MCP
                    │ proxifie cœur + modules + plugins
```

### Propagation

- **Descente** : kit → vertical marque → org → user (entitlements).
- **Remontée** : plugin terrain → review org → intégration marque → (rare)
  acceptation kit natif.
- Promotion plugin → **module marque** = revue humaine (décision §1), pas auto.

Voir [PROPAGATION.md](PROPAGATION.md).

---

## 4. Décisions verrouillées (ne pas rediscuter)

1. **SQLite multi-fichiers** : `core` / `brand` / `plugin/<id>` ; promotion
   plugin→module marque = processus humain ; données → SQLite métier.
2. **Modules métier dans le repo marque**, pas dans le kit ; Creezio = CMS stable.
3. **Nav = nav Creezio** avec **slots** métier ; pas « nav TempoFlow » dans le kit.
4. **API + MCP** : façade unique qui proxifie cœur + modules + plugins ;
   un seul MCP d’app (tools découverts), pas un produit MCP séparé.
5. **Plugins d’organisation** + ACL granulaire ; pas d’univers perso isolé.
6. **Multi-exe Client + Serveur** par marque.
7. **Serveur neuf jour 0** : SQLite core + SQLite métier ; plugins à l’install.
8. **Règle ×3 = natif** : toute fonctionnalité présente (ou l’ayant été) dans
   TempoFlow **et** Certivan **et** Fidu est **plateforme** `@creezio/*`
   (config optionnelle ok). Le métier = ce qui est spécifique à **une seule**
   marque. Pas de « question bloquante » pour reclasser tasks/cockpit/onboarding/
   shell/fleet/mails/hub/… — preuve historique dans
   [archive/ETAT-DES-LIEUX-INTENTION.md](./archive/ETAT-DES-LIEUX-INTENTION.md) §0–B.

---

## 5. Frontière kit vs marques

| Dans le kit (racine du repo creezio) | Hors kit (repos marques) |
|--------------------------------------|---------------------------|
| Packages `@creezio/*`, console, factory, demobrand | tempoflow2/3, fidu, certivan-app |
| Contrats, hosts, tooling, Product Hub générique | Domaine métier, seeds, UI CRM, migrations exécutées |
| Docs cadre + architecture | Releases exe marque, feeds publish |

L'extraction historique (phases, gates de premier branchement) est terminée
et archivée : [archive/](./archive/).

---

## 6. Références

| Doc | Rôle |
|-----|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Modes de déploiement, boot, admin, navigateur IA |
| [MATRICE-NATIVE-METIER-PLUGIN.md](MATRICE-NATIVE-METIER-PLUGIN.md) | Qui possède quoi : natif / métier / plugin |
| [PLATFORM-VS-VERTICAL.md](PLATFORM-VS-VERTICAL.md) | Règles de décision kit vs marque |
| [PROPAGATION.md](PROPAGATION.md) | Semver / canaux / extension points |
| [archive/](./archive/) | Journal historique (phases, plans, gates) |
