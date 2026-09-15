/**
 * Politique tunnel de `server-docker create` — fail-closed VPS / `--profile prod`.
 *
 * Un create « prod / VPS » ne réussit pas sans contrat Cloudflare
 * (`CREEZIO_CF_API_TOKEN` + `_ACCOUNT_ID` + `_ZONE_ID`) : l'instance
 * auto-provisionne son tunnel au boot (cf.env 600). Plus de provisioner VPS.
 * `CREEZIO_TUNNEL_LOCAL=1` reste l'opt-in explicite pour un loopback de dev.
 *
 * Slugs : SoT `RESERVED_SLUGS` = `packages/platform-core/src/tunnel-cf.ts`.
 * Un slug d'instance réservé (ex. `demo`) n'est jamais envoyé tel quel —
 * on dérive `<brandId>-<slug>` et on l'écrit dans l'env instance / cf.env.
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Clés non secrètes forwardées dans l'env instance (registre).
 * Les secrets CF (`CREEZIO_CF_API_TOKEN`…) vont uniquement dans `cf.env` 600.
 */
export const CREATE_TUNNEL_ENV_KEYS = [
  "CREEZIO_TUNNEL_SLUG",
  "CREEZIO_TUNNEL_LOCAL",
] as const;

/** Contrat CF requis pour un create public (lu process + .env marque). */
export const CREATE_CF_ENV_KEYS = [
  "CREEZIO_CF_API_TOKEN",
  "CREEZIO_CF_ACCOUNT_ID",
  "CREEZIO_CF_ZONE_ID",
] as const;

/**
 * Copie de secours alignée sur `packages/platform-core/src/tunnel-cf.ts`.
 * La gate `test-phase-server-docker-tunnel` refuse tout drift.
 */
export const RESERVED_SLUGS_FALLBACK: readonly string[] = [
  "lp",
  "www",
  "crm",
  "api",
  "n8n",
  "mail",
  "smtp",
  "ftp",
  "admin",
  "agent",
  "app",
  "desktop",
  "cdn",
  "static",
  "assets",
  "status",
  "health",
  "docs",
  "dev",
  "staging",
  "prod",
  "test",
  "demo",
  "sandbox",
  "mcp",
  "oauth",
  "catalog",
  "dl",
  "crash",
  "tunnel",
  "fleet",
  "registry",
  "root",
  "ns1",
  "ns2",
];

