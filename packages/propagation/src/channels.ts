/**
 * Contrat « kit bump → PR automatisable par marque ».
 *
 * Phase F livre le contrat + templates ; l'automation GitHub Actions
 * côté repos marques est Phase G (gated).
 *
 * H7 — canaux DATA-DRIVEN : les canaux marque sont dérivés d'une config
 * (défaut : registre production de brand-surfaces) ou injectés via
 * `configureBrandChannels`. Plus aucun nom de marque ni chemin absolu
 * n'est énuméré dans ce module (ni dans ses types).
 */

import { PRODUCTION_BRAND_GATES } from "./brand-surfaces.js";
import type { PackageBumpImpact } from "./impact.js";
import type { BumpKind } from "./semver-policy.js";

/** Id de canal — libre (H7) ; canaux marque = `brand-pr-<brandId>`. */
export type UpdateChannelId = string;

export type UpdateChannel = {
  id: UpdateChannelId;
  label: string;
  description: string;
  /** Repo / chemin cible (hint, pas d'écriture Phase F) */
  targetHint: string;
  automatable: boolean;
  /** Doc gate associée */
  gateDoc?: string;
};

/** Canal PR d'une marque — convention `brand-pr-<brandId>`. */
export function brandPrChannelId(brandId: string): UpdateChannelId {
  return `brand-pr-${brandId}`;
}

/**
 * Config d'un canal PR marque — fournie par la config, jamais câblée ici.
 * `brandId` est un id LIBRE (P3.b) : les marques déployées vivent hors du
 * registre kit déprécié (`BrandId` brand-config) — la config data-driven
 * (ex. `.github/propagate-brands.json` du repo kit) est la SoT des
 * consommateurs ciblés par le rollout npm.
 */
export type BrandChannelConfig = {
  brandId: string;
  label: string;
  /** Repo / chemin cible (hint). */
  targetHint: string;
  gateId?: string;
  gateDoc?: string;
};

function defaultBrandChannelConfigs(): BrandChannelConfig[] {
  // Vide par défaut — SoT = `.github/propagate-brands.json` via
  // `configureBrandChannels` (le kit ne connaît pas ses consommateurs).
  return Object.entries(PRODUCTION_BRAND_GATES).map(([brandId, g]) => ({
    brandId,
    label: g.label,
    targetHint: g.repoHint,
    gateId: g.gateId,
    gateDoc: g.gateId ? `docs/archive/PHASE-F.md` : undefined,
  }));
}

let brandChannelConfigs: BrandChannelConfig[] = defaultBrandChannelConfigs();

/** Injecte les canaux PR marque depuis une config (data-driven, H7). */
export function configureBrandChannels(configs: BrandChannelConfig[]): void {
  brandChannelConfigs = [...configs];
}

export function resetBrandChannelsForTests(): void {
  brandChannelConfigs = defaultBrandChannelConfigs();
}

function brandChannel(cfg: BrandChannelConfig): UpdateChannel {
  return {
    id: brandPrChannelId(cfg.brandId),
    label: cfg.gateId ? `PR ${cfg.label} (${cfg.gateId})` : `PR ${cfg.label}`,
    description:
      "PR automatisable : bump deps @creezio/* + checklist gate",
    targetHint: cfg.targetHint,
    automatable: true,
    gateDoc: cfg.gateDoc,
  };
}

const BASE_CHANNELS: readonly UpdateChannel[] = [
  {
    id: "kit-workspace",
    label: "Kit creezio/creezio",
    description:
      "Bump semver packages + CHANGELOG + rebuild workspace (script kit:version)",
    targetHint: "https://github.com/creezio/creezio",
    automatable: true,
  },
  {
    id: brandPrChannelId("demobrand"),
    label: "Sandbox DemoBrand",
    description: "Mise à jour locale apps/demobrand dans le kit",
    targetHint: "apps/demobrand",
    automatable: true,
  },
  {
    id: "console-ops",
    label: "Console ops",
    description: "Affiche versions kit locales + liens gates (lecture)",
    targetHint: "apps/console",
    automatable: false,
  },
] as const;

