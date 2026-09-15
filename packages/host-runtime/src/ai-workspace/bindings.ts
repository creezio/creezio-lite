/**
 * Injection marque pour ai-workspace (N2).
 * Partitions / cookies / titres fenêtre — zéro hardcode.
 */

import type { AiSupplierTabsFactory } from "./types.js";

export type AiWorkspaceHostBindings = {
  /** Ex. "TempoFlow" — titre fenêtres profil IA. */
  productName: string;
  /** Cookie session CRM (ex. brand_session). */
  sessionCookieName: string;
  /**
   * Slug partitions IA : `persist:{aiPartitionSlug}-<userId>`
   * et prefix supplier `{aiPartitionSlug}-<userId>`.
   * Ex. "tempoflow-ai" / "certivan-ai" / "fidu-ai".
   */
  aiPartitionSlug: string;
  /** Env opt-in partage sessions web owner (ex. TF2_AI_SHARE_WEB_SESSIONS). */
  shareWebSessionsEnvKey: string;
  /** Préfixe sessionStorage renderer (ex. brand-ai-workspace). */
  sessionStoragePrefix: string;
  preloadPath: (name: string) => string;
  createSupplierTabs: AiSupplierTabsFactory;
  reportCrash: (kind: string, detail: Record<string, unknown>) => void;
  instrumentWebContents: (
    wc: import("electron").WebContents,
    label: string,
  ) => void;
  /**
   * Hook vertical post-ensure (Hermes agent workspace / n8n API key…).
   * Best-effort, jamais bloquant.
   */
  onWorkspaceEnsured?: (aiUserId: string) => void | Promise<void>;
  /**
   * Exécuteur actions supplier marque (signature TF gold supplier-driver).
   * `(tabs, req, hooks?)` — open_tab / computer-use sur onglets IA.
   */
  executeSupplierAction?: (
    tabs: import("./types.js").AiSupplierTabsLike,
    req: import("./types.js").SupplierActionRequest,
    hooks?: {
      onTabOpened?: (info: {
        tabId: string;
        fournisseurId: number;
        url: string;
        title: string;
      }) => void;
    },
  ) => Promise<Record<string, unknown>>;
};

let bindings: AiWorkspaceHostBindings | null = null;

export function configureAiWorkspaceHost(
  next: AiWorkspaceHostBindings,
): void {
  bindings = next;
}

export function getAiWorkspaceHostBindings(): AiWorkspaceHostBindings {
  if (!bindings) {
    throw new Error(
      "AiWorkspaceHostBindings absents — appeler configureAiWorkspaceHost() au boot",
    );
  }
  return bindings;
}

export function tryGetAiWorkspaceHostBindings(): AiWorkspaceHostBindings | null {
  return bindings;
}

/** Tests uniquement. */
export function __resetAiWorkspaceHostBindingsForTests(): void {
  bindings = null;
}

export function aiShareWebSessions(): boolean {
  const b = getAiWorkspaceHostBindings();
  return (process.env[b.shareWebSessionsEnvKey] || "").trim() === "1";
}

export function aiPartitionName(userId: string): string {
  const b = getAiWorkspaceHostBindings();
  const safe = String(userId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return `persist:${b.aiPartitionSlug}-${safe || "unknown"}`;
}

export function aiSupplierPartitionPrefix(userId: string): string {
  const b = getAiWorkspaceHostBindings();
  const safe = String(userId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return `${b.aiPartitionSlug}-${safe || "unknown"}`;
}
