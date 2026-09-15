# Prompts TempoFlow3 (suite ordonnée)

Chaque prompt est **autonome** : un agent doit pouvoir l’exécuter sans lire
tempoflow2, en s’appuyant uniquement sur :

- le kit `creezio` (doc packages + code) ;
- [PRD.md](./PRD.md) + [ORACLE-0.10.26.md](./ORACLE-0.10.26.md) + [ALLOWLIST.md](./ALLOWLIST.md).

**Oracle** : comportement TempoFlow **0.10.26** (`e36e4d0`).  
**Interdit** : copier le monolithe 0.10.26 ; viser `0.10.33` ; inventer du natif.

Convention de commit : `Pxx: <titre court>`.

---

## P0 — Créer le dépôt et le squelette marque

```text
Tu crées le repo GitHub creezio/tempoflow3 (ou dossier local /agent/repos/tempoflow3)
pour l’expérience OS documentée dans creezio/docs/experiences/tempoflow3/.

Contraintes :
- Identité produit : TempoFlow (brandId à définir : `tempoflow` ou `tempoflow3` —
  si `tempoflow` est réservé aux manifests prod du kit, utilise un manifest sandbox
  puis documente l’écart ; ne recycle PAS les GUID/feeds prod de tempoflow2).
- Domaine : tempoflow.fr (tunnel/feed selon brand-config ; sandbox OK pour l’expérience).
- Structure cible : crm/ comme demobrand/factory (Electron + Next).
- Utilise `creezio new-app` OU le pattern apps/demobrand comme base scaffold,
  puis renomme/adapte — sans importer de métier TF.

Livrables :
- repo initialisé, README pointant vers le PRD expérience
- `npm install` + build electron minimal OK
- commit `P0: scaffold tempoflow3`

Interdit : copier crm/ depuis tempoflow2.
Gate : `electron:compile` (ou équivalent scaffold) OK + app shell bootable.
```

---

## P1 — Vendor sync kit + deps `@creezio/*`

```text
Branchez tempoflow3 sur le tip creezio (ARCHITECTURE H6).

- Ajoute les deps file:vendor/creezio/* nécessaires (même set que demobrand/TF
  documenté dans packages/*/README + docs/experiences/tempoflow3/PRD.md).
- Script sync-creezio-vendor (canon kit).
- next.config transpilePackages pour les packages UI/runtime requis.
- SYNC.json cohérent.

Commit `P1: vendor sync creezio`.
Gate : require('@creezio/brand-config') + electron-shell resolve OK.
Interdit : modifier le contenu de vendor/ à la main (sauf sync).
```

---

## P2 — Wiring OS (host-stack, auth, shell-ui, onboarding, cockpit)

```text
Montez le runtime OS TempoFlow3 via le kit uniquement.

Fichiers attendus (minces) :
- electron/brand.ts → manifest
- electron/main.ts → installBrandDesktopRuntime
- electron/host-stack.ts → createBrandHostStack
- bindings plugin/host N2 si requis par le kit
- configure shell-ui / onboarding / cockpit / auth

Comportement cible = first-run / setup / login / nav shell de 0.10.26,
mais implémentation = @creezio/*.

Commit `P2: OS wiring auth+shell`.
Gates : test:first-run-auth, test:app-kind, test:recovery-key, test:nav-acl
(ou équivalents kit). Lis creezio/packages/*/AGENTS.md avant d’ajouter du code.
Si tu dois réécrire un launcher Hermes/n8n/plugin : STOP, ouvre un gap kit.
```

---

## P3 — API kernel + MCP + public origin / tunnel

```text
Montez api-kernel + mcp-facade comme en demobrand/doc kit.

- /api/v1 mounts core/platform
- MCP OAuth + base URL publique (tunnel) — comportement 0.10.26 docs/MCP.md
- test:mcp-base-url, test:public-origin, test:tunnel-slug

Pas de tools métier encore (P10). Pas de copie mcp-oauth monolithe TF2.

Commit `P3: api-kernel + mcp`.
```

---

## P4 — Assistant + tasks + mails (config marque)

```text
Activez @creezio/assistant, @creezio/tasks, @creezio/mails par configuration
marque seulement (configureAssistantBrand, configure-tasks, configure-mails).

Prompts/skills/nav labels peuvent être TempoFlow.
Interdit : recopier chat-db / kanban / inbox depuis 0.10.26.

Gates : test:tasks, test:mcp-tasks, test:ai-task-agent, test:assistant-chat-scope,
test:email-inbox (ou équivalent).
Commit `P4: assistant tasks mails`.
```

---

## P5 — Plugins / Product Hub

