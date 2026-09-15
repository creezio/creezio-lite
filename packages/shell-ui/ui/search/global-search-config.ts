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
  /** Fetch hits for query - brand app decides Meili/fallback strategy. */
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
    throw new Error("@creezio/shell-ui: configureGlobalSearch() requis");
  }
  return cfg;
}