/** Canaux courants : base kit + canaux marque configurés. */
export function listUpdateChannels(): UpdateChannel[] {
  return [...BASE_CHANNELS, ...brandChannelConfigs.map(brandChannel)];
}

/**
 * @deprecated H7 — snapshot au chargement du module ; utiliser
 * `listUpdateChannels()` (reflète `configureBrandChannels`). Retrait au
 * prochain bump d'architecture.
 */
export const UPDATE_CHANNELS: readonly UpdateChannel[] = listUpdateChannels();

export type BrandPrPayload = {
  brandId: string;
  channelId: UpdateChannelId;
  title: string;
  bodyMarkdown: string;
  packageName: string;
  bumpKind: BumpKind;
  gateDoc?: string;
};

/**
 * Génère le payload PR marque à partir d'un impact (dry-run / automation
 * P3.b — workflow `propagate.yml`). Une marque est servie si l'impact la
 * liste (registre legacy) OU si elle a un canal configuré
 * (`configureBrandChannels`) et que le bump touche au moins une marque —
 * les canaux configurés SONT la liste des consommateurs déployés.
 */
export function buildBrandPrPayload(
  impact: PackageBumpImpact,
  brandId: string,
): BrandPrPayload | null {
  const factoryOnly =
    impact.surfaces.length > 0 &&
    impact.surfaces.every((s) => s === "factory-scaffold");
  const viaSandbox = impact.brands.includes(brandId);
  const viaConfiguredChannel =
    impact.surfaces.length > 0 &&
    !factoryOnly &&
    brandChannelConfigs.some((c) => c.brandId === brandId);
  if (!viaSandbox && !viaConfiguredChannel) return null;
  const channelId = brandPrChannelId(brandId);

  const gate = impact.gates.find((g) => g.brandId === brandId);
  const bodyMarkdown = [
    `## Kit bump — ${impact.packageName}`,
    "",
    `- **Bump** : \`${impact.bumpKind}\``,
    `- **Canal** : \`${channelId}\``,
    gate ? `- **Gate** : ${gate.gateId} — voir \`${gate.checklistDoc}\`` : "",
    "",
    "### Surfaces touchées",
    ...impact.surfaceDetails.map(
      (s) => `- ${s.label} (\`${s.id}\`) — ${s.typicalPaths.join(", ")}`,
    ),
    "",
    "### Rebuild packages kit",
    ...impact.rebuildPackages.map((p) => `- \`${p}\``),
    "",
    "### Checklist (ne pas skipper)",
    ...impact.gateChecklist.map((c) => `- [ ] ${c}`),
    "",
    "> Généré par `@creezio/propagation` — Phase F contrat ; exécution bascule = Phase G.",
    "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return {
    brandId,
    channelId,
    title: `${impact.suggestedPrTitle} [${brandId}]`,
    bodyMarkdown,
    packageName: impact.packageName,
    bumpKind: impact.bumpKind,
    gateDoc: gate?.checklistDoc,
  };
}

/**
 * Payloads PR pour toutes les marques servies : union des marques impactées
 * (registre legacy) et des canaux configurés (data-driven, P3.b). Bump sans
 * aucune marque impactée (ex. propagation patch) → [] (personne n'est servi).
 */
export function buildAllBrandPrPayloads(
  impact: PackageBumpImpact,
): BrandPrPayload[] {
  if (impact.surfaces.length === 0) return [];
  const factoryOnly = impact.surfaces.every((s) => s === "factory-scaffold");
  const ids = new Set<string>([
    ...impact.brands,
    ...(factoryOnly ? [] : brandChannelConfigs.map((c) => c.brandId)),
  ]);
  return [...ids]
    .sort()
    .map((b) => buildBrandPrPayload(impact, b))
    .filter((p): p is BrandPrPayload => p !== null);
}
