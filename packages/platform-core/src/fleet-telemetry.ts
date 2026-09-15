/**
 * Consentement télémétrie flotte — extrait historique fleet-telemetry.ts (M4).
 * Labels UI marque restent hors kit ; ici : types + sanitize/patch purs.
 */

export const FLEET_CONSENT_VERSION = 1;

/** Scopes connus — ordre d’affichage Config. */
export const FLEET_SCOPE_IDS = [
  "heartbeat",
  "crashes",
  "ops",
  "sessions",
  "users",
  "request_logs",
  "hermes_stats",
  "hermes_chats",
  "assistant_chats",
  "plugins",
  "actions",
  "remote_commands",
] as const;

export type FleetScopeId = (typeof FLEET_SCOPE_IDS)[number];

export type FleetTelemetryScopes = Record<FleetScopeId, boolean>;

export type FleetTelemetryConfig = {
  /** Master : si false, aucun POST flotte. */
  enabled: boolean;
  scopes: FleetTelemetryScopes;
  /** ISO — premier/dernier consentement master ON. */
  consentAt: string | null;
  consentVersion: number;
};

export type FleetTelemetryPatch = Partial<{
  enabled: boolean;
  scopes: Partial<FleetTelemetryScopes>;
  preset: "basic" | "off" | "keep";
}>;

export function defaultFleetScopes(): FleetTelemetryScopes {
  const scopes = {} as FleetTelemetryScopes;
  for (const id of FLEET_SCOPE_IDS) scopes[id] = false;
  return scopes;
}

/** Scopes « support basique » (présence + crashes + boîte noire). */
export function basicSupportScopes(): FleetTelemetryScopes {
  const scopes = defaultFleetScopes();
  scopes.heartbeat = true;
  scopes.crashes = true;
  scopes.ops = true;
  return scopes;
}

/**
 * Défaut install neuve (phase éditeur) : basique + pilotage distant ON.
 * Une config déjà persistée (même désactivée) n'est JAMAIS écrasée —
 * `sanitizeFleetTelemetry` ne retombe ici qu'en l'absence totale de config.
 */
export function defaultFleetTelemetry(): FleetTelemetryConfig {
  const scopes = basicSupportScopes();
  scopes.remote_commands = true;
  return {
    enabled: true,
    scopes,
    consentAt: null,
    consentVersion: FLEET_CONSENT_VERSION,
  };
}

export function sanitizeFleetTelemetry(raw: unknown): FleetTelemetryConfig {
  const base = defaultFleetTelemetry();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true;
  const scopes = defaultFleetScopes();
  const rawScopes =
    o.scopes && typeof o.scopes === "object"
      ? (o.scopes as Record<string, unknown>)
      : {};
  for (const id of FLEET_SCOPE_IDS) {
    scopes[id] = rawScopes[id] === true;
  }
  let consentAt: string | null = null;
  if (typeof o.consentAt === "string" && o.consentAt.length > 0) {
    consentAt = o.consentAt.slice(0, 40);
  }
  const consentVersion =
    typeof o.consentVersion === "number" && Number.isFinite(o.consentVersion)
      ? Math.max(1, Math.floor(o.consentVersion))
      : FLEET_CONSENT_VERSION;
  return { enabled, scopes, consentAt, consentVersion };
}

/** Gate unique : master + scope. */
export function isFleetScopeActive(
  cfg: FleetTelemetryConfig,
  scope: FleetScopeId,
): boolean {
  return cfg.enabled === true && cfg.scopes[scope] === true;
}

/**
 * Applique un patch UI. Si master passe à ON sans consentAt → horodatage.
 * Si master OFF → conserve scopes (pour réactivation) mais coupe les envois.
 */
export function applyFleetTelemetryPatch(
  current: FleetTelemetryConfig,
  patch: FleetTelemetryPatch,
): FleetTelemetryConfig {
  let next = { ...current, scopes: { ...current.scopes } };

  if (patch.preset === "off") {
    next.enabled = false;
    next.scopes = defaultFleetScopes();
    return next;
  }
  if (patch.preset === "basic") {
    next.enabled = true;
    next.scopes = basicSupportScopes();
    if (!next.consentAt) next.consentAt = new Date().toISOString();
    next.consentVersion = FLEET_CONSENT_VERSION;
    return next;
  }

  if (typeof patch.enabled === "boolean") {
    next.enabled = patch.enabled;
    if (patch.enabled && !next.consentAt) {
      next.consentAt = new Date().toISOString();
      next.consentVersion = FLEET_CONSENT_VERSION;
    }
  }
  if (patch.scopes && typeof patch.scopes === "object") {
    for (const id of FLEET_SCOPE_IDS) {
      if (typeof patch.scopes[id] === "boolean") {
        next.scopes[id] = patch.scopes[id] as boolean;
      }
    }
  }
  return sanitizeFleetTelemetry(next);
}
