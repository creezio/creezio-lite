/**
 * Client API Cloudflare v4 — auto-provisioning du tunnel par l'instance.
 *
 * Node pur, `fetch` natif, zéro dépendance npm. Remplace le provisioner VPS
 * (`docker/tunnel-provisioner`, supprimé en 0.10.0) : l'instance crée,
 * configure et déprovisionne son tunnel directement contre l'API Cloudflare.
 *
 * Contrat d'environnement (préfixe `CREEZIO_`, variante marque `${PREFIX}_`
 * résolue d'abord — cohérent avec l'existant) :
 *   CREEZIO_CF_API_TOKEN     (requis) — account token scopé compte+zone
 *   CREEZIO_CF_ACCOUNT_ID    (requis)
 *   CREEZIO_CF_ZONE_ID       (requis)
 *   CREEZIO_CF_ZONE_NAME     (optionnel — dérivé via GET /zones/{zone_id})
 *   CREEZIO_CF_UNIVERSAL_SSL (optionnel — D2 : truthy → hostnames nested)
 *   CREEZIO_DOMAIN           (optionnel — hostname complet custom ;
 *                             défaut `{slug}.{zoneName}`)
 *   CREEZIO_TUNNEL_SLUG      (optionnel — sinon nom d'instance / brandId)
 *   CREEZIO_TUNNEL_EXTRA_HOSTNAMES (optionnel — D1 multi-hostnames, virgules)
 *
 * Ces variables arrivent au conteneur via un `env_file` `cf.env` (chmod 600)
 * généré par le CLI — jamais en clair dans `environment:` du compose.yml.
 */

import {
  agentTunnelCfName,
  agentTunnelDeprovisionDnsHosts,
  buildAgentTunnelIngressRules,
  buildTunnelIngressRules,
  normalizeTunnelPorts,
  slugCheckLocal,
  tunnelAgentHostname,
  tunnelDeprovisionDnsHosts,
  tunnelDnsRecordSpecs,
  tunnelPublicUrls,
  type TunnelIngressPorts,
  type TunnelIngressRule,
} from "./tunnel-cf.js";

import {
  resolveTunnelHostMode,
  type TunnelHostMode,
  type TunnelPublicUrls,
} from "./tunnel-urls.js";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export type CfTunnelEnv = {
  apiToken: string;
  accountId: string;
  zoneId: string;
  zoneName?: string;
};

function pickEnv(
  env: NodeJS.ProcessEnv,
  brandPrefix: string | undefined,
  key: string,
): string {
  if (brandPrefix) {
    const branded = (env[`${brandPrefix}_${key}`] || "").trim();
    if (branded) return branded;
  }
  return (env[`CREEZIO_${key}`] || "").trim();
}

/**
 * Résout le contrat CF depuis l'environnement. Ordre : `${prefix}_CF_*`
 * (marque) puis `CREEZIO_CF_*` (générique kit). Retourne null si un requis
 * manque — l'appelant décide (skip doux au boot, erreur claire à la
 * réservation explicite).
 */
export function resolveCfTunnelEnv(
  env: NodeJS.ProcessEnv = process.env,
  brandPrefix?: string,
): CfTunnelEnv | null {
  const apiToken = pickEnv(env, brandPrefix, "CF_API_TOKEN");
  const accountId = pickEnv(env, brandPrefix, "CF_ACCOUNT_ID");
  const zoneId = pickEnv(env, brandPrefix, "CF_ZONE_ID");
  const zoneName = pickEnv(env, brandPrefix, "CF_ZONE_NAME") || undefined;
  if (!apiToken || !accountId || !zoneId) return null;
  return { apiToken, accountId, zoneId, zoneName };
}

/** Liste des clés manquantes — message d'erreur actionnable. */
export function missingCfTunnelEnvKeys(
  env: NodeJS.ProcessEnv = process.env,
  brandPrefix?: string,
): string[] {
  const missing: string[] = [];
  for (const key of ["CF_API_TOKEN", "CF_ACCOUNT_ID", "CF_ZONE_ID"]) {
    if (!pickEnv(env, brandPrefix, key)) missing.push(`CREEZIO_${key}`);
  }
  return missing;
}

