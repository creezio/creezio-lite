"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  ChevronDown,
  Eye,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Shield,
  Workflow,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@lite/auth/ui";
import { cn, getShellDesktopApi, getShellUiBrand } from "@lite/shell-ui";
import { Button } from "../primitives/button";
import { Avatar, AvatarFallback } from "../primitives/avatar";
import { useLocationSearch } from "../workspace/use-location-search";
import { useTabWorkspaceOptional } from "../workspace/tab-workspace-context";
import { openAiWorkspaceView } from "../lib/ai-workspace-client";
import {
  isHermesWebuiOpenTarget,
  resolveHermesWebuiOpenTarget,
} from "../lib/hermes-ui";
import { openN8nUiInWorkspace } from "../lib/n8n-ui";
import {
  getSidebarActionsSnapshot,
  getSidebarHost,
  getSidebarHostVersion,
  subscribeSidebarActions,
  subscribeSidebarHost,
  type SidebarActionItem,
  type SidebarAdminItem,
  type SidebarHost,
  type SidebarNavItem,
} from "./sidebar-host";

function aidProps(value: string): Record<string, string> {
  const attr = getShellUiBrand().aidAttr ?? "data-lite-aid";
  return { [attr]: value };
}

function aidSlug(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hrefPath(href: string): string {
  return href.split("?")[0] || href;
}

function canShowHref(host: SidebarHost, href: string, me: any): boolean {
  return host.canShowHref?.(href, me) !== false;
}

function hasItemPermission(
  item: { permission?: string | null },
  me: any,
): boolean {
  if (!item.permission) return true;
  if (!me) return true;
  // Owner non impersonné : tout voir — même bypass que la garde API kernel
  // (authorizeModuleAccess). Les ownerPermissions configurées restent la
  // source pour le reste (impersonation = permissions de la cible).
  if (me.role === "owner" && me.impersonating !== true) return true;
  const permissions = Array.isArray(me.permissions) ? me.permissions : [];
  return permissions.includes(item.permission);
}

function isActiveHref(pathname: string, href: string): boolean {
  const path = hrefPath(href);
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

function DefaultBrandMark({ className }: { className?: string }) {
  const productName = getShellUiBrand().productName || "Lite";
  const initials =
    productName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "C";

  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        "bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-bold tracking-tight text-white shadow-sm",
        className,
      )}
    >
      {initials}
    </div>
  );
}

function BrandMark({
  host,
  className,
}: {
  host: SidebarHost;
  className?: string;
}) {
  if (host.renderBrandMark) return host.renderBrandMark({ className });
  return <DefaultBrandMark className={className} />;
}

function DefaultToolsLinks({
  host,
  me,
  collapsed,
  nested,
  onNavigate,
}: {
  host: SidebarHost;
  me: any;
  collapsed?: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <HermesSidebarLink
        host={host}
        me={me}
        collapsed={collapsed}
        nested={nested}
        onNavigate={onNavigate}
      />
      <N8nSidebarLink
        host={host}
        me={me}
        collapsed={collapsed}
        nested={nested}
        onNavigate={onNavigate}
      />
    </>
  );
}

