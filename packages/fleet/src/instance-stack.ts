/**
 * Stack compose autonome par instance serveur — app seule (modèle 0.10)
 * **ou** app + sidecar cloudflared historique (live pré-0.10).
 *
 * Modèle cible (standard flotte, 0.10.0) :
 *   - 1 instance = 1 projet compose `<brandId>-server-<name>` autonome ;
 *   - ports INTERNES fixes : l'app écoute toujours sur 18791 dans le réseau
 *     du stack ; cloudflared tourne IN-PROCESS dans le conteneur app
 *     (fin du sidecar) et la joint en loopback `http://127.0.0.1:18791` ;
 *   - port hôte loopback persisté : `hostPort` / `port` dans servers.json
 *     (et compose `127.0.0.1:<hostPort>:18791`). Premier up : attribution
 *     auto (`127.0.0.1::18791`) puis persistance. Recreate : RÉUTILISE le
 *     port enregistré ; un port libre seulement si aucun n'est enregistré
 *     ou s'il est occupé par un autre process. ;
 *   - secrets JAMAIS dans `environment:` du compose.yml : `cf.env` (contrat
 *     Cloudflare `CREEZIO_CF_*` + `CREEZIO_DOMAIN` + `CREEZIO_TUNNEL_SLUG`)
 *     et `secrets.env` (clés applicatives détectées) sont des `env_file`
 *     chmod 600 générés par le CLI — invisibles dans ps / docker inspect /
 *     le registre ;
 *   - zéro port public : l'accès utilisateur passe par Cloudflare.
 *
 * Contrat update (0.10.3, non négociable — incident flotte prod 0.10.2) :
 *   - un service `cloudflared*` déjà dans le compose est **préservé**
 *     (seule l'image `app` change) — même tunnel.env, même hostname ;
 *   - un hostname public persisté (tunnel.env / kernel) **sans** sidecar
 *     et **sans** contrat in-process (`cf.env`) → **refus** (fail-closed),
 *     jamais un compose app-seule qui coupe le site ;
 *   - `CREEZIO_TUNNEL_LOCAL=1` : comportement local inchangé ;
 *   - `migrate-stack` seul a le droit de retirer le sidecar (`allowDropSidecar`)
 *     et **réutilise** le tunnel existant. Repo admin : admin.{zone} + lp.{zone}
 *     sur le même tunnel (CREEZIO_DOMAIN + EXTRA_HOSTNAMES).
 *
 * SoT partagée : le CLI factory (server-docker create/migrate-stack) et
 * server-lib (update stack-aware) importent ce module — jamais de copie
 * divergente du template compose.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ServerInstance } from "./types.js";
import {
  defaultPrivilegedFileIo,
  type PrivilegedFileIo,
} from "./priv-io.js";

/** Port interne fixe de l'app dans le réseau du stack (standard). */
export const STACK_APP_PORT = 18791;

/**
 * Port hôte déjà alloué : `hostPort` s'il est > 0, sinon `port`
 * (instances 0.24–0.25 qui n'avaient persisté que `port`).
 */
export function recordedHostPort(inst: {
  hostPort?: number;
  port?: number;
}): number {
  const hp = Number(inst.hostPort);
  if (Number.isInteger(hp) && hp > 0) return hp;
  const p = Number(inst.port);
  return Number.isInteger(p) && p > 0 ? p : 0;
}

/** Persiste le port hôte alloué dans l'état d'instance (servers.json). */
export function applyAllocatedHostPort<
  T extends { port?: number; hostPort?: number },
>(inst: T, hp: number): T {
  if (hp > 0) {
    inst.port = hp;
    inst.hostPort = hp;
  }
  return inst;
}

/**
 * Réutilise `recorded` sauf si aucun port n'est enregistré ou s'il est
 * occupé par un *autre* process (pas notre conteneur).
 */
export function resolveReusableHostPort(opts: {
  recorded: number;
  ownContainerPort?: number;
  busy: boolean;
}): number {
  const rec = Number(opts.recorded) || 0;
  if (rec <= 0) return 0;
  if (Number(opts.ownContainerPort) === rec) return rec;
  if (!opts.busy) return rec;
  return 0;
}

export function isLoopbackPortBusy(
  port: number,
  host = "127.0.0.1",
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (busy: boolean) => {
      sock.destroy();
      resolve(busy);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(400, () => done(false));
  });
}

