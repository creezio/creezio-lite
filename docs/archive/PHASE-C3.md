# Phase C3 — V1 fabrique réelle

| | |
|--|--|
| **Statut** | ✅ **Sign-off** |
| **Date** | 2026-07-29 |
| **Repo** | `creezio/creezio` (kit + demobrand + console) |
| **Prérequis** | [PHASE-C2.md](PHASE-C2.md), [PHASE-V1.md](PHASE-V1.md) |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish marques** | **Non** |

---

## Objectif

Remplacer la demi-mesure V1 (scaffold `console.log`, console mémoire / tempdir,
PRD déterministe figé) par une **fabrique utilisable** : fichiers plugin réels,
sessions console persistées SQLite, `PrdDrafter` pluggable (LLM optionnel).

## Livrables

| # | Livrable | Statut |
|---|----------|--------|
| 1 | `buildPluginScaffoldFiles` C3 — `schema.sql`, `index.js` (`start`/KV), `api.js`, `mcp-tools.js`, `package.json` | ✅ |
| 2 | `PrdDrafter` + `createOptionalLlmPrdDrafter` (env `CREEZIO_PRD_LLM_*`, fallback déterministe) | ✅ |
| 3 | Factory async `submitIntention` / `answerClarifications` / `iterate` | ✅ |
| 4 | Console — SQLite `var/plugin-factory/console-core.db` + plugins persistés | ✅ |
| 5 | Demobrand — drafter opt. + E2E scaffold C3 | ✅ |
| 6 | `scripts/test-phase-c3.mjs` | ✅ |
| 7 | Ce fichier + matrice / README / CHANGELOG | ✅ |
| 8 | Push kit — **pas** de republish | ✅ |

## Contrat scaffold (fichiers générés)

| Fichier | Rôle |
|---------|------|
| `manifest.json` | `creezio.factory: "c3"` + pointeurs schema/api/mcp |
| `schema.sql` | `plugin_kv` + tables PRD `db_schema` |
| `index.js` | `start(ctx)`, `applySchema`, handlers KV |
| `api.js` | `createApiMount()` status + kv GET/POST |
| `mcp-tools.js` | `plugin.<id>.kv_list|kv_get|kv_set` |
| `package.json` / `README.md` / `PRD.md` | métadonnées |

## PrdDrafter

```ts
draftPrd?: PrdDrafter; // sync | async
// défaut déterministe ; LLM :
createOptionalLlmPrdDrafter({ complete? , apiKey?, apiUrl?, model? })
```

Variables : `CREEZIO_PRD_LLM_API_KEY`, `CREEZIO_PRD_LLM_API_URL`,
`CREEZIO_PRD_LLM_MODEL`. Sans clé → zéro réseau.

## Console persist

| Path | Contenu |
|------|---------|
| `var/plugin-factory/console-core.db` | Product Hub SQLite |
| `var/plugin-factory/plugins/<id>/` | Scaffold FS |

Overrides : `CREEZIO_PLUGIN_FACTORY_CORE_DB`, `CREEZIO_PLUGIN_FACTORY_PLUGINS_DIR`.

## Critères done

- [x] Scaffold ≠ stub `console.log` seul
- [x] Console sessions survivent au reopen SQLite
- [x] PrdDrafter injectable + LLM opt. non bloquant
- [x] Demobrand E2E verts (`test-phase-c3` + V1)
- [x] `npm test` / build kit
- [x] Push kit — 0 republish exe

## Suite

→ **C4** V2/V3 prod-ready (obs/automations SQLite console + vendor TF) ·
**C5** Fidu mounts · **C6** Certivan RTI (//).

## Verdict

**Phase C3 : TERMINÉE.**
