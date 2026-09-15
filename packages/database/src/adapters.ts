/**
 * Adapters host pour le moteur Database (plugins, branding webhook, n8n).
 * Évite tout import `@/` marque dans le package.
 */

export type DatabaseEngineAdapters = {
  /** Action `plugin_event` — no-op si absent. */
  emitPluginEvent?: (event: string, payload: Record<string, unknown>) => void;
  /** Base URL n8n pour actions `n8n_webhook` (sinon env `N8N_WEBHOOK_BASE_URL`). */
  n8nWebhookBaseUrl?: string | null;
};

export type DatabaseWebhookBrand = {
  userAgent?: string;
  signatureHeader?: string;
  /** Valeur header source pour n8n (ex. `database-automation`). */
  sourceHeader?: string;
  sourceHeaderValue?: string;
};

let engineAdapters: DatabaseEngineAdapters = {};
let webhookBrand: DatabaseWebhookBrand = {
  userAgent: "Creezio-Database-Automation/1.0",
  signatureHeader: "X-Creezio-Signature",
  sourceHeader: "X-Creezio-Source",
  sourceHeaderValue: "database-automation",
};

export function configureDatabaseEngine(adapters: DatabaseEngineAdapters): void {
  engineAdapters = { ...engineAdapters, ...adapters };
}

export function getDatabaseEngineAdapters(): DatabaseEngineAdapters {
  return engineAdapters;
}

export function configureDatabaseWebhookBrand(brand: DatabaseWebhookBrand): void {
  webhookBrand = { ...webhookBrand, ...brand };
}

export function getDatabaseWebhookBrand(): Required<
  Pick<
    DatabaseWebhookBrand,
    "userAgent" | "signatureHeader" | "sourceHeader" | "sourceHeaderValue"
  >
> {
  return {
    userAgent: webhookBrand.userAgent || "Creezio-Database-Automation/1.0",
    signatureHeader: webhookBrand.signatureHeader || "X-Creezio-Signature",
    sourceHeader: webhookBrand.sourceHeader || "X-Creezio-Source",
    sourceHeaderValue: webhookBrand.sourceHeaderValue || "database-automation",
  };
}