/**
 * Port à pin dans le compose avant recreate : enregistré s'il est libre
 * ou tenu par notre conteneur ; 0 (= auto Docker) sinon.
 */
export async function resolveInstanceHostPort(
  inst: { hostPort?: number; port?: number; containerName?: string },
  opts?: {
    inspectHostPort?: (containerName: string) => number;
    isBusy?: (port: number) => Promise<boolean> | boolean;
  },
): Promise<number> {
  const recorded = recordedHostPort(inst);
  if (recorded <= 0) return 0;
  const inspect = opts?.inspectHostPort ?? stackHostPort;
  const own =
    inst.containerName && inspect
      ? Number(inspect(inst.containerName)) || 0
      : 0;
  const probe = opts?.isBusy ?? isLoopbackPortBusy;
  const busy = own === recorded ? false : Boolean(await probe(recorded));
  return resolveReusableHostPort({
    recorded,
    ownContainerPort: own,
    busy,
  });
}

/**
 * Clés du contrat Cloudflare forwardées par le CLI vers `cf.env` (600).
 * L'instance les consomme au boot pour auto-provisionner son tunnel.
 */
export const CF_ENV_KEYS = [
  "CREEZIO_CF_API_TOKEN",
  "CREEZIO_CF_ACCOUNT_ID",
  "CREEZIO_CF_ZONE_ID",
  "CREEZIO_CF_ZONE_NAME",
  "CREEZIO_CF_UNIVERSAL_SSL",
  "CREEZIO_DOMAIN",
  "CREEZIO_TUNNEL_SLUG",
  "CREEZIO_TUNNEL_EXTRA_HOSTNAMES",
];

/** Instance minimale requise par le rendu stack (sous-ensemble registre). */
export type StackInstance = Pick<
  ServerInstance,
  "name" | "containerName" | "dataDir" | "env" | "variant" | "hostPort"
>;

/** Répertoire du stack (compose.yml + cf.env + secrets.env) — hors /data. */
export function stackDir(brandRoot: string, inst: StackInstance): string {
  return path.join(brandRoot, "docker-data", "stacks", inst.name);
}

export function composeFilePath(brandRoot: string, inst: StackInstance): string {
  return path.join(stackDir(brandRoot, inst), "compose.yml");
}

/** Nom de projet compose stable (fleet tooling, docker compose -p). */
export function stackProjectName(brandId: string, inst: StackInstance): string {
  return `${brandId}-server-${inst.name}`;
}

export function cfEnvPath(brandRoot: string, inst: StackInstance): string {
  return path.join(stackDir(brandRoot, inst), "cf.env");
}

export function secretsEnvPath(brandRoot: string, inst: StackInstance): string {
  return path.join(stackDir(brandRoot, inst), "secrets.env");
}

/**
 * Owner / recette e2e — toujours dans secrets.env (600), jamais dans
 * `environment:` ni le registre. EMAIL ne matche pas isSecretEnvKey
 * (PASSWORD/TOKEN/…) : liste explicite.
 */
export const OWNER_SECRET_ENV_KEYS = [
  "CREEZIO_OWNER_EMAIL",
  "CREEZIO_OWNER_PASSWORD",
  "CREEZIO_E2E_EMAIL",
  "CREEZIO_E2E_PASSWORD",
];

/** Sidecar historique (pré-0.10) — token + hostname, chmod 600. */
export function tunnelEnvPath(brandRoot: string, inst: StackInstance): string {
  return path.join(stackDir(brandRoot, inst), "tunnel.env");
}

