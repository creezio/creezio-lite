# Phase O11 hotfix — Vendor restore (pin sans build = interdit)

| | |
|--|--|
| **Statut** | ✅ Restauré |
| **Date** | 2026-07-30 |
| **Incident** | Audit pin `kitSha=91ef2ec` : sync vendor depuis `dist/` kit **non rebuildé** → wipe mounts HTTP (~187 fichiers) ; `create*` → `undefined` |
| **Kit tip** | `91ef2ec` (+ `npm run build:packages` local ; `dist/` gitignoré) |

## Règle

**Pin `kitSha` / sync vendor SANS `npm run build:packages` réussi = INTERDIT.**

Le SHA tip ne suffit pas : le vendor consomme les **artefacts** `dist/` + `dist-cjs/`.
Sans rebuild, `sync-creezio-vendor.sh` copie un arbre stale/vide et **écrase** le vendor marque.

## Fix appliqué

1. `cd /opt/docker/creezio && npm install && npm run build:packages`
2. Preuve kit : `createAuthRoutes`, `createAssistantRoutes`, `createEmailInboxRoutes`, `createTasksHonoRoutes`, `createPluginProductsRoutes`, `mountApiKernelOnHono`, `createMcpOAuthRoutes` = `function`
3. Re-sync liste complète ×3 (TF / Certivan / Fidu) via `scripts/sync-creezio-vendor.sh`
4. Garde ajoutée dans `scripts/sync-creezio-vendor.sh` : assert symboles critiques **avant** `rm -rf DEST`

## Preuve marques

| Marque | Vendor | route/hono files | kitSha SYNC | SHA push |
|--------|--------|------------------|-------------|----------|
| TempoFlow | `tempoflow2/crm/vendor/creezio` | 96 | `91ef2ec` | `b0dada4` |
| Certivan | `certivan-app/crm/vendor/creezio` | 96 | `91ef2ec` | `bcafffc` |
| Fidu | `fidu/crm/vendor/creezio` | 96 | `91ef2ec` | `e791eea` |

`require(dist-cjs).create*` / `mountApiKernelOnHono` / `createMcpOAuthRoutes` = `function` ×3.

Kit hotfix (garde sync + cette note) : `41bfb44` (sur tip post-`91ef2ec`).
