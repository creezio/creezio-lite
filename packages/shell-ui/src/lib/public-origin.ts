import { getShellUiBrand } from "../brand.js";

/**
 * Origine publique pour redirects / liens absolus derrière un reverse-proxy
 * (Cloudflare Tunnel) ou en local desktop (Electron sur 127.0.0.1).
 *
 * Priorité :
 * 1. X-Forwarded-Host non-loopback (+ X-Forwarded-Proto)
 * 2. Host non-loopback
 * 3. APP_PUBLIC_URL si la requête vient du tunnel (CF / proto https)
 *    alors que Host a été réécrit en localhost/127.0.0.1
 * 4. URL de la requête / APP_BASE_URL (accès local Electron)
 */

export type HeaderReader = {
  get(name: string): string | null;
};

export type ResolvedOrigin = {
  origin: string;
  proto: "http" | "https";
  host: string;
  source:
    | "x-forwarded-host"
    | "host"
    | "app-public-url"
    | "request-url"
    | "app-base-url"
    | "default";
};

function firstHeader(value: string | null): string {
  if (!value) return "";
  return value.split(",")[0]?.trim() || "";
}

export function isLoopbackHost(host: string): boolean {
  const raw = (host || "").toLowerCase().trim();
  let bare: string;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    bare = end >= 0 ? raw.slice(1, end) : raw.replace(/[\[\]]/g, "");
  } else {
    bare = raw.split(":")[0] || "";
  }
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

function hasCloudflareHints(headers: HeaderReader): boolean {
  if (headers.get("cf-connecting-ip") || headers.get("cf-ray")) return true;
  const visitor = headers.get("cf-visitor") || "";
  return /"scheme"\s*:\s*"https"/i.test(visitor) || /https/i.test(visitor);
}

function normalizeProto(
  raw: string,
  fallback: "http" | "https",
): "http" | "https" {
  const p = raw.toLowerCase();
  if (p === "http" || p === "https") return p;
  return fallback;
}

export function resolvePublicOrigin(
  headers: HeaderReader,
  opts?: {
    fallbackUrl?: string | URL;
    appPublicUrl?: string | null;
    appBaseUrl?: string | null;
  },
): ResolvedOrigin {
  const xfHost = firstHeader(headers.get("x-forwarded-host"));
  const hostHeader = firstHeader(headers.get("host"));
  const xfProto = firstHeader(headers.get("x-forwarded-proto")).toLowerCase();
  const fromTunnel = xfProto === "https" || hasCloudflareHints(headers);
  const appPublic = (opts?.appPublicUrl || "").trim().replace(/\/+$/, "");

  if (xfHost && !isLoopbackHost(xfHost)) {
    const proto = normalizeProto(xfProto, "https");
    return {
      origin: `${proto}://${xfHost}`,
      proto,
      host: xfHost,
      source: "x-forwarded-host",
    };
  }

  if (hostHeader && !isLoopbackHost(hostHeader)) {
    const proto = normalizeProto(
      xfProto,
      hostHeader.toLowerCase().endsWith("." + getShellUiBrand().publicHostSuffix) || fromTunnel
        ? "https"
        : "http",
    );
    return {
      origin: `${proto}://${hostHeader}`,
      proto,
      host: hostHeader,
      source: "host",
    };
  }

  // Tunnel actif mais Host réécrit vers localhost:PORT par cloudflared.
  if (appPublic && fromTunnel) {
    try {
      const u = new URL(appPublic);
      const proto = u.protocol === "http:" ? "http" : "https";
      return {
        origin: u.origin,
        proto,
        host: u.host,
        source: "app-public-url",
      };
    } catch {
      /* ignore */
    }
  }

  if (opts?.fallbackUrl) {
    try {
      const u =
        typeof opts.fallbackUrl === "string"
          ? new URL(opts.fallbackUrl)
          : new URL(opts.fallbackUrl.toString());
      const proto = u.protocol === "https:" ? "https" : "http";
      return {
        origin: u.origin,
        proto,
        host: u.host,
        source: "request-url",
      };
    } catch {
      /* ignore */
    }
  }

  const base = (opts?.appBaseUrl || "").trim().replace(/\/+$/, "");
  if (base) {
    try {
      const u = new URL(base);
      const proto = u.protocol === "https:" ? "https" : "http";
      return {
        origin: u.origin,
        proto,
        host: u.host,
        source: "app-base-url",
      };
    } catch {
      /* ignore */
    }
  }

  return {
    origin: "http://127.0.0.1",
    proto: "http",
    host: "127.0.0.1",
    source: "default",
  };
}

/** Cookie Secure : https public / tunnel ; false sur loopback desktop HTTP. */
export function resolveCookieSecure(
  headers: HeaderReader,
  opts?: { appPublicUrl?: string | null; appBaseUrl?: string | null },
): boolean {
  const resolved = resolvePublicOrigin(headers, {
    appPublicUrl: opts?.appPublicUrl ?? process.env.APP_PUBLIC_URL,
    appBaseUrl: opts?.appBaseUrl ?? process.env.APP_BASE_URL,
  });
  if (resolved.proto === "https") return true;
  if (isLoopbackHost(resolved.host)) return false;
  return process.env.NODE_ENV === "production";
}
