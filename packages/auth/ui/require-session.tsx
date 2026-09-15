"use client";

import { useEffect, type ReactNode } from "react";
import { useSession } from "./session-provider";

const PUBLIC_PREFIXES = [
  "/login",
  "/setup",
  "/onboarding",
  "/health",
  "/developers",
  "/oauth",
  "/.well-known",
  "/lp",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export type RequireSessionProps = {
  children: ReactNode;
  /** Défaut `/login`. */
  loginPath?: string;
};

/**
 * Garde client : si la session est absente hors pages publiques,
 * redirige vers le login (évite un CRM « creux » où seul le chat 401).
 * À monter **dans** un `SessionProvider`.
 */
export function RequireSession({
  children,
  loginPath = "/login",
}: RequireSessionProps) {
  const { me, loading } = useSession();

  useEffect(() => {
    if (loading || typeof window === "undefined") return;
    const pathname = window.location.pathname || "/";
    if (isPublicPath(pathname)) return;
    if (me) return;
    const next = `${pathname}${window.location.search || ""}`;
    const url = new URL(loginPath, window.location.origin);
    if (next && next !== "/" && next !== loginPath) {
      url.searchParams.set("next", next);
    }
    window.location.replace(url.toString());
  }, [loading, me, loginPath]);

  if (typeof window !== "undefined") {
    const pathname = window.location.pathname || "/";
    if (isPublicPath(pathname)) return <>{children}</>;
  }

  if (loading) return null;
  if (!me) return null;
  return <>{children}</>;
}
