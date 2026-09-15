/** Clé Suspense stable — inclut la vue + filtres actifs (sans recréer page par page). */
export function buildCatalogSuspenseKey(
  sp: Record<string, string | undefined> | undefined,
  resolveView: (raw: string | undefined) => string,
  filterKeys: readonly string[],
): string {
  const view = resolveView(sp?.view);
  const parts: string[] = [view];
  for (const key of filterKeys) {
    const value = (sp?.[key] || "").trim();
    if (value) parts.push(`${key}=${value}`);
  }
  return parts.join("&");
}
