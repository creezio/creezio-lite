# @creezio/integrations

Gestionnaire d'intégrations / clés API tierces (OpenAI, Notion, Anthropic,
custom) — la page « Integrations / API keys » native du CRM Creezio.

ADR : [`docs/adr/ADR-integrations-store.md`](../../docs/adr/ADR-integrations-store.md).

## Ce que fait le package

- **Store natif chiffré** (`creezio_integrations`, `core.db`) : secrets
  scellés AES-256-GCM avec une clé dérivée de l'`AUTH_SECRET` de l'instance
  (`secret-box.ts`), hint non sensible (`sk-t…def`) pour l'UI.
- **Références** : chaque intégration est adressable par
  `integration://<slug>` (`reference.ts`) — les modules ne manipulent jamais
  la valeur en clair, seulement la référence.
- **API** `/api/v1/platform/integrations` (`http/routes.ts`, montée par
  `@creezio/app-runtime`) : listing/catalog (session), CRUD (owner),
  `POST /resolve` (owner **ou** clé API service `api_keys` — le canal des
  plugins exécutés par Hermes).
- **Sync n8n push** (`n8n-sync.ts`) : credential n8n `creezio:<slug>`
  (create/update/delete via l'API publique n8n, clé API du bridge Hermes) —
  les workflows n8n utilisent les mêmes intégrations. n8n ne réexpose jamais
  les valeurs (d'où le store natif comme source de vérité).
- **UI** (`ui/integrations-client.tsx`) : page kit design system, wrappée par
  `@creezio/os-ui` sous `/admin/integrations`.

## Consommer depuis un module / plugin

```ts
const r = await fetch(`${crmBase}/api/v1/platform/integrations/resolve`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.CRM_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ reference: "integration://openai" }),
});
const { integration } = await r.json(); // { secret, provider, meta … }
```

## Gates

`scripts/test-phase-integrations.mjs` (store chiffré, CRUD, résolution
owner + clé service, sync n8n mockée create/patch/delete).