/** Échappement double-quote YAML pour les valeurs d'env. */
function yq(value: unknown): string {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Clé d'env « secrète » → env_file 600 (jamais dans `environment:`).
 * Couvre tokens, secrets, mots de passe, clés API/privées.
 */
export function isSecretEnvKey(key: string): boolean {
  const k = String(key || "");
  if (OWNER_SECRET_ENV_KEYS.includes(k)) return true;
  return /TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS/i.test(
    k,
  );
}

/**
 * Fusion secrets.env : les clés fournies gagnent ; les clés owner/e2e
 * déjà persistées ne sont **jamais** droppées si l'update ne les renvoie pas
 * (inst.env du registre ne contient pas CREEZIO_OWNER_* — volontaire).
 */
export function mergeSecretsEnv(
  existing: Record<string, string> | null | undefined,
  next: Record<string, string> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = { ...(existing || {}) };
  for (const [k, v] of Object.entries(next || {})) {
    if (v !== undefined && v !== null && String(v) !== "") out[k] = String(v);
  }
  for (const k of OWNER_SECRET_ENV_KEYS) {
    const incoming = String((next || {})[k] || "").trim();
    const kept = String((existing || {})[k] || "").trim();
    if (!incoming && kept) out[k] = kept;
  }
  return out;
}

function writeMergedSecretsFile(
  secretsFile: string,
  instEnv: Record<string, string> | undefined,
  extra: Record<string, string> = {},
  io: PrivilegedFileIo = defaultPrivilegedFileIo,
): string | null {
  const existing = parseDotEnvFile(secretsFile, io);
  const { secret } = splitInstanceEnv(instEnv);
  const merged = mergeSecretsEnv(existing, { ...secret, ...extra });
  if (Object.keys(merged).length) {
    writeEnvFile600(secretsFile, merged, io);
    return secretsFile;
  }
  if (io.exists(secretsFile)) io.rmFile(secretsFile);
  return null;
}

/**
 * Persiste owner / e2e dans secrets.env (600) sans toucher au compose
 * (sidecar historique inclus). Jamais de secret en log.
 */
export function persistOwnerSecrets({
  brandRoot,
  inst,
  owner,
  io = defaultPrivilegedFileIo,
}: {
  brandRoot: string;
  inst: StackInstance;
  owner?: {
    email?: string;
    password?: string;
    e2eEmail?: string;
    e2ePassword?: string;
  };
  io?: PrivilegedFileIo;
}): string | null {
  fs.mkdirSync(stackDir(brandRoot, inst), { recursive: true });
  const extra: Record<string, string> = {};
  const email = String(owner?.email || "").trim();
  const password = String(owner?.password || "").trim();
  const e2eEmail = String(owner?.e2eEmail || "").trim();
  const e2ePassword = String(owner?.e2ePassword || "").trim();
  if (email) extra.CREEZIO_OWNER_EMAIL = email;
  if (password) extra.CREEZIO_OWNER_PASSWORD = password;
  if (e2eEmail) extra.CREEZIO_E2E_EMAIL = e2eEmail;
  if (e2ePassword) extra.CREEZIO_E2E_PASSWORD = e2ePassword;
  return writeMergedSecretsFile(
    secretsEnvPath(brandRoot, inst),
    inst?.env,
    extra,
    io,
  );
}

/**
 * Sépare l'env d'instance (registre) : `plain` reste dans `environment:`,
 * `secret` part dans `secrets.env` (600). Règle d'audit : aucun secret
 * applicatif en clair dans le compose généré.
 */
export function splitInstanceEnv(env: Record<string, string> | undefined): {
  plain: Record<string, string>;
  secret: Record<string, string>;
} {
  const plain: Record<string, string> = {};
  const secret: Record<string, string> = {};
  for (const [k, v] of Object.entries(env || {})) {
    (isSecretEnvKey(k) ? secret : plain)[k] = v;
  }
  return { plain, secret };
}

/**
 * Rendu du compose.yml d'une instance.
 * opts.inst.hostPort : 0/undefined = attribution auto (défaut), >0 = fixe.
 * opts.withCf : true → `env_file: cf.env` (contrat Cloudflare — l'instance
 * auto-provisionne son tunnel au boot, cloudflared in-process).
 */
export function renderInstanceCompose({
  brandRoot,
  brandId,
  image,
  inst,
  withCf,
  withSecrets,
}: {
  brandRoot: string;
  brandId: string;
  image: string;
  inst: StackInstance;
  withCf?: boolean;
  withSecrets?: boolean;
}): string {
  const dataAbs = path.isAbsolute(inst.dataDir)
    ? inst.dataDir
    : path.join(brandRoot, inst.dataDir);
  const publish =
    Number(inst.hostPort) > 0
      ? `127.0.0.1:${Number(inst.hostPort)}:${STACK_APP_PORT}`
      : `127.0.0.1::${STACK_APP_PORT}`;
  const { plain, secret } = splitInstanceEnv(inst.env);
  const env: Record<string, string> = {
    BRAND_ID: brandId,
    INSTANCE_ID: `server-${inst.name}`,
    PORT: String(STACK_APP_PORT),
    METIER_PORT: String(STACK_APP_PORT),
    CREEZIO_HTTP_HOST: "0.0.0.0",
    ...plain,
  };
  const envLines = Object.entries(env)
    .map(([k, v]) => `      ${k}: ${yq(v)}`)
    .join("\n");
  const labels = [
    `creezio.server=1`,
    `creezio.brand=${brandId}`,
    `creezio.instance=${inst.name}`,
    `creezio.port=${Number(inst.hostPort) > 0 ? Number(inst.hostPort) : "auto"}`,
    `creezio.variant=${inst.variant || "base"}`,
    `creezio.brand-root=${brandRoot}`,
    `creezio.stack=compose`,
  ]
    .map((l) => `      - ${yq(l)}`)
    .join("\n");

  const envFiles = [
    // cf.env : CREEZIO_CF_* (chmod 600) — auto-provisioning tunnel au boot.
    ...(withCf ? [`      - ./cf.env`] : []),
    // secrets.env : clés applicatives + owner/e2e (chmod 600).
    ...(withSecrets || Object.keys(secret).length ? [`      - ./secrets.env`] : []),
  ];

  const app = [
    `  app:`,
    `    image: ${image}`,
    `    container_name: ${inst.containerName}`,
    `    restart: unless-stopped`,
    `    init: true`,
    ...(inst.variant === "browser" ? [`    shm_size: 1g`] : []),
    `    ports:`,
    `      - ${yq(publish)}`,
    `    volumes:`,
    `      - ${yq(`${dataAbs}:/data`)}`,
    ...(envFiles.length ? [`    env_file:`, ...envFiles] : []),
    `    environment:`,
    envLines,
    `    labels:`,
    labels,
    `    extra_hosts:`,
    `      - "host.docker.internal:host-gateway"`,
    `    healthcheck:`,
    `      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:${STACK_APP_PORT}/api/v1/core/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]`,
    `      interval: 30s`,
    `      timeout: 5s`,
    `      retries: 5`,
    `      start_period: 120s`,
    `    logging:`,
    `      driver: json-file`,
    `      options: { max-size: "50m", max-file: "3" }`,
  ];

  return [
    `# Généré par creezio server-docker — stack autonome instance.`,
    `# App seule (cloudflared in-process), ports internes fixes, port hôte`,
    `# loopback auto, secrets en env_file 600, zéro port public.`,
    `# Régénéré à chaque update/migrate — ne pas éditer à la main.`,
    `name: ${stackProjectName(brandId, inst)}`,
    `services:`,
    app.join("\n"),
    ``,
  ].join("\n");
}

/** Écrit un env_file chmod 600 (jamais de secret dans ps/inspect/registre). */
function writeEnvFile600(
  file: string,
  entries: Record<string, string>,
  io: PrivilegedFileIo = defaultPrivilegedFileIo,
): void {
  const lines = Object.entries(entries)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => `${k}=${String(v)}`);
  io.writeFile(file, lines.join("\n") + "\n");
}

