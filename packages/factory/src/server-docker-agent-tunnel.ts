/**
 * Tunnel cloudflared DÉDIÉ au host-agent (T7) — helpers purs du CLI.
 *
 * `creezio server-docker enroll` / `agent up` provisionnent un tunnel
 * Cloudflare PROPRE à l'agent (nom CF `creezio-agent-<slug>`, ingress
 * unique `agent-{slug}.{zone}` → 127.0.0.1:<port agent>) et persistent
 * l'URL publique canonique dans `host-agent.json` + `fleet-hosts.json`
 * (`agentUrl`). Le connecteur tourne dans `creezio-agent-tunnel` — l'agent
 * ne dépend plus du cloudflared in-process d'un serveur applicatif du VPS
 * (serveur down/recréé ≠ agent injoignable).
 *
 * Sécurité : le token du connecteur vit UNIQUEMENT dans
 * `docker-data/agent-tunnel.env` (chmod 600, `TUNNEL_TOKEN=`) — jamais en
 * argv (docker inspect / ps), jamais dans host-agent.json ni les logs.
 *
 * Respawn : `--restart unless-stopped` côté Docker + surveillance bornée
 * par le host-agent (`@creezio/fleet` `agent-tunnel.ts`, miroir de la
 * politique cloudflared-respawn).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Nom du container cloudflared dédié agent (aligné @creezio/fleet). */
export const AGENT_TUNNEL_CONTAINER = "creezio-agent-tunnel";

/**
 * Image du connecteur — l'image officielle cloudflared (le binaire seul,
 * pas d'app Creezio dedans). Override : `CREEZIO_AGENT_TUNNEL_IMAGE`.
 */
export const AGENT_TUNNEL_IMAGE_DEFAULT = "cloudflare/cloudflared:latest";

export function resolveAgentTunnelImage(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    String(env.CREEZIO_AGENT_TUNNEL_IMAGE || "").trim() ||
    AGENT_TUNNEL_IMAGE_DEFAULT
  );
}

/** Env file 600 du token connecteur — à côté de host-agent.json. */
export function agentTunnelEnvPath(brandRoot: string): string {
  return path.join(brandRoot, "docker-data", "agent-tunnel.env");
}

/** Contenu de l'env file (TUNNEL_TOKEN lu nativement par cloudflared). */
export function renderAgentTunnelEnvFile(tunnelToken: string): string {
  const token = String(tunnelToken || "").trim();
  if (!token) {
    throw new Error("agent-tunnel.env : tunnelToken vide (refus d'écrire)");
  }
  return `# Token du connecteur cloudflared dédié agent (T7) — chmod 600, jamais commité.\nTUNNEL_TOKEN=${token}\n`;
}

/**
 * Args `docker run` du connecteur dédié. Réseau host : cloudflared joint
 * l'agent en loopback (`127.0.0.1:<port>`) sans dépendre de docker0 /
 * host.docker.internal. `--protocol http2` : QUIC/UDP instable sur les VPS
 * (même règle que les tunnels hôte, skill fleet-ops §13). Token via
 * `--env-file` uniquement — jamais en argv.
 */
export function buildAgentTunnelRunArgs(opts: {
  image: string;
  envFile: string;
  container?: string;
}): string[] {
  return [
    "run",
    "-d",
    "--name",
    opts.container || AGENT_TUNNEL_CONTAINER,
    "--restart",
    "unless-stopped",
    "--network",
    "host",
    "--label",
    "creezio.agent-tunnel=1",
    "--env-file",
    opts.envFile,
    opts.image,
    "tunnel",
    "--no-autoupdate",
    "--protocol",
    "http2",
    "run",
  ];
}

/**
 * Hôte déjà enrôlé (credentials enroll présents) mais encore sans tunnel
 * dédié — `agent up` doit migrer tout seul (fail-closed si CF manque).
 */
