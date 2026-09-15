export type GlobalSearchHit = {
  index: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
};

export type GlobalSearchConfig = {
  placeholder?: string;
  indexLabels?: Record<string, string>;
  storageKey?: string;
  /** Disable browser persistence when results contain workspace data. */
  persistHistory?: boolean;
  /** Fetch authorized hits from the application search service. */
  search: (query: string, signal?: AbortSignal) => Promise<GlobalSearchHit[]>;
  /** Prefer catalogue soft-ctx when navigating to this href. */
  preferCatalogueHref?: (href: string) => boolean;
  /** Optional analytics. */
  onTrack?: (event: string, payload?: Record<string, unknown>) => void;
};

let cfg: GlobalSearchConfig | null = null;

export function configureGlobalSearch(next: GlobalSearchConfig): void {
  cfg = next;
}

export function getGlobalSearchConfig(): GlobalSearchConfig {
  if (!cfg?.search) {
    throw new Error("@lite/shell-ui: configureGlobalSearch() requis");
  }
  return cfg;
}
