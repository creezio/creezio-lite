/**
 * Contrat cutover stores plateforme (SoT kit core.db) — M8.
 * Zéro dual-write runtime. Extensions brand (ACL, kanban, PJ) hors SoT.
 */

export type PlatformDomain = "auth" | "assistant" | "tasks" | "mails";

export type PlatformBackend = "kit-core";

export type PlatformDomainContract = {
  domain: PlatformDomain;
  productBackend: PlatformBackend;
  kitRole: string;
  honoPath: string;
  kitMount?: string;
  status: "cutover";
  notes: string;
};

export const PLATFORM_STORES_CONTRACT: readonly PlatformDomainContract[] = [
  {
    domain: "auth",
    productBackend: "kit-core",
    kitRole: "SoT credentials creezio_users (+ sessions kit)",
    honoPath: "/api/v1/auth",
    status: "cutover",
    notes:
      "Login via kit ; cookie JWT produit inchangé ; users brand = ACL projection.",
  },
  {
    domain: "assistant",
    productBackend: "kit-core",
    kitRole: "SoT creezio_assistant_* (model/mode/user_id/sources)",
    honoPath: "/api/v1/assistant",
    status: "cutover",
    notes: "chat-db = façade kit ; migrate one-shot depuis assistant_chats.db.",
  },
  {
    domain: "tasks",
    productBackend: "kit-core",
    kitRole: "SoT creezio_platform_tasks (id partagé)",
    honoPath: "/api/v1/tasks",
    kitMount: "platform-tasks",
    status: "cutover",
    notes:
      "CRUD plateforme kit ; kanban/AI/Hermes/runs restent brand liés par task_id.",
  },
  {
    domain: "mails",
    productBackend: "kit-core",
    kitRole: "SoT index creezio_platform_mails (inbound+outbound)",
    honoPath: "/api/v1/email",
    kitMount: "platform-mails",
    status: "cutover",
    notes:
      "Inbox indexe kit ; PJ BLOB restent brand. Outbound = kit file-sink.",
  },
] as const;

/** Chemins historiques — plus actifs en runtime. */
export const DEPRECATED_SHADOW_ONLY = [
  "dual-write auth mirrorBrandLoginToKit (runtime)",
  "dual-write chat-db → kit",
  "tasks/mails brand-retained sans bridge kit",
] as const;
