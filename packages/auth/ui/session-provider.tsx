"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getShellDesktopApi } from "@creezio/shell-ui";

export type SessionRole = "owner" | "collaborator" | "admin";

export type SessionMe = {
  user: string;
  user_id?: string;
  role: SessionRole;
  /**
   * Rôle métier marque (configureAuth.resolveBrandRole, champ brand_role de
   * /me) — ex. backoffice / pos. null = marque sans resolver : aucun
   * filtrage métier. Suit la CIBLE en impersonation.
   */
  brandRole?: string | null;
  kind?: "human" | "ai";
  permissions: string[];
  impersonating: boolean;
  actor: {
    id: string;
    username: string;
    role: "owner" | "collaborator" | string;
  } | null;
};

export type SessionContextValue = {
  me: SessionMe | null;
  loading: boolean;
  refresh: () => Promise<void>;
  stopImpersonate: () => Promise<boolean>;
  /** Humain : swap JWT. IA : bascule vue workspace Electron dédiée. */
  impersonate: (userId: string) => Promise<boolean>;
  /** Bascule explicite vers l’espace workspace Electron d’un collab IA. */
  openAiWorkspace: (userId: string) => Promise<boolean>;
};

export type SessionProviderProps = {
  children: ReactNode;
  /**
   * @deprecated SoT = GET /api/v1/auth/me (configureAuth.ownerPermissions
   * côté serveur). Conservé pour ne pas casser les BrandChrome existants
   * — ignoré, plus de fallback chrome.
   */
  ownerPermissions?: readonly string[];
  /** Redirect après impersonate (défaut /dashboard). */
  impersonateRedirect?: string;
  /** Redirect après stop impersonate (défaut /collaborateurs). */
  stopImpersonateRedirect?: string;
  /** Endpoint heartbeat desktop (défaut /api/v1/desktop/heartbeat). */
  heartbeatPath?: string;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Provider session React.
 * Bridge desktop via getShellDesktopApi() (configureShellUiBrand).
 */
export function SessionProvider({
  children,
  impersonateRedirect = "/dashboard",
  stopImpersonateRedirect = "/collaborateurs",
  heartbeatPath = "/api/v1/desktop/heartbeat",
}: SessionProviderProps) {
  const [me, setMe] = useState<SessionMe | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me");
      if (!res.ok) {
        setMe(null);
        return;
      }
      const data = (await res.json()) as SessionMe & {
        ok?: boolean;
        kind?: "human" | "ai";
        brand_role?: string | null;
      };
      // Legacy /me (sans role) = compte principal.
      const role: SessionRole =
        data.role === "collaborator" ||
        data.role === "owner" ||
        data.role === "admin"
          ? data.role
          : "owner";
      // SoT unique = session /me (configureAuth.ownerPermissions côté serveur).
      const permissions: string[] = Array.isArray(data.permissions)
        ? data.permissions
        : [];
      setMe({
        user: data.user,
        user_id: data.user_id,
        role,
        brandRole: typeof data.brand_role === "string" ? data.brand_role : null,
        kind: data.kind === "ai" ? "ai" : "human",
        permissions,
        impersonating: Boolean(data.impersonating),
        actor: data.actor || null,
      });
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!me) return;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      void fetch(heartbeatPath, { method: "POST" }).catch(() => {});
    };
    beat();
    const id = window.setInterval(beat, 60_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [me, heartbeatPath]);

  const openAiWorkspace = useCallback(
    async (userId: string) => {
      const desktop = getShellDesktopApi();
      if (!desktop?.ensureAiWorkspace || !desktop.showAiWorkspace) {
        const res = await fetch("/api/v1/auth/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) return false;
        window.location.href = impersonateRedirect;
        return true;
      }
      const res = await fetch("/api/v1/auth/ai-workspace-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        ok?: boolean;
        token?: string;
        user?: string;
        user_id?: string;
      };
      if (!data.token) return false;
      const ensured = await desktop.ensureAiWorkspace({
        userId,
        token: data.token,
        label: data.user || userId,
        show: true,
      });
      return Boolean(ensured && "ok" in ensured && ensured.ok);
    },
    [impersonateRedirect],
  );

  const impersonate = useCallback(
    async (userId: string) => {
      try {
        const probe = await fetch("/api/v1/users");
        if (probe.ok) {
          const body = (await probe.json()) as {
            users?: Array<{ id: string; kind?: string }>;
          };
          const u = body.users?.find((x) => x.id === userId);
          if (u?.kind === "ai") {
            return openAiWorkspace(userId);
          }
        }
      } catch {
        /* fallback JWT */
      }
      const res = await fetch("/api/v1/auth/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) return false;
      await refresh();
      window.location.href = impersonateRedirect;
      return true;
    },
    [refresh, openAiWorkspace, impersonateRedirect],
  );

  const stopImpersonate = useCallback(async () => {
    const desktop = getShellDesktopApi();
    if (desktop?.getAiWorkspaceIdentity && desktop.showOwnerWorkspace) {
      try {
        const id = await desktop.getAiWorkspaceIdentity();
        if (id?.userId) {
          await desktop.showOwnerWorkspace();
          return true;
        }
      } catch {
        /* continue stop-impersonate */
      }
    }
    const res = await fetch("/api/v1/auth/stop-impersonate", {
      method: "POST",
    });
    if (!res.ok) return false;
    await refresh();
    window.location.href = stopImpersonateRedirect;
    return true;
  }, [refresh, stopImpersonateRedirect]);

  const value = useMemo(
    () => ({
      me,
      loading,
      refresh,
      impersonate,
      stopImpersonate,
      openAiWorkspace,
    }),
    [me, loading, refresh, impersonate, stopImpersonate, openAiWorkspace],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    return {
      me: null,
      loading: true,
      refresh: async () => {},
      impersonate: async () => false,
      stopImpersonate: async () => false,
      openAiWorkspace: async () => false,
    };
  }
  return ctx;
}