/** Parse KEY=VAL (lignes # ignorées) — jamais logué (peut contenir un token). */
export function parseDotEnvFile(
  file: string | null | undefined,
  io: PrivilegedFileIo = defaultPrivilegedFileIo,
): Record<string, string> {
  if (!file || !io.exists(file)) return {};
  const out: Record<string, string> = {};
  for (const line of io.readFile(file).split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

/** Services compose dont le nom commence par `cloudflared` (`cloudflared`, `cloudflared-xxx`). */
export function listCloudflaredServiceNames(composeYml: string | null | undefined): string[] {
  const names: string[] = [];
  const re = /^  (cloudflared[A-Za-z0-9_-]*):/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(composeYml || "")))) names.push(m[1] ?? "");
  return names;
}

export function composeHasCloudflaredSidecar(composeYml: string | null | undefined): boolean {
  return listCloudflaredServiceNames(composeYml).length > 0;
}

export function isLocalTunnelOnly(inst: StackInstance | null | undefined): boolean {
  const v = String(inst?.env?.CREEZIO_TUNNEL_LOCAL || "").trim();
  return v === "1" || /^true$/i.test(v);
}

/** Contrat in-process 0.10 (cf.env) — l'app spawn cloudflared elle-même. */
export function hasInProcessCfContract(
  brandRoot: string,
  inst: StackInstance,
  io: PrivilegedFileIo = defaultPrivilegedFileIo,
): boolean {
  const cf = parseDotEnvFile(cfEnvPath(brandRoot, inst), io);
  return Boolean(
    String(cf.CREEZIO_CF_API_TOKEN || "").trim() &&
      String(cf.CREEZIO_CF_ACCOUNT_ID || "").trim() &&
      String(cf.CREEZIO_CF_ZONE_ID || "").trim(),
  );
}

