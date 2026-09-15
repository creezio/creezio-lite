/**
 * Remontée d'incidents serveur (app desktop) vers le collecteur de crash de
 * l'éditeur — ex. « Meilisearch indisponible alors que la recherche est
 * sollicitée ». Best-effort, jamais bloquant, dédupliqué (1 envoi max par
 * type d'incident par heure) pour ne pas inonder le collecteur.
 *
 * Actif uniquement si `{PREFIX}_CRASH_ENDPOINT` (ou `LITE_CRASH_ENDPOINT`)
 * est injecté dans l'environnement (fait par brand-host-stack / server-launcher).
 * En déploiement web classique, cette fonction est un no-op.
 */

const DEDUP_MS = 3600_000;
const lastSent = new Map<string, number>();

function firstEnv(...keys: string[]): string {
  for (const k of keys) {
    const v = (process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

/** `LITE_*` puis scan `*_CRASH_ENDPOINT` (clé canonique `envKey`). */
function resolveCrashEndpoint(): string {
  const direct = firstEnv("LITE_CRASH_ENDPOINT");
  if (direct) return direct;
  for (const [k, v] of Object.entries(process.env)) {
    if (k.endsWith("_CRASH_ENDPOINT") && (v || "").trim()) {
      return v!.trim();
    }
  }
  return "";
}

function resolveInstallId(): string {
  return (
    firstEnv("LITE_INSTALL_ID") ||
    (() => {
      for (const [k, v] of Object.entries(process.env)) {
        if (k.endsWith("_INSTALL_ID") && (v || "").trim()) return v!.trim();
      }
      return "server";
    })()
  );
}

function resolveAppVersion(): string {
  return (
    firstEnv("LITE_APP_VERSION", "npm_package_version") || "unknown"
  );
}

export function reportServerIncident(kind: string, detail: Record<string, unknown>): void {
  const endpoint = resolveCrashEndpoint();
  if (!endpoint) return;
  const now = Date.now();
  const prev = lastSent.get(kind) || 0;
  if (now - prev < DEDUP_MS) return;
  lastSent.set(kind, now);

  console.error(`[incident] ${kind}: ${JSON.stringify(detail).slice(0, 300)}`);
  void fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: `server-${kind}`,
      brandId: firstEnv("LITE_BRAND_ID", "LITE_BRAND") || null,
      installId: resolveInstallId(),
      appVersion: resolveAppVersion(),
      platform: process.platform,
      bootStage: "running",
      timestamp: new Date().toISOString(),
      detail,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
