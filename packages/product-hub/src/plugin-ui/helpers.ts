/**
 * Ouverture panel plugin / sidebar items (port kit — N6).
 */

import { browserWindow, getDesktopApi, getProductHubUiBrand } from "./brand.js";

export type PluginPanelOpenTarget = {
  url: string;
  siteId: number;
  title: string;
  pluginId: string;
};

export type PluginPanelOpenFail = {
  ok: false;
  error: string;
};

export type PluginStatusSnapshot = {
  plugins: Array<{
    manifest: {
      id: string;
      name: string;
      permissions: string[];
      panel?: { title?: string; path?: string };
    };
    enabled: boolean;
    error?: string;
  }>;
};

export type PluginSidebarItem = {
  id: string;
  label: string;
};

/**
 * Ne garde que les plugins activés qui exposent une UI directement ouvrable.
 * `allowedIds` (ACL) : null/undefined = pas de filtre ; liste = filtre.
 */
export function pluginSidebarItems(
  status: PluginStatusSnapshot | null | undefined,
  allowedIds?: string[] | null,
): PluginSidebarItem[] {
  const allowed = Array.isArray(allowedIds) ? new Set(allowedIds) : null;
  return (status?.plugins || [])
    .filter(
      (plugin) =>
        plugin.enabled &&
        !plugin.error &&
        plugin.manifest.permissions?.includes("ui:panel") &&
        (!allowed || allowed.has(plugin.manifest.id)),
    )
    .map((plugin) => ({
      id: plugin.manifest.id,
      label: plugin.manifest.panel?.title?.trim() || plugin.manifest.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/** Informe les autres vues React qu'une mutation de plugins vient d'aboutir. */
export function notifyPluginsChanged(): void {
  const w = browserWindow();
  if (w?.dispatchEvent) {
    const Ev = (globalThis as { Event?: new (type: string) => object }).Event;
    if (Ev) w.dispatchEvent(new Ev(getProductHubUiBrand().pluginsChangedEvent) as never);
  }
}

function panelPathFromManifest(panel?: { path?: string }): string {
  const raw = panel?.path || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/** Résout l’URL panel d’un plugin running (Desktop IPC ou proxy web). */
export async function resolvePluginPanelOpenTarget(
  pluginId: string,
): Promise<PluginPanelOpenTarget | PluginPanelOpenFail> {
  const api = getDesktopApi();
  if (api?.resolvePluginPanel) {
    try {
      const r = await api.resolvePluginPanel(pluginId);
      if (!r.ok) return r;
      return {
        url: r.url,
        siteId: r.siteId,
        title: r.title,
        pluginId,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Panel introuvable",
      };
    }
  }

  // Navigateur / Docker : même origine via `/api/v1/plugins/<id>/*`
  // (tunnel Cloudflare inclus — pas besoin d'Electron ni de 127.0.0.1).
  try {
    const res = await fetch("/api/v1/os/plugins");
    if (!res.ok) {
      return {
        ok: false,
        error: `Liste plugins indisponible (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as {
      plugins?: PluginStatusSnapshot["plugins"];
      status?: {
        plugins?: PluginStatusSnapshot["plugins"];
        running?: Array<{
          id: string;
          panelUrl?: string | null;
          siteId?: number;
        }>;
      };
    };
    const plugins = data.status?.plugins || data.plugins || [];
    const running = data.status?.running || [];
    const plug = plugins.find((p) => p.manifest.id === pluginId);
    if (!plug) return { ok: false, error: `plugin inconnu: ${pluginId}` };
    if (!plug.manifest.permissions?.includes("ui:panel")) {
      return { ok: false, error: "permission ui:panel absente" };
    }
    const run = running.find((r) => r.id === pluginId);
    const pathPart = panelPathFromManifest(plug.manifest.panel);
    const url =
      run?.panelUrl ||
      `/api/v1/plugins/${encodeURIComponent(pluginId)}${pathPart}`;
    if (!run && !plug.enabled) {
      return { ok: false, error: "plugin non démarré (désactivé)" };
    }
    return {
      url,
      siteId: typeof run?.siteId === "number" ? run.siteId : 0,
      title: plug.manifest.panel?.title?.trim() || plug.manifest.name,
      pluginId,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Panel introuvable",
    };
  }
}

export function isPluginPanelOpenTarget(
  v: PluginPanelOpenTarget | PluginPanelOpenFail,
): v is PluginPanelOpenTarget {
  return Boolean(v && "url" in v && typeof v.url === "string");
}

export async function openPluginPanelInWorkspace(opts: {
  pluginId: string;
  openExternalSite?: (o: {
    siteId: number;
    url: string;
    title: string;
  }) => void;
}): Promise<{ ok: true } | PluginPanelOpenFail> {
  const target = await resolvePluginPanelOpenTarget(opts.pluginId);
  if (!isPluginPanelOpenTarget(target)) return target;
  if (opts.openExternalSite) {
    opts.openExternalSite({
      siteId: target.siteId,
      url: target.url,
      title: target.title,
    });
    return { ok: true };
  }
  browserWindow()?.open?.(target.url, "_blank", "noreferrer");
  return { ok: true };
}

export async function isRemoteDesktopClient(): Promise<boolean> {
  const api = getDesktopApi();
  if (!api?.getConnectionProfile) return false;
  try {
    const [profile, info] = await Promise.all([
      api.getConnectionProfile(),
      api.getAppInfo?.() ?? Promise.resolve(null),
    ]);
    const p = profile as { mode?: string } | null;
    const kind = info?.kind;
    const remote =
      p?.mode === "remote" || kind === "client";
    return Boolean(api && remote);
  } catch {
    return false;
  }
}