export class CfApiError extends Error {
  status: number;
  cf: unknown;
  constructor(message: string, status: number, cf: unknown) {
    super(message);
    this.name = "CfApiError";
    this.status = status;
    this.cf = cf;
  }
}

/** Appel API Cloudflare v4 — jette CfApiError (status + payload) sur échec. */
export async function cfApi<T = unknown>(
  env: CfTunnelEnv,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${CF_API_BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.apiToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: T;
  };
  if (!res.ok || data.success === false) {
    const msg =
      (data.errors && data.errors[0] && data.errors[0].message) ||
      `HTTP ${res.status}`;
    throw new CfApiError(String(msg), res.status, data);
  }
  return data.result as T;
}

/**
 * Vérifie le token CF. Un **account token** se vérifie via
 * `GET /accounts/{account_id}/tokens/verify`, un **user token** via
 * `GET /user/tokens/verify` — on tente le compte puis l'utilisateur.
 */
export async function verifyCfApiToken(
  env: CfTunnelEnv,
): Promise<{ ok: boolean; kind: "account" | "user"; id?: string }> {
  try {
    const r = await cfApi<{ id?: string }>(
      env,
      "GET",
      `/accounts/${env.accountId}/tokens/verify`,
    );
    return { ok: true, kind: "account", id: r?.id };
  } catch (err) {
    // Token utilisateur (ou droits compte absents) → endpoint user.
    if (!(err instanceof CfApiError)) throw err;
  }
  const r = await cfApi<{ id?: string }>(env, "GET", `/user/tokens/verify`);
  return { ok: true, kind: "user", id: r?.id };
}

let cachedZoneName: string | null = null;

/** Nom de la zone — env `CREEZIO_CF_ZONE_NAME` ou `GET /zones/{zone_id}`. */
export async function resolveCfZoneName(env: CfTunnelEnv): Promise<string> {
  if (env.zoneName) return env.zoneName;
  if (cachedZoneName) return cachedZoneName;
  const zone = await cfApi<{ name?: string }>(
    env,
    "GET",
    `/zones/${env.zoneId}`,
  );
  const name = String(zone?.name || "").trim();
  if (!name) throw new Error(`Zone ${env.zoneId} sans nom (réponse CF)`);
  cachedZoneName = name;
  return name;
}

/** Tunnel par id — null si 404 (recréation attendue par l'appelant). */
export async function getCfTunnel(
  env: CfTunnelEnv,
  tunnelId: string,
): Promise<{ id: string; name?: string; status?: string } | null> {
  try {
    return await cfApi(
      env,
      "GET",
      `/accounts/${env.accountId}/cfd_tunnel/${tunnelId}`,
    );
  } catch (err) {
    if (err instanceof CfApiError && err.status === 404) return null;
    throw err;
  }
}

/** Crée le tunnel (`config_src: cloudflare` — config pilotée par API). */
export async function createCfTunnel(
  env: CfTunnelEnv,
  name: string,
): Promise<{ id: string; token: string }> {
  const tunnel = await cfApi<{ id?: string; token?: string }>(
    env,
    "POST",
    `/accounts/${env.accountId}/cfd_tunnel`,
    { name: name.slice(0, 100), config_src: "cloudflare" },
  );
  if (!tunnel?.id || !tunnel?.token) {
    throw new Error("Réponse création tunnel incomplète (id/token)");
  }
  return { id: tunnel.id, token: tunnel.token };
}

/** PUT configurations — remplace TOUTE la config ingress du tunnel. */
export async function putCfTunnelIngress(
  env: CfTunnelEnv,
  tunnelId: string,
  ingress: TunnelIngressRule[],
): Promise<void> {
  await cfApi(
    env,
    "PUT",
    `/accounts/${env.accountId}/cfd_tunnel/${tunnelId}/configurations`,
    { config: { ingress } },
  );
}