/**
 * Hostname public persisté (sidecar historique ou kernel).
 * Ne lit jamais le token pour le renvoyer — source + hostname seulement.
 */
export function readPersistedPublicHostname({
  brandRoot,
  inst,
  brandId,
  io = defaultPrivilegedFileIo,
}: {
  brandRoot: string;
  inst: StackInstance;
  brandId?: string;
  io?: PrivilegedFileIo;
}): { hostname: string; source: string } | null {
  const tunnel = parseDotEnvFile(tunnelEnvPath(brandRoot, inst), io);
  const fromTunnel = String(tunnel.CREEZIO_TUNNEL_HOSTNAME || "").trim();
  if (fromTunnel) return { hostname: fromTunnel, source: "tunnel.env" };
  const fromInst = String(
    inst?.env?.CREEZIO_TUNNEL_HOSTNAME || inst?.env?.CREEZIO_DOMAIN || "",
  ).trim();
  if (fromInst) return { hostname: fromInst, source: "instance.env" };
  if (brandId) {
    const kc = readKernelTunnelConfig(brandRoot, inst, brandId);
    if (kc?.hostname) return { hostname: kc.hostname, source: "kernel" };
  }
  return null;
}

export type StackUpdatePolicy =
  | { action: "preserve-sidecar"; sidecarServices: string[] }
  | { action: "rewrite" }
  | { action: "refuse"; hostname: string; error: string };

/** Politique update d'un stack existant. */
export function resolveStackUpdatePolicy({
  brandRoot,
  brandId,
  inst,
  composeYml,
  io = defaultPrivilegedFileIo,
}: {
  brandRoot: string;
  brandId?: string;
  inst: StackInstance;
  composeYml?: string;
  io?: PrivilegedFileIo;
}): StackUpdatePolicy {
  const composeFile = composeFilePath(brandRoot, inst);
  const yml =
    composeYml !== undefined
      ? String(composeYml || "")
      : io.exists(composeFile)
        ? io.readFile(composeFile)
        : "";
  const sidecarServices = listCloudflaredServiceNames(yml);
  if (sidecarServices.length) {
    return { action: "preserve-sidecar", sidecarServices };
  }
  if (isLocalTunnelOnly(inst)) {
    return { action: "rewrite" };
  }
  if (hasInProcessCfContract(brandRoot, inst, io)) {
    return { action: "rewrite" };
  }
  const persisted = readPersistedPublicHostname({ brandRoot, inst, brandId, io });
  const hasTunnelEnv = io.exists(tunnelEnvPath(brandRoot, inst));
  if (persisted || hasTunnelEnv) {
    const hostname = persisted?.hostname || "(adresse publique persistée)";
    return {
      action: "refuse",
      hostname,
      error:
        `update refusé : ${inst.name} a une adresse publique (${hostname}) ` +
        `mais le compose n'a plus de service cloudflared. Réécrire le compose ` +
        `couperait le site. Restaurer le sidecar, ou lancer migrate-stack ` +
        `(réutilise le même tunnel). Rien n'a été modifié.`,
    };
  }
  return { action: "rewrite" };
}

/**
 * Remplace uniquement `image:` du service `app` — jamais celle de cloudflared.
 */
export function patchComposeAppImage(yml: string | null | undefined, image: string): string {
  const text = String(yml || "");
  const appMatch = text.match(/^  app:\s*$/m);
  if (!appMatch || appMatch.index === undefined) {
    throw new Error("compose.yml sans service app — refus de réécriture");
  }
  const appIdx = appMatch.index;
  const afterHead = text.slice(appIdx + appMatch[0].length);
  const nextSvc = afterHead.search(/^  [A-Za-z0-9_-]+:/m);
  const blockEnd = nextSvc < 0 ? text.length : appIdx + appMatch[0].length + nextSvc;
  const before = text.slice(0, appIdx);
  const block = text.slice(appIdx, blockEnd);
  const rest = text.slice(blockEnd);
  if (!/^[ ]{4}image:/m.test(block)) {
    throw new Error("service app sans image — refus de réécriture");
  }
  const patched = block.replace(
    /^([ ]{4}image:\s+)("[^"]+"|\S+)/m,
    `$1${image}`,
  );
  return before + patched + rest;
}

