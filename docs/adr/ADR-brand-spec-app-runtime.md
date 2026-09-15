# ADR — BrandSpec + `@creezio/app-runtime`

## Statut

Accepté — implémenté (2026-08-01).

## Contexte

La factory `--from-prd` générait encore l'orchestration desktop (boot, HTTP
kernel, Meili, session IPC) dans `main.ts` de chaque marque. Toute évolution
OS obligeait à retoucher / régénérer les apps — risque de **jumeaux** et de
divergence.

## Décision

1. **BrandSpec** (`brand-spec/`, package `@creezio/brand-spec`) = SoT
   déclarative agent (YAML + modules + interview).
2. **`@creezio/app-runtime`** expose `startBrandDesktop` et
   `startBrandKernelHarness` — seule façade d'orchestration pour les marques
   from-prd / brand apply.
3. La marque fournit uniquement : `manifest`, `bootKernel`, `meiliFeed?`,
   `navItems?`.
4. CLI : `creezio brand init|doctor|apply|smoke`.

## Conséquences

- `main.ts` généré ≤ ~20 lignes, sans `listenBrandKernelHttp` local.
- Evolutions Meili/MCP/session se propagent via npm packages sans toucher le
  métier.
- `creezio new-app --from-prd` reste supporté (compat) ; le chemin nominal
  agent = BrandSpec → apply.

## Évolution (2026-08-01)

`desktopProfile: "full"` (défaut) compose dans `@creezio/app-runtime` :

- `composeBrandOs` → `createBrandHostRuntime` + `createBrandHostStack`
  (Hermes / n8n / tunnel / Meili / factory-reset, plugins feature-off)
- `listenBrandOsHttp` → api-kernel + `/mcp` + `/api/v1/os/*`
- tasks/mails/assistant via `createBrandKernel`

La marque **ne** contient **pas** `host-stack.ts`.  
`installBrandDesktopRuntime` (WebContentsView / splash / tray Next) reste
une couche supérieure à absorber ensuite derrière la même façade
(Next UI plane), sans jumeau marque.

## Non-objectifs

- Pas de questionnaire utilisateur final CHR dans le kit.
- Pas de copie du monolithe TF2 dans `apps/<marque>`.
