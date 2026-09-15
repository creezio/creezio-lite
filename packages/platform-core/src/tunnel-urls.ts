/**
 * URLs publiques des embeds via tunnel Cloudflare.
 *
 * Deux modes d'hôtes (SoT partagée avec `tunnel-cf.ts`) :
 *
 *   nested (défaut, rétrocompat) — certificats Advanced Certificate Manager
 *     CRM     : https://{slug}.{zone}
 *     n8n     : https://n8n.{slug}.{zone}
 *     Hermes  : https://hermes.{slug}.{zone}
 *     agent   : https://agent.{slug}.{zone}  (flotte — hors embeds)
 *
 *   flat — Universal SSL (1 niveau de sous-domaine seulement)
 *     CRM     : https://{slug}.{zone}          (inchangé)
 *     n8n     : https://n8n-{slug}.{zone}
 *     Hermes  : https://hermes-{slug}.{zone}
 *     agent   : https://agent-{slug}.{zone}
 *
 * Pilotage (D2, mécanique unique) : env `CREEZIO_CF_UNIVERSAL_SSL` truthy →
 * nested ; sinon (défaut) → flat. Un explicite `hostMode` (opts / config
 * persistée) prime toujours l'env. Remplace `CREEZIO_TUNNEL_FLAT_HOSTS`
 * (supprimé en 0.10.0 — pas de double mécanisme).
 */

export const TUNNEL_EMBED_SERVICES = ["n8n", "hermes"] as const;
export type TunnelEmbedService = (typeof TUNNEL_EMBED_SERVICES)[number];

/** Services d'ingress tunnel (embeds + agent flotte). */
export const TUNNEL_HOST_SERVICES = ["n8n", "hermes", "agent"] as const;
export type TunnelHostService = (typeof TUNNEL_HOST_SERVICES)[number];

export type TunnelHostMode = "nested" | "flat";

export type TunnelPublicUrls = {
  crm: string;
  n8n: string;
  hermes: string;
};

export type TunnelUrlOpts = {
  /** Force le mode ; sinon `resolveTunnelHostMode()` (env / défaut nested). */
  hostMode?: TunnelHostMode;
};

/**
 * Env du mode de hostnames (D2) : truthy → nested (`n8n.{slug}.{zone}`,
 * zones avec certificat multi-niveaux) ; absent/falsy → flat
 * (`n8n-{slug}.{zone}`, compatible Universal SSL — défaut).
 */
export const TUNNEL_UNIVERSAL_SSL_ENV = "CREEZIO_CF_UNIVERSAL_SSL";

function cleanHost(raw: string): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]!;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Résout nested | flat.
 * - explicit "flat" | true | "1" → flat
 * - explicit "nested" | false | "0" → nested
 * - sinon env CREEZIO_CF_UNIVERSAL_SSL=1|true → nested
 * - défaut → flat (Universal SSL, 1 niveau de sous-domaine)
 */
export function resolveTunnelHostMode(
  explicit?: TunnelHostMode | boolean | string | null,
): TunnelHostMode {
  if (explicit === "flat" || explicit === true || explicit === "1") {
    return "flat";
  }
  if (explicit === "nested" || explicit === false || explicit === "0") {
    return "nested";
  }
  const env = String(process.env[TUNNEL_UNIVERSAL_SSL_ENV] || "")
    .trim()
    .toLowerCase();
  if (env === "1" || env === "true" || env === "yes" || env === "on") {
    return "nested";
  }
  return "flat";
}

function modeFromOpts(opts?: TunnelUrlOpts | TunnelHostMode): TunnelHostMode {
  if (typeof opts === "string") return resolveTunnelHostMode(opts);
  return resolveTunnelHostMode(opts?.hostMode);
}

/** Première label DNS = slug CRM ; le reste = zone. */
export function splitCrmHostname(crmHostname: string): {
  slug: string;
  zone: string;
} {
  const host = cleanHost(crmHostname);
  const i = host.indexOf(".");
  if (i <= 0 || i === host.length - 1) {
    throw new Error(`hostname CRM invalide: ${crmHostname}`);
  }
  return { slug: host.slice(0, i), zone: host.slice(i + 1) };
}

