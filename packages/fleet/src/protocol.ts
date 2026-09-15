/**
 * Contrat de version du protocole flotte agent ↔ backend (F4.4d).
 *
 * Header HTTP `x-creezio-fleet-protocol` porté dans les DEUX sens des
 * échanges backend flotte (server-admin) ↔ agent hôte (host-agent), et par
 * la boucle pull agent → app admin (module fleet-releases).
 *
 * Politique de compatibilité (protocole v1, strict depuis 0.19.0) :
 *   - header présent et égal à FLEET_PROTOCOL_VERSION → OK ;
 *   - header ABSENT → REFUS fail-closed (dual-accept 0.15→0.18 terminé :
 *     vérifié via l'API flotte 2026-08-31, tous les composants déployés
 *     — host-agents enrôlés inclus — annoncent le protocole v1) ;
 *   - header présent mais différent → REFUS explicite avec message
 *     actionnable (jamais de dégradation silencieuse).
 *
 * Historique F4.4d : le dual-accept (header absent = warn bruyant throttlé)
 * couvrait la génération ≤ 0.14 pendant UNE version. Le retrait des wrappers
 * fleet-collector (0.19.0) acte la fin de cette génération — pas de bump v2 :
 * le format filaire n'a pas changé, seul le défaut de tolérance passe strict.
 */

export const FLEET_PROTOCOL_VERSION = 1;

export const FLEET_PROTOCOL_HEADER = "x-creezio-fleet-protocol";

/** Dual-accept terminé (0.19.0) : l'absence de header est refusée fail-closed. */
export const FLEET_PROTOCOL_ACCEPT_MISSING: boolean = false;

export type ProtocolDecision =
  | { action: "ok" }
  | { action: "warn-missing"; message: string }
  | { action: "refuse"; message: string };

/**
 * Décision de compatibilité pour un header de protocole reçu.
 * `peer` est un libellé lisible du composant distant (ex. "agent hostId=x").
 */
export function checkFleetProtocol(
  raw: string | null | undefined,
  peer: string,
): ProtocolDecision {
  const v = String(raw ?? "").trim();
  if (!v) {
    const message =
      `${peer} sans version de protocole flotte (header ${FLEET_PROTOCOL_HEADER} absent — génération ≤ 0.14). ` +
      (FLEET_PROTOCOL_ACCEPT_MISSING
        ? `Accepté cette version (dual-accept), refus fail-closed à venir — `
        : `Refus fail-closed (dual-accept terminé en 0.19.0) — `) +
      `mettre à jour : agent hôte via \`creezio server-docker agent up\`, backend via \`creezio server-docker admin up\`.`;
    return FLEET_PROTOCOL_ACCEPT_MISSING
      ? { action: "warn-missing", message }
      : { action: "refuse", message };
  }
  if (Number(v) === FLEET_PROTOCOL_VERSION) return { action: "ok" };
  return {
    action: "refuse",
    message:
      `${peer} en protocole flotte v${v} ≠ v${FLEET_PROTOCOL_VERSION} supporté — geste refusé (pas de dégradation silencieuse). ` +
      `Mettre à jour le composant le plus ancien : agent hôte via \`creezio server-docker agent up\`, ` +
      `backend via \`creezio server-docker admin up\`, puis rejouer le geste.`,
  };
}

/* Warn throttlé — évite le spam des pollers (snapshot 30 s, pull 5 min). */
const lastWarnAt = new Map<string, number>();

/** true si un warn peut être émis pour cette clé (défaut : 1 / 10 min). */
export function shouldWarnProtocol(key: string, intervalMs = 600_000): boolean {
  const now = Date.now();
  const prev = lastWarnAt.get(key) || 0;
  if (now - prev < intervalMs) return false;
  lastWarnAt.set(key, now);
  return true;
}
