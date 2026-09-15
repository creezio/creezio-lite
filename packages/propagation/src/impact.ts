/**
 * Dry-run d'impact : bump package → packages dépendants + surfaces + marques.
 */

import {
  brandsImpactedBySurfaces,
  PACKAGE_SURFACE_MAP,
  PRODUCTION_BRAND_GATES,
  surfaceMeta,
  type BrandSurfaceId,
  type ImpactBrandId,
  type ProductionBrandGate,
} from "./brand-surfaces.js";
import {
  assertKitPackage,
  getKitPackage,
  transitiveDependents,
  type CreezioPackageName,
} from "./packages.js";
import type { BumpKind } from "./semver-policy.js";

export type PackageBumpImpact = {
  packageName: CreezioPackageName;
  bumpKind: BumpKind;
  /** Packages workspace à rebuild (dépendants transitifs) */
  rebuildPackages: CreezioPackageName[];
  /** Surfaces app touchées (union package + dépendants) */
  surfaces: BrandSurfaceId[];
  surfaceDetails: Array<{
    id: BrandSurfaceId;
    label: string;
    typicalPaths: string[];
  }>;
  /** Marques concernées */
  brands: ImpactBrandId[];
  /** Gates Phase G à préparer si bascule */
  gates: Array<{
    gateId: "G1" | "G2" | "G3";
    brandId: ProductionBrandGate;
    label: string;
    checklistDoc: string;
  }>;
  /** Checklist gate minimale (texte) */
  gateChecklist: string[];
  /** Titre PR suggéré */
  suggestedPrTitle: string;
  summary: string;
};

function unionSurfaces(
  packages: CreezioPackageName[],
): BrandSurfaceId[] {
  const set = new Set<BrandSurfaceId>();
  for (const name of packages) {
    for (const s of PACKAGE_SURFACE_MAP[name] || []) set.add(s);
  }
  return [...set];
}

export function impactForPackageBump(input: {
  packageName: string;
  bumpKind?: BumpKind;
}): PackageBumpImpact {
  const packageName = assertKitPackage(input.packageName);
  const bumpKind = input.bumpKind ?? "minor";
  const meta = getKitPackage(packageName)!;
  const rebuildPackages = transitiveDependents(packageName);
  const surfaces = unionSurfaces([packageName, ...rebuildPackages]);
  const brands = brandsImpactedBySurfaces(surfaces);
  const gates = brands
    .filter((b): b is ProductionBrandGate => b in PRODUCTION_BRAND_GATES)
    .flatMap((brandId) => {
      const g = PRODUCTION_BRAND_GATES[brandId];
      if (!g) return [];
      return [
        {
          gateId: g.gateId,
          brandId,
          label: g.label,
          checklistDoc: "docs/archive/PHASE-F.md",
        },
      ];
    })
    .sort((a, b) => a.gateId.localeCompare(b.gateId));

  const gateChecklist = [
    "Ne pas basculer le runtime legacy (Phase F = préparation uniquement)",
    "Bump dépendances @creezio/* dans package.json de la marque",
    "npm install + npm run build + smoke Client+Serveur",
    "Remplacer modules dupliqués listés dans PLATFORM-VS-VERTICAL.md",
    "Valider feeds latest.yml Client (+ Serveur si buildServerArtifact)",
    "PR marque avec template kit-bump (voir .github/PULL_REQUEST_TEMPLATE/)",
    "Valider les gates documentées G1 → G2 → G3 (docs/PROPAGATION.md)",
  ];

  const surfaceDetails = surfaces.map((id) => {
    const s = surfaceMeta(id);
    return {
      id: s.id,
      label: s.label,
      typicalPaths: [...s.typicalPaths],
    };
  });

  const suggestedPrTitle = `chore(deps): bump ${packageName} (${bumpKind}) — kit creezio`;

  const summary = [
    `Bump ${packageName} [${bumpKind}]`,
    `→ rebuild: ${rebuildPackages.length ? rebuildPackages.join(", ") : "(aucun dépendant)"}`,
    `→ surfaces: ${surfaces.length ? surfaces.join(", ") : "(aucune surface marque)"}`,
    `→ marques: ${brands.length ? brands.join(", ") : "(aucune)"}`,
    `→ gates: ${gates.map((g) => g.gateId).join(", ") || "—"}`,
  ].join("\n");

  return {
    packageName,
    bumpKind,
    rebuildPackages,
    surfaces,
    surfaceDetails,
    brands,
    gates,
    gateChecklist,
    suggestedPrTitle,
    summary: `${meta.summary}\n${summary}`,
  };
}

export function formatImpactReport(impact: PackageBumpImpact): string {
  const lines: string[] = [
    `# Impact kit bump — ${impact.packageName} (${impact.bumpKind})`,
    "",
    impact.summary,
    "",
    "## Rebuild packages",
    ...(impact.rebuildPackages.length
      ? impact.rebuildPackages.map((p) => `- ${p}`)
      : ["- (aucun)"]),
    "",
    "## Surfaces",
    ...(impact.surfaceDetails.length
      ? impact.surfaceDetails.map(
          (s) =>
            `- **${s.id}** — ${s.label}\n  - paths: ${s.typicalPaths.join(", ")}`,
        )
      : ["- (aucune)"]),
    "",
    "## Marques / gates",
    ...(impact.gates.length
      ? impact.gates.map(
          (g) =>
            `- ${g.gateId} ${g.label} (\`${g.brandId}\`) → ${g.checklistDoc}`,
        )
      : ["- (aucune marque production)"]),
    "",
    "## Checklist gate",
    ...impact.gateChecklist.map((c) => `- [ ] ${c}`),
    "",
    `## PR suggérée`,
    `\`${impact.suggestedPrTitle}\``,
    "",
  ];
  return lines.join("\n");
}
