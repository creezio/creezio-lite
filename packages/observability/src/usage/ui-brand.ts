/**
 * Tokens UI / tracker usage (marque).
 */

export type FleetActionPayload = {
  type: string;
  label: string;
  path?: string;
  userId?: string;
  username?: string;
  meta?: Record<string, unknown>;
};

export type UsageAnalyticsUiBrand = {
  /** Attribut data-* pour labels clics (défaut data-creezio-aid). */
  aidAttr: string;
  /** Classe titlebar à ignorer pour les clics. */
  titlebarNoDragClass: string;
  /** Miroir télémétrie flotte (optionnel). */
  mirrorFleetAction?: (payload: FleetActionPayload) => void;
};

const DEFAULT: UsageAnalyticsUiBrand = {
  aidAttr: "data-creezio-aid",
  titlebarNoDragClass: "creezio-titlebar-no-drag",
};

let brand: UsageAnalyticsUiBrand = { ...DEFAULT };

export function configureUsageAnalyticsUiBrand(
  next: Partial<UsageAnalyticsUiBrand>,
): void {
  brand = { ...brand, ...next };
}

export function getUsageAnalyticsUiBrand(): UsageAnalyticsUiBrand {
  return brand;
}

export function resetUsageAnalyticsUiBrandForTests(): void {
  brand = { ...DEFAULT };
}
