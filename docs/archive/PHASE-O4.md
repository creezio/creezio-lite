# Phase O4 — `assistant-chat` générique → `@creezio/assistant`

| | |
|--|--|
| **Statut** | ✅ **Sign-off** (gates verts) |
| **Date** | 2026-07-30 |
| **Repo** | `creezio/creezio` (extract only) |
| **Prérequis** | [PHASE-O3p.md](PHASE-O3p.md) · plan [PLAN-O.md](PLAN-O.md) |
| **Baseline O3p kit tip** | `90f5573` / docs `17fd66b` |
| **Kit tip O4** | `f06577b` |
| **ARCHITECTURE_VERSION** | `"H6"` (inchangé) |
| **Republish** | Non (cutover = O4p) |

---

## Objectif

Orchestration chat SSE / tools / Work Hermes **générique** SoT dans
`@creezio/assistant` (`runtime/assistant-chat.ts`). Marques = métier via
`configureAssistantBrand` (auth, BrandTools, hermes work). **Pas de cutover**
(jumeaux `assistant-chat.ts` restent jusqu’à O4p).

**Façades / stubs = NON done.** Paperclip = mort.  
**Exclu kit** : panier / `add_to_cart` / `set_statut` / tasks-todos / catering.

---

## Inventaire

### Porté (gold TF orchestration)

| Module | Rôle |
|--------|------|
| `runtime/assistant-chat.ts` | `handleAssistantChat` + `maxDuration` · boucles OpenAI/Anthropic · SSE · Work Hermes · outils plateforme (surface/ui/supplier, explore, Meili, SQL) |

### Extension brand (O4)

| Hook | Rôle |
|------|------|
| `auth.getSession` | Remplace `@/lib/auth` |
| `tools.executeTool` | Métier (panier, statut, tasks/todos, accounting…) — `null` = pas moi |
| `tools.getEntity` / `entitySources` | `get_entity` + liens CRM |
| `tools.formatSearchHit` / `argsPreview` | Projection hits / preview args métier |
| `hermes.workSkills` / `sessionIdPrefix` | Skills + session Work (≠ `defaultSkills` n8n) |

### Hors kit (reste marque → O4p)

- Corps `add_to_cart` / `set_statut` / `create_task` / `list_tasks` / todos Fidu
- Contenu `prompts.ts` / `sql-tools.ts` / `sources.ts` marque
- Routes Hono brand (`routes/assistant.ts`) — mount chat mince en O4p
- Delete jumeaux `src/server/assistant-chat.ts` ×3

---

## Pattern injection (O4p)

```ts
import { configureAssistantBrand, handleAssistantChat } from "@creezio/assistant";

configureAssistantBrand({
  identity: { /* … */ },
  auth: { getSession },
  tools: {
    getEntity,
    entitySources,
    executeTool, // panier / statut / tasks…
    collectSourcesFromSqlRows,
  },
  hermes: {
    workSkills: ["tempoflow2-crm", "tempoflow2-crm-db"],
    sessionIdPrefix: "tf2-crm",
  },
  // prompts / appMap / db / meili …
});

// Mount ≤80 LOC :
assistantRoutes.post("/chat", (c) => handleAssistantChat(c.req.raw));
```

---

## Gates

```bash
cd /opt/docker/creezio
npm run build -w @creezio/assistant && node scripts/build-cjs.mjs
npm test   # incl. test-phase-o4
```

### Gate `test-phase-o4`

- `runtime/assistant-chat.ts` + exports `handleAssistantChat` / `maxDuration`
- Hooks auth / executeTool / workSkills / sessionIdPrefix
- Pas de `add_to_cart` impl / `getOrCreatePanier` / `/panier` / `tempoflow2-crm` hardcodé
- Jumeaux marques **encore présents** (anti-cutover prématuré)
- Paperclip mort
- PLAN-O O4 marqué livré

---

## Done

| Critère | Preuve |
|---------|--------|
| Orchestration chat dans kit | ~1850 LOC `assistant-chat.ts` |
| Extension auth / BrandTools / hermes work | `brand/types.ts` |
| Build assistant ESM+CJS | ✅ |
| `test-phase-o4` | ✅ |
| Cutover différé | O4p |
| Republish | Non |

---

## Suite

**O4p** — ✅ Cutover livré ([PHASE-O4p.md](PHASE-O4p.md)).
