---
name: creezio-integrations
description: Utiliser les intégrations / clés API tierces de l'utilisateur (OpenAI, Notion…) PAR RÉFÉRENCE — lister les intégrations disponibles et résoudre `integration://<slug>` en valeur au moment de l'exécution, sans jamais coder une clé en dur.
version: 1.0.0
metadata:
  hermes:
    tags: [creezio, integrations, credentials, secrets]
---

# creezio-integrations — Intégrations tierces (OS Creezio)

L'utilisateur enregistre ses clés d'outils externes (OpenAI, Notion,
Anthropic, services custom) dans la page **Admin → Intégrations** du CRM.
Chaque intégration a une **référence stable** : `integration://<slug>`
(ex. `integration://openai`, `integration://notion`).

**Règle d'or** : un plugin / script / workflow que tu génères n'embarque
JAMAIS une clé en clair. Il embarque la **référence**, et la résout à
l'exécution via l'API interne.

## Variables d'environnement (déjà dans ton process)

| Variable | Rôle |
|----------|------|
| `<PREFIX>_API_URL` | Origine CRM, ex. `http://127.0.0.1:18791` (préfixe marque, ex. `TF3_API_URL`) |
| `<PREFIX>_API_KEY` | Clé API service CRM (Bearer) — autorise la résolution |

```bash
CRM="$TF3_API_URL"   # adapter au préfixe de la marque
AUTH="Authorization: Bearer $TF3_API_KEY"
```

## Lister les intégrations disponibles (métadonnées seules)

```bash
curl -sS "$CRM/api/v1/platform/integrations" -H "$AUTH"
# → { ok, integrations: [{ slug, reference, provider, label, secretHint, … }] }
```

Les valeurs ne sont jamais dans le listing. S'il manque une intégration,
demande à l'utilisateur de l'ajouter dans **Admin → Intégrations**.

## Résoudre une référence en valeur (exécution)

```bash
curl -sS -X POST "$CRM/api/v1/platform/integrations/resolve" \
  -H "$AUTH" -H 'content-type: application/json' \
  -d '{"reference":"integration://openai"}'
# → { ok:true, integration: { slug, provider, label, secret, meta } }
```

Codes d'erreur : `404 not_found` (référence inconnue), `409 unreadable`
(clé à re-saisir par l'utilisateur), `401` (clé service absente/invalide).

## Dans un plugin généré

- Config du plugin : stocker `"llm": "integration://openai"`,
  `"storage": "integration://notion"` (références, pas de valeurs).
- Au boot / à l'exécution, le plugin résout chaque référence via l'API
  ci-dessus (loopback) et garde la valeur en mémoire seulement.
- Ne jamais logger la valeur résolue.

## Côté n8n

Chaque intégration est automatiquement poussée comme credential n8n nommée
`creezio:<slug>` (ex. `creezio:notion`, type `notionApi`). Dans un workflow
n8n que tu crées via le skill `creezio-n8n`, référence la credential par ce
nom — inutile de recréer des credentials n8n à la main.
