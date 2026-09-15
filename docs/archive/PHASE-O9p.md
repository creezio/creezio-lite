# Phase O9p — Cutover jumeaux lib/UI (TF → CV → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-O9.md](PHASE-O9.md) · [ADR-no-brand-domain-in-native-packages.md](ADR-no-brand-domain-in-native-packages.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Kit tip O9p** | `ae00f6e` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (O11) |

### SHAs marques (gold O9p)

| Marque | SHA |
|--------|-----|
| TempoFlow | `a78cada` |
| Certivan | `49480ba` |
| Fidu | `28968f8` |

---

## Objectif

**0** jumeaux lib/UI plateforme locaux ×3 ; imports `@creezio/shell-ui` /
`@creezio/shell-ui/ui` / `@creezio/tasks/ui`. Labels métier via
`configure*` marque (TF « Fournisseur » = config, kit = « Site externe »).
Vendor liste complète. **Paperclip = mort**. **Façades = NON done**.

---

## Travaux

1. Kit build-ready (sonner, hermes types, desktop re-exports, filtres
   `skipRefresh`, `ApiKeysSettings.users` alias, `n8n onProgress`).
2. Cutover TF → CV → Fidu : sync vendor 16 packages ; delete jumeaux O9 ;
   boot `configure-shell-ui-client` ; hosts tab-workspace / global-search ;
   `transpilePackages` shell-ui+tasks.
3. Wire debts : `siteId` dual-compat ; storage key / list-toolbar /
   fullscreen paths injectés marque ; cookies `persist:fournisseur-*` inchangés.

---

## Gates

```bash
# ×3
bash scripts/electron/sync-creezio-vendor.sh
npm run build && npm run electron:compile

cd /opt/docker/creezio && npm test   # incl. test-phase-o9p
```

### Gate `test-phase-o9p`

- Jumeaux absents ×3 (libs + primitives + settings + workspace chrome)
- Boot `configure-shell-ui-client` + imports kit
- Vendor `shell-ui/ui` + `tasks/ui` + `SYNC.kitSha`
- 0 Paperclip ; ADR site externe respecté dans kit
- PLAN-O O9p ✅

---

## Done

| Critère | Preuve |
|---------|--------|
| Deletes ×3 + vendor complet | ✅ |
| build + electron:compile ×3 | ✅ |
| `test-phase-o9p` | ✅ |
| Façades / Paperclip / domaine TF natif | ❌ absents |

## Suite

**O10** — Polish SYNC + matrice + allowlists.
