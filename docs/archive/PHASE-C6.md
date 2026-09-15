# Phase C6 — Certivan RTI API métier

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | `certivan-app` |
| **Prérequis** | [PHASE-C2.md](PHASE-C2.md) |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Non** — regroupé **C8** |

---

## Objectif

Fermer le mount RTI **UI-only** : table brand `rti_documents` + API
list/get/create/generate + tools MCP.

## Surface

| Path | Rôle |
|------|------|
| GET `/rti/status` | `kind: "api"` + count |
| GET `/rti/list` | documents (filtre `dossier_id`) |
| GET `/rti/id/:id` | détail |
| POST `/rti/create` | brouillon lié dossier VASP |
| POST `/rti/id/:id/generate` | markdown depuis dossier+véhicule |
| PATCH/DELETE `/rti/id/:id` | update / archive |

Migration : `c6_brand_003_rti_documents`.

## Vérif

```bash
cd /opt/docker/certivan-app/crm && npm run test:phase-c6
```

## Verdict

**Phase C6 : TERMINÉE.**