/** Erreur typée du refus fail-closed d'update de stack. */
export interface StackUpdateRefusedError extends Error {
  code: "STACK_UPDATE_REFUSED";
  policy: StackUpdatePolicy;
}

export function isStackUpdateRefused(e: unknown): e is StackUpdateRefusedError {
  return (
    e instanceof Error &&
    (e as { code?: unknown }).code === "STACK_UPDATE_REFUSED"
  );
}

export interface WriteInstanceStackResult {
  dir: string;
  composeFile: string;
  withCf: boolean;
  preservedSidecar: boolean;
  sidecarServices?: string[];
}

/**
 * Écrit compose.yml + cf.env (contrat Cloudflare) + secrets.env (clés
 * applicatives) — tous deux chmod 600 : un secret ne doit jamais apparaître
 * dans ps, le registre ou un docker inspect.
 *
 * opts.cf : objet des clés CF_ENV_KEYS à écrire ; `undefined` → cf.env
 * existant conservé (updates sans re-fournir les credentials) ; `null` →
 * cf.env supprimé (tunnel désactivé). secrets.env est recalculé à chaque
 * écriture depuis inst.env (supprimé s'il n'y a plus de secret).
 *
 * opts.allowDropSidecar : **uniquement** `migrate-stack`. Sans ce flag,
 * un sidecar `cloudflared*` est préservé (patch image app) ; un hostname
 * public persisté sans sidecar refuse l'écriture (fail-closed).
 */
export function writeInstanceStack({
  brandRoot,
  brandId,
  image,
  inst,
  cf,
  allowDropSidecar = false,
  io = defaultPrivilegedFileIo,
}: {
  brandRoot: string;
  brandId: string;
  image: string;
  inst: StackInstance;
  cf?: Record<string, string> | null;
  allowDropSidecar?: boolean;
  io?: PrivilegedFileIo;
}): WriteInstanceStackResult {
  const dir = stackDir(brandRoot, inst);
  fs.mkdirSync(dir, { recursive: true });
  const composeFile = composeFilePath(brandRoot, inst);
  const existing = io.exists(composeFile) ? io.readFile(composeFile) : "";

  if (!allowDropSidecar && existing) {
    const policy = resolveStackUpdatePolicy({
      brandRoot,
      brandId,
      inst,
      composeYml: existing,
      io,
    });
    if (policy.action === "refuse") {
      const err = new Error(policy.error) as StackUpdateRefusedError;
      err.code = "STACK_UPDATE_REFUSED";
      err.policy = policy;
      throw err;
    }
    if (policy.action === "preserve-sidecar") {
      io.writeFile(composeFile, patchComposeAppImage(existing, image));
      // Sidecar intact — secrets.env fusionné (owner/e2e jamais droppés).
      writeMergedSecretsFile(secretsEnvPath(brandRoot, inst), inst.env, {}, io);
      return {
        dir,
        composeFile,
        withCf: io.exists(cfEnvPath(brandRoot, inst)),
        preservedSidecar: true,
        sidecarServices: policy.sidecarServices,
      };
    }
  }

  const cfFile = cfEnvPath(brandRoot, inst);
  if (cf && typeof cf === "object") {
    writeEnvFile600(cfFile, cf, io);
  } else if (cf === null && io.exists(cfFile)) {
    io.rmFile(cfFile);
  }
  const secretsFile = secretsEnvPath(brandRoot, inst);
  writeMergedSecretsFile(secretsFile, inst.env, {}, io);
  const withCf = Boolean(cf && Object.keys(cf).length) || io.exists(cfFile);
  const withSecrets = io.exists(secretsFile);
  io.writeFile(
    composeFile,
    renderInstanceCompose({ brandRoot, brandId, image, inst, withCf, withSecrets }),
  );
  return { dir, composeFile, withCf, preservedSidecar: false };
}

