---
name: creezio-create-app
description: Créer une app marque Creezio (brand create, pas demo-app, pas de module notes). Utiliser dès qu'il faut naître une marque, scaffolder un monorepo + repo admin frère, ou qu'un agent demande « créer une app » / CREATE-APP.
---

# Creezio — créer une app

Happy path **une commande**. Guide complet :
`$CREEZIO_KIT_ROOT/docs/agents/CREATE-APP.md`.

## Commande

```bash
creezio brand create --id <id> --name <Name> --domain <host> [--out <dir>] [--force]
# Repos GitHub : ajouter --push (token requis). Défaut = local, zéro réseau.
```

Puis :

```bash
creezio brand module init <moduleId> --app <racine-marque>
```

Remplir `brand-spec/product.md` + `brand-spec/modules/<id>/{prd,interview}.md`
**sans** laisser « (à remplir) » avant tout apply métier.

## Interdit

- `creezio demo-app` — déprécié, **exit 1**. Dire d'utiliser `brand create`.
- Module `notes` par défaut, `redirect("/notes")`, `server/crm/`.
- `parseProductPrd` / `brand apply` sur un `product.md` stub → **error**
  (plus de fallback notes).
- CHR seulement si `vertical: chr` explicite.
- Glue OS marque : `src/lib/host-stack.ts`, `listenBrandKernelHttp`,
  app Hono parallèle dans `server/src`.

## Câblage imposé

- Registre vide à la naissance + `createInteractiveDemoMount({ defaults: collectDemoScenarios() })`.
- Un seul `InteractiveDemoRoot` **dans** `SessionProvider` (BrandChrome).
- Pas de `brandDemoScenarios()`.
- Layout 2 repos : monorepo + `<id>-admin`. Jamais `admin/` dans la marque.

## Pas ce skill

- Module métier déjà dans une app existante → skill / guide CREATE-MODULE.
- Ops flotte (serveur Docker, owner, publish) → `creezio-fleet-ops`.
