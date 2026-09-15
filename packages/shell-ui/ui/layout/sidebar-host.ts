export type SidebarNavItem = {
  href: string;
  label: string;
  icon: any;
  fromShell?: boolean;
  /**
   * Permission requise pour voir l'entrée primaire (ex. "nav.panier") —
   * filtrée sur me.permissions comme les entrées admin. Absente = visible.
   */
  permission?: string | null;
};

export type SidebarAdminItem = {
  href: string;
  label: string;
  icon: any;
  permission?: string | null;
};

export type SidebarActionItem = {
  /** Identifiant stable (clé de rendu, aid). */
  id: string;
  label: string;
  icon: any;
  /** Action au clic — entrée SANS navigation (ex. visite guidée). */
  onSelect: () => void;
  /** Permission requise (même filtrage que les entrées nav/admin). */
  permission?: string | null;
};

export type SidebarHost = {
  /** Primary nav items (ordered). */
  getNavItems: () => SidebarNavItem[];
  /** Admin page links (Hermes/n8n added separately if tools enabled). */
  getAdminItems?: () => SidebarAdminItem[];
  /** Entrées d'action sans navigation (ex. visite guidée), rendues après le groupe Admin. */
  getActionItems?: () => SidebarActionItem[];
  /** ACL: return false to hide item. me from useSession. */
  canShowHref?: (href: string, me: any) => boolean;
  /** Forced active href for soft-ctx (product detail etc). */
  resolveForcedActiveHref?: (pathname: string, search: string) => string | null;
  /** Brand mark node factory (monogram). If absent, use productName initials. */
  renderBrandMark?: (props: { className?: string }) => any;
  /** Optional tools section renderer (Hermes/n8n links) - ReactNode or component. */
  renderTools?: (ctx: { collapsed: boolean; me: any }) => any;
  /** Optional plugins section. */
  renderPlugins?: (ctx: { collapsed: boolean; me: any }) => any;
  /** Plugin host optional (fetch + open). */
  plugins?: {
    changedEvent: string;
    fetchVisible: () => Promise<Array<{ id: string; label: string; href?: string }>>;
    openPanel: (id: string, opts: any) => void;
  };
  /** Extra footer actions (rechoose connection etc) - optional. */
  /** Optional browser auth redirect. Default remains /login. */
  logoutHref?: string;
  allowImpersonation?: boolean;
  onLogoutExtra?: () => void | Promise<void>;
};

let host: SidebarHost | null = null;
let hostVersion = 0;
const hostListeners = new Set<() => void>();

function bumpSidebarHost(): void {
  hostVersion += 1;
  for (const listener of hostListeners) listener();
}

export function configureSidebar(next: SidebarHost): void {
  host = next;
  bumpSidebarHost();
}

export function getSidebarHost(): SidebarHost {
  if (!host) throw new Error("@creezio/shell-ui: configureSidebar() requis");
  return host;
}

export function getSidebarHostOptional(): SidebarHost | null {
  return host;
}

/** Abonnement aux reconfigurations (`NavCatalogLoader` bump après GET /). */
export function subscribeSidebarHost(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => {
    hostListeners.delete(listener);
  };
}

export function getSidebarHostVersion(): number {
  return hostVersion;
}

/**
 * Registre d'actions sidebar contribuées par des modules kit (ex.
 * @creezio/interactive-demo) SANS passer par le host de la marque : les
 * providers enregistrés ici sont fusionnés avec `getActionItems` au
 * rendu. Réactif (useSyncExternalStore) : le snapshot n'est recalculé
 * qu'à l'enregistrement ou au retrait d'un provider.
 */
export type SidebarActionsProvider = () => SidebarActionItem[];

const sidebarActionsProviders = new Set<SidebarActionsProvider>();
const sidebarActionsListeners = new Set<() => void>();
let sidebarActionsSnapshot: SidebarActionItem[] = [];

function recomputeSidebarActions(): void {
  const next: SidebarActionItem[] = [];
  for (const provider of sidebarActionsProviders) {
    try {
      next.push(...(provider() ?? []));
    } catch {
      /* provider défaillant — les autres actions restent servies */
    }
  }
  sidebarActionsSnapshot = next;
  for (const listener of sidebarActionsListeners) listener();
}

/**
 * Enregistre un provider d'actions sidebar et renvoie la fonction de retrait
 * (à appeler au démontage). Le provider est relu à chaque
 * enregistrement/retrait : le garder pur et sans I/O.
 */
export function registerSidebarActionsProvider(
  provider: SidebarActionsProvider,
): () => void {
  sidebarActionsProviders.add(provider);
  recomputeSidebarActions();
  return () => {
    sidebarActionsProviders.delete(provider);
    recomputeSidebarActions();
  };
}

export function subscribeSidebarActions(listener: () => void): () => void {
  sidebarActionsListeners.add(listener);
  return () => {
    sidebarActionsListeners.delete(listener);
  };
}

export function getSidebarActionsSnapshot(): SidebarActionItem[] {
  return sidebarActionsSnapshot;
}
