# AGENTS — @creezio/landing

## Mission

Module natif hybride « landing page » — **implémentation de référence** du
patron [ADR-module-natif-hybride](../../docs/adr/ADR-module-natif-hybride.md) :
moteur + préfabriqués dans le kit, contenu 100 % en DB brand (éditable via
l'admin OS), surcharge totale par marque (seed + registry de composants),
rendu public sur `lp.{zone}` (tunnel brand-web).

## Ne pas faire

- Pas de texte/asset/domaine marque ici (le seed marque vit dans le repo
  admin de la marque, ADR-no-brand-domain-in-native-packages).
- Ne pas tenter du multipart ou des réponses binaires via le mount kernel :
  upload = JSON base64, service binaire = route Next (`createLandingMediaGET`).
- Ne pas renommer les migrations `landing_001_schema` / `landing_002_seed_default`
  (déjà appliquées chez les marques).
- Ne pas transformer ce module en CMS multi-pages — une landing par app.

## Points d'entrée

- `src/index.ts` : types, `LANDING_PREFAB_KINDS`, `defaultLandingSeed`,
  `buildLandingSeedSql`, `landingMigrations`, `createLandingMount`,
  `resolveLandingMediaDir`, `createLandingMediaGET`.
- `ui/prefabs.tsx` : composants préfabriqués par kind + `LANDING_PREFAB_COMPONENTS`.
- `ui/landing-public-page.tsx` : rendu public (fetch `GET public`, registry).
- `ui/landing-admin-client.tsx` : client d'édition (sections, settings, upload).
- `ui/landing.css` : styles `.lnd-*` du rendu public.

## Contrats

- Mount : `/api/v1/modules/landing/{public,sections[,/:id,/reorder],settings,media[,/:id],kinds}`.
- `GET public` est volontairement lisible sans session (page publique) ;
  l'édition suit la posture ADR-admin-app-os.
- Médias : fichiers `{id}.{ext}` sous `{METIER_DATA_DIR}/uploads/landing/`
  (ou `CREEZIO_LANDING_MEDIA_DIR`), URLs `/lp-media/{file}`.

## Tests / gates

```bash
npm run build -w @creezio/landing
node --test scripts/test-phase-landing.mjs
```
