"use client";

import { useCallback, useEffect, useState } from "react";
import { getShellDesktopApi } from "@creezio/shell-ui";
import { openAiWorkspaceView } from "@creezio/shell-ui/ui/kit";
import { toast } from "sonner";
import type { CockpitConfig } from "@creezio/cockpit";
import { resolveCockpitConfig } from "@creezio/cockpit";
import type {
  CockpitAclPlugin,
  CockpitAiActivity,
  CockpitDesktopSessions,
  CockpitHealth,
  CockpitRequestLogEntry,
  CockpitTunnelLive,
  CockpitUser,
} from "@creezio/cockpit";

export type UseCockpitDashboardOpts = {
  config?: Partial<CockpitConfig>;
  /** Inclure GET /admin/request-logs (shell autonome). */
  includeLogs?: boolean;
};

export function useCockpitDashboard(opts: UseCockpitDashboardOpts = {}) {
  const cfg = resolveCockpitConfig(opts.config);
  const apiBase = (cfg.apiBase || "/api/v1").replace(/\/+$/, "");
  const refreshMs = cfg.refreshMs ?? 15_000;

  const [health, setHealth] = useState<CockpitHealth | null>(null);
  const [tunnelLive, setTunnelLive] = useState<CockpitTunnelLive | null>(null);
  const [users, setUsers] = useState<CockpitUser[]>([]);
  const [activity, setActivity] = useState<Record<string, CockpitAiActivity>>(
    {},
  );
  const [sessions, setSessions] = useState<CockpitDesktopSessions | null>(null);
  const [acl, setAcl] = useState<CockpitAclPlugin[]>([]);
  const [logs, setLogs] = useState<CockpitRequestLogEntry[]>([]);
  const [liveUserId, setLiveUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isDesktop =
    typeof window !== "undefined" && Boolean(getShellDesktopApi());

  const load = useCallback(async () => {
    const fetches: Promise<unknown>[] = [
      fetch(`${apiBase}/cockpit/health`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<CockpitHealth>) : null))
        .catch(() => null),
      fetch(`${apiBase}/users`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`${apiBase}/desktop/sessions`, { cache: "no-store" })
        .then((r) =>
          r.ok ? (r.json() as Promise<CockpitDesktopSessions>) : null,
        )
        .catch(() => null),
      fetch(`${apiBase}/cockpit/plugin-acl`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ];
    if (opts.includeLogs) {
      fetches.push(
        fetch(`${apiBase}/admin/request-logs?limit=40`, { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    }

    const results = await Promise.all(fetches);
    const h = results[0] as CockpitHealth | null;
    const u = results[1] as { users?: CockpitUser[] } | null;
    const s = results[2] as CockpitDesktopSessions | null;
    const a = results[3] as { plugins?: CockpitAclPlugin[] } | null;
    const l = opts.includeLogs
      ? (results[4] as { logs?: CockpitRequestLogEntry[] } | null)
      : null;

    if (h) setHealth(h);
    const list = (u?.users || []) as CockpitUser[];
    setUsers(list);
    if (s) setSessions(s);
    if (a) setAcl((a.plugins || []) as CockpitAclPlugin[]);
    if (l) setLogs((l.logs || []) as CockpitRequestLogEntry[]);

    const ai = list.filter((x) => x.kind === "ai" && x.active);
    const entries = await Promise.all(
      ai.map(async (x) => {
        try {
          const res = await fetch(`${apiBase}/tasks/activity/${x.id}`);
          if (!res.ok)
            return [x.id, { running: false, taskTitle: null }] as const;
          const data = (await res.json()) as {
            run?: { status?: string } | null;
            task?: { title?: string } | null;
          };
          const running =
            data.run?.status === "running" || data.run?.status === "queued";
          return [
            x.id,
            { running, taskTitle: running ? data.task?.title || null : null },
          ] as const;
        } catch {
          return [x.id, { running: false, taskTitle: null }] as const;
        }
      }),
    );
    setActivity(Object.fromEntries(entries));

    try {
      const t = await getShellDesktopApi()?.getTunnelStatus?.();
      if (t) {
        setTunnelLive({
          running: Boolean(t.online),
          url: t.publicUrl ?? null,
          hostname: t.hostname ?? null,
        });
      }
    } catch {
      /* hors desktop */
    }
  }, [apiBase, opts.includeLogs]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  async function openWorkspace(u: CockpitUser) {
    setBusy(`open:${u.id}`);
    try {
      const result = await openAiWorkspaceView(u.id, u.username);
      if (!result.ok) toast.error(result.error || "Workspace IA indisponible");
      return result;
    } finally {
      setBusy(null);
    }
  }

  async function closeWorkspace(u: CockpitUser) {
    setBusy(`close:${u.id}`);
    try {
      const r = await fetch(`${apiBase}/cockpit/ai-workspace/${u.id}/close`, {
        method: "POST",
      });
      const data = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        closed?: boolean;
        error?: string;
      };
      if (r.ok && data.ok) {
        toast.success(
          data.closed
            ? `Fenêtre de ${u.username} fermée — mémoire libérée`
            : `Aucune fenêtre ouverte pour ${u.username}`,
        );
      } else {
        toast.error(
          data.error || "Fermeture impossible (hôte desktop hors ligne ?)",
        );
      }
    } finally {
      setBusy(null);
    }
  }

  async function toggleAcl(plugin: CockpitAclPlugin, userId: string) {
    const next = plugin.user_ids.includes(userId)
      ? plugin.user_ids.filter((x) => x !== userId)
      : [...plugin.user_ids, userId];
    const r = await fetch(
      `${apiBase}/cockpit/plugin-acl/${encodeURIComponent(plugin.plugin_id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_ids: next }),
      },
    );
    if (r.ok) {
      setAcl((prev) =>
        prev.map((p) =>
          p.plugin_id === plugin.plugin_id ? { ...p, user_ids: next } : p,
        ),
      );
    } else {
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error || "Mise à jour ACL impossible");
    }
  }

  async function createAi(usernameRaw: string) {
    const username = usernameRaw.trim();
    if (!username) {
      toast.error("Nom du collaborateur IA requis");
      return false;
    }
    setBusy("create-ai");
    try {
      const r = await fetch(`${apiBase}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, kind: "ai" }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        toast.error(data.error || "Création impossible");
        return false;
      }
      toast.success(`Collaborateur IA « ${username} » créé`);
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function createHuman(usernameRaw: string, password: string) {
    const username = usernameRaw.trim();
    if (!username || !password) {
      toast.error("Identifiant et mot de passe requis");
      return false;
    }
    setBusy("create-human");
    try {
      const r = await fetch(`${apiBase}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, kind: "human" }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        toast.error(data.error || "Création impossible");
        return false;
      }
      toast.success(
        `Compte « ${username} » créé — transmettez les identifiants`,
      );
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function openAdminApp() {
    const api = getShellDesktopApi();
    if (api?.openAdminWindow) {
      const r = await api.openAdminWindow();
      if (!r?.ok) toast.error("Ouverture de l'app admin impossible");
      return;
    }
    window.open("/dashboard", "_blank", "noreferrer");
  }

  const aiUsers = users.filter((u) => u.kind === "ai" && u.active);
  const humans = users.filter((u) => u.kind === "human" && u.active);
  const collaborators = users.filter((u) => u.role !== "owner" && u.active);
  const bridgesOnline = (sessions?.bridges || []).filter(
    (b) => b.online !== false,
  ).length;
  const clientsOnline = (sessions?.users || []).filter(
    (u) => u.online !== false,
  ).length;
  const tunnelOk = tunnelLive
    ? tunnelLive.running
    : Boolean(health?.tunnel.configured);
  const tunnelUrl = tunnelLive?.url || health?.tunnel.public_url || null;
  const tunnelHost =
    tunnelLive?.hostname ||
    (tunnelUrl
      ? (() => {
          try {
            return new URL(tunnelUrl).hostname;
          } catch {
            return null;
          }
        })()
      : null);

  return {
    cfg,
    apiBase,
    health,
    tunnelLive,
    users,
    activity,
    sessions,
    acl,
    logs,
    liveUserId,
    setLiveUserId,
    busy,
    isDesktop,
    load,
    openWorkspace,
    closeWorkspace,
    toggleAcl,
    createAi,
    createHuman,
    openAdminApp,
    aiUsers,
    humans,
    collaborators,
    bridgesOnline,
    clientsOnline,
    tunnelOk,
    tunnelUrl,
    tunnelHost,
  };
}
