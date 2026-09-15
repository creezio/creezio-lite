# Matrice Natif / Métier / Plugin — état courant

Règle de découpage de l'OS Creezio : **qui possède quoi**, entre le kit
(natif), le repo marque (métier) et les plugins (organisation).

> Version historique (sign-offs M/N/O/P, statuts d'époque) :
> [archive/MATRICE-NATIVE-METIER-PLUGIN.md](./archive/MATRICE-NATIVE-METIER-PLUGIN.md).

## Les 3 couches

| Couche | Où | SQLite | Exemples |
|--------|----|--------|----------|
| **Natif (kit)** | `packages/@creezio/*` | `core` | auth, shell UI, os-ui, API `/api/v1`, MCP, assistant, tasks, mails, observability, database admin, plugins host, runtime Electron/serveur, navigateur IA |
| **Métier (marque)** | repo marque (`src/electron/brand-*`, `ui/app` hors `(creezio-os)`, `brand-spec/`) | `brand` | catalogue, panier, workflows sectoriels, nav `brand.*`, feed Meili marque |
| **Plugin (org)** | Product Hub (install par organisation) | `plugin/<id>` | extensions n8n, intégrations spécifiques client |

## Règles d'arbitrage

1. **Pas de domaine marque dans le kit** —
   [adr/ADR-no-brand-domain-in-native-packages.md](./adr/ADR-no-brand-domain-in-native-packages.md).
   Vocabulaire kit neutre (`external site`, `siteId`, `catalog_*`) ; les alias
   marque historiques sont dépréciés, pas étendus.
2. **Règle ×3 = natif** : un besoin présent dans 3 marques devient un
   générique kit (configurable par la marque), jamais un copier-coller.
3. **Un module métier** = migrations `brand` + `registerModuleApi` + nav
   `brand.*` + (optionnel) feed Meili — déclaré via BrandSpec, monté par
   `startBrandDesktop` / kernel harness.
4. **Un plugin** est installé par organisation via Product Hub, avec ACL
   see/install/execute et DB isolée `plugin/<id>` ; jamais d'accès cross-layer
   (deny api-kernel + mcp-facade).
5. **Les surfaces UI OS** (mails, tâches, setup, admin…) viennent d'`os-ui`
   et sont matérialisées chez la marque — une marque ne les réécrit pas.

## Où vérifier

- Gates kit : `npm run test:kit` (frontières, owned-by-brand, no-brand-domain).
- Gates marques : `npm run test:brands` (parité twins, montages métier).
- Doctor marque : `creezio brand doctor --spec brand-spec`.

## Voir aussi

- [ARCHITECTURE.md](./ARCHITECTURE.md) — modes de déploiement
- [PLATFORM-VS-VERTICAL.md](./PLATFORM-VS-VERTICAL.md) — le raisonnement plateforme vs vertical
- [PACKAGES.md](./PACKAGES.md) — index des packages natifs
