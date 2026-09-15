# ADR — Gestionnaire d'intégrations / clés API natif (`@creezio/integrations`)

Statut : accepté · Date : 2026-08-06

> Note 2026-08-10 : les mentions de `vendor/creezio` / sync ci-dessous décrivent le mécanisme de distribution de l'époque — remplacé par les packages npm ([../NPM-DISTRIBUTION.md](../NPM-DISTRIBUTION.md)). La décision reste en vigueur.

## Contexte

Les utilisateurs d'une marque Creezio doivent pouvoir enregistrer leurs clés
d'outils externes (OpenAI, Notion, Anthropic…) dans une page native du CRM,
puis les faire **utiliser par référence** par les autres briques : plugins
générés par Hermes, workflows n8n, modules métier. Exemple cible : « plugin
recettes → Notion » qui a besoin de l'intégration `integration://openai`
(LLM) et `integration://notion` (stockage) sans jamais recevoir la valeur en
dur dans son code.

Question ouverte : réutiliser le gestionnaire de credentials de **n8n**
(déjà embarqué dans chaque serveur) comme backend unique piloté par son API,
ou construire un store natif Creezio ?

## Faisabilité vérifiée (doc n8n + test live)

Doc officielle ([docs.n8n.io — API credential](https://docs.n8n.io/connect/n8n-api/credential)) :
« Credential data (secrets) is not included » sur le listing ; les champs
sensibles sont expurgés (`***REDACTED***`) même sur `GET /credentials/:id`.

Test sur le n8n embarqué du parc (`tempoflow3-server-resto-marseille`,
n8n v2.31.5, clé API provisionnée `ensureN8nApiKey`) :

| Opération API publique n8n | Résultat |
|---|---|
| `POST /api/v1/credentials` (secret dans `data`) | ✅ 200, renvoie métadonnées seules |
| `GET /api/v1/credentials` (listing) | ✅ métadonnées seules, jamais `data` |
| `GET /api/v1/credentials/:id` | ✅ 200, **aucun champ `data`** |
| `PATCH /:id` (rename **et** remplacement `data`) | ✅ 200 (write-only) |
| `PUT /:id` | ❌ `PUT method not allowed` |
| `DELETE /:id` | ✅ 200 |

**Conclusion factuelle : n8n est un puits en écriture seule.** Aucune API ne
réexpose la valeur d'une credential — c'est un choix de sécurité assumé de
n8n. Il ne peut donc pas servir de source lisible pour Hermes/plugins/modules.

## Décision — Option B : store natif source de vérité, push vers n8n

- **Source de vérité** : table `creezio_integrations` dans `core.db`
  (migration kit `app_runtime_005_integrations`), package
  **`@creezio/integrations`**.
- **Protection au repos** : AES-256-GCM, clé dérivée de l'`AUTH_SECRET` de
  l'instance (même mécanisme éprouvé que les clés BYOK du chat assistant,
  `@creezio/assistant` chat-db). Un `AUTH_SECRET` par serveur, persistant
  dans `/data/{brand}-config.json` — pas de secret partagé entre serveurs.
- **Référence** : `integration://<slug>` (slug unique par instance, ex.
  `integration://openai`). Les modules ne stockent que la référence.
- **Sync n8n (option B, retenue)** : à chaque create / remplacement de
  secret, le kit **pousse** une credential n8n équivalente via l'API
  publique du n8n embarqué (`http://127.0.0.1:15678/api/v1/credentials`,
  clé `N8N_API_KEY` déjà provisionnée pour le bridge Hermes). Nom n8n :
  `creezio:<slug>` ; l'id n8n est mémorisé (`n8n_credential_id`) pour le
  PATCH/DELETE. Best-effort : n8n absent (client thin, warm off) ⇒ statut
  `pending`, re-sync possible.
- **Résolution** : `POST /api/v1/platform/integrations/resolve`
  `{ reference }` → valeur en clair, réservé à (a) session **owner** non
  impersonnée, (b) **clé API service** de la table `api_keys` (brand.db,
  scopes `full` ou `crm:read`) — exactement la clé CRM que Hermes reçoit
  déjà dans son env (`{PREFIX}_API_KEY` / `{PREFIX}_API_URL`). Les
  collaborateurs voient les métadonnées, jamais les valeurs.

### Pourquoi pas A (n8n backend unique) ni C (hybride complexe)

- (A) impossible : la contrainte write-only de n8n interdit toute lecture ;
  Hermes/plugins ne pourraient jamais résoudre une clé.
- (C) hybride « n8n pour n8n + store pour le reste » sans push automatique
  obligerait l'utilisateur à saisir deux fois ses clés. L'option B EST le
  bon hybride : une seule saisie, le store natif fait autorité et n8n est
  alimenté automatiquement.

## Modèle de données (`core.db`)

```sql
CREATE TABLE IF NOT EXISTS creezio_integrations (
  id TEXT PRIMARY KEY,              -- uuid
  slug TEXT NOT NULL UNIQUE,        -- référence integration://<slug>
  provider TEXT NOT NULL,           -- openai | anthropic | notion | custom
  label TEXT NOT NULL,              -- libellé utilisateur
  secret_enc TEXT NOT NULL,         -- enc:v1:<iv>:<tag>:<data> (AES-256-GCM)
  secret_hint TEXT NOT NULL,        -- ex. "sk-p…cwA" (jamais la valeur)
  meta TEXT NOT NULL DEFAULT '{}',  -- JSON libre (header custom, baseUrl…)
  n8n_credential_id TEXT,           -- id credential n8n poussée (nullable)
  n8n_synced_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## Surface API — `/api/v1/platform/integrations`

Montée par `mountBrandPlatformSurface` (préfixe ajouté à
`PLATFORM_PREFIXES`), harness Docker et desktop.

| Route | Auth | Rôle |
|---|---|---|
| `GET /` | session | liste métadonnées (+ hint, statut sync n8n) |
| `GET /catalog` | session | providers connus + mapping n8n |
| `POST /` | owner | créer `{ provider, label, secret, slug?, meta? }` + push n8n |
| `PATCH /:id` | owner | renommer / **remplacer le secret** / meta + re-push n8n |
| `DELETE /:id` | owner | supprimer + delete n8n |
| `POST /:id/sync-n8n` | owner | re-pousser vers n8n (rattrapage) |
| `POST /resolve` | owner **ou** clé API service | `{ reference }` → `{ secret, provider, meta }` |

## UI

Page kit `IntegrationsClient` (`@creezio/integrations/ui`, design system
shell-ui), wrapper os-ui `/admin/integrations` matérialisé dans les marques ;
entrée sidebar dans le groupe Admin (owner-only, permission `nav.admin`
existante — cohérent : les secrets sont gérés par le compte principal).

## Accès Hermes / plugins

Hermes reçoit déjà `{PREFIX}_API_URL` + `{PREFIX}_API_KEY` (clé service
`api_keys`). Le skill kit `creezio-integrations` documente le geste :

```bash
curl -sS -X POST "$API_URL/api/v1/platform/integrations/resolve" \
  -H "Authorization: Bearer $API_KEY" -H 'content-type: application/json' \
  -d '{"reference":"integration://openai"}'
```

Un plugin généré par Hermes embarque la **référence** dans sa config et la
résout au boot/à l'exécution via cette route (loopback). Les workflows n8n
utilisent la credential `creezio:<slug>` poussée par la sync.

## Conséquences

- Nouvelle dépendance `app-runtime → integrations` (ordre build avant
  `app-runtime`). Vendor sync des marques : ajouter `integrations`.
- La sync n8n dépend de la clé API n8n provisionnée au boot
  (`ensureN8nApiKey`) — déjà en place sur les serveurs `--profile prod`.
- Rotation `AUTH_SECRET` ⇒ les secrets deviennent illisibles (comme les
  BYOK chat) : l'UI signale `unreadable` et demande une re-saisie.
- Gate kit : `scripts/test-phase-integrations.mjs` (CRUD chiffré, résolution
  par référence session/clé API, sync n8n contre un faux n8n HTTP).
