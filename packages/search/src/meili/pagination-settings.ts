/**
 * Meili `pagination.maxTotalHits` — défaut amont = 1000, plafond silencieux
 * du browse (`totalHits` + dernière page accessible).
 *
 * Le kit pose un plancher (100 000) à l'indexation ET au boot (PATCH
 * settings, sans réindexation). Une marque peut monter plus haut via
 * `index.settings.pagination.maxTotalHits` ou `CREEZIO_MEILI_MAX_TOTAL_HITS`.
 */

export const DEFAULT_MEILI_MAX_TOTAL_HITS = 100_000;

export type MeiliSettingsJson = Record<string, unknown>;

function asPositiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.trunc(n);
}

/** Plancher kit, surchargeable par env (tests / catalogues hors norme). */
export function resolveMeiliMaxTotalHitsFloor(): number {
  const fromEnv = asPositiveInt(process.env.CREEZIO_MEILI_MAX_TOTAL_HITS);
  return fromEnv ?? DEFAULT_MEILI_MAX_TOTAL_HITS;
}

/**
 * Fusionne `pagination.maxTotalHits` dans les settings d'un index.
 * Conserve un override marque s'il est déjà ≥ au plancher.
 */
export function mergeMeiliIndexSettings(
  settings: MeiliSettingsJson | null | undefined,
): MeiliSettingsJson {
  const base: MeiliSettingsJson =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? { ...settings }
      : {};
  const pagination =
    base.pagination &&
    typeof base.pagination === "object" &&
    !Array.isArray(base.pagination)
      ? { ...(base.pagination as MeiliSettingsJson) }
      : {};
  const floor = resolveMeiliMaxTotalHitsFloor();
  const declared = asPositiveInt(pagination.maxTotalHits);
  pagination.maxTotalHits = declared != null ? Math.max(declared, floor) : floor;
  return { ...base, pagination };
}

export function needsMeiliMaxTotalHitsRaise(current: unknown): boolean {
  const n = asPositiveInt(current);
  return n == null || n < resolveMeiliMaxTotalHitsFloor();
}
