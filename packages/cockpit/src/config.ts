import {
  DEFAULT_COCKPIT_TABS,
  type CockpitTabId,
} from "./types.js";

export type CockpitConfig = {
  /**
   * Protocole deep-link (ex. "mybrand" → mybrand://join/<host>).
   * Requis au boot marque via configureCockpit.
   */
  deepLinkProtocol: string;
  /** URL installeur client (Invitations + CTA). */
  clientDownloadUrl: string;
  /** Onglets visibles du shell autonome. Défaut = les 6 gold TF/CV. */
  tabs?: CockpitTabId[];
  /** Prefetch interval ms (défaut 15000). */
  refreshMs?: number;
  /** Base API (défaut "/api/v1"). */
  apiBase?: string;
};

const DEFAULT: CockpitConfig = {
  deepLinkProtocol: "",
  clientDownloadUrl: "",
  tabs: [...DEFAULT_COCKPIT_TABS],
  refreshMs: 15_000,
  apiBase: "/api/v1",
};

let config: CockpitConfig = { ...DEFAULT, tabs: [...DEFAULT_COCKPIT_TABS] };

/** Configure une fois au boot marque (layout / providers). */
export function configureCockpit(next: Partial<CockpitConfig>): void {
  config = {
    ...config,
    ...next,
    tabs: next.tabs ? [...next.tabs] : config.tabs,
  };
}

export function getCockpitConfig(): CockpitConfig {
  return {
    ...config,
    tabs: config.tabs ? [...config.tabs] : [...DEFAULT_COCKPIT_TABS],
  };
}

export function resetCockpitConfigForTests(): void {
  config = { ...DEFAULT, tabs: [...DEFAULT_COCKPIT_TABS] };
}

/** Merge config globale + override local props. */
export function resolveCockpitConfig(
  override?: Partial<CockpitConfig>,
): CockpitConfig {
  const base = getCockpitConfig();
  if (!override) return base;
  return {
    ...base,
    ...override,
    tabs: override.tabs ? [...override.tabs] : base.tabs,
  };
}

export function buildJoinLink(
  protocol: string,
  tunnelHost: string | null | undefined,
): string | null {
  const p = String(protocol || "").trim().replace(/:\/\/.*$/, "");
  const host = String(tunnelHost || "").trim();
  if (!p || !host) return null;
  return `${p}://join/${host}`;
}