/** GET configurations — ingress courant (null si tunnel/config absent). */
export async function getCfTunnelConfig(
  env: CfTunnelEnv,
  tunnelId: string,
): Promise<TunnelIngressRule[] | null> {
  try {
    const data = await cfApi<{ config?: { ingress?: TunnelIngressRule[] } }>(
      env,
      "GET",
      `/accounts/${env.accountId}/cfd_tunnel/${tunnelId}/configurations`,
    );
    return Array.isArray(data?.config?.ingress) ? data.config.ingress : null;
  } catch (err) {
    if (err instanceof CfApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Extrait la règle agent existante d'un ingress (hostname agent.* / agent-*)
 * → `{ host, port }` parsé depuis l'URL de service, null si absente.
 */
export function extractAgentRule(
  ingress: TunnelIngressRule[] | null | undefined,
  agentHostname: string,
): { host: string; port: number } | null {
  for (const rule of ingress || []) {
    if (rule.hostname !== agentHostname) continue;
    const m = /^https?:\/\/([^:/]+):(\d+)$/.exec(String(rule.service || ""));
    if (m && m[1] && m[2]) return { host: m[1], port: Number(m[2]) };
  }
  return null;
}

export type CfDnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
};

export async function listCfDnsRecords(
  env: CfTunnelEnv,
  name: string,
  type?: string,
): Promise<CfDnsRecord[]> {
  const q = new URLSearchParams({ name, per_page: "20" });
  if (type) q.set("type", type);
  const records = await cfApi<CfDnsRecord[]>(
    env,
    "GET",
    `/zones/${env.zoneId}/dns_records?${q}`,
  );
  return Array.isArray(records) ? records : [];
}

/**
 * Upsert idempotent d'un CNAME tunnel : no-op si l'enregistrement existe
 * avec la bonne cible (et proxied) ; PUT si la cible/proxy diffère (ex.
 * tunnel recréé — le CNAME suit le nouvel id) ; remplace un A/AAAA héritage
 * (NPM / IP VPS) puis POST sinon. Un A laissé en place bloquait le POST.
 */
export async function ensureCfCnameRecord(
  env: CfTunnelEnv,
  opts: { name: string; target: string; comment?: string },
): Promise<"exists" | "updated" | "created"> {
  const all = await listCfDnsRecords(env, opts.name);
  const here = all.filter((r) => r.name === opts.name);
  const match = here.find((r) => r.type === "CNAME");
  const conflicts = here.filter((r) => r.type !== "CNAME");
  for (const rec of conflicts) {
    await cfApi(env, "DELETE", `/zones/${env.zoneId}/dns_records/${rec.id}`);
  }
  if (match) {
    if (
      match.content === opts.target &&
      match.proxied !== false &&
      conflicts.length === 0
    ) {
      return "exists";
    }
    await cfApi(env, "PUT", `/zones/${env.zoneId}/dns_records/${match.id}`, {
      type: "CNAME",
      name: opts.name,
      content: opts.target,
      proxied: true,
      ...(opts.comment ? { comment: opts.comment } : {}),
    });
    return "updated";
  }
  await cfApi(env, "POST", `/zones/${env.zoneId}/dns_records`, {
    type: "CNAME",
    name: opts.name,
    content: opts.target,
    proxied: true,
    ...(opts.comment ? { comment: opts.comment } : {}),
  });
  return conflicts.length ? "updated" : "created";
}

export type EnsureCfTunnelDnsOpts = {
  slug: string;
  hostname: string;
  tunnelId: string;
  hostMode?: TunnelHostMode | null;
  /** false = zone-level (brand-web/registry) : pas de wildcard/services. */
  wildcard?: boolean;
  /** D1 — hostnames supplémentaires sur le même tunnel. */
  extraHostnames?: string[];
};

/** Upsert idempotent de tous les CNAME du tunnel (CRM + services + extras). */
export async function ensureCfTunnelDns(
  env: CfTunnelEnv,
  opts: EnsureCfTunnelDnsOpts,
): Promise<{ hostMode: TunnelHostMode; ensured: string[] }> {
  const zoneName = await resolveCfZoneName(env);
  const target = `${opts.tunnelId}.cfargotunnel.com`;
  const { hostMode, records } = tunnelDnsRecordSpecs(
    opts.slug,
    opts.hostname,
    zoneName,
    {
      wildcard: opts.wildcard,
      hostMode: opts.hostMode,
      extraHostnames: opts.extraHostnames,
    },
  );
  const ensured: string[] = [];
  for (const rec of records) {
    await ensureCfCnameRecord(env, {
      name: rec.qName,
      target,
      comment: `Creezio server ${opts.slug}`,
    });
    ensured.push(rec.qName);
  }
  return { hostMode, ensured };
}

/** MX + SPF Email Routing pour `{slug}.mail.{zone}` — hors arbre CNAME. */
export async function ensureCfEmailDns(
  env: CfTunnelEnv,
  slug: string,
): Promise<{ emailDomain: string }> {
  const zoneName = await resolveCfZoneName(env);
  const mailHost = `${slug}.mail.${zoneName}`;
  const mxTargets = [
    { priority: 10, content: "route1.mx.cloudflare.net" },
    { priority: 20, content: "route2.mx.cloudflare.net" },
    { priority: 30, content: "route3.mx.cloudflare.net" },
  ];
  const existingMx = await listCfDnsRecords(env, mailHost, "MX");
  const have = new Set(
    existingMx.map((r) => String(r.content || "").toLowerCase()),
  );
  for (const mx of mxTargets) {
    if (have.has(mx.content)) continue;
    await cfApi(env, "POST", `/zones/${env.zoneId}/dns_records`, {
      type: "MX",
      name: mailHost,
      content: mx.content,
      priority: mx.priority,
      ttl: 1,
      comment: `Creezio email ${slug}`,
    });
  }
  const existingTxt = await listCfDnsRecords(env, mailHost, "TXT");
  const hasSpf = existingTxt.some((r) =>
    String(r.content || "").toLowerCase().includes("v=spf1"),
  );
  if (!hasSpf) {
    await cfApi(env, "POST", `/zones/${env.zoneId}/dns_records`, {
      type: "TXT",
      name: mailHost,
      content: "v=spf1 include:_spf.mx.cloudflare.net ~all",
      ttl: 1,
      comment: `Creezio email SPF ${slug}`,
    });
  }
  return { emailDomain: mailHost };
}

/** Supprime le tunnel (connexions actives coupées d'abord — sinon 409). */
export async function deleteCfTunnel(
  env: CfTunnelEnv,
  tunnelId: string,
): Promise<void> {
  await cfApi(
    env,
    "DELETE",
    `/accounts/${env.accountId}/cfd_tunnel/${tunnelId}/connections`,
  ).catch(() => {});
  await cfApi(env, "DELETE", `/accounts/${env.accountId}/cfd_tunnel/${tunnelId}`);
}

export type DeprovisionCfSlugOpts = {
  slug: string;
  /** Défaut `{slug}.{zoneName}`. */
  hostname?: string;
  /** Tunnel à supprimer (store kernel / registre) — sinon DNS seul. */
  tunnelId?: string;
  extraHostnames?: string[];
  log?: (line: string) => void;
};

/**
 * Nettoyage complet d'un slug : DNS (nested + flat + mail + extras) puis
 * tunnel CF. Best-effort par enregistrement — un résidu DNS n'empêche pas
 * la suppression du tunnel.
 */
export async function deprovisionCfSlug(
  env: CfTunnelEnv,
  opts: DeprovisionCfSlugOpts,
): Promise<{ ok: true; slug: string; removed: { dns: string[]; tunnel: string | null } }> {
  const zoneName = await resolveCfZoneName(env);
  const hostname = opts.hostname || `${opts.slug}.${zoneName}`;
  const removed: { dns: string[]; tunnel: string | null } = {
    dns: [],
    tunnel: null,
  };
  const hosts = tunnelDeprovisionDnsHosts(
    opts.slug,
    hostname,
    zoneName,
    opts.extraHostnames,
  );
  for (const h of hosts) {
    try {
      const records = await listCfDnsRecords(env, h);
      for (const rec of records) {
        await cfApi(
          env,
          "DELETE",
          `/zones/${env.zoneId}/dns_records/${rec.id}`,
        );
        removed.dns.push(`${rec.type} ${rec.name}`);
      }
    } catch (err) {
      opts.log?.(
        `DNS cleanup ${h}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (opts.tunnelId) {
    try {
      await deleteCfTunnel(env, opts.tunnelId);
      removed.tunnel = opts.tunnelId;
    } catch (err) {
      opts.log?.(
        `tunnel delete ${opts.tunnelId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { ok: true, slug: opts.slug, removed };
}

export type DeprovisionCfAgentTunnelOpts = {
  slug: string;
  /** Hostname public agent déjà connu (`agent.{slug}.{zone}` / `agent-{slug}.{zone}`). */
  hostname?: string;
  /** Tunnel dédié agent à supprimer (host-agent.json / agent-tunnel.env). */
  tunnelId?: string;
  extraHostnames?: string[];
  log?: (line: string) => void;
};

/**
 * Nettoyage des ressources Cloudflare du host-agent (T7) : DNS
 * `agent.*` / `agent-*` puis tunnel dédié. Seul geste autorisé à
 * toucher ces enregistrements — jamais `deprovisionCfSlug` /
 * `server-docker rm` d'une instance applicative.
 */
export async function deprovisionCfAgentTunnel(
  env: CfTunnelEnv,
  opts: DeprovisionCfAgentTunnelOpts,
): Promise<{
  ok: true;
  slug: string;
  removed: { dns: string[]; tunnel: string | null };
}> {
  const zoneName = await resolveCfZoneName(env);
  const removed: { dns: string[]; tunnel: string | null } = {
    dns: [],
    tunnel: null,
  };
  const hosts = agentTunnelDeprovisionDnsHosts(opts.slug, zoneName, [
    opts.hostname,
    ...(opts.extraHostnames || []),
  ]);
  for (const h of hosts) {
    try {
      const records = await listCfDnsRecords(env, h);
      for (const rec of records) {
        await cfApi(
          env,
          "DELETE",
          `/zones/${env.zoneId}/dns_records/${rec.id}`,
        );
        removed.dns.push(`${rec.type} ${rec.name}`);
      }
    } catch (err) {
      opts.log?.(
        `DNS cleanup ${h}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (opts.tunnelId) {
    try {
      await deleteCfTunnel(env, opts.tunnelId);
      removed.tunnel = opts.tunnelId;
    } catch (err) {
      opts.log?.(
        `tunnel delete ${opts.tunnelId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return { ok: true, slug: opts.slug, removed };
}

export type CfTunnelEnsureOpts = {
  slug: string;
  /** Hostname complet custom (CREEZIO_DOMAIN) — défaut `{slug}.{zone}`. */
  domain?: string;
  ports?: Partial<TunnelIngressPorts> & { localPort?: number };
  hostMode?: TunnelHostMode | null;
  /** D1 — hostnames supplémentaires sur le même tunnel. */
  extraHostnames?: string[];
  /** false = zone-level (brand-web/registry) : un seul ingress, pas d'email. */
  embeds?: boolean;
  /** Préfixe du nom CF du tunnel (cosmétique côté console Cloudflare). */
  tunnelNamePrefix?: string;
  /** État persisté (store kernel) — réutilisé si le tunnel existe encore. */
  stored?: { tunnelId?: string; tunnelToken?: string } | null;
  log?: (line: string) => void;
};

export type CfTunnelEnsureResult = {
  ok: true;
  slug: string;
  hostname: string;
  hostMode: TunnelHostMode;
  tunnelId: string;
  tunnelToken: string;
  publicUrl: string;
  publicUrls: TunnelPublicUrls | { crm: string };
  emailDomain: string | null;
  /** true si le tunnel a été (re)créé à ce tour (store wipé / 404 CF). */
  recreated: boolean;
};

/**
 * Ensure idempotent du tunnel d'une instance — cœur du boot kernel :
 *
 * 1. `stored.tunnelId` + token présents → `GET cfd_tunnel/{id}` :
 *    - 200 → le tunnel existe encore, on le réutilise (ré-ensure ingress+DNS) ;
 *    - 404 (ou token absent) → recréation complète et le CNAME existant est
 *      mis à jour vers le nouvel id (un `/data` wipé ou un tunnel supprimé
 *      côté CF aboutit à un tunnel recréé proprement).
 * 2. `PUT configurations` — ingress `http://127.0.0.1:<port>` (+ services
 *    selon D2, + hostnames supplémentaires D1).
 * 3. Upsert idempotent des DNS (jamais d'échec si déjà à la bonne cible).
 * 4. MX/SPF e-mail best-effort (serveurs seulement).
 */
export async function ensureCfTunnel(
  env: CfTunnelEnv,
  opts: CfTunnelEnsureOpts,
): Promise<CfTunnelEnsureResult> {
  const slug = opts.slug;
  const local = slugCheckLocal(slug, { hostMode: opts.hostMode });
  if (!local.available) {
    throw new Error(local.reason || `Slug indisponible: ${slug}`);
  }
  const zoneName = await resolveCfZoneName(env);
  const hostname = (opts.domain || "").trim().toLowerCase() || `${slug}.${zoneName}`;
  const hostMode = resolveTunnelHostMode(opts.hostMode);
  const ports = normalizeTunnelPorts(opts.ports || {});
  const embeds = opts.embeds !== false;
  const extraHostnames = (opts.extraHostnames || []).filter(
    (h) => h && h !== hostname,
  );

  let tunnelId = "";
  let tunnelToken = "";
  let recreated = false;
  const storedId = (opts.stored?.tunnelId || "").trim();
  const storedToken = (opts.stored?.tunnelToken || "").trim();
  if (storedId && storedToken) {
    const existing = await getCfTunnel(env, storedId);
    if (existing) {
      tunnelId = storedId;
      tunnelToken = storedToken;
      opts.log?.(`tunnel ${slug} existant (${tunnelId}) — ré-ensure ingress+DNS`);
    } else {
      opts.log?.(
        `tunnel ${slug} introuvable côté Cloudflare (404) — recréation`,
      );
    }
  }
  if (!tunnelId) {
    const namePrefix = opts.tunnelNamePrefix || "creezio-server-";
    const created = await createCfTunnel(env, `${namePrefix}${slug}`);
    tunnelId = created.id;
    tunnelToken = created.token;
    recreated = true;
  }

  await putCfTunnelIngress(
    env,
    tunnelId,
    buildTunnelIngressRules(hostname, ports, {
      hostMode,
      embeds,
      extraHostnames,
    }),
  );
  await ensureCfTunnelDns(env, {
    slug,
    hostname,
    tunnelId,
    hostMode,
    wildcard: embeds,
    extraHostnames,
  });

  let emailDomain: string | null = null;
  if (embeds) {
    emailDomain = `${slug}.mail.${zoneName}`;
    try {
      await ensureCfEmailDns(env, slug);
    } catch (err) {
      opts.log?.(
        `ensureEmailDns (best-effort): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    ok: true,
    slug,
    hostname,
    hostMode,
    tunnelId,
    tunnelToken,
    publicUrl: `https://${hostname}`,
    publicUrls: tunnelPublicUrls(hostname, { hostMode, embeds }),
    emailDomain,
    recreated,
  };
}

/* ────────────────────────── Tunnel dédié agent (T7) ────────────────────────── */

export type CfAgentTunnelEnsureOpts = {
  /** Slug d'où dérive le hostname agent (nom CF `creezio-agent-<slug>`). */
  slug: string;
  /** Hostname CRM de référence (ex. `resto-a.zone.fr`) — l'hostname agent en dérive. */
  serverHostname: string;
  /** Port hôte du host-agent (l'origin du connecteur network-host). */
  agentPort: number;
  hostMode?: TunnelHostMode | null;
  /** Origin du service — défaut `127.0.0.1` (container cloudflared en network host). */
  originHost?: string;
  /**
   * false → le CNAME agent n'est PAS touché ici : l'appelant bascule le DNS
   * séparément (`ensureCfAgentTunnelDns`) APRÈS le démarrage du connecteur.
   */
  dns?: boolean;
  /** État persisté (host-agent.json + agent-tunnel.env) — réutilisé si le tunnel existe. */
  stored?: { tunnelId?: string; tunnelToken?: string } | null;
  log?: (line: string) => void;
};

export type CfAgentTunnelEnsureResult = {
  ok: true;
  slug: string;
  /** Hostname public de l'agent (`agent-{slug}.{zone}` flat / `agent.{slug}.{zone}` nested). */
  hostname: string;
  hostMode: TunnelHostMode;
  tunnelId: string;
  tunnelToken: string;
  agentUrl: string;
  /** true si le tunnel dédié a été (re)créé à ce tour (premier enroll / 404 CF). */
  recreated: boolean;
};

/**
 * Ensure idempotent du tunnel Cloudflare DÉDIÉ au host-agent (T7) — même
 * modèle que `ensureCfTunnel` pour les serveurs (tunnel-self-provision),
 * mais un seul ingress : `agent.{slug}.{zone}` → `http://127.0.0.1:<port>`.
 *
 * L'agent ne partage plus le cloudflared d'un serveur applicatif : un
 * update/down/recreate du serveur ne coupe plus le pilotage de l'hôte.
 *
 * 1. `stored.tunnelId` + token → GET : 200 = réutilisé ; 404 = recréation.
 * 2. `PUT configurations` — ingress agent seul (jamais d'embeds/email).
 * 3. DNS (sauf `dns: false`) : CNAME agent → `<tunnelId>.cfargotunnel.com`
 *    (upsert idempotent — un CNAME encore pointé sur un tunnel d'instance
 *    est MIS À JOUR vers le tunnel dédié).
 */
export async function ensureCfAgentTunnel(
  env: CfTunnelEnv,
  opts: CfAgentTunnelEnsureOpts,
): Promise<CfAgentTunnelEnsureResult> {
  const slug = String(opts.slug || "").trim().toLowerCase();
  const serverHostname = String(opts.serverHostname || "")
    .trim()
    .toLowerCase();
  if (!slug || !serverHostname) {
    throw new Error("ensureCfAgentTunnel: slug et serverHostname requis");
  }
  if (!Number.isInteger(opts.agentPort) || opts.agentPort <= 0) {
    throw new Error("ensureCfAgentTunnel: agentPort invalide");
  }
  const hostMode = resolveTunnelHostMode(opts.hostMode);
  const hostname = tunnelAgentHostname(serverHostname, hostMode);

  let tunnelId = "";
  let tunnelToken = "";
  let recreated = false;
  const storedId = (opts.stored?.tunnelId || "").trim();
  const storedToken = (opts.stored?.tunnelToken || "").trim();
  if (storedId && storedToken) {
    const existing = await getCfTunnel(env, storedId);
    if (existing) {
      tunnelId = storedId;
      tunnelToken = storedToken;
      opts.log?.(
        `tunnel agent ${slug} existant (${tunnelId}) — ré-ensure ingress`,
      );
    } else {
      opts.log?.(
        `tunnel agent ${slug} introuvable côté Cloudflare (404) — recréation`,
      );
    }
  }
  if (!tunnelId) {
    const created = await createCfTunnel(env, agentTunnelCfName(slug));
    tunnelId = created.id;
    tunnelToken = created.token;
    recreated = true;
  }

  await putCfTunnelIngress(
    env,
    tunnelId,
    buildAgentTunnelIngressRules(hostname, opts.agentPort, {
      originHost: opts.originHost,
    }),
  );
  if (opts.dns !== false) {
    await ensureCfAgentTunnelDns(env, { hostname, tunnelId, slug });
  }

  return {
    ok: true,
    slug,
    hostname,
    hostMode,
    tunnelId,
    tunnelToken,
    agentUrl: `https://${hostname}`,
    recreated,
  };
}

/**
 * Bascule/upsert du CNAME agent vers le tunnel dédié. Séparé de l'ensure
 * pour l'ordre sans coupure : provision tunnel → démarrage du container
 * cloudflared → bascule DNS.
 */
export async function ensureCfAgentTunnelDns(
  env: CfTunnelEnv,
  opts: { hostname: string; tunnelId: string; slug?: string },
): Promise<"exists" | "updated" | "created"> {
  return ensureCfCnameRecord(env, {
    name: opts.hostname,
    target: `${opts.tunnelId}.cfargotunnel.com`,
    comment: `Creezio agent ${opts.slug || opts.hostname}`,
  });
}

/**
 * Retire une règle agent résiduelle de l'ingress d'un tunnel d'instance
 * (reste historique). À appeler APRÈS la bascule DNS vers le tunnel
 * dédié. Best-effort côté appelant.
 */
export async function removeCfTunnelAgentRule(
  env: CfTunnelEnv,
  opts: { tunnelId: string; agentHostname: string },
): Promise<boolean> {
  const ingress = await getCfTunnelConfig(env, opts.tunnelId);
  if (!ingress) return false;
  const next = ingress.filter((r) => r.hostname !== opts.agentHostname);
  if (next.length === ingress.length) return false;
  await putCfTunnelIngress(env, opts.tunnelId, next);
  return true;
}
