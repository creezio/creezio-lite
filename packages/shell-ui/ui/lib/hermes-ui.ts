import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";
/**
 * Ouverture Hermes WebUI dans un onglet workspace (outil externe).
 * URL dynamique (port libre desktop) — résolue via IPC getHermesStatus.
 */

import { isRemoteDesktopClient } from "./desktop-host";

/** Partition Electron stable (catalogue outils ≥ 900000). */
export const HERMES_WEBUI_SITE_ID = 900099;

export const HERMES_WEBUI_TAB_TITLE = "Hermes";

export type HermesWebuiOpenTarget = {
  url: string;
  siteId: number;
  title: string;
};

/** Statut Hermes desktop — typé soft (API marque via getShellDesktopApi). */
type HermesDesktopStatus = {
  status?: string;
  detail?: string | null;
  uiUrl?: string | null;
  webuiUrl?: string | null;
  webuiStatus?: string | null;
  bootstrapError?: string | null;
};

function cleanDetail(value: string | null | undefined): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

/** Message actionnable fondé sur l’état réel, jamais sur l’ancien splash. */
export function hermesUnavailableMessage(st: HermesDesktopStatus): string {
  const detail = cleanDetail(st.bootstrapError || st.detail);
  if (st.status === "starting" || st.status === "installing") {
    return "Hermes est encore en cours de démarrage. " + getShellUiBrand().productName + " continue d’attendre l’API et la WebUI.";
  }
  if (st.status === "missing") {
    return `Le runtime Hermes est absent ou incomplet${detail ? ` : ${detail}` : "."} Ouvrez Configuration → Hermes → Réparer.`;
  }
  if (st.status === "error") {
    const timeout = /timeout|délai/i.test(detail);
    return `${timeout ? "Le démarrage Hermes a dépassé le délai prévu" : "Hermes n’a pas pu démarrer"}${detail ? ` : ${detail}` : "."} Vous pouvez réessayer ; les détails sont dans Configuration → Hermes → Logs.`;
  }
  if (st.status === "running" && st.webuiStatus !== "running") {
    return `L’API Hermes fonctionne, mais la WebUI est ${st.webuiStatus === "missing" ? "absente" : "indisponible"}${detail ? ` : ${detail}` : "."} Utilisez Réparer dans Configuration → Hermes.`;
  }
  if (st.status === "stopped") {
    return `Hermes s’est arrêté après l’ouverture de ${getShellUiBrand().productName}${detail ? ` : ${detail}` : "."} Réessayez maintenant ou consultez Configuration → Hermes → Logs.`;
  }
  return `Hermes est indisponible (état ${st.status}, WebUI ${st.webuiStatus})${detail ? ` : ${detail}` : "."}`;
}

/** Résout l’URL et relance Hermes local une fois si nécessaire. */
export async function resolveHermesWebuiOpenTarget(opts?: {
  onRetry?: () => void;
}): Promise<
  HermesWebuiOpenTarget | { ok: false; error: string }
> {
  const api = typeof window !== "undefined" ? getShellDesktopApi() : undefined;
  if (!api?.getHermesStatus) {
    return {
      ok: false,
      error: "Hermes disponible uniquement dans l’app desktop.",
    };
  }
  try {
    let st = await api.getHermesStatus();
    let url = (st.webuiUrl || "").trim();
    if (
      !url &&
      st.status !== "skipped-remote-client" &&
      st.status !== "remote" &&
      api.retryHermes &&
      // Client distant : hermes:retry est host-only, ne jamais le tenter.
      !(await isRemoteDesktopClient())
    ) {
      opts?.onRetry?.();
      st = await api.retryHermes();
      url = (st.webuiUrl || "").trim();
    }
    if (!url) {
      if (st.status === "skipped-remote-client") {
        return {
          ok: false,
          error:
            "Client distant — URL Hermes introuvable. Rejoignez un hôte via {slug}." + getShellUiBrand().publicHostSuffix + " (sous-domaine hermes.{slug}…).",
        };
      }
      return {
        ok: false,
        error: hermesUnavailableMessage(st),
      };
    }
    return {
      url,
      siteId: HERMES_WEBUI_SITE_ID,
      title: HERMES_WEBUI_TAB_TITLE,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Statut Hermes indisponible",
    };
  }
}

export function isHermesWebuiOpenTarget(
  v: HermesWebuiOpenTarget | { ok: false; error: string },
): v is HermesWebuiOpenTarget {
  return Boolean(v && "url" in v && typeof v.url === "string");
}