/**
 * Retire un préfixe service (nested `svc.` ou flat `svc-` sur la 1ʳᵉ label)
 * pour retrouver le hostname CRM.
 */
export function stripTunnelServicePrefix(hostname: string): string {
  const host = cleanHost(hostname);
  if (!host) return host;
  for (const svc of TUNNEL_HOST_SERVICES) {
    if (host.startsWith(`${svc}.`)) {
      return host.slice(svc.length + 1);
    }
  }
  const dot = host.indexOf(".");
  if (dot > 0) {
    const label = host.slice(0, dot);
    const zone = host.slice(dot + 1);
    for (const svc of TUNNEL_HOST_SERVICES) {
      const prefix = `${svc}-`;
      if (label.startsWith(prefix) && label.length > prefix.length) {
        return `${label.slice(prefix.length)}.${zone}`;
      }
    }
  }
  return host;
}

/** Hostnames services pour un slug CRM (nested ou flat). */
export function tunnelServiceHostname(
  crmHostname: string,
  service: TunnelHostService | TunnelEmbedService,
  opts?: TunnelUrlOpts | TunnelHostMode,
): string {
  const mode = modeFromOpts(opts);
  const host = cleanHost(crmHostname);
  if (!host) throw new Error("hostname CRM requis");

  // Déjà le bon hostname service → no-op.
  if (mode === "nested" && host.startsWith(`${service}.`)) return host;
  if (mode === "flat") {
    const { slug, zone } = (() => {
      try {
        return splitCrmHostname(stripTunnelServicePrefix(host));
      } catch {
        return splitCrmHostname(host);
      }
    })();
    const flat = `${service}-${slug}.${zone}`;
    if (host === flat) return host;
  }

  const crmHost = stripTunnelServicePrefix(host);
  if (mode === "flat") {
    const { slug, zone } = splitCrmHostname(crmHost);
    return `${service}-${slug}.${zone}`;
  }
  return `${service}.${crmHost}`;
}

/** Construit le map d'URLs publiques pour un hostname CRM. */
export function buildTunnelPublicUrls(
  crmHostname: string,
  opts?: TunnelUrlOpts | TunnelHostMode,
): TunnelPublicUrls {
  const mode = modeFromOpts(opts);
  const host = cleanHost(crmHostname);
  if (!host) throw new Error("hostname CRM requis");
  const crmHost = stripTunnelServicePrefix(host);
  return {
    crm: `https://${crmHost}`,
    n8n: `https://${tunnelServiceHostname(crmHost, "n8n", mode)}`,
    hermes: `https://${tunnelServiceHostname(crmHost, "hermes", mode)}`,
  };
}

/**
 * Dérive l'URL publique d'un embed depuis l'origine CRM (mode Rejoindre).
 * Retourne null si l'origin n'appartient pas au `tunnelRootDomain`.
 */
export function deriveTunnelServiceUrl(
  crmOrigin: string,
  service: TunnelEmbedService,
  tunnelRootDomain: string,
  opts?: TunnelUrlOpts | TunnelHostMode,
): string | null {
  try {
    let s = String(crmOrigin || "").trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
    const u = new URL(s);
    const root = cleanHost(tunnelRootDomain);
    const re = new RegExp(`(^|\\.)${escapeRegex(root)}$`, "i");
    if (!re.test(u.hostname)) return null;
    return `https://${tunnelServiceHostname(u.hostname, service, opts)}`;
  } catch {
    return null;
  }
}

/** Extrait le port d'une URL loopback locale. */
export function portFromLocalUrl(
  url: string | null | undefined,
): number | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.port) {
      const n = Number(u.port);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (u.protocol === "https:") return 443;
    if (u.protocol === "http:") return 80;
    return null;
  } catch {
    return null;
  }
}
