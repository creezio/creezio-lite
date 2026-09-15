/** Trails admin / loading plateforme (O9) — trails métier restent marque. */

export type TrailCrumb = { href?: string; label: string };

export function trailForRequestLogs(): TrailCrumb[] {
  return [
    { href: "/admin/request-logs", label: "Admin" },
    { label: "Logs API / MCP" },
  ];
}

export function trailForAnalytics(): TrailCrumb[] {
  return [
    { href: "/admin/analytics", label: "Admin" },
    { label: "Analytics" },
  ];
}

export function trailForLoading(listHref: string, listLabel: string): TrailCrumb[] {
  return [
    { href: listHref, label: listLabel },
    { label: "Chargement…" },
  ];
}
