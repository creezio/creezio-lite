"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";
/**
 * Détection partagée « cette page tourne-t-elle dans un desktop client
 * distant ? » (app Client kind=client, ou legacy joint en remote).
 *
 * - Navigateur pur (pas de getShellDesktopApi()) → l'UI est servie par le
 *   serveur : on considère « hôte » (les panneaux desktop se rendent null
 *   d'eux-mêmes hors Electron).
 * - Desktop avec profil remote → client distant : les sections/actions qui
 *   pilotent la stack locale (Hermes, n8n, tunnel, plugins, reindex…) sont
 *   gérées par l'app Serveur, pas par ce poste.
 *
 * Résultat mis en cache pour la durée de vie de la page : le mode de
 * connexion ne change jamais sans relance de l'app.
 */

export type DesktopHostInfo = {
  /** true si getShellDesktopApi() existe (Electron). */
  isDesktop: boolean;
  /** true si les actions host-only ont un sens ici (hôte local ou navigateur). */
  isHost: boolean;
  appKind: "server" | "client" | "legacy" | null;
};

let cached: Promise<DesktopHostInfo> | null = null;

export function getDesktopHostInfo(): Promise<DesktopHostInfo> {
  if (cached) return cached;
  cached = (async (): Promise<DesktopHostInfo> => {
    if (typeof window === "undefined") {
      return { isDesktop: false, isHost: true, appKind: null };
    }
    const api = getShellDesktopApi();
    if (!api?.getConnectionProfile) {
      return { isDesktop: false, isHost: true, appKind: null };
    }
    try {
      const [profile, info] = await Promise.all([
        api.getConnectionProfile(),
        api.getInfo?.() ?? Promise.resolve(undefined),
      ]);
      return {
        isDesktop: true,
        isHost: profile.mode !== "remote",
        appKind: info?.appKind ?? null,
      };
    } catch {
      // IPC indisponible : ne pas casser l'UI, comportement hôte par défaut.
      return { isDesktop: true, isHost: true, appKind: null };
    }
  })();
  return cached;
}

/** Raccourci : true quand ce poste est un client distant (host-only à masquer). */
export async function isRemoteDesktopClient(): Promise<boolean> {
  const info = await getDesktopHostInfo();
  return info.isDesktop && !info.isHost;
}

/* ── Miroir télémétrie flotte ────────────────────────────────────────────── */

export type FleetActionPayload = {
  type: string;
  label: string;
  path?: string;
  userId?: string;
  username?: string;
  meta?: Record<string, unknown>;
};

/** null = résolution hôte en cours (on bufferise), sinon décision figée. */
let fleetMirrorAllowed: boolean | null = null;
let fleetMirrorBuffer: FleetActionPayload[] = [];
const FLEET_MIRROR_BUFFER_MAX = 20;

function sendFleetAction(payload: FleetActionPayload): void {
  const api = typeof window !== "undefined" ? getShellDesktopApi() : undefined;
  if (!api?.reportFleetAction) return;
  // catch : best-effort — jamais de rejet non géré pour de la télémétrie.
  void api.reportFleetAction(payload).catch(() => {});
}

/**
 * Miroir flotte gaté : sur un client distant (app Client / legacy joint en
 * remote), fleet:action est un canal host-only — on n'appelle simplement pas
 * l'IPC au lieu de générer un rejet à chaque page vue / clic.
 */
export function mirrorFleetAction(payload: FleetActionPayload): void {
  if (typeof window === "undefined") return;
  if (!getShellDesktopApi()?.reportFleetAction) return;
  if (fleetMirrorAllowed === true) {
    sendFleetAction(payload);
    return;
  }
  if (fleetMirrorAllowed === false) return;
  // Résolution en cours : bufferiser les premiers événements pour ne pas
  // perdre le page.view initial côté hôte.
  fleetMirrorBuffer.push(payload);
  if (fleetMirrorBuffer.length > FLEET_MIRROR_BUFFER_MAX) {
    fleetMirrorBuffer = fleetMirrorBuffer.slice(-FLEET_MIRROR_BUFFER_MAX);
  }
  if (fleetMirrorBuffer.length > 1) return; // résolution déjà lancée
  void isRemoteDesktopClient().then((remote) => {
    fleetMirrorAllowed = !remote;
    const pending = fleetMirrorBuffer;
    fleetMirrorBuffer = [];
    if (fleetMirrorAllowed) {
      for (const p of pending) sendFleetAction(p);
    }
  });
}
