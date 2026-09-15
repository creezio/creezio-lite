# PRD — TempoFlow3

## 1. But de l’expérience

Créer un nouveau dépôt **`tempoflow3`** qui :

1. **Fonctionne** au moins comme TempoFlow **0.10.26** (27 juil. 2026, `e36e4d0`) — c’est la référence **produit / capacités**.
2. **Ressemble structurellement** à la **dernière** TempoFlow2 (tip post-kit : `vendor/@creezio/*`, wiring mince, modules métier) — **en plus clean**, pas au monolithe 0.10.26.

Autrement dit :

| Dimension | Référence | Interdit |
|-----------|-----------|----------|
| Capacités / parcours / tests comportementaux | **0.10.26** | Régresser vs ce qui marchait le 27 juil. |
| Architecture code / dossiers / deps | **TF2 tip (kit)** plus strict | Copier l’arborescence monolithe 0.10.26 |
| Améliorations architecture « vision » post-refactor | hors scope sauf si déjà dans le kit | Réinventer P/N/O dans la marque |

Le but n’est **pas** de cloner 0.10.26. Le but est de prouver que **l’OS creezio** + un PRD métier suffisent à produire une app TempoFlow propre.

---

## 2. Produit (ce que c’est)

**TempoFlow** = CRM desktop local pour le **catalogue et le suivi fournisseurs** :

- app Electron + UI Next.js ;
- données SQLite (+ Meilisearch) sur la machine ;
- assistant IA BYOK ;
- accès distant via tunnel `{slug}.tempoflow.fr` ;
- MCP exposé sur le tunnel ;
- kanban tâches (humains / IA / Hermes), mails, plugins org, admin plateforme.

Ce n’est **pas** Fidu (GED cabinet), **pas** Certivan (dossiers VASP), **pas** un CRM cloud multi-tenant.

---

## 3. Capacités minimales (= oracle 0.10.26)

Détail opérable : [ORACLE-0.10.26.md](./ORACLE-0.10.26.md).

### Plateforme (doit venir du kit `@creezio/*`)

First-run (Héberger / Rejoindre), setup, recovery key, auth, shell UI, onboarding, configuration, cockpit, tâches, mails, MCP OAuth + URL publique, plugins control plane, Hermes/n8n embeds, admin (MCP, plugins, database, API, analytics, request-logs), updater/BYOK/profils, ops journal, AI workspace / open external tab, etc. — tout ce que `test:shell` @ 0.10.26 couvrait.

### Métier TempoFlow (seul gros code dans tempoflow3)

- Catalogue fournisseurs / produits / SKU / secteurs / marketplaces / agrégateurs  
- Panier, commandes, optimiser, dispatch  
- Stack, relevés, scan, promotions, data-mapping  
- Surfaces fournisseur (`/site/[fournisseurId]`)  
- Search (Meili host + fallback SQL métier)  
- Nav métier + aliases MCP métier  

MVP d’abord (dashboard, fournisseurs, produits, skus, panier, commandes, search, nav) puis extension (optimiser, dispatch, relevés, scan…) jusqu’à checklist oracle cochée.

---

## 4. Forme du repo (cible architecture = TF2 tip clean)

Structure attendue (inspirée demobrand + TF2 tip, **pas** 0.10.26) :

```text
tempoflow3/
  README.md
  AGENTS.md
  docs/
  crm/
    package.json          # deps file:vendor/creezio/*
    vendor/creezio/       # sync kit uniquement
    electron/             # wiring mince + modules/ métier
    src/
      app/                # pages métier (+ wrappers minces plateforme)
      lib/                # queries métier + configure*
      server/             # mounts kit + routes métier
    scripts/              # tests adaptés
```

### Règles clean (plus strictes que TF2 tip actuel)

1. **Zéro** launcher OS dans la marque (Hermes/n8n/Meili/plugin-control/updater/tray…).  
2. **Zéro** store plateforme dupliqué (auth, tasks, mails, chat-db, mcp-oauth monolithe…).  
3. Tout natif = import `@creezio/*` après `electron:sync-vendor`.  
4. Marque = `configure*` + `host-stack` composition + modules/routes/UI/migrations **brand**.  
5. Si le kit ne suffit pas → **gap creezio**, pas un copier-coller depuis 0.10.26.  
6. Allowlist : [ALLOWLIST.md](./ALLOWLIST.md).

Tu peux t’inspirer de **comment** TF2 tip branche le kit (`brand-runtime`, `host-stack`, `configure-brand`) comme **modèle de câblage**, jamais recopier le monolithe 0.10.26 ni le gras résiduel TF2 sans le réduire.

---

## 5. Non-objectifs

- Ressembler à 0.10.26 en structure fichiers  
- Valider / reproduire 0.10.33 « tel quel »  
- Porter les dettes twins TF2 (schemas gras, settings métier non filtrés)  
- Publier Windows prod pendant l’expérience (optionnel après parity)

---

## 6. Acceptance

1. **Comportement** : checklist + `test:shell` équivalent + smokes métier MVP ≥ 0.10.26.  
2. **Structure** : audit allowlist OK ; ratio wiring << métier ; 0 natif dupliqué.  
3. **Traçabilité** : commits `Pxx:` selon [PROMPTS.md](./PROMPTS.md) ou exécution du prompt maître ci-dessous en une campagne documentée.

---

## 7. Références kit

- `creezio/AGENTS.md`, `creezio/docs/PACKAGES.md`  
- `creezio/packages/*/README.md` + `AGENTS.md`  
- Factory : `creezio new-app` / `apps/demobrand` (squelette OS, **sans** métier TF)
