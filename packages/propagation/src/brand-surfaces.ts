/**
 * Mapping packages kit → surfaces apps marques (contrat canal de mise à jour).
 *
 * Phase F : contrat uniquement — pas de modification des repos marques.
 * Phase G : les PR automatisables consomment ce mapping.
 */

import type { CreezioPackageName } from "./packages.js";

/** Surfaces code dans une app marque susceptibles d'être touchées par un bump kit. */
export type BrandSurfaceId =
  | "electron-main"
  | "electron-preload"
  | "product-hub"
  | "desktop-scripts"
  | "package-json-deps"
  | "electron-builder"
  | "next-host-env"
  | "factory-scaffold";

export type BrandSurface = {
  id: BrandSurfaceId;
  label: string;
  /** Chemins typiques (relatifs à la racine CRM / app) */
  typicalPaths: string[];
};

export const BRAND_SURFACES: readonly BrandSurface[] = [
  {
    id: "package-json-deps",
    label: "Dépendances @creezio/*",
    typicalPaths: ["package.json", "crm/package.json"],
  },
  {
    id: "electron-main",
    label: "Boot Electron / main",
    typicalPaths: ["crm/electron/main.ts", "src/electron/main.ts"],
  },
  {
    id: "electron-preload",
    label: "Preload / DesktopBridge",
    typicalPaths: [
      "crm/electron/preload-app.ts",
      "src/electron/preload.ts",
    ],
  },
  {
    id: "product-hub",
    label: "Product Hub / plugins",
    typicalPaths: [
      "crm/src/lib/plugin-product-hub.ts",
      "crm/electron/plugin-control-api.ts",
      "src/electron/product-hub-stub.ts",
    ],
  },
  {
    id: "desktop-scripts",
    label: "Scripts publish / remote-build",
    typicalPaths: [
      "crm/scripts/electron/publish-desktop.sh",
      "crm/scripts/electron/remote-build-win.sh",
      "crm/package.json#scripts",
    ],
  },
  {
    id: "electron-builder",
    label: "electron-builder / after-pack",
    typicalPaths: [
      "crm/electron-builder.yml",
      "crm/scripts/electron/after-pack.cjs",
      "crm/scripts/electron/build-builder-config.mjs",
    ],
  },
  {
    id: "next-host-env",
    label: "Env host Next / embeds",
    typicalPaths: ["crm/electron/host-stack.ts", "crm/src/lib/"],
  },
  {
    id: "factory-scaffold",
    label: "Sandbox factory (demobrand)",
    typicalPaths: ["apps/demobrand/"],
  },
] as const;

/**
 * Gates production — le kit ne connaît pas ses consommateurs (H11).
 * Les marques ciblées vivent dans `.github/propagate-brands.json`
 * (`configureBrandChannels`). Ce registre reste vide par défaut.
 */
export type ProductionBrandGate = string;

/** Id dans un rapport d'impact : sandbox kit + ids configurés. */
export type ImpactBrandId = string;

export const PRODUCTION_BRAND_GATES: Record<
  string,
  { gateId: "G1" | "G2" | "G3"; label: string; repoHint: string }
> = {};

/**
 * Surfaces touchées par package (direct). Les dépendants transitifs
 * élargissent via `impactForPackageBump`.
 */
export const PACKAGE_SURFACE_MAP: Record<
  CreezioPackageName,
  BrandSurfaceId[]
> = {
  "@creezio/brand-config": [
    "package-json-deps",
    "electron-builder",
    "electron-main",
    "desktop-scripts",
  ],
  "@creezio/shell": ["package-json-deps", "electron-preload", "electron-main"],
  "@creezio/platform-core": [
    "package-json-deps",
    "electron-main",
    "next-host-env",
  ],
  "@creezio/product-hub": ["package-json-deps", "product-hub", "electron-main"],
  "@creezio/api-kernel": ["package-json-deps", "next-host-env", "electron-main"],
  "@creezio/mcp-facade": ["package-json-deps", "next-host-env", "electron-main"],
  "@creezio/auth": ["package-json-deps", "electron-main", "electron-preload"],
  "@creezio/shell-ui": ["package-json-deps", "electron-main", "factory-scaffold"],
  "@creezio/assistant": ["package-json-deps", "electron-main"],
  "@creezio/tasks": ["package-json-deps", "next-host-env"],
  "@creezio/mails": ["package-json-deps", "next-host-env"],
  "@creezio/search": ["package-json-deps", "next-host-env"],
  "@creezio/host-runtime": [
    "package-json-deps",
    "electron-main",
    "next-host-env",
  ],
  "@creezio/electron-shell": [
    "package-json-deps",
    "electron-main",
    "product-hub",
    "next-host-env",
  ],
  "@creezio/desktop-tooling": [
    "package-json-deps",
    "desktop-scripts",
    "electron-builder",
  ],
  "@creezio/factory": ["factory-scaffold"],
  "@creezio/propagation": [],
};

/** Marques concernées par défaut pour un bump (hors canaux configurés). */
export function brandsImpactedBySurfaces(
  surfaces: BrandSurfaceId[],
): ImpactBrandId[] {
  if (surfaces.length === 0) return [];
  if (surfaces.includes("factory-scaffold")) return ["demobrand"];
  return [];
}

export function surfaceMeta(id: BrandSurfaceId): BrandSurface {
  const s = BRAND_SURFACES.find((x) => x.id === id);
  if (!s) throw new Error(`Surface inconnue: ${id}`);
  return s;
}