export function needsDedicatedAgentTunnelMigration(opts: {
  adminUrl?: string | null;
  agentUrl?: string | null;
  fleetKey?: string | null;
  agentTunnel?: { tunnelId?: string } | null;
  envFileExists: boolean;
}): boolean {
  const enrolled = Boolean(
    String(opts.adminUrl || "").trim() ||
      String(opts.fleetKey || "").trim() ||
      String(opts.agentUrl || "").trim(),
  );
  const dedicated =
    Boolean(String(opts.agentTunnel?.tunnelId || "").trim()) ||
    opts.envFileExists;
  return enrolled && !dedicated;
}

export type ParsedAgentPublicUrl = {
  hostname: string;
  serverHostname: string;
  slugGuess: string;
  hostMode: "nested" | "flat";
};

/**
 * Décode `https://agent.{slug}.{zone}` (nested) ou
 * `https://agent-{slug}.{zone}` (flat). Null si ce n'est pas un hostname
 * agent Creezio (ex. `--agent-url` custom).
 */
export function parseAgentPublicUrl(
  agentUrl: string,
): ParsedAgentPublicUrl | null {
  let host = "";
  try {
    host = new URL(String(agentUrl || "").trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host.startsWith("agent.")) {
    const serverHostname = host.slice("agent.".length);
    const slugGuess = serverHostname.split(".")[0] || "";
    if (!serverHostname || !slugGuess) return null;
    return { hostname: host, serverHostname, slugGuess, hostMode: "nested" };
  }
  if (host.startsWith("agent-")) {
    const serverHostname = host.slice("agent-".length);
    const slugGuess = serverHostname.split(".")[0] || "";
    if (!serverHostname || !slugGuess) return null;
    return { hostname: host, serverHostname, slugGuess, hostMode: "flat" };
  }
  return null;
}

/**
 * URL publique canonique du tunnel dédié (`https://agent-{slug}.{zone}`
 * flat, ou celle réellement provisionnée). Fail-closed si rien n'est
 * dérivable — jamais d'URL nested partagée inventée en secours.
 */
export function canonicalDedicatedAgentUrl(opts: {
  provisionedUrl?: string | null;
  hostname?: string | null;
}): string {
  const raw = String(opts.provisionedUrl || "").trim().replace(/\/+$/, "");
  if (raw) {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(
        `agentUrl dédiée invalide (${raw}) — URL https publique attendue.`,
      );
    }
    if (parsed.protocol !== "https:") {
      throw new Error(`agentUrl dédiée invalide (${raw}) — https requis.`);
    }
    const host = parsed.hostname.toLowerCase();
    if (!host) {
      throw new Error(`agentUrl dédiée invalide (${raw}) — hostname manquant.`);
    }
    return `https://${host}`;
  }
  const host = String(opts.hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (host && host.includes(".") && !host.includes("/") && !/\s/.test(host)) {
    return `https://${host}`;
  }
  throw new Error(
    "agentUrl dédiée introuvable : ni URL provisionnée ni hostname du tunnel. " +
      "Relancer `creezio server-docker agent up --slug <slug>` pour (re)provisionner.",
  );
}

/** True si l'URL persistée n'est pas encore celle du tunnel dédié. */
export function agentUrlNeedsDedicatedPersist(
  currentUrl: string | null | undefined,
  dedicatedUrl: string,
): boolean {
  const cur = String(currentUrl || "").trim().replace(/\/+$/, "");
  const want = String(dedicatedUrl || "").trim().replace(/\/+$/, "");
  if (!want) {
    throw new Error("agentUrl dédiée vide — refus de comparer");
  }
  return cur !== want;
}

export function applyDedicatedAgentUrlToHostState<
  T extends { agentUrl?: string | null },
>(state: T, dedicatedUrl: string): boolean {
  const url = canonicalDedicatedAgentUrl({ provisionedUrl: dedicatedUrl });
  if (!agentUrlNeedsDedicatedPersist(state.agentUrl, url)) return false;
  state.agentUrl = url;
  return true;
}

export function applyDedicatedAgentUrlToFleetHosts(
  data: { hosts?: Array<{ hostId: string; agentUrl?: string }> },
  hostId: string,
  dedicatedUrl: string,
): { found: boolean; changed: boolean } {
  const id = String(hostId || "").trim();
  if (!id) return { found: false, changed: false };
  const url = canonicalDedicatedAgentUrl({ provisionedUrl: dedicatedUrl });
  const host = (data.hosts || []).find((h) => h.hostId === id);
  if (!host) return { found: false, changed: false };
  if (!agentUrlNeedsDedicatedPersist(host.agentUrl, url)) {
    return { found: true, changed: false };
  }
  host.agentUrl = url;
  return { found: true, changed: true };
}

/**
 * Chemins SoT `fleet-hosts.json` (runtime + miroirs) à mettre à jour
 * après `agent up`. Uniquement les fichiers déjà présents.
 */
export function discoverFleetHostsJsonPaths(opts: {
  brandRoot: string;
  adminRoot?: string | null;
  extraRoots?: string[];
}): string[] {
  const roots = new Set<string>();
  const addRoot = (r?: string | null) => {
    const v = String(r || "").trim();
    if (v) roots.add(path.resolve(v));
  };
  addRoot(opts.adminRoot);
  addRoot(opts.brandRoot);
  const brand = path.resolve(opts.brandRoot);
  if (brand) addRoot(`${brand}-admin`);
  for (const r of opts.extraRoots || []) addRoot(r);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const rel of [
      path.join("docker-data", "fleet-hosts.json"),
      "fleet-hosts.json",
      path.join("admin", "fleet-hosts.json"),
    ]) {
      const file = path.join(root, rel);
      if (!fs.existsSync(file) || seen.has(file)) continue;
      seen.add(file);
      out.push(file);
    }
  }
  return out;
}

