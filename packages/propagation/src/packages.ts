/**
 * Catalogue des packages @creezio/* et graphe de dépendances internes.
 * Source de vérité pour impacts de bump et canaux de mise à jour.
 */

export type CreezioPackageName =
  | "@creezio/brand-config"
  | "@creezio/shell"
  | "@creezio/platform-core"
  | "@creezio/product-hub"
  | "@creezio/search"
  | "@creezio/host-runtime"
  | "@creezio/electron-shell"
  | "@creezio/desktop-tooling"
  | "@creezio/factory"
  | "@creezio/propagation"
  | "@creezio/api-kernel"
  | "@creezio/mcp-facade"
  | "@creezio/auth"
  | "@creezio/shell-ui"
  | "@creezio/assistant"
  | "@creezio/tasks"
  | "@creezio/mails";

export type KitPackageMeta = {
  name: CreezioPackageName;
  /** Dossier sous packages/ */
  dir: string;
  /** Description courte (console / release notes) */
  summary: string;
  /** Dépendances workspace @creezio/* (directes) */
  dependsOn: CreezioPackageName[];
  /** Couche architecture Notion §2 */
  layer: "L1-core" | "L1-tooling" | "L1-ops";
};

export const KIT_PACKAGES: readonly KitPackageMeta[] = [
  {
    name: "@creezio/brand-config",
    dir: "brand-config",
    summary: "AppManifest, createAppManifest, manifests marques",
    dependsOn: [],
    layer: "L1-core",
  },
  {
    name: "@creezio/shell",
    dir: "shell",
    summary: "DesktopBridge, createDesktopApi (preload/IPC)",
    dependsOn: ["@creezio/brand-config"],
    layer: "L1-core",
  },
  {
    name: "@creezio/platform-core",
    dir: "platform-core",
    summary: "paths, sqlite core/brand/plugin, app-kind, connection, plugins purs",
    dependsOn: ["@creezio/brand-config"],
    layer: "L1-core",
  },
  {
    name: "@creezio/product-hub",
    dir: "product-hub",
    summary: "Product Hub (lifecycle, PRD, ACL, control plane, sqlite core store)",
    dependsOn: ["@creezio/brand-config", "@creezio/platform-core"],
    layer: "L1-core",
  },
  {
    name: "@creezio/api-kernel",
    dir: "api-kernel",
    summary: "Façade HTTP /api/v1 cœur + montage modules/plugins",
    dependsOn: ["@creezio/brand-config", "@creezio/platform-core"],
    layer: "L1-core",
  },
  {
    name: "@creezio/mcp-facade",
    dir: "mcp-facade",
    summary: "MCP d'app unique — tools cœur + discoverTools",
    dependsOn: ["@creezio/api-kernel", "@creezio/platform-core"],
    layer: "L1-core",
  },
  {
    name: "@creezio/auth",
    dir: "auth",
    summary: "Session / login / logout / recovery (sqlite core)",
    dependsOn: ["@creezio/platform-core", "@creezio/shell"],
    layer: "L1-core",
  },
  {
    name: "@creezio/shell-ui",
    dir: "shell-ui",
    summary: "Nav Creezio + slots métier typés",
    dependsOn: ["@creezio/brand-config", "@creezio/shell"],
    layer: "L1-core",
  },
  {
    name: "@creezio/assistant",
    dir: "assistant",
    summary: "Chat / assistant plateforme (store + contrats IPC)",
    dependsOn: ["@creezio/platform-core", "@creezio/shell"],
    layer: "L1-core",
  },
  {
    name: "@creezio/tasks",
    dir: "tasks",
    summary: "Tâches natives plateforme (hors Product Hub)",
    dependsOn: [
      "@creezio/api-kernel",
      "@creezio/auth",
      "@creezio/platform-core",
    ],
    layer: "L1-core",
  },
  {
    name: "@creezio/mails",
    dir: "mails",
    summary: "Mails natifs plateforme + slot providers",
    dependsOn: [
      "@creezio/api-kernel",
      "@creezio/auth",
      "@creezio/platform-core",
    ],
    layer: "L1-core",
  },
  {
    name: "@creezio/search",
    dir: "search",
    summary: "Sous-domaine Meili (feed, indexation, browse, cohérence, launcher)",
    dependsOn: ["@creezio/platform-core"],
    layer: "L1-core",
  },
  {
    name: "@creezio/host-runtime",
    dir: "host-runtime",
    summary:
      "Host runtime Node pur (hermes, n8n, tunnel, plugins, sandbox, server-launcher)",
    dependsOn: [
      "@creezio/brand-config",
      "@creezio/platform-core",
      "@creezio/product-hub",
      "@creezio/search",
    ],
    layer: "L1-core",
  },
  {
    name: "@creezio/electron-shell",
    dir: "electron-shell",
    summary:
      "Desktop Electron (boot, fenêtres, updater, tray, splash) + ré-exports compat host",
    dependsOn: [
      "@creezio/brand-config",
      "@creezio/shell",
      "@creezio/platform-core",
      "@creezio/product-hub",
      "@creezio/search",
      "@creezio/host-runtime",
    ],
    layer: "L1-core",
  },
  {
    name: "@creezio/desktop-tooling",
    dir: "desktop-tooling",
    summary: "publish-desktop, remote-build-win, after-pack, build-status",
    dependsOn: ["@creezio/brand-config"],
    layer: "L1-tooling",
  },
  {
    name: "@creezio/factory",
    dir: "factory",
    summary: "creezio new-app — scaffold marque sandbox",
    dependsOn: ["@creezio/brand-config"],
    layer: "L1-tooling",
  },
  {
    name: "@creezio/propagation",
    dir: "propagation",
    summary: "Semver, impacts, canaux PR, registre L3, extension points",
    dependsOn: ["@creezio/brand-config"],
    layer: "L1-ops",
  },
] as const;

export const KIT_PACKAGE_NAMES: readonly CreezioPackageName[] =
  KIT_PACKAGES.map((p) => p.name);

export function getKitPackage(
  name: string,
): KitPackageMeta | undefined {
  return KIT_PACKAGES.find((p) => p.name === name);
}

export function assertKitPackage(name: string): CreezioPackageName {
  const meta = getKitPackage(name);
  if (!meta) {
    throw new Error(
      `Package inconnu: ${name}. Attendu l'un de: ${KIT_PACKAGE_NAMES.join(", ")}`,
    );
  }
  return meta.name;
}

/**
 * Consommateurs workspace directs d'un package (inverse de dependsOn).
 */
export function directDependents(
  name: CreezioPackageName,
): CreezioPackageName[] {
  return KIT_PACKAGES.filter((p) => p.dependsOn.includes(name)).map(
    (p) => p.name,
  );
}

/**
 * Fermeture transitive des dépendants (package bumpé → tout ce qui doit
 * être rebuild / potentiellement re-bumpé en cascade).
 */
export function transitiveDependents(
  name: CreezioPackageName,
): CreezioPackageName[] {
  const out: CreezioPackageName[] = [];
  const seen = new Set<CreezioPackageName>();
  const queue: CreezioPackageName[] = [name];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const dep of directDependents(cur)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      out.push(dep);
      queue.push(dep);
    }
  }
  return out;
}
