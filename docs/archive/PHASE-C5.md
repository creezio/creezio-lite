# Phase C5 — Fidu mounts métier utiles

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repos** | `fidu` |
| **Prérequis** | [PHASE-C1.md](PHASE-C1.md), I17 mounts |
| **ARCHITECTURE_VERSION** | `"H6"` |
| **Republish marques** | **Non** — regroupé **C8** |

---

## Objectif

Remplacer les mounts `status`/`COUNT` minces par une API **list / get /
mutation** sur `dossiers`, `contacts`, `ged` (folders + files).

## Surface

| Module | GET | Mutation |
|--------|-----|----------|
| dossiers | `status`, `list`, `id/:id` | POST create, PATCH/DELETE `id/:id` |
| contacts | `status`, `list`, `id/:id` | POST create, PATCH/DELETE `id/:id` |
| ged | `status`, `folders/list`, `files/list`, `…/id/:id` | POST folders/files, PATCH/DELETE |

MCP : `module.dossiers.get|create`, `module.contacts.get|create`,
`module.ged.folders.list`, `module.ged.files.list`.

## Vérif

```bash
cd /opt/docker/fidu/crm && npm run test:phase-c5
```

## Verdict

**Phase C5 : TERMINÉE.**
