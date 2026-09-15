# Audit — brief produit non technique → app TempoFlow

**Date** : 2026-08-01  
**Question** : un prompt du type « app pour restaurateurs / prix fournisseurs /
panier / commandes » + le repo `creezio` suffisent-ils à créer TempoFlow3 ?  
**Réponse** : **Non.** Preuves ci-dessous. Ce n’est pas une opinion.

---

## 1. Verdict exécutif

| Capacité demandée | État actuel |
|-------------------|-------------|
| Brief produit seul → app desktop runnable avec fournisseurs / prix / panier / commandes | **ÉCHEC — bloquant** |
| Brief produit seul → plugin Product Hub (sidecar) | **OK partiel** (pas une app) |
| Flags techniques `creezio new-app --name/--id/--domain` → squelette OS vide | **OK** |
| DemoBrand = preuve OS (notes + plugins), pas métier CHR | **OK comme sandbox, hors sujet produit** |

**Conclusion** : creezio est un **kit plateforme + fabrique de plugins**.  
Il n’est **pas** encore une **fabrique d’applications métier depuis un PRD produit**.

Tant que c’est le cas, l’expérience que tu veux (prompt non technique → app) **ne peut pas réussir** sans faire évoluer creezio.

---

## 2. Preuves (état actuel)

### 2.1 Factory CLI — pas d’entrée PRD

Fichiers : `packages/factory/src/cli.ts`, `packages/factory/src/scaffold.ts`.

- Seule commande : `new-app`.
- Args : `--name`, `--id`, `--domain`, `--out`, `--env-prefix`, `--feed-token`, `--sandbox|--no-sandbox`, `--force`.
- **Aucun** `--from-prd`, aucun parseur de brief texte.
- Test runtime : `creezio new-app --from-prd …` → `Argument inconnu: --from-prd`.

Sévérité : **BLOCKER**.

### 2.2 Scaffold — 19 fichiers, zéro métier

`scaffoldNewApp` écrit exactement :

`package.json`, `tsconfig.electron.json`, `electron-builder.*`, `installer.nsh`,
`scripts/build-builder-config.mjs`, `src/electron/{electron-shim.d.ts,app-manifest.ts,app-manifest.json,main.ts,preload.ts,nav-core.ts,product-hub-stub.ts,vertical-slot.ts}`,
`resources/renderer/index.html`, icônes, `README.md`.

Explicitement dans le code (`scaffold.ts` L1–4, `vertical-slot.ts` généré) :

> Pas de catalogue TempoFlow — nav core placeholder + slot métier vide.

Pas de :

- schéma brand `fournisseurs` / `produits` / `panier` / `commandes` ;
- routes API métier ;
- pages Next `/fournisseurs`, `/panier`, `/commandes` ;
- `installBrandDesktopRuntime` / host-stack production (le scaffold appelle
  `prepareDesktopBoot` + HTML statique).

Sévérité : **BLOCKER**.

### 2.3 Mission factory documentée = anti-métier

`packages/factory/AGENTS.md` :

- « sans vertical métier » ;
- « Ne pas injecter de catalogue TempoFlow/Fidu/Certivan ».

Donc même un agent qui suit la doc kit **ne doit pas** générer TempoFlow via
la factory actuelle.

Sévérité : **BLOCKER** (contrat volontairement trop étroit pour ton expérience).

### 2.4 DemoBrand ≠ TempoFlow

`apps/demobrand` :

- table brand : `demobrand_notes` ;
- module API : `demo-notes` ;
- nav métier : Notes ;
- preload commenté « pas d’API catalogue TF ».

Aucun fournisseurs / prix / panier / commandes.

Sévérité : **BLOCKER** pour le brief produit ; DemoBrand reste utile comme
preuve OS/plugins uniquement.

### 2.5 Product Hub factory = plugins, pas apps

`packages/product-hub/src/factory/*` :

- intention → PRD → `scaffoldPlugin` / `writePluginFiles` ;
- fichiers : `manifest.json`, `index.js`, `api.js`, `mcp-tools.js`, `schema.sql`
  sous `plugins/<id>/` ;
- adapters typés `scaffoldPlugin` / `installRuntime` — **pas** création de repo
  marque ni pages App Router.

Console `POST /api/plugin-factory` accepte du texte libre → **plugin**.

Sévérité : **BLOCKER** pour une app ; **OK** pour extensions org.

### 2.6 Wiring marque encore trop manuel (TF2 tip)

Même après conso `@creezio/*`, TempoFlow2 tip nécessite encore des dizaines
de fichiers de câblage (`brand-runtime`, `host-stack`, `configure-*`, mounts
MCP/auth/tasks/mails, pages wrappers admin…).

Un agent « produit » ne peut pas les inventer correctement sans templates kit.

Sévérité : **MAJOR** (même avec métier généré, le boot OS n’est pas 1-clic).

### 2.7 Twins / natifs encore côté marque

