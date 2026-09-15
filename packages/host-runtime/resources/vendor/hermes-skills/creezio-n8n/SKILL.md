---
name: creezio-n8n
description: Piloter le n8n embarqué Creezio — lister, créer, mettre à jour et activer des workflows via l’API REST (X-N8N-API-KEY).
version: 1.0.0
metadata:
  hermes:
    tags: [creezio, n8n, automation, workflows]
---

# creezio-n8n — Contrôle n8n (OS Creezio)

Tu as accès à l’instance **n8n native** de l’application (loopback). Les credentials sont déjà dans l’environnement process Hermes.

## Variables d’environnement (obligatoires)

| Variable | Rôle |
|----------|------|
| `N8N_BASE_URL` | Origine n8n, ex. `http://127.0.0.1:15678` |
| `N8N_API_URL` | Racine API, ex. `http://127.0.0.1:15678/api/v1` |
| `N8N_API_KEY` | Clé API provisionnée pour Hermes (`X-N8N-API-KEY`) |

Si `N8N_API_KEY` est absente : dis à l’utilisateur d’ouvrir **Admin → Configuration → n8n** puis **Réparer**, ou de redémarrer l’application.

## Authentification

Toutes les requêtes API publiques :

```bash
curl -sS -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Accept: application/json" \
  "$N8N_API_URL/workflows"
```

## Opérations courantes

### Lister les workflows

```bash
curl -sS -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_API_URL/workflows"
```

### Lire un workflow

```bash
curl -sS -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_API_URL/workflows/<id>"
```

### Créer un workflow minimal (manuel, inactif)

```bash
curl -sS -X POST \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Exemple",
    "nodes": [
      {
        "parameters": {},
        "id": "manual-trigger",
        "name": "When clicking \"Execute workflow\"",
        "type": "n8n-nodes-base.manualTrigger",
        "typeVersion": 1,
        "position": [0, 0]
      }
    ],
    "connections": {},
    "settings": { "executionOrder": "v1" }
  }' \
  "$N8N_API_URL/workflows"
```

### Activer / désactiver

```bash
# Activer
curl -sS -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/<id>/activate"

# Désactiver
curl -sS -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/workflows/<id>/deactivate"
```

### Mettre à jour

```bash
curl -sS -X PUT \
  -H "X-N8N-API-KEY: $N8N_API_KEY" \
  -H "Content-Type: application/json" \
  -d @workflow.json \
  "$N8N_API_URL/workflows/<id>"
```

### Exécutions

```bash
curl -sS -H "X-N8N-API-KEY: $N8N_API_KEY" \
  "$N8N_API_URL/executions?workflowId=<id>&limit=10"
```

## Règles

1. **Toujours** utiliser `N8N_API_URL` / `N8N_API_KEY` — jamais inventer une URL cloud n8n.
2. Les webhooks publics doivent utiliser l’URL tunnel (`WEBHOOK_URL` côté n8n), pas `127.0.0.1`. Sur un serveur flotte c’est `https://n8n.<slug>.<domaine>/`.
3. Avant d’activer un workflow webhook : vérifier que le tunnel de l’app est réservé.
4. Préférer des workflows **inactifs** à la création, puis activer après validation.
5. Ne pas supprimer de workflows utilisateur sans confirmation explicite.
6. Pour l’UI n8n : l’utilisateur ouvre **Admin → n8n** (desktop) ou `https://n8n.<slug>.<domaine>` (serveur).

## MCP n8n

L’accès MCP instance est activé côté OS (`N8N_MCP_ACCESS_ENABLED`). Pour exposer un workflow aux clients MCP, active-le dans n8n (Settings → Instance-level MCP) après création via API si besoin. Le pilotage principal pour **créer** des workflows reste cette API REST.
