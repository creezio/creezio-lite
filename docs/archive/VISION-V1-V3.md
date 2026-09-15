# Sign-off vision Notion — V1 → V3

| | |
|--|--|
| **Date** | 2026-07-29 |
| **Kit** | `/opt/docker/creezio` · `ARCHITECTURE_VERSION = "H6"` |
| **Prérequis** | D0–D6 terminés |
| **Republish marques** | Aucune (V1–V3 = kit + demobrand + console) |

---

## Synthèse

La vision Notion (architecture 29/07/2026) demandait trois capacités natives
au-delà du socle H6 / conso marques :

1. **Fabrique de plugins pilotée par conversation**
2. **Observabilité** (activité, usages, pilotage)
3. **Automations déclenchées par les changements de données**

Ces trois phases sont **livrées et testées** dans le kit, avec preuve
**demobrand** (et surfaces console ops). Hors scope volontaire respecté :
auto-promotion plugin→module, univers perso, cloud registry.

---

## V1 — Fabrique plugins conversationnelle

| Item | Statut |
|------|--------|
| Intention → impact → [clarif] → PRD → approve → scaffold → `openPlugin` | ✅ |
| Tools MCP space plugin + ACL L3 | ✅ |
| Itération `evolve` | ✅ |
| Console `/api/plugin-factory` | ✅ |
| Doc | [PHASE-V1.md](PHASE-V1.md) |

Package clé : `@creezio/product-hub` (`createConversationalPluginFactory`).

---

## V2 — Observabilité native

| Item | Statut |
|------|--------|
| Contrats `activity` / `plugin_usage` / `control_plane` | ✅ |
| Store SQLite **core** | ✅ |
| API demobrand + agrégats multi-org | ✅ |
| Console `/api/observability` | ✅ |
| Doc | [PHASE-V2.md](PHASE-V2.md) |

Package clé : `@creezio/observability`.

---

## V3 — Automations data-driven

| Item | Statut |
|------|--------|
| Triggers lifecycle + `org.data_changed` | ✅ |
| Actions emit_obs / log / webhook(opt) / n8n_tag_hint | ✅ |
| Preuve demobrand (factory + KV) | ✅ |
| n8n optionnel (skip sans URL) — marques intactes | ✅ |
| Doc | [PHASE-V3.md](PHASE-V3.md) |

Package clé : `@creezio/automations`.

---

## Chaîne E2E (demobrand)

```text
Chat intention
  → V1 factory materialize (DB plugin/<id>)
  → V2 control_plane install + activity
  → V3 plugin.installed / factory.materialized (+ tag n8n)
  → écriture données plugin
  → V3 org.data_changed → emit observability
  → V2 agrégats usage / org consultables
```

---

## Non-livré (volontaire)

- Auto-promotion plugin → module marque
- Univers perso hors org
- Cloud registry multi-tenant
- Republish TF / Fidu / Certivan pour V*

---

## Addendum C0 — demi-mesures (pas « 100 % produit »)

Sign-off V1–V3 = **socle kit + demobrand**. Correction C* : **C1–C7** ✅ ;
clôture docs + republish = **C8** (TF **0.10.32** · Certivan **0.1.15** ·
Fidu **0.1.57**). Voir [PHASE-C8.md](PHASE-C8.md) · [PHASE-C0.md](PHASE-C0.md).

---

## Verdict

**Vision V1–V3 : SIGNÉE** (socle). Correction produit : backlog **C\***.

---

## Amendement R0 — prototypes ≠ Source of Truth

> Intention OS Creezio (audit écart) : OS = commun ; marques = minimum métier ;
> extraire le réel TF — **ne pas inventer** de jumeaux.

| Prototype | Lecture corrigée |
|-----------|------------------|
| **V1** Fabrique | Prototype kit/demobrand — **≠** SoT fabrique produit final |
| **V2** Observabilité | Prototype kit — **≠** extraction complète vertical |
| **V3** `@creezio/automations` | **Lifecycle-only** (plugins/org/factory/obs) — **≠** automations **Database** row-level TempoFlow |

**Interdit** (R0) : nouvelles features plateforme inventées dans TF / Certivan / Fidu.
Extraction Database réelle = **R1** → `@creezio/database`.

Voir [PHASE-R0.md](PHASE-R0.md).