export function isExplicitTunnelLocal(
  value: string | undefined | null,
): boolean {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export type CreateTunnelPolicyInput = {
  instanceName: string;
  brandId: string;
  profile?: string;
  /** Env fusionné (process + .env marque + `--env`) — jamais de secrets en log. */
  env: Record<string, string | undefined>;
  reservedSlugs: ReadonlySet<string>;
  /** `--no-stack` : pas de cf.env / compose, donc pas de hostname public. */
  noStack?: boolean;
};

export type CreateTunnelSlugResult = {
  slug: string;
  derived: boolean;
  from: string;
};

export type CreateTunnelPolicy =
  | {
      mode: "local";
      local: true;
      slug?: undefined;
      derived?: false;
    }
  | {
      mode: "public";
      local: false;
      slug: string;
      derived: boolean;
      from: string;
    };

export function deriveCreateTunnelSlug(opts: {
  instanceName: string;
  brandId: string;
  explicitSlug?: string;
  reservedSlugs: ReadonlySet<string>;
}): CreateTunnelSlugResult {
  const instanceName = String(opts.instanceName || "")
    .trim()
    .toLowerCase();
  const brandId = String(opts.brandId || "")
    .trim()
    .toLowerCase();
  const explicit = String(opts.explicitSlug || "")
    .trim()
    .toLowerCase();
  const candidate = explicit || instanceName;
  if (!candidate) {
    throw new Error("nom d'instance requis pour dériver CREEZIO_TUNNEL_SLUG");
  }
  if (!opts.reservedSlugs.has(candidate)) {
    return { slug: candidate, derived: false, from: candidate };
  }
  if (!brandId) {
    throw new Error(
      `slug tunnel « ${candidate} » est réservé (RESERVED_SLUGS) — ` +
        `poser CREEZIO_TUNNEL_SLUG=<marque>-${candidate} (ex. foove2-demo)`,
    );
  }
  const derived = `${brandId}-${instanceName || candidate}`;
  if (opts.reservedSlugs.has(derived)) {
    throw new Error(
      `slug tunnel dérivé « ${derived} » est encore réservé — ` +
        `poser CREEZIO_TUNNEL_SLUG explicitement (ex. ${brandId}-client-01)`,
    );
  }
  return { slug: derived, derived: true, from: candidate };
}

export function formatMissingProvisionerError(): string {
  return [
    "create VPS/prod refuse un stack loopback-only : CREEZIO_CF_API_TOKEN, CREEZIO_CF_ACCOUNT_ID et CREEZIO_CF_ZONE_ID sont requis (hostname public {slug}.crm.foove.io, auto-provisionné au boot via cf.env).",
    "",
    "Poser les vars dans le .env de la marque (gitignoré), ou les exporter avant create.",
    "Le token CF ne doit jamais être commité ni écrit dans le registre / compose (cf.env chmod 600).",
    "",
    "Dev local (loopback assumé) : CREEZIO_TUNNEL_LOCAL=1",
  ].join("\n");
}

export function formatNoStackPublicError(): string {
  return [
    "create VPS/prod exige le stack compose (cf.env + cloudflared in-process) pour le hostname public.",
    "Retirer --no-stack, ou CREEZIO_TUNNEL_LOCAL=1 pour un loopback de dev.",
  ].join("\n");
}

/**
 * Décide local vs public. Défaut = public (fail-closed).
 * `--profile prod` impose le public même si LOCAL=1 est posé.
 */
export function resolveCreateTunnelPolicy(
  input: CreateTunnelPolicyInput,
): CreateTunnelPolicy {
  const wantLocal = isExplicitTunnelLocal(input.env.CREEZIO_TUNNEL_LOCAL);
  const prod = input.profile === "prod";
  if (wantLocal && !prod) {
    return { mode: "local", local: true };
  }
  const apiToken = String(input.env.CREEZIO_CF_API_TOKEN || "").trim();
  const accountId = String(input.env.CREEZIO_CF_ACCOUNT_ID || "").trim();
  const zoneId = String(input.env.CREEZIO_CF_ZONE_ID || "").trim();
  if (!apiToken || !accountId || !zoneId) {
    throw new Error(formatMissingProvisionerError());
  }
  if (input.noStack) {
    throw new Error(formatNoStackPublicError());
  }
  const mapped = deriveCreateTunnelSlug({
    instanceName: input.instanceName,
    brandId: input.brandId,
    explicitSlug: input.env.CREEZIO_TUNNEL_SLUG,
    reservedSlugs: input.reservedSlugs,
  });
  return {
    mode: "public",
    local: false,
    slug: mapped.slug,
    derived: mapped.derived,
    from: mapped.from,
  };
}

/**
 * Décide ce que `migrate-stack` doit faire. Un stack déjà « in-process »
 * (plus de sidecar compose) n'est pas forcément à jour : s'il n'a pas de
 * `cf.env` mais que le contrat CF est posé, on **attache** le tunnel natif
 * (landing extra-hostname, admin sans sidecar historique, etc.).
 */
export function isAdminBrandId(brandId: string): boolean {
  return /admin$/i.test(String(brandId || "").trim());
}

/** Hostnames extras (virgules) — FQDN avec un point, ordre normalisé. */
export function parseExtraHostnamesList(raw: unknown): string[] {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("."));
}

export function extraHostnamesKey(raw: unknown): string {
  return parseExtraHostnamesList(raw).slice().sort().join(",");
}

export function apexFromHostname(host: string): string {
  const h = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (h.startsWith("admin.")) return h.slice("admin.".length);
  if (h.startsWith("lp.")) return h.slice("lp.".length);
  return h;
}

/**
 * Contrat public d'un repo admin : un tunnel, deux hostnames.
 * `admin.{apex}` = OS, `lp.{apex}` = landing. Jamais l'inverse.
 * Un DOMAIN custom (ni admin.* ni lp.*) n'est pas écrasé ; on y ajoute lp.
 */
