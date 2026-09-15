/**
 * Injection host pour request-logs (évite imports `@/` marque).
 * O5 — noyau générique kit.
 */

export type RequestLogsConfig = {
  /**
   * Répertoire miroir jsonl pour l’agent flotte Electron.
   * Défaut : `CREEZIO_FLEET_STATE_DIR`, sinon la variable
   * `${envPrefix}_FLEET_STATE_DIR` dérivée du manifest marque (posée par le
   * host — voir brand-host-stack) : aucun préfixe marque énuméré ici.
   */
  getFleetStateDir?: () => string | undefined;
};

let config: RequestLogsConfig = {};

export function configureRequestLogs(next: RequestLogsConfig): void {
  config = next ?? {};
}

export function getRequestLogsConfig(): RequestLogsConfig {
  return config;
}

export function resetRequestLogsConfigForTests(): void {
  config = {};
}

const FLEET_STATE_DIR_SUFFIX = "_FLEET_STATE_DIR";

/** Résout le dir miroir (config marque, env générique, ou envKey manifest). */
export function resolveFleetStateDir(): string | undefined {
  const custom = config.getFleetStateDir?.();
  if (custom) return custom;
  const generic = process.env.CREEZIO_FLEET_STATE_DIR;
  if (generic) return generic;
  // Dérivation manifest/envKey : le host pose `${envPrefix}_FLEET_STATE_DIR`
  // (préfixe issu du manifest marque) — on accepte n'importe quel préfixe,
  // ce qui couvre aussi les préfixes legacy sans les câbler ici.
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value &&
      key.endsWith(FLEET_STATE_DIR_SUFFIX) &&
      key !== "CREEZIO_FLEET_STATE_DIR"
    ) {
      return value;
    }
  }
  return undefined;
}