export type PersistFleetHostsResult = {
  found: boolean;
  changed: boolean;
  /** Présent mais lecture/écriture refusée (root:root 600 typique). */
  permissionDenied?: boolean;
};

export type FleetHostsFileIo = {
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, body: string) => void;
};

export type SudoExec = (
  argv: string[],
  opts?: { input?: string },
) => { ok: boolean; stdout: string; stderr: string };

/** Wrapper sudoers scopé (VPS) — seul binaire NOPASSWD typique. */
export const CREEZIO_SERVER_DOCKER_WRAPPER =
  "/usr/local/sbin/creezio-server-docker";

export function isFsPermissionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "EACCES" || code === "EPERM";
}

function spawnSudo(
  argv: string[],
  opts?: { input?: string },
): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("sudo", ["-n", ...argv], {
    encoding: "utf8",
    input: opts?.input,
  });
  return {
    ok: r.status === 0,
    stdout: r.stdout || "",
    stderr: String(r.stderr || r.error?.message || ""),
  };
}

/**
 * `sudo -n <cmd>` puis, si refusé, `sudo -n /usr/local/sbin/creezio-server-docker priv-io <cmd>`.
 * Jamais de chmod/chown du fichier cible — le wrapper est le seul fallback.
 */
export function defaultSudoExec(
  argv: string[],
  opts?: { input?: string },
): { ok: boolean; stdout: string; stderr: string } {
  const direct = spawnSudo(argv, opts);
  if (direct.ok) return direct;
  if (!fs.existsSync(CREEZIO_SERVER_DOCKER_WRAPPER)) return direct;
  const viaWrapper = spawnSudo(
    [CREEZIO_SERVER_DOCKER_WRAPPER, "priv-io", ...argv],
    opts,
  );
  if (viaWrapper.ok) return viaWrapper;
  return {
    ok: false,
    stdout: viaWrapper.stdout || direct.stdout,
    stderr:
      [direct.stderr, viaWrapper.stderr].filter(Boolean).join(" | ") ||
      "sudo -n / wrapper refusés",
  };
}

export function permissionError(message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = "EACCES";
  return err;
}

