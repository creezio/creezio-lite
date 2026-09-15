# @creezio/granola

Module natif **Granola** (AI meeting notes) : le serveur marque expose une
adresse webhook à coller dans Granola (Settings → Connectors → Webhooks) et
reçoit toutes les livraisons (`note.generated`, `note.edited`,
`note.access_granted`) — chaque note référencée est ensuite synchronisée en
`brand.db` via l'API publique Granola.

## Architecture (ADR-module-natif-hybride)

- **Mount hybride** `granola` — enregistré **par la marque**
  (`api.registerModuleApi("granola", createGranolaMount({ defaults }))`) →
  HTTP `/api/v1/modules/granola/*`, données en `brand.db`
  (`granola_settings`, `granola_events`, `granola_notes`).
- **Webhook** : `POST /api/v1/modules/granola/webhook` — récepteur
  Standard Webhooks. Dès qu'un `signingSecret` (`whsec_…`) est configuré,
  la vérification HMAC-SHA256 est **fail-closed** (401 `invalid_signature`),
  avec dédup par `event_id` (les retries Granola réutilisent l'id).
- **Sync notes** : le payload webhook ne porte jamais le contenu — la note
  est re-fetchée avec la clé API (`grn_…`), les contrôles d'accès
  s'appliquent côté Granola au fetch.
- **Config** : défauts marque via `createGranolaMount({ defaults })`,
  override à chaud `PUT config` (clé API, signing secret, origine publique),
  secrets **masqués** en `GET config`.
- **UI** : `@creezio/granola/ui` → `GranolaClient` compose
  `GranolaNotesPanel` (workspace notes : liste filtrable, fiche résumé /
  transcript — GRANOLA-1) et `GranolaConnectPanel` (santé, endpoints
  distants, livraisons — GRANOLA-2).

## API mount (câblé par la marque)

| Méthode | Chemin | Rôle |
|---------|--------|------|
| POST | `webhook` | récepteur livraisons Granola (public, signé HMAC) |
| GET | `webhook-info` | URL webhook à coller dans Granola |
| POST | `register-webhook` | crée l'endpoint via l'API Granola + stocke le `signing_secret` (retourné une seule fois) |
| GET/PUT/DELETE | `config` | config module (secrets masqués en GET) |
| GET | `events` | livraisons reçues (dédupliquées, `verified`) |
| GET | `notes` / `notes/<id>` | notes synchronisées localement |
| GET | `notes/<id>/transcript` | proxy transcript paginé (`next_cursor`) |
| POST | `notes/<id>/sync` | re-fetch d'une note via l'API |
| GET | `remote/notes[?…]` | proxy `GET /v1/notes` (pagination, filtres) |
| GET | `remote/notes/<id>[?include=transcript]` | proxy `GET /v1/notes/{id}` |
| GET | `remote/notes/<id>/transcript` | proxy transcript paginé |
| GET | `remote/folders` | proxy `GET /v1/folders` |
| GET/PATCH/DELETE | `remote/webhook-endpoints[/<id>]` | gestion endpoints webhook Granola |

## Câblage marque (3 gestes)

```ts
// 1. server/src/electron/brand-granola-content.ts (défauts, optionnel)
export const brandGranolaDefaults = {
  publicBaseUrl: process.env.BRAND_PUBLIC_ORIGIN,
};

// 2. brand-migrations.ts
...granolaMigrations(),

// 3. brand-module-api.ts
api.registerModuleApi("granola", createGranolaMount({ defaults: brandGranolaDefaults }));
```

L'URL à coller dans Granola est alors
`https://<origine-publique>/api/v1/modules/granola/webhook` (exposée par
`GET webhook-info`). Prérequis côté Granola : plan Business/Enterprise
(webhooks) + clé API `grn_…` (Settings → Connectors → API keys).

## Client API

`createGranolaClient({ apiKey, baseUrl?, fetchImpl? })` couvre toute la
surface documentée de l'API publique (`https://public-api.granola.ai`) :
notes, note + transcript, folders, webhook-endpoints (CRUD). Rate limits
officiels : burst 25 req/5 s, 5 req/s soutenu.