Exemples TF2 tip qui devraient être kit ou générés :

`creezio-boot.ts`, `paths.ts` épais, `connection-profile.ts`,
`tunnel-service-urls.ts`, `brand-module-api.ts`, `db.ts` singleton,
`desktop-presence.ts`, parties de `desktop-control` / `ops` / `plugin-ui`.

Sévérité : **MAJOR** (pollue l’allowlist « métier only »).

### 2.8 Doc expérience vs runtime

`PROMPT-PRODUIT.md` décrit le bon critère d’échec OS.  
Mais `MASTER-PROMPT.md` / `PROMPTS.md` retombent sur un plan ingénieur P0–P12 :
preuve que **le chemin produit n’est pas implémenté**, seulement documenté
comme aspiration.

Sévérité : **MAJOR** (docs ≠ capacité).

---

## 3. Matrice brief produit → besoin → état

| Besoin issu du brief | Doit vivre où | État creezio |
|----------------------|---------------|--------------|
| Compte / login / setup | kit auth + onboarding | **Présent** |
| Fenêtre desktop / MAJ / tray | electron-shell | **Présent** (mais scaffold ne monte pas le runtime riche) |
| Assistant / tâches / mails | assistant, tasks, mails | **Présent** (wiring marque manuel) |
| Extensions plugins | product-hub + electron-shell CP | **Présent** (fabrique plugins OK) |
| Parse brief → modèle produit | factory / nouveau module | **Absent** |
| Générer brandId/domain depuis le nom | factory | **Absent** (flags manuels ; `tempoflow` **interdit** par `createAppManifest`) |
| Schéma brand fournisseurs/prix/panier/commandes | générateur métier ou template vertical | **Absent** |
| Routes API + MCP tools métier | générateur modules brand | **Absent** |
| Pages UI métier | générateur UI + shell-ui | **Absent** (HTML statique factory) |
| Nav métier | shell-ui registry générée | **Absent** (slot vide) |
| Runtime marque « production-ready » 1 fichier | template host-stack / brand-runtime | **Partiel** (code kit oui, scaffold non) |
| Sync vendor + deps dans repo externe | script + recipe factory | **Présent côté marques**, pas dans `new-app` out-of-kit |
| Tests smoke parcours fournisseur→panier→commande | templates tests | **Absent** |

---

## 4. Ce que « succès » signifie concrètement

Le brief produit réussit **si et seulement si** :

1. Un agent reçoit uniquement `PROMPT-PRODUIT.md` (+ accès creezio).  
2. Sans qu’on lui explique host-stack / sync / P0.  
3. Il produit un repo `tempoflow3` qui boot.  
4. Parcours **fournisseurs → prix → panier → commande** fonctionne.  
5. Le générique manquant a été ajouté **dans creezio**, pas recopié en marque.

**Aujourd’hui : 0/5.**

---

## 5. Plan d’évolution / correction / implémentation

Ordre imposé : chaque phase a une gate binaire. Pas de phase suivante si fail.

### Phase F0 — Contrat produit factory (doc + gates)

**But** : changer la mission factory : OS shell **et** génération d’app métier
depuis PRD (sans mettre le métier CHR *dans* les packages natifs — templates
générateurs oui).

Travaux :

1. Réécrire `packages/factory/AGENTS.md` / README : autoriser
   `new-app --from-prd` + génération de **modules brand** à partir d’un modèle.  
2. Gate `scripts/test-phase-factory-prd.mjs` : échoue tant que `--from-prd`
   n’existe pas.  
3. Clarifier ADR : métier généré = **code marque**, générateurs = **kit**.

Gate : doc + test rouge qui force l’implémentation.

### Phase F1 — `creezio new-app --from-prd <file>`

**But** : entrée non technique.

Travaux :

1. CLI : `--from-prd` (chemin md/json) ; dériver `name` / `id` / `domain`
   (heuristiques + overrides optionnels).  
2. Parser PRD → `ProductModel` :
   - `entities[]` (fournisseur, produit, tarif, panier, commande…) ;
   - `pages[]` ;
   - `flows[]` (ex. panier→commande) ;
   - `platformNeeds[]` (auth, assistant, tasks, mails, plugins…).  
3. Pour le PRD-PRODUIT TempoFlow : fixture gold dans
   `packages/factory/fixtures/prd-tempoflow-produit.md` + expected model JSON.  
4. Interdire de demander à l’utilisateur des flags techniques si le PRD suffit.

Gate :

```bash
creezio new-app --from-prd docs/experiences/tempoflow3/PRD-PRODUIT.md --out /tmp/tf3
# → ProductModel extrait + scaffold non vide
node --test scripts/test-phase-factory-prd.mjs  # vert
```

### Phase F2 — Template runtime marque « production » (plus HTML statique)

**But** : le scaffold génère une app qui utilise vraiment l’OS.

Remplacer / étendre le scaffold pour générer (hors métier) :

