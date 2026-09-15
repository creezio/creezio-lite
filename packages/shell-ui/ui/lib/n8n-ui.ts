import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";
/**
 * Ouverture n8n UI dans un onglet workspace.
 * Contrat : n8n est déjà installé + démarré au splash Héberger.
 * Aucun download / ensure / start au clic.
 */

/** Partition Electron stable (catalogue outils ≥ 900000). Aligné EMBED_TOOL_SITE_IDS.n8nUi. */
export const N8N_UI_SITE_ID = 900097;

export const N8N_UI_TAB_TITLE = "n8n";

export type N8nUiOpenTarget = {
  url: string;
  siteId: number;
  title: string;
};

export type N8nUiOpenFail = {
  ok: false;
  error: string;
  needsConfig?: boolean;
  installing?: boolean;
};

/** Résout l’URL n8n déjà prête (splash) — pas de bootstrap. */
export async function resolveN8nUiOpenTarget(): Promise<
  N8nUiOpenTarget | N8nUiOpenFail
> {
  const api = typeof window !== "undefined" ? getShellDesktopApi() : undefined;
  if (!api?.getN8nStatus) {
    return {
      ok: false,
      error: "n8n disponible uniquement dans l’app desktop.",
    };
  }
  try {
    const st = await api.getN8nStatus();
    const url = (st.uiUrl || "").trim();
    if (!url) {
      if (st.status === "skipped-remote-client") {
        return {
          ok: false,
          error:
            "Client distant — URL n8n introuvable. Rejoignez un hôte via {slug}." + getShellUiBrand().publicHostSuffix + " (sous-domaine n8n.{slug}…).",
        };
      }
      return {
        ok: false,
        error:
          "n8n n’est pas prêt. Redémarrez " + getShellUiBrand().productName + " et attendez la fin du splash (install automatique).",
      };
    }
    return {
      url,
      siteId: N8N_UI_SITE_ID,
      title: N8N_UI_TAB_TITLE,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Statut n8n indisponible",
    };
  }
}

export function isN8nUiOpenTarget(
  v: N8nUiOpenTarget | N8nUiOpenFail,
): v is N8nUiOpenTarget {
  return Boolean(v && "url" in v && typeof v.url === "string");
}

/** Ouvre l’onglet n8n — URL déjà connue, cookie session optionnel. */
export async function openN8nUiInWorkspace(opts: {
  openExternalSite?: (o: {
    siteId: number;
    url: string;
    title: string;
  }) => void;
  openTab?: (siteId: number, url: string) => Promise<unknown>;
  onProgress?: (msg: string) => void;
}): Promise<{ ok: true } | N8nUiOpenFail> {
  const api = typeof window !== "undefined" ? getShellDesktopApi() : undefined;
  const target = await resolveN8nUiOpenTarget();
  if (!isN8nUiOpenTarget(target)) {
    return target;
  }
  if (api?.prepareN8nSession) {
    try {
      const prep = await api.prepareN8nSession();
      if (!prep.ok) {
        console.warn("[n8n] prepareN8nSession:", prep.detail);
      }
    } catch (e) {
      console.warn(
        "[n8n] prepareN8nSession failed",
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (opts.openExternalSite) {
    opts.openExternalSite({
      siteId: target.siteId,
      url: target.url,
      title: target.title,
    });
    return { ok: true };
  }
  if (opts.openTab) {
    await opts.openTab(target.siteId, target.url);
    return { ok: true };
  }
  window.open(target.url, "_blank", "noreferrer");
  return { ok: true };
}