export function formatStackFileEaccesError(filePath: string): string {
  return (
    `fichier stack ${filePath} est root:root 600 (écrit par un geste root / wrapper) ` +
    `et sudo -n / ${CREEZIO_SERVER_DOCKER_WRAPPER} priv-io ont échoué. ` +
    `Ne PAS chmod/chown à la main. ` +
    `Chemin qui marche : installer ${CREEZIO_SERVER_DOCKER_WRAPPER} ` +
    `(docker/server/creezio-server-docker-sudo.sh) avec sudoers ` +
    `NOPASSWD: ${CREEZIO_SERVER_DOCKER_WRAPPER} puis relancer ` +
    `creezio server-docker update|migrate-stack|ensure-owner.`
  );
}

/** Lecture directe, sinon `sudo -n cat` puis wrapper `priv-io cat`. */
export function readTextFileDirectOrSudo(
  filePath: string,
  sudoExec: SudoExec = defaultSudoExec,
): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
  }
  const r = sudoExec(["cat", filePath]);
  if (!r.ok) {
    throw permissionError(
      r.stderr || formatStackFileEaccesError(filePath),
    );
  }
  return r.stdout;
}

/** Écriture directe, sinon `sudo -n tee` / wrapper `priv-io tee` + chmod 600. */
export function writeTextFileDirectOrSudo(
  filePath: string,
  body: string,
  sudoExec: SudoExec = defaultSudoExec,
): void {
  try {
    fs.writeFileSync(filePath, body, { mode: 0o600 });
    return;
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
  }
  const tee = sudoExec(["tee", filePath], { input: body });
  if (!tee.ok) {
    throw permissionError(
      tee.stderr || formatStackFileEaccesError(filePath),
    );
  }
  sudoExec(["chmod", "600", filePath]);
}

export function formatFleetHostsEaccesError(opts: {
  dedicatedUrl: string;
  deniedFiles: string[];
  adminDetail: string;
}): string {
  const files = opts.deniedFiles.join(", ");
  return (
    `hôte enrôlé : agentUrl dédiée ${opts.dedicatedUrl} écrite dans host-agent.json ` +
    `mais ${files} est root:root 600 (écrit par creezio-server-admin) ` +
    `et sudo -n / admin ont échoué (${opts.adminDetail}). ` +
    `Ne PAS chmod/chown à la main. ` +
    `Chemin qui marche : creezio server-docker admin up --admin-root <repo-admin> ` +
    `puis relancer agent up — POST /admin/api/hosts/agent-url écrit le fichier ` +
    `depuis le container (même wrapper que enroll / server-docker update).`
  );
}

/**
 * Écrit `agentUrl` dans un fleet-hosts.json existant (idempotent).
 * EACCES/EPERM → tente sudo -n ; si ça échoue encore, `permissionDenied`
 * (le caller pousse via POST admin, sans aborter).
 */
export function persistDedicatedAgentUrlInFleetHostsFile(
  filePath: string,
  hostId: string,
  dedicatedUrl: string,
  io?: FleetHostsFileIo,
): PersistFleetHostsResult {
  if (!fs.existsSync(filePath)) return { found: false, changed: false };
  const readFile = io?.readFile ?? readTextFileDirectOrSudo;
  const writeFile = io?.writeFile ?? writeTextFileDirectOrSudo;
  let raw: unknown;
  try {
    raw = JSON.parse(readFile(filePath));
  } catch (e) {
    if (isFsPermissionError(e)) {
      return { found: true, changed: false, permissionDenied: true };
    }
    throw new Error(
      `fleet-hosts.json illisible (${filePath}) : ${(e as Error).message}`,
    );
  }
  if (!raw || typeof raw !== "object") {
    throw new Error(`fleet-hosts.json invalide (${filePath})`);
  }
  const data = raw as { hosts?: Array<{ hostId: string; agentUrl?: string }> };
  const result = applyDedicatedAgentUrlToFleetHosts(data, hostId, dedicatedUrl);
  if (result.changed) {
    try {
      writeFile(filePath, JSON.stringify(data, null, 2) + "\n");
    } catch (e) {
      if (isFsPermissionError(e)) {
        return { found: true, changed: false, permissionDenied: true };
      }
      throw e;
    }
  }
  return result;
}
