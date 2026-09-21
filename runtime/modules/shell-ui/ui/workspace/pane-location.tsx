"use client";
import { useMemo } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { usePaneHref } from "./keep-alive";
import { useTabWorkspaceOptional } from "./tab-workspace-host";

/** Use Creezio's existing stable pane identity; the host URL belongs to the active tab. */
export function usePanePathname(): string {
  const pane = usePaneHref(), pathname = usePathname();
  return pane === null ? pathname || "/" : pane.split("?")[0];
}
export function usePaneSearchParams(): URLSearchParams {
  const pane = usePaneHref(), current = useSearchParams();
  const search = pane === null ? (current?.toString() ?? "") : pane.split("?").slice(1).join("?");
  return useMemo(() => new URLSearchParams(search), [search]);
}
/** Commands follow the same history and tab policy as links. Public pages use the host router. */
export function useWorkspaceRouter() {
  const router = useRouter(), workspace = useTabWorkspaceOptional();
  const navigate = workspace?.navigate;
  return useMemo(() => ({
    ...router,
    push: (href: string, options?: {scroll?:boolean}) => navigate ? navigate(href) : router.push(href, options),
    replace: (href: string, options?: {scroll?:boolean}) => navigate ? navigate(href, { replace: true, skipHistory: true }) : router.replace(href, options),
  }), [router, navigate]);
}

export {usePaneActive} from "./keep-alive";
