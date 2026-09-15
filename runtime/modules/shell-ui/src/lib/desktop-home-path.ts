import { getShellDesktopApi } from "../brand.js";
/** Accueil CRM classique (Client / legacy / navigateur). */
export const CRM_HOME_PATH = "/dashboard";

/** Surface ops de l'app desktop Serveur (kind=server). */
export const SERVER_COCKPIT_PATH = "/server-cockpit";

/**
 * Chemin d'accueil par défaut hors contexte desktop (SSR, navigateur).
 */
export function defaultHomePathSync(): string {
  return CRM_HOME_PATH;
}

/**
 * Après onboarding / skip / login sans `?next=` : cockpit serveur si
 * `desktop:info` signale appKind=server, sinon dashboard CRM.
 */
export async function resolveDesktopHomePath(): Promise<string> {
  if (typeof window === "undefined") return CRM_HOME_PATH;
  try {
    const info = await getShellDesktopApi()?.getInfo?.();
    if (info?.appKind === "server") return SERVER_COCKPIT_PATH;
  } catch {
    /* hors desktop ou IPC indisponible */
  }
  return CRM_HOME_PATH;
}