function run(
  cmd: string,
  args: string[],
  opts: { quiet?: boolean } & Parameters<typeof spawnSync>[2] = {},
) {
  const { quiet, ...rest } = opts;
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    ...rest,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} → exit ${r.status}${r.stderr ? ` — ${String(r.stderr).slice(0, 400)}` : ""}`,
    );
  }
  return r;
}

function composeBase(brandRoot: string, inst: StackInstance): string[] {
  return ["compose", "-f", composeFilePath(brandRoot, inst)];
}

export function stackUp(
  brandRoot: string,
  inst: StackInstance,
  { quiet, removeOrphans = true }: { quiet?: boolean; removeOrphans?: boolean } = {},
): void {
  const args = [...composeBase(brandRoot, inst), "up", "-d"];
  // update d'un sidecar historique : jamais --remove-orphans (c'est ce
  // flag qui a tué cloudflared quand le compose était régénéré app-seule).
  if (removeOrphans) args.push("--remove-orphans");
  run("docker", args, { quiet });
}

/**
 * Recrée uniquement le service `app` (injecte secrets.env) — jamais
 * --remove-orphans, jamais le sidecar cloudflared.
 */
export function stackRecreateApp(
  brandRoot: string,
  inst: StackInstance,
  { quiet }: { quiet?: boolean } = {},
): void {
  run(
    "docker",
    [
      ...composeBase(brandRoot, inst),
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "app",
    ],
    { quiet },
  );
}

export function stackDown(
  brandRoot: string,
  inst: StackInstance,
  { quiet }: { quiet?: boolean } = {},
): void {
  run("docker", [...composeBase(brandRoot, inst), "down"], { quiet });
}

export function stackStop(
  brandRoot: string,
  inst: StackInstance,
  { quiet }: { quiet?: boolean } = {},
): void {
  run("docker", [...composeBase(brandRoot, inst), "stop"], { quiet });
}

export function stackStart(
  brandRoot: string,
  inst: StackInstance,
  { quiet }: { quiet?: boolean } = {},
): void {
  run("docker", [...composeBase(brandRoot, inst), "start"], { quiet });
}

export function stackLogs(
  brandRoot: string,
  inst: StackInstance,
  { tail = 200, follow = false }: { tail?: number; follow?: boolean } = {},
): void {
  const args = [...composeBase(brandRoot, inst), "logs", "--tail", String(tail)];
  if (follow) args.push("-f");
  run("docker", args);
}

/**
 * Port hôte loopback attribué (auto) au service app — debug/healthcheck.
 * Source de vérité : docker inspect du conteneur (le registre suit).
 */
export function stackHostPort(containerName: string): number {
  const r = spawnSync(
    "docker",
    [
      "inspect",
      containerName,
      "--format",
      `{{(index (index .NetworkSettings.Ports "${STACK_APP_PORT}/tcp") 0).HostPort}}`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return 0;
  const p = Number(String(r.stdout).trim());
  return Number.isInteger(p) && p > 0 ? p : 0;
}

export interface KernelTunnelConfig {
  slug: string;
  hostname: string;
  publicUrl: string;
  tunnelId: string;
  tunnelToken: string;
  localPort: number;
}

/** Token tunnel stocké par le kernel dans /data (format {plain} ou brut). */
export function readKernelTunnelConfig(
  brandRoot: string,
  inst: StackInstance,
  brandId: string,
): KernelTunnelConfig | null {
  const dataAbs = path.isAbsolute(inst.dataDir)
    ? inst.dataDir
    : path.join(brandRoot, inst.dataDir);
  const file = path.join(dataAbs, `${brandId}-config.json`);
  let raw: {
    tunnelMeta?: {
      slug?: string;
      hostname?: string;
      publicUrl?: string;
      tunnelId?: string;
      localPort?: number;
    } | null;
    tunnelToken?: unknown;
  };
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const meta = raw.tunnelMeta || null;
  let token = "";
  try {
    const t =
      typeof raw.tunnelToken === "string"
        ? (JSON.parse(raw.tunnelToken) as unknown)
        : raw.tunnelToken;
    token = String((t as { plain?: unknown } | null)?.plain ?? t ?? "");
  } catch {
    token = String(raw.tunnelToken || "");
  }
  if (!meta?.hostname || !token || token === "local") return null;
  return {
    slug: meta.slug || inst.name,
    hostname: meta.hostname,
    publicUrl: meta.publicUrl || `https://${meta.hostname}`,
    tunnelId: meta.tunnelId || "",
    tunnelToken: token,
    localPort: meta.localPort || STACK_APP_PORT,
  };
}
