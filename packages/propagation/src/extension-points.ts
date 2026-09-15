/**
 * Points d'extension — descente (cœur→métier→org→user) et remontée
 * (plugin terrain→review→kit). Notion §3–4.
 *
 * Contrats purs : les apps / console s'y branchent en Phase G.
 */

import type { PropagationLevel } from "./org-plugin-registry.js";

export type PropagationDirection = "downward" | "upward";

export type ExtensionPointId =
  /* Descente */
  | "kit.release.published"
  | "vertical.deps.bumped"
  | "org.feature.rolled_out"
  | "user.plugin.entitled"
  /* Remontée */
  | "user.plugin.created"
  | "org.plugin.reviewed"
  | "vertical.plugin.promoted"
  | "kit.plugin.accepted";

export type ExtensionHookPayload = {
  pointId: ExtensionPointId;
  direction: PropagationDirection;
  levelFrom: PropagationLevel;
  levelTo: PropagationLevel;
  brandId?: string;
  orgId?: string;
  userId?: string;
  pluginId?: string;
  packageName?: string;
  version?: string;
  meta?: Record<string, unknown>;
  at: string;
};

export type ExtensionHookHandler = (
  payload: ExtensionHookPayload,
) => void | Promise<void>;

export type ExtensionPointDef = {
  id: ExtensionPointId;
  direction: PropagationDirection;
  levelFrom: PropagationLevel;
  levelTo: PropagationLevel;
  label: string;
  description: string;
};

export const EXTENSION_POINTS: readonly ExtensionPointDef[] = [
  {
    id: "kit.release.published",
    direction: "downward",
    levelFrom: "L1-core",
    levelTo: "L2-vertical",
    label: "Kit publié → vertical",
    description:
      "Un package @creezio/* est versionné ; canaux PR marques s'ouvrent",
  },
  {
    id: "vertical.deps.bumped",
    direction: "downward",
    levelFrom: "L2-vertical",
    levelTo: "L3-org",
    label: "Vertical → orgs",
    description:
      "Le produit métier diffuse Client/Serveur vers les organisations",
  },
  {
    id: "org.feature.rolled_out",
    direction: "downward",
    levelFrom: "L3-org",
    levelTo: "L4-user",
    label: "Org → utilisateurs",
    description:
      "ACL granulaire : individu / groupe / org entière (Product Hub L3/L4)",
  },
  {
    id: "user.plugin.entitled",
    direction: "downward",
    levelFrom: "L4-user",
    levelTo: "L4-user",
    label: "Entitlement user",
    description: "Activation effective du plugin / feature pour l'utilisateur",
  },
  {
    id: "user.plugin.created",
    direction: "upward",
    levelFrom: "L4-user",
    levelTo: "L3-org",
    label: "Création terrain",
    description: "Plugin créé par un user ; org informée (registre L3)",
  },
  {
    id: "org.plugin.reviewed",
    direction: "upward",
    levelFrom: "L3-org",
    levelTo: "L2-vertical",
    label: "Review org → vertical",
    description: "L'org valide et propose le module au produit métier",
  },
  {
    id: "vertical.plugin.promoted",
    direction: "upward",
    levelFrom: "L2-vertical",
    levelTo: "L1-core",
    label: "Promotion verticale → kit",
    description:
      "Le vertical intègre le module ; candidat à native Creezio (review)",
  },
  {
    id: "kit.plugin.accepted",
    direction: "upward",
    levelFrom: "L1-core",
    levelTo: "L1-core",
    label: "Accepté dans le kit",
    description:
      "Fonctionnalité native @creezio/* ; rediffusion descendante possible",
  },
] as const;

export function getExtensionPoint(
  id: ExtensionPointId,
): ExtensionPointDef | undefined {
  return EXTENSION_POINTS.find((p) => p.id === id);
}

/**
 * Bus d'hooks in-process (console, tests, dry-run).
 * Les apps marques brancheront leurs adapters en Phase G.
 */
export type ExtensionHookBus = {
  on(pointId: ExtensionPointId, handler: ExtensionHookHandler): () => void;
  emit(payload: Omit<ExtensionHookPayload, "at"> & { at?: string }): Promise<void>;
  listPoints(): readonly ExtensionPointDef[];
  history(): ExtensionHookPayload[];
};

export function createExtensionHookBus(options?: {
  /** Conserver l'historique (défaut true, max 200) */
  keepHistory?: boolean;
  maxHistory?: number;
}): ExtensionHookBus {
  const keepHistory = options?.keepHistory !== false;
  const maxHistory = options?.maxHistory ?? 200;
  const handlers = new Map<ExtensionPointId, Set<ExtensionHookHandler>>();
  const hist: ExtensionHookPayload[] = [];

  return {
    on(pointId, handler) {
      let set = handlers.get(pointId);
      if (!set) {
        set = new Set();
        handlers.set(pointId, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
      };
    },
    async emit(partial) {
      const def = getExtensionPoint(partial.pointId);
      if (!def) throw new Error(`Extension point inconnu: ${partial.pointId}`);
      const payload: ExtensionHookPayload = {
        ...partial,
        direction: partial.direction || def.direction,
        levelFrom: partial.levelFrom || def.levelFrom,
        levelTo: partial.levelTo || def.levelTo,
        at: partial.at || new Date().toISOString(),
      };
      if (keepHistory) {
        hist.push(payload);
        while (hist.length > maxHistory) hist.shift();
      }
      const set = handlers.get(payload.pointId);
      if (!set) return;
      for (const h of set) await h(payload);
    },
    listPoints() {
      return EXTENSION_POINTS;
    },
    history() {
      return [...hist];
    },
  };
}

/** Chaîne descendante ordonnée (Notion §3). */
export const DOWNWARD_CHAIN: ExtensionPointId[] = [
  "kit.release.published",
  "vertical.deps.bumped",
  "org.feature.rolled_out",
  "user.plugin.entitled",
];

/** Chaîne remontante ordonnée (Notion §4). */
export const UPWARD_CHAIN: ExtensionPointId[] = [
  "user.plugin.created",
  "org.plugin.reviewed",
  "vertical.plugin.promoted",
  "kit.plugin.accepted",
];