```text
Activez Product Hub + control plane plugins (features.plugins=true pour TempoFlow).

- plugin-host-bindings / hub store selon contrats kit
- Gates : test:plugin-runtime, test:plugin-control-api, test:plugin-git

Comportement = control plane 0.10.26 (scaffold → health → files → restart).
Si restart flake : corriger dans creezio/electron-shell, pas un hack marque.

Commit `P5: plugins product-hub`.
```

---

## P6 — Métier : schéma brand + migrations

```text
À partir du PRD §5 MVP et de l’oracle 0.10.26 (tables brand catalogue/panier/
commandes/stack…), créez les migrations **brand uniquement** dans tempoflow3.

- Aucune table core kit dupliquée
- Runner migrations via platform-core / brand-runtime mince
- Documentez le schéma dans crm/docs/METIER.md

Ne lisez pas vendor pour inventer le core. Pour le détail métier, vous pouvez
consulter UNIQUEMENT la liste d’objets de ORACLE-0.10.26.md / PRD — pas coller
les fichiers de migration monolithes entiers sans les filtrer (core vs brand).

Commit `P6: brand schema MVP`.
Gate : DB brand créée, boot sans erreur sqlite brand.
```

---

## P7 — Métier : modules Electron (catalogue, panier, stack…)

```text
Implémentez les modules métier Electron nécessaires au MVP
(catalogue sync local, panier, stack…) sous electron/modules/ (ou équivalent
allowlist), enregistrés via le mécanisme kit de brand modules / API mounts.

Interdit : meili-launcher, plugin-control-api, hermes-launcher dans la marque.

Commit `P7: electron modules métier MVP`.
Gate : modules chargés ; smoke module catalogue/panier.
```

---

## P8 — Métier : routes Hono + queries

```text
Ajoutez src/server/routes + src/lib/*-queries pour le MVP :
catalog, fournisseurs, panier, commandes, search, stack (base), data-mapping (base).

Montez-les dans api-kernel espace modules (pas core).

Commit `P8: API métier MVP`.
Gates : smokes HTTP catalogue/panier/commandes ; test:panier-sku si portable.
```

---

## P9 — Métier : pages Next UI

```text
Créez les pages App Router MVP listées dans ORACLE-0.10.26.md (cœur métier).
Réutilisez @creezio/shell-ui (AppShell, patterns) — pas de second design system.

Pages plateforme (login, taches, mails, admin, setup) = routes kit / wrappers
minces, pas de réécriture.

Commit `P9: UI métier MVP`.
Gate : npm run build ; smoke routes /dashboard /fournisseurs /panier /commandes.
```

---

## P10 — Nav métier + MCP aliases métier

```text
Nav TempoFlow (items métier) via shell-ui registry.
Aliases MCP métier (si 0.10.26 en avait) sans dupliquer la façade.

Commit `P10: nav + mcp métier`.
Gates : test:nav-acl ; list tools MCP inclut modules métier attendus.
```

---

## P11 — Parity suite oracle 0.10.26

```text
Portez/adaptez l’agrégat test:shell et les smokes métier MVP pour tempoflow3.
Chaque test doit valider le COMPORTEMENT 0.10.26, avec chemins kit modernes.

Produisez crm/docs/PARITY-0.10.26.md : tableau script → statut (pass/fail/skip motivé).

Commit `P11: parity tests oracle`.
Gate : test:shell vert ; checklist MVP oracle cochée.
```

---

## P12 — Audit allowlist + rapport

```text
Auditez l’arbre tempoflow3 contre ALLOWLIST.md.
Tout fichier hors allowlist = soit suppression, soit gap kit documenté.

Rédigez RAPPORT-EXPERIENCE.md (voir RAPPORT-TEMPLATE.md) :
- ce qui est venu du kit tel quel
- gaps creezio ouverts
- % estimation métier vs wiring
- verdict : OS suffisant / partiel / insuffisant pour parity 0.10.26

Commit `P12: audit allowlist + rapport`.
Gate : 0 natif dupliqué non justifié.
```

---

## Prompts d’extension (après MVP)

### P7b / P8b / P9b — Optimiser, dispatch, relevés, scan

```text
Étendez le métier pour couvrir optimiser/dispatch/relevés/scan/promotions
au niveau utilisable 0.10.26. Mêmes règles allowlist. Gates : test:optimiser,
test:dispatch*, parcours UI associés. Commits P7b/P8b/P9b.
```

---

## Règle transversale (à préfixer mentalement à chaque P)

```text
Oracle = tempoflow2 v0.10.26 e36e4d0 uniquement.
Si le kit ne suffit pas : STOP + gap creezio.
Ne jamais viser 0.10.33 comme définition du succès.
```