export function applyAdminPublicTunnelDefaults(input: {
  brandId: string;
  isAdmin?: boolean;
  env: Record<string, string>;
}): {
  env: Record<string, string>;
  applied: boolean;
  adminHost: string | null;
  landingHost: string | null;
} {
  const isAdmin = input.isAdmin ?? isAdminBrandId(input.brandId);
  if (!isAdmin) {
    return { env: input.env, applied: false, adminHost: null, landingHost: null };
  }
  const zoneRaw = (
    input.env.CREEZIO_CF_ZONE_NAME ||
    apexFromHostname(input.env.CREEZIO_DOMAIN || "")
  )
    .trim()
    .toLowerCase();
  const apex = apexFromHostname(zoneRaw);
  if (!apex.includes(".")) {
    return { env: input.env, applied: false, adminHost: null, landingHost: null };
  }
  const adminHost = `admin.${apex}`;
  const landingHost = `lp.${apex}`;
  const current = String(input.env.CREEZIO_DOMAIN || "")
    .trim()
    .toLowerCase();
  const extras = parseExtraHostnamesList(
    input.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES,
  ).filter((h) => h !== adminHost);
  if (current && current !== adminHost && current !== landingHost) {
    if (extras.includes(landingHost)) {
      return { env: input.env, applied: false, adminHost: current, landingHost };
    }
    extras.push(landingHost);
    return {
      env: {
        ...input.env,
        CREEZIO_TUNNEL_EXTRA_HOSTNAMES: extras.join(","),
      },
      applied: true,
      adminHost: current,
      landingHost,
    };
  }
  if (!extras.includes(landingHost)) extras.push(landingHost);
  const next = {
    ...input.env,
    CREEZIO_DOMAIN: adminHost,
    CREEZIO_TUNNEL_EXTRA_HOSTNAMES: extras.join(","),
  };
  const applied =
    next.CREEZIO_DOMAIN !== current ||
    extraHostnamesKey(next.CREEZIO_TUNNEL_EXTRA_HOSTNAMES) !==
      extraHostnamesKey(input.env.CREEZIO_TUNNEL_EXTRA_HOSTNAMES);
  return { env: next, applied, adminHost, landingHost };
}

export function resolveMigrateStackPlan(input: {
  isStack: boolean;
  hasSidecar: boolean;
  hasCfEnv: boolean;
  hasCfContract: boolean;
  /** cf.env présent mais DOMAIN / EXTRA pas alignés sur le contrat admin+lp. */
  needsHostnameSync?: boolean;
}):
  | "sidecar-migrate"
  | "attach-cf"
  | "sync-cf"
  | "noop-inprocess"
  | "legacy-migrate" {
  if (input.hasSidecar) return "sidecar-migrate";
  if (!input.isStack) return "legacy-migrate";
  if (input.hasCfEnv && input.hasCfContract && input.needsHostnameSync) {
    return "sync-cf";
  }
  if (input.hasCfEnv) return "noop-inprocess";
  if (input.hasCfContract) return "attach-cf";
  return "noop-inprocess";
}

export function formatDerivedSlugLog(mapped: CreateTunnelSlugResult): string {
  return (
    `slug « ${mapped.from} » réservé (RESERVED_SLUGS) — ` +
    `CREEZIO_TUNNEL_SLUG dérivé → ${mapped.slug} (écrit dans cf.env / env instance)`
  );
}

export async function loadReservedSlugs(
  kitRoot: string,
): Promise<Set<string>> {
  const file = path.join(kitRoot, "packages/platform-core/dist/tunnel-cf.js");
  try {
    const mod = (await import(pathToFileURL(file).href)) as {
      RESERVED_SLUGS?: Set<string>;
    };
    if (mod.RESERVED_SLUGS instanceof Set && mod.RESERVED_SLUGS.size > 0) {
      return mod.RESERVED_SLUGS;
    }
  } catch {
    /* kit absent du package npm publié — fallback */
  }
  return new Set(RESERVED_SLUGS_FALLBACK);
}

export function pickEnvValues(
  sources: Array<Record<string, string | undefined>>,
  keys: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    for (const src of sources) {
      const v = String(src[key] || "").trim();
      if (v) {
        out[key] = v;
        break;
      }
    }
  }
  return out;
}
