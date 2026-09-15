/** Types partagés cockpit UI (contrats API /api/v1/cockpit/*). */

export type CockpitTabId =
  | "sante"
  | "ia"
  | "acces"
  | "logs"
  | "plugins"
  | "invitations";

export type CockpitServiceHealth = {
  configured: boolean;
  ok: boolean;
  url: string | null;
  error?: string;
};

export type CockpitHealth = {
  generated_at: string;
  next: { ok: boolean; db: boolean; db_path: string };
  meili: CockpitServiceHealth;
  hermes: CockpitServiceHealth;
  n8n: CockpitServiceHealth;
  tunnel: { configured: boolean; public_url: string | null };
  ai_collaborators: number;
};

export type CockpitUser = {
  id: string;
  username: string;
  role: "owner" | "collaborator";
  kind: "human" | "ai";
  active: boolean;
};

export type CockpitAiActivity = {
  running: boolean;
  taskTitle: string | null;
};

export type CockpitAclPlugin = {
  plugin_id: string;
  name: string;
  user_ids: string[];
};

export type CockpitDesktopSessions = {
  bridges: Array<{
    userId: string;
    online?: boolean;
    bridgeConnected?: boolean;
  }>;
  users: Array<{ userId: string; online?: boolean }>;
};

export type CockpitRequestLogEntry = {
  id: string;
  ts: string;
  method: string;
  path: string;
  status: number;
  source?: string;
  detail?: { error?: string; ok?: boolean };
};

export type CockpitTunnelLive = {
  running: boolean;
  url: string | null;
  hostname: string | null;
};

export const DEFAULT_COCKPIT_TABS: readonly CockpitTabId[] = [
  "sante",
  "ia",
  "acces",
  "logs",
  "plugins",
  "invitations",
] as const;
