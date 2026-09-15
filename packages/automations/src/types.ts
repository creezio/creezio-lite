/**
 * Contrats automations **lifecycle** (vision V3 prototype).
 * Triggers = plugin/org/factory/obs — pas row-level Database.
 * Voir `@creezio/database` pour Admin Database / automations TF.
 */

export const AUTOMATION_TRIGGER_TYPES = [
  "plugin.installed",
  "plugin.uninstalled",
  "plugin.released",
  "org.data_changed",
  "factory.materialized",
  "observability.recorded",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_ACTION_TYPES = [
  "emit_observability",
  "log",
  "webhook",
  "n8n_tag_hint",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export type AutomationTriggerEvent = {
  type: AutomationTriggerType;
  orgId?: string | null;
  userId?: string | null;
  brandId?: string | null;
  pluginId?: string | null;
  /** Couche données touchée (core/brand/plugin). */
  dataLayer?: "core" | "brand" | "plugin" | null;
  payload?: Record<string, unknown>;
  at?: string;
};

export type AutomationAction =
  | {
      type: "emit_observability";
      action: string;
      meta?: Record<string, unknown>;
    }
  | {
      type: "log";
      level?: "info" | "warn";
      message?: string;
    }
  | {
      type: "webhook";
      /** URL absolue ; si absente → utilise adapter / env. */
      url?: string;
    }
  | {
      type: "n8n_tag_hint";
      /** plugin product / runtime id pour `pluginN8nTag`. */
      pluginProductId?: string;
    };

export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTriggerType;
  /** Filtre optionnel (pluginId / orgId / dataLayer). */
  filter?: {
    pluginId?: string;
    orgId?: string;
    dataLayer?: "core" | "brand" | "plugin";
  };
  actions: AutomationAction[];
  createdAt: string;
};

export type AutomationRunResult = {
  ruleId: string;
  trigger: AutomationTriggerType;
  ok: boolean;
  actions: Array<{
    type: AutomationActionType;
    ok: boolean;
    detail?: unknown;
    error?: string;
  }>;
  at: string;
};

export type AutomationEngineAdapters = {
  /** Émettre vers store observability (V2). */
  emitObservability?: (input: {
    action: string;
    orgId?: string | null;
    userId?: string | null;
    brandId?: string | null;
    pluginId?: string | null;
    meta?: Record<string, unknown>;
  }) => void;
  /** POST webhook (n8n / Hermes) — optionnel. */
  postWebhook?: (
    url: string,
    body: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status?: number; error?: string }>;
  /** Préfixe tag n8n marque (ex. demobrand-plugin:). */
  n8nTagPrefix?: string;
  /** Logger (tests / host). */
  log?: (level: "info" | "warn", message: string, meta?: unknown) => void;
  /** URL webhook par défaut (env N8N_AUTOMATION_WEBHOOK_URL). */
  defaultWebhookUrl?: string | null;
  /**
   * Persistance SQLite rules/runs (C4). Absent = mémoire (V3 legacy).
   */
  persist?: import("./sqlite-persist.js").AutomationPersistStore;
};