- `electron/main.ts` → `installBrandDesktopRuntime`  
- `host-stack.ts` / bindings minces **générés**  
- Next app minimale (pas seulement `index.html`)  
- mounts auth, shell-ui, api-kernel, mcp-facade, tasks, mails, assistant
  (feature flags depuis ProductModel.platformNeeds)  
- script `electron:sync-vendor` + `package.json` deps `@creezio/*`  
- `brandId` : si nom TempoFlow → `tempoflow3` sandbox (ne pas casser réserve
  prod `tempoflow`)

Gate : app générée sans métier custom → boot + login/setup + page shell +
`test:first-run-auth` portable.

### Phase F3 — Générateur de modules métier brand

**But** : transformer ProductModel → code marque.

Pour chaque entité / flow du modèle, générer sous le repo marque :

| Artefact | Exemple |
|----------|---------|
| Migration SQL brand | `fournisseurs`, `produits`, `prix_historique`, `panier_lignes`, `commandes` |
| Module API Kernel | `registerModuleApi('catalogue'…)` |
| Queries | `src/lib/*-queries.ts` |
| Routes Hono | `src/server/routes/*.ts` |
| Pages App Router | `/fournisseurs`, `/produits`, `/panier`, `/commandes` |
| Nav items | shell-ui registry |
| MCP tools/aliases métier | optionnel MVP |
| Smoke test | `test:metier-parcours` HTTP |

Implémentation recommandée (dans le kit, pas dans TF2) :

- `packages/factory/src/product-model.ts`  
- `packages/factory/src/generators/{schema,api,ui,nav,tests}.ts`  
- templates Handlebars/TS littéraux versionnés  
- **pas** de SQL TempoFlow hardcodé dans `@creezio/platform-core` : le
  générateur produit du code **dans le repo marque**.

Gate : `--from-prd PRD-PRODUIT.md` crée tables + routes + pages ; smoke
`fournisseurs → créer → produit/prix → panier → commande` vert sur DB jetable.

### Phase F4 — Absorber le wiring générique encore en marques

Remonter dans creezio (ou générer systématiquement) :

- paths / connection-profile / tunnel-service-urls  
- brand-module-api / db adapter Next  
- creezio-boot twin  
- desktop-presence / health / client-log templates  

Gate : allowlist marque post-génération = métier + configure* minces ;
rapport LOC wiring généré vs métier.

### Phase F5 — Chemin agent « un prompt »

1. `AGENTS.md` racine : section **Créer une marque depuis un brief produit**
   → pointe uniquement `PROMPT-PRODUIT` + commande `--from-prd`.  
2. Supprimer la nécessité de MASTER-PROMPT technique pour le happy path.  
3. Gate expérience : script qui lance un agent simulé / dry-run :
   - input = PROMPT-PRODUIT uniquement ;
   - assert fichiers métier générés + smoke.

Gate finale expérience : **5/5** du §4.

### Phase F6 — Parity capacités 0.10.26 (après happy path)

Une fois le générateur MVP vert, enrichir templates / prompts métier pour
couvrir optimiser, dispatch, relevés, scan…  
Oracle comportemental : `ORACLE-0.10.26.md`.  
Forme : TF tip clean.

---

## 6. Ordre d’implémentation recommandé (tickets)

| ID | Ticket | Dépend | Effort relatif |
|----|--------|--------|----------------|
| T1 | Gate `test-phase-factory-prd` rouge + ADR factory-from-prd | — | S |
| T2 | `ProductModel` + parse PRD md | T1 | M |
| T3 | CLI `--from-prd` + fixture TempoFlow produit | T2 | M |
| T4 | Scaffold runtime `installBrandDesktopRuntime` + Next minimal | T3 | L |
| T5 | Generator schema+API+UI+nav pour 5 entités MVP | T4 | L |
| T6 | Smoke `test:metier-parcours` généré | T5 | M |
| T7 | Absorber twins wiring (F4) | T4 | M |
| T8 | AGENTS « brief produit only » + gate expérience | T5–T6 | S |
| T9 | Extensions métier oracle 0.10.26 | T8 | L |

S/M/L = taille technique (pas de calendrier).

---

## 7. Hors scope volontaire

- Mettre le catalogue CHR **dans** `@creezio/platform-core` (viole ADR no-brand-domain).  
- Faire croire que Product Hub plugin factory = création d’app.  
- Utiliser 0.10.33 comme oracle capacités.

---

## 8. Réponse précise à ta question

> « suffit probablement pas » n’est pas acceptable — qu’en est-il ?

**Aujourd’hui, ça ne suffit pas.**  
Preuve dure : pas de `--from-prd`, scaffold sans métier, DemoBrand sans
catalogue, Product Hub = plugins only, wiring runtime non généré.

Pour que ton prompt restaurateurs fonctionne **tel quel**, il faut livrer au
minimum **F0→F5** (T1–T8). Avant ça, l’expérience produit est **structurellement
impossible**, quel que soit l’agent.
