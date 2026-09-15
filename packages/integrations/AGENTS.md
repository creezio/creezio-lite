# AGENTS — @creezio/integrations

## Mission

Store natif des intégrations / clés API tierces d'une instance (source de
vérité), résolution par référence `integration://<slug>` pour Hermes /
plugins / modules, et push best-effort vers le n8n embarqué. ADR :
`docs/adr/ADR-integrations-store.md`.

## Invariants (ne pas casser)

- **La valeur en clair ne sort que par `POST /resolve`** (owner ou clé API
  service `api_keys` scopes `full`/`crm:read`). Listing/GET = `secretHint`
  seulement. Ne jamais ajouter le secret aux réponses de listing.
- **Chiffrement au repos** : `sealIntegrationSecret` (AES-256-GCM, clé
  dérivée `AUTH_SECRET` par instance, format `enc:v1:iv:tag:ct`). Un
  `AUTH_SECRET` changé rend le secret illisible → resolve 409 `unreadable`
  (re-saisie), jamais de fallback en clair.
- **n8n = destination d'exécution, pas source** : l'API publique n8n ne
  réexpose jamais les valeurs (vérifié doc + live). La sync est best-effort :
  une panne n8n ne bloque jamais le CRUD (`n8nCredentialId` null, re-push
  via `POST /:id/sync-n8n`).
- **Pas de domaine marque** ici (providers génériques uniquement) ; le
  montage (session, owner, clé service, bridge n8n) vit dans
  `@creezio/app-runtime` (`mount-brand-platform-surface.ts`).
- Le canal clé service lit `api_keys` dans la **brand db** de la marque —
  migration marque requise (factory : `fromprd_brand_api_keys`).

## Points d'entrée

- `src/store.ts` — CRUD SQLite (`creezio_integrations`, core.db).
- `src/http/routes.ts` — routes Hono `/api/v1/platform/integrations`.
- `src/n8n-sync.ts` — push/remove credentials n8n (`creezio:<slug>`).
- `src/providers.ts` — catalogue providers + mapping types n8n.
- `src/reference.ts` / `src/secret-box.ts` / `src/schema.ts`.
- `ui/integrations-client.tsx` — page CRM (wrappée par os-ui
  `/admin/integrations`).

## Tests

```bash
npm run build -w @creezio/integrations
node scripts/test-phase-integrations.mjs
```
