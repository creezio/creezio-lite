/** Types / helpers partagés client + serveur (sans dépendance SQLite). */

export type UsageUserKind = "human" | "ai" | "system" | "unknown";
export type UsagePeriod = "day" | "week" | "month" | "year";

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}j ${rh}h` : `${d}j`;
}
