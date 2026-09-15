/**
 * Allowlist web des agents IA — appliquée AU NIVEAU EXÉCUTION (hosts) :
 * `AiSessionHost.openTab` (browser-host, Chromium serveur) et
 * `executeSupplierAction` (electron-shell, onglets externes desktop).
 *
 * La garde du runner de tâches (`aiWebHostAllowed`, @creezio/tasks) reste en
 * place comme garde UX (message orienté `ask_human`) — ici c'est la défense
 * en profondeur : même un appel qui contourne le runner (tool MCP direct,
 * bridge SSE, code marque) est refusé par l'exécuteur.
 *
 * Convention env : toute variable `*_WEB_ALLOWED_HOSTS` (préfixe marque tel
 * que lu par le runner, ex. `TF3_AI_WEB_ALLOWED_HOSTS`, ou générique
 * `CREEZIO_WEB_ALLOWED_HOSTS`), valeur CSV d'hôtes
 * (`exemple.com, *.fournisseur.fr` — sous-domaines inclus). Un process ne
 * sert qu'UNE marque : on prend l'union de toutes les variables présentes.
 * Aucune variable définie (ou valeurs vides) = pas de filtrage (tout http(s)),
 * même sémantique que le runner.
 */

/** Code d'erreur stable pour un refus host-level. */
export const WEB_HOST_NOT_ALLOWED_CODE = "web_host_not_allowed";

const ALLOWLIST_ENV_RE = /^[A-Z][A-Z0-9_]*_WEB_ALLOWED_HOSTS$/;

/**
 * Hôtes autorisés d'après l'environnement (union des `*_WEB_ALLOWED_HOSTS`).
 * `null` = aucun filtrage configuré.
 */
export function readWebAllowedHosts(
  env: NodeJS.ProcessEnv = process.env,
): string[] | null {
  const hosts = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!ALLOWLIST_ENV_RE.test(key)) continue;
    const raw = String(value || "").trim();
    if (!raw) continue;
    for (const part of raw.split(",")) {
      const host = part.trim().toLowerCase().replace(/^\*\./, "");
      if (host) hosts.add(host);
    }
  }
  return hosts.size ? [...hosts] : null;
}

export type WebHostCheck =
  | { ok: true; host: string }
  | { ok: false; error: string; code: typeof WEB_HOST_NOT_ALLOWED_CODE };

/**
 * Vérifie qu'une URL http(s) pointe vers un hôte de l'allowlist.
 * Refus = `{ ok:false, code:"web_host_not_allowed" }` (erreur claire, jamais
 * de throw). URL non http(s)/invalide = refus aussi (fail-closed côté host —
 * les exécuteurs valident déjà le schéma en amont pour un message dédié).
 */
export function checkWebHostAllowed(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): WebHostCheck {
  let host = "";
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("non http(s)");
    }
    host = parsed.hostname.toLowerCase();
  } catch {
    return {
      ok: false,
      error: `URL invalide ou non http(s) : ${String(url || "").slice(0, 200)}`,
      code: WEB_HOST_NOT_ALLOWED_CODE,
    };
  }
  const allowed = readWebAllowedHosts(env);
  if (!allowed) return { ok: true, host };
  const match = allowed.some((h) => host === h || host.endsWith(`.${h}`));
  if (match) return { ok: true, host };
  return {
    ok: false,
    error: `Hôte « ${host} » hors de l'allowlist *_WEB_ALLOWED_HOSTS (${WEB_HOST_NOT_ALLOWED_CODE})`,
    code: WEB_HOST_NOT_ALLOWED_CODE,
  };
}