function AdminNavGroup({
  host,
  me,
  pathname,
  collapsed,
  onNavigate,
}: {
  host: SidebarHost;
  me: any;
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const adminItems = useMemo(
    () =>
      (host.getAdminItems?.() || []).filter(
        (item) =>
          hasItemPermission(item, me) && canShowHref(host, hrefPath(item.href), me),
      ),
    [host, me],
  );
  const adminActive =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/configuration" ||
    pathname.startsWith("/configuration/");
  const [open, setOpen] = useState(adminActive);
  const [popover, setPopover] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (adminActive) setOpen(true);
  }, [adminActive]);

  useEffect(() => {
    if (!popover) return;
    function onDoc(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) setPopover(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [popover]);

  if (!adminItems.length && !host.renderTools && !canShowHref(host, "/admin", me)) {
    return null;
  }

  const toolLinks = host.renderTools ? (
    host.renderTools({ collapsed: false, me })
  ) : (
    <DefaultToolsLinks
      host={host}
      me={me}
      collapsed={false}
      nested
      onNavigate={() => {
        setPopover(false);
        onNavigate?.();
      }}
    />
  );

  if (collapsed) {
    return (
      <div className="relative" ref={popRef}>
        <button
          type="button"
          title="Admin"
          aria-label="Admin"
          aria-expanded={popover}
          onClick={() => setPopover((v) => !v)}
          {...aidProps("nav.admin")}
          className={cn(
            "flex h-9 w-full items-center justify-center rounded-lg text-sm transition-colors",
            adminActive
              ? "bg-slate-800 text-white"
              : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
          )}
        >
          <Shield className="h-4 w-4 shrink-0" />
        </button>
        {popover ? (
          <div className="absolute left-full top-0 z-50 ml-2 min-w-[12rem] rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
            {adminItems.map((item) => {
              const active = isActiveHref(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    setPopover(false);
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 text-sm",
                    active
                      ? "bg-slate-800 text-white"
                      : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
            {toolLinks ? (
              <>
                {adminItems.length ? (
                  <div className="my-1 border-t border-slate-700" />
                ) : null}
                <div className="px-1">{toolLinks}</div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        {...aidProps("nav.admin")}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          adminActive
            ? "bg-slate-800/80 text-white"
            : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
        )}
      >
        <Shield className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Admin</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="ml-3 space-y-0.5 border-l border-slate-700 pl-2">
          {adminItems.map((item) => {
            const active = isActiveHref(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                {...aidProps(`nav.${aidSlug(item.label)}`)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
          {toolLinks ? (
            <>
              <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Outils
              </div>
              {toolLinks}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HermesSidebarLink({
  host,
  me,
  collapsed,
  nested,
  onNavigate,
}: {
  host: SidebarHost;
  me: any;
  collapsed?: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const workspace = useTabWorkspaceOptional();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!canShowHref(host, "/admin/hermes", me)) return;
    const api = getShellDesktopApi();
    if (!api?.getHermesStatus) return;
    let cancelled = false;
    const refresh = () => {
      void api.getHermesStatus?.().then(() => {
        if (!cancelled) setVisible(true);
      });
    };
    refresh();
    const t = window.setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [host, me]);

  if (!visible) return null;

  async function openHermes() {
    onNavigate?.();
    let retryToast: string | number | undefined;
    const target = await resolveHermesWebuiOpenTarget({
      onRetry: () => {
        retryToast = toast.loading(
          "Hermes est arrêté - relance de l'API et de la WebUI...",
        );
      },
    });
    if (retryToast !== undefined) toast.dismiss(retryToast);
    if (!isHermesWebuiOpenTarget(target)) {
      toast.error(target.error, { duration: 9000 });
      if (/Configuration|desactive|désactivé|URL/i.test(target.error)) {
        router.push("/configuration");
      }
      return;
    }
    if (workspace?.openExternalSite) {
      workspace.openExternalSite({
        siteId: target.siteId,
        url: target.url,
        title: target.title,
      });
      return;
    }
    const api = getShellDesktopApi();
    if (api?.openTab) {
      try {
        await api.openTab(target.siteId, target.url);
        return;
      } catch {
        /* fall through */
      }
    }
    window.open(target.url, "_blank", "noreferrer");
  }

  return (
    <button
      type="button"
      onClick={() => void openHermes()}
      {...aidProps("nav.hermes")}
      title={collapsed ? "Agent Hermes" : undefined}
      className={cn(
        "flex w-full items-center rounded-lg text-sm transition-colors",
        nested
          ? "gap-2.5 px-2.5 py-1.5 text-slate-400 hover:bg-slate-800/60 hover:text-white"
          : collapsed
            ? "h-9 justify-center text-slate-300 hover:bg-slate-800/60 hover:text-white"
            : "gap-3 px-3 py-2 text-slate-300 hover:bg-slate-800/60 hover:text-white",
      )}
    >
      <Bot className={cn("shrink-0", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
      {collapsed && !nested ? (
        <span className="sr-only">Agent Hermes</span>
      ) : (
        "Agent Hermes"
      )}
    </button>
  );
}

function N8nSidebarLink({
  host,
  me,
  collapsed,
  nested,
  onNavigate,
}: {
  host: SidebarHost;
  me: any;
  collapsed?: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  const workspace = useTabWorkspaceOptional();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!canShowHref(host, "/admin/n8n", me)) return;
    const api = getShellDesktopApi();
    if (!api?.getN8nStatus) return;
    let cancelled = false;
    const refresh = () => {
      void api.getN8nStatus?.().then(() => {
        if (!cancelled) setVisible(true);
      });
    };
    refresh();
    const t = window.setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [host, me]);

  if (!visible) return null;

  async function openN8n() {
    onNavigate?.();
    const api = getShellDesktopApi();
    const r = await openN8nUiInWorkspace({
      openExternalSite: workspace?.openExternalSite
        ? (o) => workspace.openExternalSite(o)
        : undefined,
      openTab: api?.openTab ? (siteId, url) => api.openTab(siteId, url) : undefined,
    });
    if (!r.ok) {
      if (r.needsConfig) {
        toast.message("Configurez l'URL n8n");
        router.push("/configuration");
        return;
      }
      toast.error(r.error);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void openN8n()}
      {...aidProps("nav.n8n")}
      title={collapsed ? "n8n" : undefined}
      className={cn(
        "flex w-full items-center rounded-lg text-sm transition-colors",
        nested
          ? "gap-2.5 px-2.5 py-1.5 text-slate-400 hover:bg-slate-800/60 hover:text-white"
          : collapsed
            ? "h-9 justify-center text-slate-300 hover:bg-slate-800/60 hover:text-white"
            : "gap-3 px-3 py-2 text-slate-300 hover:bg-slate-800/60 hover:text-white",
      )}
    >
      <Workflow
        className={cn("shrink-0", nested ? "h-3.5 w-3.5" : "h-4 w-4")}
      />
      {collapsed && !nested ? <span className="sr-only">n8n</span> : "n8n"}
    </button>
  );
}

function PluginSidebarLinks({
  host,
  me,
  collapsed,
  onNavigate,
}: {
  host: SidebarHost;
  me: any;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const [plugins, setPlugins] = useState<
    Array<{ id: string; label: string; href?: string }>
  >([]);

  useEffect(() => {
    const pluginHost = host.plugins;
    if (!pluginHost) return;
    let cancelled = false;
    const refresh = () => {
      void pluginHost
        .fetchVisible()
        .then((items) => {
          if (!cancelled) setPlugins(items);
        })
        .catch(() => {
          /* keep last known plugin list */
        });
    };
    refresh();
    window.addEventListener(pluginHost.changedEvent, refresh);
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.removeEventListener(pluginHost.changedEvent, refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [host.plugins]);

  if (!plugins.length) return null;

  function openPlugin(plugin: { id: string; label: string; href?: string }) {
    onNavigate?.();
    try {
      host.plugins?.openPanel(plugin.id, { collapsed, me, href: plugin.href });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Plugin indisponible");
    }
  }

  return (
    <>
      {!collapsed ? (
        <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Plugins
        </div>
      ) : null}
      {plugins.map((plugin) => (
        <button
          key={plugin.id}
          type="button"
          onClick={() => openPlugin(plugin)}
          {...aidProps(`nav.plugin-${plugin.id}`)}
          title={collapsed ? plugin.label : undefined}
          className={cn(
            "flex w-full items-center rounded-lg text-sm text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white",
            collapsed ? "h-9 justify-center" : "gap-3 px-3 py-2",
          )}
        >
          <Puzzle className="h-4 w-4 shrink-0" />
          {collapsed ? (
            <span className="sr-only">{plugin.label}</span>
          ) : (
            <span className="truncate">{plugin.label}</span>
          )}
        </button>
      ))}
    </>
  );
}

const EMPTY_SIDEBAR_ACTIONS: SidebarActionItem[] = [];

/**
 * Entrées d'action de la sidebar (sans navigation — ex. « Visite
 * guidée ») : items du host de marque (`getActionItems`) + providers
 * kit enregistrés (`registerSidebarActionsProvider`), filtrés par
 * permission comme les entrées nav. La sidebar n'existant que dans le
 * workspace authentifié, ces entrées ne sont jamais visibles sur les
 * pages publiques (/login, /lp…).
 */
function SidebarActionLinks({
  host,
  me,
  collapsed,
  onNavigate,
}: {
  host: SidebarHost;
  me: any;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const registered = useSyncExternalStore(
    subscribeSidebarActions,
    getSidebarActionsSnapshot,
    () => EMPTY_SIDEBAR_ACTIONS,
  );
  const items = useMemo(
    () =>
      [...(host.getActionItems?.() ?? []), ...registered].filter((item) =>
        hasItemPermission(item, me),
      ),
    [host, me, registered],
  );
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              item.onSelect();
              onNavigate?.();
            }}
            {...aidProps(`nav.${aidSlug(item.label)}`)}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex w-full items-center rounded-lg text-sm transition-colors",
              collapsed ? "h-9 justify-center" : "gap-3 px-3 py-2",
              "text-slate-300 hover:bg-slate-800/60 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span className="truncate">{item.label}</span>
            )}
          </button>
        );
      })}
    </>
  );
}

function NavLinks({
  host,
  pathname,
  search,
  collapsed,
  onNavigate,
}: {
  host: SidebarHost;
  pathname: string;
  search: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { me } = useSession();
  const forced = host.resolveForcedActiveHref?.(pathname, search) ?? null;
  const navItems = host.getNavItems();

  return (
    <nav
      className={cn(
        "sidebar-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto py-4",
        collapsed ? "px-2.5" : "px-3",
      )}
    >
      {navItems.map((item: SidebarNavItem) => {
        const path = hrefPath(item.href);
        if (!hasItemPermission(item, me)) return null;
        if (!canShowHref(host, path, me)) return null;
        const active =
          forced != null ? path === forced : isActiveHref(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            {...aidProps(`nav.${aidSlug(item.label)}`)}
            title={collapsed ? item.label : undefined}
            className={cn(
              "flex items-center rounded-lg text-sm transition-colors",
              collapsed ? "h-9 justify-center" : "gap-3 px-3 py-2",
              active
                ? "bg-slate-800 text-white"
                : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              item.label
            )}
          </Link>
        );
      })}
      {host.renderPlugins ? (
        host.renderPlugins({ collapsed: Boolean(collapsed), me })
      ) : (
        <PluginSidebarLinks
          host={host}
          me={me}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      )}
      <AdminNavGroup
        host={host}
        me={me}
        pathname={pathname}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <SidebarActionLinks
        host={host}
        me={me}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    </nav>
  );
}

function BrandHeader({
  host,
  collapsed,
  onToggleCollapse,
  showClose,
  onClose,
  closeRef,
}: {
  host: SidebarHost;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  showClose?: boolean;
  onClose?: () => void;
  closeRef?: RefObject<HTMLButtonElement | null>;
}) {
  const productName = getShellUiBrand().productName || "Lite";

  if (collapsed) {
    return (
      <div className="flex h-[57px] shrink-0 items-center justify-center border-b border-slate-800">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Déplier la barre latérale"
          title="Déplier la barre latérale"
          className="group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-slate-800"
        >
          <BrandMark host={host} className="transition-opacity group-hover:opacity-0" />
          <PanelLeftOpen className="absolute h-4 w-4 text-slate-200 opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-[57px] shrink-0 items-center justify-between gap-2 border-b border-slate-800 pl-4 pr-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark host={host} />
        <div className="truncate text-sm font-semibold tracking-[0.18em] text-white">
          {productName.toUpperCase()}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {onToggleCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label="Réduire la barre latérale"
            title="Réduire la barre latérale"
            className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        ) : null}
        {showClose ? (
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Fermer le menu"
            className="h-8 w-8 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function initialsFromUsername(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function SidebarFooter({
  host,
  collapsed,
}: {
  host: SidebarHost;
  collapsed?: boolean;
}) {
  const { me, impersonate } = useSession();
  const [username, setUsername] = useState<string | null>(null);
  const [collabs, setCollabs] = useState<
    Array<{
      id: string;
      username: string;
      kind: "human" | "ai";
      active: boolean;
      role: string;
    }>
  >([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const desktopUser = await getShellDesktopApi()?.getAccount?.();
        if (!cancelled && desktopUser?.username) {
          setUsername(desktopUser.username);
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/v1/auth/me");
        if (!res.ok) return;
        const data = (await res.json()) as { user?: string };
        if (!cancelled && data.user) setUsername(data.user);
      } catch {
        /* ignore */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (host.allowImpersonation === false || me?.role !== "owner" || me.impersonating) return;
    void fetch("/api/v1/users")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { users?: typeof collabs } | null) => {
        if (data?.users) {
          setCollabs(
            data.users.filter((u) => u.role === "collaborator" && u.active),
          );
        }
      })
      .catch(() => {});
  }, [me?.role, me?.impersonating, host.allowImpersonation]);

  async function viewAs(user: (typeof collabs)[number]) {
    setMenuOpen(false);
    if (user.kind === "ai" && getShellDesktopApi()?.showAiWorkspace) {
      await openAiWorkspaceView(user.id, user.username);
      return;
    }
    await impersonate(user.id);
  }

  async function logout() {
    const desktop = getShellDesktopApi();
    if (desktop?.logout) {
      try {
        await desktop.logout();
      } catch {
        /* ignore */
      }
    }
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    try {
      await host.onLogoutExtra?.();
    } catch {
      /* ignore */
    }
    if (desktop?.rechooseConnection) {
      try {
        await desktop.rechooseConnection();
        return;
      } catch {
        /* fallback */
      }
    }
    window.location.href = host.logoutHref ?? "/login";
  }

  const label = username || "Compte";
  const initials = username ? initialsFromUsername(username) : "?";

  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1.5 border-t border-slate-800 px-2.5 py-3">
        <Avatar className="h-8 w-8 border border-slate-700 bg-slate-800" title={label}>
          <AvatarFallback className="bg-slate-800 text-xs font-semibold text-slate-100">
            {initials}
          </AvatarFallback>
        </Avatar>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void logout()}
          title="Déconnexion"
          aria-label="Déconnexion"
          className="h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative shrink-0 space-y-3 border-t border-slate-800 px-3 py-3">
      {me?.role === "owner" && !me.impersonating && collabs.length > 0 ? (
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start gap-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Eye className="h-3.5 w-3.5" /> Voir comme...
          </Button>
          {menuOpen ? (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl">
              {collabs.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="flex w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                  onClick={() => void viewAs(u)}
                >
                  {u.kind === "ai" ? `IA - ${u.username}` : u.username}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar className="h-8 w-8 border border-slate-700 bg-slate-800">
            <AvatarFallback className="bg-slate-800 text-xs font-semibold text-slate-100">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-sm font-medium text-slate-200">{label}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void logout()}
          title="Déconnexion"
          aria-label="Déconnexion"
          className="h-8 w-8 shrink-0 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function SidebarContent({
  host,
  pathname,
  search,
  collapsed,
  onNavigate,
}: {
  host: SidebarHost;
  pathname: string;
  search: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <NavLinks
        host={host}
        pathname={pathname}
        search={search}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
      <SidebarFooter host={host} collapsed={collapsed} />
    </>
  );
}

export function Sidebar({
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onMobileClose,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const hostVersion = useSyncExternalStore(
    subscribeSidebarHost,
    getSidebarHostVersion,
    getSidebarHostVersion,
  );
  void hostVersion;
  const host = getSidebarHost();
  const pathname = usePathname() || "/";
  const search = useLocationSearch(pathname);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (prevPathRef.current !== pathname) {
      prevPathRef.current = pathname;
      if (mobileOpen) onMobileClose?.();
    }
  }, [pathname, mobileOpen, onMobileClose]);

  useEffect(() => {
    if (!mobileOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onMobileClose?.();
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden h-[100dvh] flex-col bg-slate-900 text-slate-100 md:flex",
          "transition-[width] duration-200 ease-out",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <BrandHeader
          host={host}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
        <SidebarContent
          host={host}
          pathname={pathname}
          search={search}
          collapsed={collapsed}
        />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={onMobileClose}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-y-0 left-0 flex h-[100dvh] w-64 max-w-[85vw] flex-col bg-slate-900 text-slate-100 shadow-xl"
          >
            <span id={titleId} className="sr-only">
              Menu de navigation
            </span>
            <BrandHeader
              host={host}
              showClose
              onClose={onMobileClose}
              closeRef={closeRef}
            />
            <SidebarContent
              host={host}
              pathname={pathname}
              search={search}
              onNavigate={onMobileClose}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}

/** @deprecated Use Sidebar. */
export const CrmSidebar = Sidebar;
