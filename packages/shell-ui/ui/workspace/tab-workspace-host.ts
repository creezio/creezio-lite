/**
 * Host marque pour le tab-workspace (nav / surfaces métier reste marque).
 * O9 — injection ; pas de jumeau.
 *
 * Capacité native = ouvrir un **site externe** (onglet) — les libellés
 * métier de ces sites = config/UI marque.
 */

/** Options d’ouverture d’un site externe (partition /site/<id>). */
export type OpenExternalSiteOpts = {
  url: string;
  title?: string;
  /** Id de partition persistante (0 = générique / hash host). */
  siteId?: number;
  electronTabId?: string;
  navigateUrl?: boolean;
  [key: string]: unknown;
};

export type TabWorkspaceHost = {
  useTabWorkspace: () => any;
  useOpenTab?: () => (...args: any[]) => any;
};

let host: TabWorkspaceHost | null = null;

export function configureTabWorkspaceHost(next: TabWorkspaceHost): void {
  host = next;
}

export function useTabWorkspace(): any {
  if (!host?.useTabWorkspace) {
    throw new Error(
      "@creezio/shell-ui: configureTabWorkspaceHost() requis avant useTabWorkspace",
    );
  }
  return host.useTabWorkspace();
}

export function useOpenTab(): any {
  if (host?.useOpenTab) return host.useOpenTab();
  return () => {};
}

export function useTabWorkspaceOptional(): any {
  if (!host?.useTabWorkspace) return null;
  try {
    return host.useTabWorkspace();
  } catch {
    return null;
  }
}

/** Normalise les opts (siteId par défaut 0 = partition générique). */
export function normalizeOpenExternalSiteOpts(
  opts: OpenExternalSiteOpts,
): OpenExternalSiteOpts {
  return { ...opts, siteId: opts.siteId ?? 0 };
}

/** Ouvre un site externe via le host workspace (API générique). */
export function openExternalSiteFromWorkspace(
  workspace: any,
  opts: OpenExternalSiteOpts,
): void {
  if (!workspace) return;
  const normalized = normalizeOpenExternalSiteOpts(opts);
  if (typeof workspace.openExternalSite === "function") {
    workspace.openExternalSite(normalized);
  }
}
