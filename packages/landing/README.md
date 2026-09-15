# @creezio/landing

Module **natif hybride** « landing page » (implémentation de référence du
patron [ADR-module-natif-hybride](../../docs/adr/ADR-module-natif-hybride.md)) :
chaque marque a une landing publique (`lp.{zone}`) dont **tout le contenu
(textes + images) vit en DB brand** et s'édite dans l'app admin OS.

## Ce que fournit le package

| Surface | Contenu |
|---|---|
| `@creezio/landing` (server) | `landingMigrations(seed?)` (tables `landing_sections` / `landing_settings` / `landing_media` + seed), `createLandingMount()` (CRUD `/api/v1/modules/landing/*`, upload média JSON base64), `defaultLandingSeed()`, `createLandingMediaGET()` (route Next thin de service binaire), `LANDING_PREFAB_KINDS` |
| `@creezio/landing/ui` | Préfabriqués `hero` / `features` / `pricing` / `cta` / `footer`, `LandingPublicPage` (rendu public piloté DB + registry `components` de surcharge 100 %), `LandingAdminClient` (édition admin, upload d'images) |

## Câblage app (généré par la factory pour toute app admin neuve)

```ts
// server/src/electron/brand-migrations.ts
composeMigrations(…, landingMigrations(defaultLandingSeed({ brandName: "Ma marque" })));

// server/src/electron/brand-module-api.ts
api.registerModuleApi("landing", createLandingMount());
```

Pages Next (repo admin, versionnées) :

- `ui/app/landing/page.tsx` → `<LandingAdminClient />` (édition, auth OS)
- `ui/app/lp/page.tsx` → `<LandingPublicPage />` (public)
- `ui/app/lp-media/[file]/route.ts` → `createLandingMediaGET()` (binaire)
- `ui/middleware.ts` → host `lp.*` → rewrite `/lp`

## Exposition publique

Réservation **brand-web** `lp.{zone}` via le client CF du kit
(`@creezio/platform-core` `tunnel-cf-client`, 0.10.0 — auto-provisioning par
l'instance, fin du provisioner VPS) :

- kind `brand-web` = **zone-level** : un seul ingress
  (`lp.{zone}` → `http://127.0.0.1:18801`, plane app admin), pas
  d'embeds/wildcard/e-mail ;
- contrat env `CREEZIO_CF_API_TOKEN` / `_ACCOUNT_ID` / `_ZONE_ID` (+
  `_ZONE_NAME`) — le tunnel est créé/configuré via l'API Cloudflare puis
  servi par le cloudflared in-process de l'instance admin.

## Surcharge par la marque

- **Contenu** : via l'admin (`/landing`) — sections composables/ordonnables/
  désactivables, textes et images en DB (`/lp-media/...`).
- **Seed défaut** : `landingMigrations(monSeed)` dans le repo admin.
- **Composants** : `<LandingPublicPage components={{ hero: MonHero, "mon-kind": MaSection }} />`
  dans `ui/app/lp/page.tsx` — remplace/complète n'importe quel préfabriqué.

## Frontières

- Zéro texte/asset marque dans ce package (le seed marque vit dans le repo
  admin de la marque).
- L'upload passe en JSON base64 (l'adaptateur HTTP kernel ne parse pas le
  multipart) ; le service binaire passe par la route Next (le kernel ne
  stream pas).

Gate : `scripts/test-phase-landing.mjs`.
