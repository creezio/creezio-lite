# Phase O3p — Cutover jumeaux Electron (TF → CV → Fidu)

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (+ marques) |
| **Prérequis** | [PHASE-O3.md](PHASE-O3.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O3 kit tip** | `0b7daec` / docs `40003a9` |
| **Kit tip O3p** | `90f5573` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (wiring electron, pas de packing) |

### SHAs marques (gold O3p)

| Marque | SHA |
|--------|-----|
| TempoFlow | `c8fb984` |
| Certivan | `3499243` |
| Fidu | `69f0a5b` |

---

## Objectif

Jumeaux Electron plateforme **absents** ×3 ; imports `@creezio/electron-shell`
/ `@creezio/platform-core` directs + brand opts inline (pas de façades
fichier). Vendor sync liste complète (kit tip O3). **Paperclip = mort**.

---

## Deletes (liste O3)

| Fichier | TF | CV | Fidu |
|---------|----|----|------|
| `n8n-api-key.ts` | ✅ | ✅ | déjà absent |
| `agent-isolation.ts` | ✅ | ✅ | déjà absent |
| `oauth-loopback.ts` | ✅ | ✅ | ✅ |
| `assistant-chrome.ts` | ✅ | ✅ | ✅ |
| `profile-picker-html.ts` | ✅ | ✅ | ✅ |
| `factory-reset.ts` | ✅ | ✅ | ✅ |
| `licensing.ts` | ✅ | ✅ | ✅ |
| `installer-prefs.ts` | ✅ | ✅ | ✅ |
| `error-page-html.ts` | ✅ | ✅ | ✅ |
| `hermes-crm-key.ts` | ✅ | ✅ | ✅ |
| `ensure-hermes-crm-key-db.ts` | ✅ | ✅ | déjà absent |

**Hors scope** : `paths` / `connection-profile` / `recovery-key` / `ua` /
`fake-cursor` / `host-stack` / supplier TF (O7 / smokes locaux).

---

## Wiring

| Surface | SoT | Brand opts |
|---------|-----|------------|
| n8n API key / agent | `@creezio/electron-shell` | `*_N8N_API_KEY_BRAND` / `*_N8N_AGENT_BRAND` |
| oauth / assistant chrome / picker / error | electron-shell | inline `main.ts` |
| licensing / installer-prefs | `@creezio/platform-core` | `LicensingOptions` |
| factory-reset wipe | electron-shell + platform-core | `PathsContext` via host-stack |
| hermes CRM key | electron-shell | `*_HERMES_CRM_BRAND` + paths ; **Fidu** bridge CRM-only |

---

## Gates

```bash
# ×3 marques (TF → CV → Fidu)
bash scripts/electron/sync-creezio-vendor.sh   # liste complète
npm run electron:compile
npm run test:recovery-key
npm run test:connection-profile
npm run test:n8n-api-key   # TF+CV (absent Fidu)
# Fidu : npm run test:fidu

# Kit
cd /opt/docker/creezio && npm test   # incl. test-phase-o3p
```

### Gate `test-phase-o3p`

- Absents ×3 : liste deletes O3 (Fidu : n8n/agent/ensure déjà N/A)
- Présents ×3 : `host-runtime-ctx.ts`, imports kit dans `main.ts`
- Paperclip mort
- PLAN-O O3p livré + SHAs marques

---

## Done

| Critère | Preuve |
|---------|--------|
| Cutover TF+CV+Fidu poussé | SHAs ci-dessus |
| 0 jumeaux O3 ×3 | ✅ |
| Vendor kit tip O3 | ✅ `40003a9` |
| `test-phase-o3p` | ✅ |
| Republish packing | Non (différé) |

---

## Suite

**O4** — `assistant-chat` générique → `@creezio/assistant` (kit only).
