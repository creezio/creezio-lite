# packages/automations — inventaire des fichiers

> Standard : [DOC-STANDARD.md](../../../docs/DOC-STANDARD.md) — maintenu via
> `node scripts/generate-files-md.mjs automations` (gate `test-phase-docs-freshness`).
> Colonne « Rôle » éditable à la main : la régénération la préserve.

## `src/`

| Fichier | Rôle |
|---|---|
| [`src/api-mount.ts`](../src/api-mount.ts) | Mount API automations — /api/v1/platform/automations/... |
| [`src/engine.ts`](../src/engine.ts) | Moteur automations — dispatch trigger → rules → actions. |
| [`src/index.ts`](../src/index.ts) | @creezio/automations — **lifecycle-only** (plugins / org / factory / obs). Prototype V3 — **pas** le moteur Admin Database row-level. SoT row-level = `@creezio/database` (extraction TempoFlow, R1). |
| [`src/match.ts`](../src/match.ts) | _(pas de cartouche JSDoc en tête — voir le code)_ |
| [`src/schema.ts`](../src/schema.ts) | Schema SQLite core — rules + runs automations (C4). |
| [`src/sqlite-persist.ts`](../src/sqlite-persist.ts) | Persistance SQLite rules/runs automations (C4). |
| [`src/types.ts`](../src/types.ts) | Contrats automations **lifecycle** (vision V3 prototype). Triggers = plugin/org/factory/obs — pas row-level Database. Voir `@creezio/database` pour Admin Database / automations TF. |
