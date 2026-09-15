/**
 * Logique serveurs Docker partagée admin ↔ agent hôte flotte.
 *
 * SoT registre : {brandRoot}/docker-data/servers.json (conventions
 * `creezio server-docker` — packages/factory/src/server-docker-registry.ts).
 *
 * Consommé par :
 *   - server-admin (Creezio Server Admin — VPS admin, socket local)
 *   - host-agent   (agent hôte flotte — VPS client, exposé tunnel)
 */

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  containerLogs,
  createContainer,
  dockerPing,
  imageExists,
  inspectContainer,
  listContainers,
  pullImage,
  removeContainer,
  startContainer,
  stopContainer,
} from "./docker.js";
import {
  applyAllocatedHostPort,
  isStackUpdateRefused,
  resolveInstanceHostPort,
  resolveStackUpdatePolicy,
  stackHostPort,
  stackUp,
  writeInstanceStack,
} from "./instance-stack.js";
import { defaultPrivilegedFileIo, isFsPermissionError } from "./priv-io.js";
import type {
  AuditFn,
  BackupResult,
  BootStatusLight,
  CollectedServer,
  DockerStateLight,
  JsonResponse,
  ServerInstance,
  ServerRegistry,
  UpdateResult,
} from "./types.js";

// Conventions registre (miroir de factory/src/server-docker-registry.ts).
export const SERVER_PORT_BASE = 18790;
export const SERVER_CONTAINER_PORT = 18791;
export const SERVER_LABEL = "creezio.server";
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;

/* ---------------------------------------------------------------- fichiers */

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown): void {
  const body = JSON.stringify(data, null, 2) + "\n";
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
    defaultPrivilegedFileIo.writeFile(file, body);
  }
}

export async function fetchJson(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<JsonResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* corps non JSON */
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- registre */

export function registryPath(brandRoot: string): string {
  return path.join(brandRoot, "docker-data", "servers.json");
}

export function inferBrandId(brandRoot: string): string {
  for (const dir of [brandRoot, path.join(brandRoot, "server")]) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf8"),
      ) as { name?: string; creezio?: { brandId?: string } };
      if (pkg?.creezio?.brandId) return pkg.creezio.brandId;
      if (pkg?.name) {
        const last = String(pkg.name).split("/").pop() || "";
        const id = last.replace(/^app-/, "").replace(/[^a-z0-9-]/gi, "");
        if (id) return id;
      }
    } catch {
      /* dossier suivant */
    }
  }
  return path.basename(brandRoot);
}

export function loadRegistry(brandRoot: string): ServerRegistry {
  const brandId = inferBrandId(brandRoot);
  const raw = readJson<Partial<ServerRegistry> | null>(
    registryPath(brandRoot),
    null,
  );
  if (raw && Array.isArray(raw.instances)) {
    return {
      version: 1,
      brandId: raw.brandId || brandId,
      image: raw.image || `creezio-server-${brandId}:local`,
      instances: raw.instances,
    };
  }
  return {
    version: 1,
    brandId,
    image: `creezio-server-${brandId}:local`,
    instances: [],
  };
}

export function saveRegistry(brandRoot: string, registry: ServerRegistry): void {
  writeJson(registryPath(brandRoot), registry);
}

export function instanceDataDirAbs(brandRoot: string, inst: ServerInstance): string {
  return path.isAbsolute(inst.dataDir)
    ? inst.dataDir
    : path.join(brandRoot, inst.dataDir);
}

/** Image effective d'une instance (per-instance après update, sinon marque). */
export function instanceImage(registry: ServerRegistry, inst: ServerInstance): string {
  return inst.image || registry.image;
}

/**
 * Proxy vers le mount support natif d'une instance (loopback uniquement).
 * Utilisé par host-agent et server-admin — l'admin de marque pull les
 * tickets / pousse les réponses via ce relais (jamais de push instance→admin).
 */
export async function proxyInstanceSupport(
  inst: ServerInstance,
  method: string,
  restPath: string,
  search: string,
  body: unknown,
): Promise<JsonResponse> {
  const target =
    `http://127.0.0.1:${inst.port}/api/v1/platform/platform-support` +
    `${restPath || ""}${search || ""}`;
  return fetchJson(target, 5000, {
    method,
    ...(body != null
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

export interface FoundInstance {
  brandRoot: string;
  registry: ServerRegistry;
  inst: ServerInstance;
}

export function findInstance(
  brandRoots: string[],
  brandId: string,
  name: string,
): FoundInstance | null {
  for (const brandRoot of brandRoots) {
    const registry = loadRegistry(brandRoot);
    if (registry.brandId !== brandId) continue;
    const inst = registry.instances.find((i) => i.name === name);
    if (inst) return { brandRoot, registry, inst };
  }
  return null;
}

export function portBusy(port: number, host = "127.0.0.1"): Promise<boolean> {
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

/** Premier port libre à partir de 18791 — évite les registres de TOUTES les marques. */
export async function allocatePort(brandRoots: string[]): Promise<number> {
  const used = new Set<number>();
  for (const brandRoot of brandRoots) {
    for (const inst of loadRegistry(brandRoot).instances) used.add(inst.port);
  }
  for (let n = 1; n < 200; n++) {
    const candidate = SERVER_PORT_BASE + n;
    if (used.has(candidate)) continue;
    if (await portBusy(candidate)) continue;
    return candidate;
  }
  throw new Error("aucun port libre entre 18791 et 18990");
}

/* ------------------------------------------------------------ état docker */

/** Inspect léger : {state, health, startedAt, image}. "unknown" si docker KO. */
export async function dockerStateOf(containerName: string): Promise<DockerStateLight> {
  try {
    const info = await inspectContainer(containerName);
    if (!info)
      return { state: "absent", health: null, startedAt: null, image: null };
    return {
      state: info?.State?.Status || "?",
      health: info?.State?.Health?.Status || null,
      startedAt: info?.State?.StartedAt || null,
      image: info?.Config?.Image || null,
    };
  } catch {
    return { state: "unknown", health: null, startedAt: null, image: null };
  }
}

/** Boot-status léger (timeout 1s) — null si injoignable. */
export async function fetchBootStatusLight(port: number): Promise<BootStatusLight | null> {
  try {
    const r = await fetchJson(
      `http://127.0.0.1:${port}/api/v1/os/boot-status`,
      1000,
    );
    if (r.status !== 200 || !r.json) return null;
    const j = r.json as {
      booting?: unknown;
      headline?: string | null;
      overallPercent?: number | null;
      bootStartedAt?: string | null;
    };
    return {
      booting: j.booting === true,
      headline: j.headline ?? null,
      overallPercent: j.overallPercent ?? null,
      bootStartedAt: j.bootStartedAt ?? null,
    };
  } catch {
    return null;
  }
}

/** Version applicative (GET /api/v1/core/version) — null si injoignable. */
export async function fetchVersionLight(port: number): Promise<string | null> {
  try {
    const r = await fetchJson(
      `http://127.0.0.1:${port}/api/v1/core/version`,
      1000,
    );
    if (r.status !== 200 || !r.json) return null;
    return (r.json as { version?: string | null }).version ?? null;
  } catch {
    return null;
  }
}

export async function collectServers(
  brandRoots: string[],
): Promise<{ servers: CollectedServer[]; docker: boolean }> {
  const dockerUp = await dockerPing();
  const servers: CollectedServer[] = [];
  const known = new Set<string>();
  for (const brandRoot of brandRoots) {
    const registry = loadRegistry(brandRoot);
    for (const inst of registry.instances) {
      known.add(inst.containerName);
      const docker = dockerUp
        ? await dockerStateOf(inst.containerName)
        : { state: "unknown", health: null, startedAt: null, image: null };
      const running = docker.state === "running";
      const bootStatus = running ? await fetchBootStatusLight(inst.port) : null;
      const version = running ? await fetchVersionLight(inst.port) : null;
      servers.push({
        brandId: registry.brandId,
        brandRoot,
        name: inst.name,
        containerName: inst.containerName,
        port: inst.port,
        bind: inst.bind ?? null,
        dataDir: inst.dataDir,
        createdAt: inst.createdAt ?? null,
        env: inst.env || {},
        image: instanceImage(registry, inst),
        version,
        orphan: false,
        docker,
        bootStatus,
      });
    }
  }
  // Containers docker labellisés creezio.server=1 absents des registres.
  if (dockerUp) {
    try {
      const list = await listContainers({
        all: true,
        filters: { label: [`${SERVER_LABEL}=1`] },
      });
      for (const c of list) {
        const cname = String((c.Names || [])[0] || "").replace(/^\//, "");
        if (!cname || known.has(cname)) continue;
        const labels = c.Labels || {};
        servers.push({
          brandId: labels["creezio.brand"] || null,
          brandRoot: labels["creezio.brand-root"] || null,
          name: labels["creezio.instance"] || cname,
          containerName: cname,
          port: labels["creezio.port"] ? Number(labels["creezio.port"]) : null,
          bind: null,
          dataDir: null,
          createdAt: null,
          env: {},
          image: c.Image || null,
          version: null,
          orphan: true,
          docker: {
            state: c.State || "?",
            health: null,
            startedAt: null,
            image: c.Image || null,
          },
          bootStatus: null,
        });
      }
    } catch {
      /* best effort */
    }
  }
  return { servers, docker: dockerUp };
}

/* --------------------------------------------------------------- spec/run */

/**
 * Spec Engine API d'une instance — miroir de buildDockerRunArgs (CLI).
 * Même volume /data, mêmes labels, mêmes env de base + env persistés.
 */
export function buildContainerSpec({
  brandRoot,
  brandId,
  image,
  inst,
}: {
  brandRoot: string;
  brandId: string;
  image: string;
  inst: ServerInstance;
}): Record<string, unknown> {
  const dataAbs = instanceDataDirAbs(brandRoot, inst);
  const envList = [
    `BRAND_ID=${brandId}`,
    `INSTANCE_ID=server-${inst.name}`,
    `PORT=${SERVER_CONTAINER_PORT}`,
    `METIER_PORT=${SERVER_CONTAINER_PORT}`,
    "CREEZIO_HTTP_HOST=0.0.0.0",
    ...Object.entries(inst.env || {}).map(([k, v]) => `${k}=${v}`),
  ];
  return {
    Image: image,
    Env: envList,
    Labels: {
      [SERVER_LABEL]: "1",
      "creezio.brand": brandId,
      "creezio.instance": inst.name,
      "creezio.port": String(inst.port),
      "creezio.variant": inst.variant || "base",
      "creezio.brand-root": brandRoot,
    },
    ExposedPorts: { [`${SERVER_CONTAINER_PORT}/tcp`]: {} },
    HostConfig: {
      Binds: [`${dataAbs}:/data`],
      PortBindings: {
        [`${SERVER_CONTAINER_PORT}/tcp`]: [
          { HostIp: inst.bind || "127.0.0.1", HostPort: String(inst.port) },
        ],
      },
      RestartPolicy: { Name: "unless-stopped" },
      // Chromium sidecar : /dev/shm 64 Mo par défaut = crashs renderer.
      ...(inst.variant === "browser" ? { ShmSize: 1024 * 1024 * 1024 } : {}),
    },
  };
}

export interface CreateServerBody {
  brandRoot?: string;
  brandId?: string;
  name?: string;
  image?: string;
  pull?: boolean;
  port?: number;
  env?: Record<string, unknown>;
}

export async function createServer(
  brandRoots: string[],
  body: CreateServerBody,
  audit?: AuditFn,
): Promise<{ code: number; out: { ok: boolean; error?: string; instance?: unknown } }> {
  const brandRoot = path.resolve(String(body.brandRoot || ""));
  if (!brandRoots.includes(brandRoot)) {
    return {
      code: 400,
      out: { ok: false, error: "brandRoot inconnu (brand roots configurés)" },
    };
  }
  const name = String(body.name || "");
  if (!NAME_RE.test(name)) {
    return {
      code: 400,
      out: { ok: false, error: "nom invalide (attendu [a-z0-9][a-z0-9-]{0,30})" },
    };
  }
  const registry = loadRegistry(brandRoot);
  if (registry.instances.some((i) => i.name === name)) {
    return {
      code: 409,
      out: { ok: false, error: `instance déjà enregistrée: ${name}` },
    };
  }
  const containerName = `${registry.brandId}-server-${name}`;
  const existing = await inspectContainer(containerName);
  if (existing) {
    return {
      code: 409,
      out: { ok: false, error: `container ${containerName} existe déjà` },
    };
  }
  const image = String(body.image || registry.image);
  if (!(await imageExists(image))) {
    if (body.pull === true) {
      await pullImage(image, { authB64: registryAuthB64() });
    } else {
      return {
        code: 409,
        out: {
          ok: false,
          error: `image ${image} absente — build ou pull requis (body.pull=true)`,
        },
      };
    }
  }
  const requested = Number(body.port || 0);
  if (requested > 0 && (await portBusy(requested))) {
    return {
      code: 409,
      out: { ok: false, error: `port ${requested} déjà occupé` },
    };
  }
  const port =
    requested > 0 && Number.isInteger(requested)
      ? requested
      : await allocatePort(brandRoots);
  const extraEnv: Record<string, string> = {};
  if (body.env && typeof body.env === "object") {
    for (const [k, v] of Object.entries(body.env)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) extraEnv[k] = String(v);
    }
  }
  const inst: ServerInstance = {
    name,
    containerName,
    port,
    bind: "127.0.0.1",
    dataDir: path.join("docker-data", "servers", name),
    createdAt: new Date().toISOString(),
    ...(Object.keys(extraEnv).length ? { env: extraEnv } : {}),
    ...(body.image ? { image } : {}),
  };
  fs.mkdirSync(instanceDataDirAbs(brandRoot, inst), { recursive: true });
  const spec = buildContainerSpec({
    brandRoot,
    brandId: registry.brandId,
    image,
    inst,
  });
  const created = await createContainer(containerName, spec);
  await startContainer(created.Id);
  registry.instances.push(inst);
  saveRegistry(brandRoot, registry);
  audit?.(
    `create brand=${registry.brandId} name=${name} port=${port} container=${containerName}`,
  );
  return {
    code: 200,
    out: {
      ok: true,
      instance: { ...inst, brandId: registry.brandId, brandRoot },
    },
  };
}

/* --------------------------------------------------------------- backups */

/** Kill-switch backups (CLI `--backup`, API `backup:true`, one-shot). Défaut on. */
export const SERVER_DOCKER_BACKUP_ENV = "CREEZIO_SERVER_DOCKER_BACKUP";

/**
 * Défaut **on** (prod-safe). `0` / `false` / `off` = skip.
 * L'env gagne sur `--backup` / `{"backup":true}`.
 */
export function isServerDockerBackupEnabled(
  raw: string | undefined | null = process.env.CREEZIO_SERVER_DOCKER_BACKUP,
): boolean {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

export function backupsDir(brandRoot: string): string {
  return path.join(brandRoot, "docker-data", "backups");
}

/**
 * tar.gz du volume /data d'une instance, puis vérification d'intégrité
 * (gzip -t). Sémantique GNU tar sur volume VIVANT : exit 1 = « file changed
 * as we read it » — l'archive est écrite et valide (vécu flotte prod :
 * backup 2,4 Go complet signalé « indisponible »). Seuls exit ≥ 2, spawn
 * error ou archive invalide sont des échecs (fichier partiel supprimé).
 * Retourne { ok, file, detail }.
 */
export function backupInstanceData(
  brandRoot: string,
  inst: ServerInstance,
): Promise<BackupResult> {
  const run = (cmd: string, args: string[]) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (c) => {
        if (stdout.length < 4096) stdout += String(c);
      });
      child.stderr?.on("data", (c) => {
        if (stderr.length < 4096) stderr += String(c);
      });
      child.on("error", (e) =>
        resolve({ code: -1, stdout, stderr: String(e?.message || e) }),
      );
      child.on("exit", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });
  return (async (): Promise<BackupResult> => {
    if (!isServerDockerBackupEnabled()) {
      return {
        ok: true,
        file: null,
        detail: "backup skippé (CREEZIO_SERVER_DOCKER_BACKUP=0)",
      };
    }
    const dataAbs = instanceDataDirAbs(brandRoot, inst);
    if (!fs.existsSync(dataAbs)) {
      return { ok: false, file: null, detail: `volume introuvable: ${dataAbs}` };
    }
    const dir = backupsDir(brandRoot);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${inst.name}-${stamp}.tar.gz`);
    // Le tar tourne DANS un conteneur éphémère (image de l'instance — Debian,
    // GNU tar) : /data contient des fichiers root-owned 600 écrits par le
    // conteneur (token plugins, config) et backups/ peut être root-owned.
    // Un tar hôte en user non-root produirait une archive INCOMPLÈTE
    // (fichiers skippés) voire non créable (vécu prod 2026-08-12, tar
    // exit 2). Via le socket docker (groupe docker, sans sudo) le tar
    // s'exécute en root : lecture complète + écriture garantie, puis chown
    // au uid/gid de l'appelant pour que la rétention (pruneBackups, user
    // hôte) fonctionne. Comportement identique sur tous les hôtes, quelle
    // que soit l'ownership.
    const insp = await run("docker", [
      "inspect",
      "--format",
      "{{.Config.Image}}",
      inst.containerName,
    ]);
    const image = insp.code === 0 ? insp.stdout.trim().split("\n")[0] : "";
    if (!image) {
      return {
        ok: false,
        file: null,
        detail: `image du conteneur ${inst.containerName} introuvable (docker inspect)`,
      };
    }
    const uid = typeof process.getuid === "function" ? process.getuid() : 0;
    const gid = typeof process.getgid === "function" ? process.getgid() : 0;
    const base = path.basename(file);
    const name = path.basename(dataAbs);
    // tar 0/1 → gzip -t + chown (exit 0) ; tar ≥ 2 → fatal (exit propagé).
    const script =
      `tar -czf /out/${base} --warning=no-file-changed --ignore-failed-read` +
      ` -C /srv ${name}; code=$?;` +
      ` if [ "$code" -le 1 ]; then` +
      ` if [ "$code" = 1 ]; then echo TAR_LIVE=1; fi;` +
      ` gzip -t /out/${base} && chown ${uid}:${gid} /out/${base};` +
      ` else echo "TAR_FATAL=$code" >&2; exit "$code"; fi`;
    const tar = await run("docker", [
      "run",
      "--rm",
      "-v",
      `${path.dirname(dataAbs)}:/srv:ro`,
      "-v",
      `${dir}:/out`,
      image,
      "sh",
      "-c",
      script,
    ]);
    // GNU tar : 0 = OK, 1 = fichiers modifiés pendant la lecture (archive
    // complète — normal sur un container up), ≥ 2 / -1 = erreur réelle.
    if (tar.code !== 0) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* partiel absent */
      }
      return {
        ok: false,
        file: null,
        detail: `tar conteneur exit ${tar.code}${tar.stderr ? ` — ${tar.stderr.trim().slice(0, 300)}` : ""}`,
      };
    }
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      /* stat KO → archive absente */
    }
    if (size <= 0) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        /* déjà absent */
      }
      return {
        ok: false,
        file: null,
        detail: "archive invalide (0 octet après tar conteneur)",
      };
    }
    return {
      ok: true,
      file,
      detail: `${path.basename(file)} (${Math.round(size / 1e6)} Mo, gzip vérifié en conteneur${tar.stdout.includes("TAR_LIVE") ? ", fichiers vivants" : ""})`,
    };
  })();
}

/**
 * Rétention backups d'update (défaut 1, env CREEZIO_UPDATE_BACKUP_KEEP ≥ 1).
 * Chaque backup pèse ~la taille du volume /data compressé (vécu : 2,4 Go par
 * serveur) — sans borne le disque du VPS regonfle à chaque update de flotte.
 * On ne garde que le DERNIER backup par serveur (décision 2026-08-06).
 */
export function updateBackupKeep(): number {
  const n = Number.parseInt(process.env.CREEZIO_UPDATE_BACKUP_KEEP || "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Rétention simple : garder les N derniers backups d'une instance. */
export function pruneBackups(
  brandRoot: string,
  instName: string,
  keep = updateBackupKeep(),
): void {
  try {
    const dir = backupsDir(brandRoot);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${instName}-`) && f.endsWith(".tar.gz"))
      .sort()
      .reverse();
    for (const f of files.slice(keep)) {
      fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    /* pas de backups */
  }
}

/* ---------------------------------------------------------------- update */

export function registryAuthB64(): string | undefined {
  // base64 de {"username","password","serveraddress"} — registres privés.
  return (process.env.CREEZIO_REGISTRY_AUTH || "").trim() || undefined;
}

export async function waitBootReady(port: number, timeoutMs = 180_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetchJson(
        `http://127.0.0.1:${port}/api/v1/core/health`,
        2000,
      );
      if (r.status === 200 && (r.json as { ok?: unknown } | null)?.ok) return true;
    } catch {
      /* pas encore up */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Update d'une instance : pull nouvelle image → [opt-in backup /data] →
 * recreate même volume/labels/env → attente health → rollback image
 * précédente si KO.
 *
 * Défaut `backup=false` (itération / data stables) : pas de nouveau tar.gz.
 * Les archives déjà dans `docker-data/backups/` sont **conservées** (pas de
 * prune ici). Opt-in : CLI `--backup` / API `{"backup":true}` / one-shot
 * `creezio server-docker backup <nom>`.
 * `CREEZIO_SERVER_DOCKER_BACKUP=0` (aussi `false`/`off`) gagne : skip
 * même si `--backup` / `backup:true` (warn CLI / log update).
 *
 * Stack compose : un sidecar `cloudflared*` est **préservé** (même tunnel,
 * même hostname). Un hostname public persisté sans sidecar → refus
 * (fail-closed) avant tout recreate. Jamais de 2e hostname à l'update.
 */
export async function updateServer({
  brandRoot,
  registry,
  inst,
  image,
  audit,
  onStep,
  waitTimeoutMs = 180_000,
  backup = false,
}: {
  brandRoot: string;
  registry: ServerRegistry;
  inst: ServerInstance;
  image: string;
  audit?: AuditFn;
  /** Hook optionnel appelé à chaque étape (suivi update-status persisté). */
  onStep?: (step: string) => void;
  waitTimeoutMs?: number;
  backup?: boolean;
}): Promise<UpdateResult> {
  const brandId = registry.brandId;
  const prev = await dockerStateOf(inst.containerName);
  const previousImage = prev.image || instanceImage(registry, inst);
  const steps: string[] = [];
  const log = (s: string) => {
    steps.push(s);
    audit?.(`update ${brandId}/${inst.name}: ${s}`);
    try {
      onStep?.(s);
    } catch {
      /* le suivi ne doit jamais casser l'update */
    }
  };

  let stackPolicy: ReturnType<typeof resolveStackUpdatePolicy> | null = null;
  if (inst.stack) {
    stackPolicy = resolveStackUpdatePolicy({ brandRoot, brandId, inst });
    if (stackPolicy.action === "refuse") {
      log(stackPolicy.error);
      return {
        ok: false,
        error: stackPolicy.error,
        image,
        previousImage,
        rolledBack: false,
        backup: null,
        steps,
      };
    }
    if (stackPolicy.action === "preserve-sidecar") {
      log(
        `sidecar ${stackPolicy.sidecarServices.join(", ")} conservé — même tunnel / hostname`,
      );
    }
  }

  if (!(await imageExists(image))) {
    log(`pull ${image}`);
    await pullImage(image, { authB64: registryAuthB64() });
  } else {
    log(`image ${image} déjà locale`);
  }

  let backupFile: string | null = null;
  if (backup && !isServerDockerBackupEnabled()) {
    log("backup skippé (CREEZIO_SERVER_DOCKER_BACKUP=0)");
    backup = false;
  }
  if (backup) {
    const b = await backupInstanceData(brandRoot, inst);
    if (!b.ok) {
      // Backup demandé mais impossible : échec PROPRE avant tout recreate
      // (rien n'a été touché) — jamais un warning silencieux.
      log(`backup impossible: ${b.detail} — update annulé`);
      return {
        ok: false,
        error: `backup impossible: ${b.detail}`,
        image,
        previousImage,
        rolledBack: false,
        backup: null,
        steps,
      };
    }
    backupFile = b.file;
    // Pas de pruneBackups : les archives de référence existantes se gardent
    // (politique propriétaire — un backup stable > un snapshot à chaque update).
    log(`backup ${b.detail}`);
  } else {
    // Défaut : pas de nouveau tar.gz. Volume bind-mount conservé au recreate ;
    // archives déjà présentes dans docker-data/backups/ inchangées.
    log("pas de nouveau backup (défaut) — volume /data + archives existantes conservés");
  }

  const recreate = async (img: string): Promise<void> => {
    if (inst.stack) {
      // Stack compose : writeInstanceStack préserve un sidecar historique
      // (patch image app seulement) ou refuse si hostname public sans
      // cloudflared. --remove-orphans interdit dès qu'un sidecar est
      // conservé (c'est ce flag qui a retiré cloudflared en 0.10.2).
      // hostPort persisté : réutilise le port enregistré (2e update =
      // même loopback) ; alloue seulement si aucun n'est enregistré
      // ou s'il est occupé par un autre process.
      const nextHp = await resolveInstanceHostPort(inst);
      inst.hostPort = nextHp > 0 ? nextHp : 0;
      writeInstanceStack({ brandRoot, brandId, image: img, inst });
      stackUp(brandRoot, inst, {
        quiet: true,
        removeOrphans: stackPolicy?.action !== "preserve-sidecar",
      });
      const hp = stackHostPort(inst.containerName);
      applyAllocatedHostPort(inst, hp);
      return;
    }
    try {
      await removeContainer(inst.containerName, { force: true });
    } catch {
      /* déjà absent */
    }
    const spec = buildContainerSpec({ brandRoot, brandId, image: img, inst });
    const created = await createContainer(inst.containerName, spec);
    await startContainer(created.Id);
  };

  log(`recreate → ${image}`);
  try {
    await recreate(image);
  } catch (e) {
    if (isStackUpdateRefused(e)) {
      log(e.message);
      return {
        ok: false,
        error: e.message,
        image,
        previousImage,
        rolledBack: false,
        backup: backupFile,
        steps,
      };
    }
    throw e;
  }
  const ready = await waitBootReady(inst.port, waitTimeoutMs);
  if (ready) {
    inst.image = image;
    saveRegistry(brandRoot, registry);
    const version = await fetchVersionLight(inst.port);
    log(`health OK (version ${version || "?"})`);
    return {
      ok: true,
      image,
      previousImage,
      version,
      backup: backupFile ? path.basename(backupFile) : null,
      steps,
    };
  }

  // Rollback : retour à l'image précédente (conservée localement).
  log(`health KO après update — rollback → ${previousImage}`);
  let rolledBack = false;
  try {
    await recreate(previousImage);
    rolledBack = await waitBootReady(inst.port, waitTimeoutMs);
  } catch (e) {
    log(`rollback KO: ${(e as Error)?.message || e}`);
  }
  if (rolledBack) {
    inst.image = previousImage;
    saveRegistry(brandRoot, registry);
    log("rollback OK — serveur sur l'image précédente");
  }
  return {
    ok: false,
    error: `serveur pas prêt après update (${Math.round(waitTimeoutMs / 1000)}s)`,
    image,
    previousImage,
    rolledBack,
    backup: backupFile ? path.basename(backupFile) : null,
    steps,
  };
}

/* --------------------------------------------------------------- ops/disk */

export function readOpsEvents(
  brandRoot: string,
  inst: ServerInstance,
  limit: number,
): unknown[] {
  try {
    const dir = path.join(instanceDataDirAbs(brandRoot, inst), "ops");
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const full = path.join(dir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const newest = files[0];
    if (!newest) return [];
    const lines = fs
      .readFileSync(newest.full, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .slice(-limit);
    const events: unknown[] = [];
    for (const l of lines) {
      try {
        events.push(JSON.parse(l));
      } catch {
        /* ligne partielle */
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Taille récursive ASYNCHRONE avec garde-fou (max entrées, pas de symlinks).
 * fs.promises + yield périodique (setImmediate ~toutes les 500 entrées) :
 * un gros /data ne doit JAMAIS geler l'event loop mono-thread de l'admin.
 */
export async function dirSizeBytes(
  dir: string,
  budget: { entries: number } = { entries: 200_000 },
): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    budget.entries -= 1;
    if (budget.entries <= 0) return total;
    if (budget.entries % 500 === 0) {
      await new Promise((r) => setImmediate(r));
    }
    const full = path.join(dir, e.name);
    try {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) total += await dirSizeBytes(full, budget);
      else if (e.isFile()) total += (await fs.promises.stat(full)).size;
    } catch {
      /* fichier disparu */
    }
  }
  return total;
}

export interface DiskReport {
  ok: true;
  instances: Array<{
    brandId: string;
    name: string;
    dataDir: string;
    sizeBytes: number;
  }>;
  filesystem: { path: string; freeBytes: number; totalBytes: number } | null;
}

export async function buildDiskReport(brandRoots: string[]): Promise<DiskReport> {
  const instances: DiskReport["instances"] = [];
  for (const brandRoot of brandRoots) {
    const registry = loadRegistry(brandRoot);
    for (const inst of registry.instances) {
      instances.push({
        brandId: registry.brandId,
        name: inst.name,
        dataDir: inst.dataDir,
        sizeBytes: await dirSizeBytes(instanceDataDirAbs(brandRoot, inst)),
      });
    }
  }
  let fsInfo: DiskReport["filesystem"] = null;
  const firstRoot = brandRoots[0];
  if (firstRoot) {
    try {
      const s = fs.statfsSync(firstRoot);
      fsInfo = {
        path: firstRoot,
        freeBytes: s.bavail * s.bsize,
        totalBytes: s.blocks * s.bsize,
      };
    } catch {
      /* statfs indisponible */
    }
  }
  return { ok: true, instances, filesystem: fsInfo };
}

/* ------------------------------------------------- snapshot flotte (F1) */

export interface FleetSnapshot<TServers, THost> {
  servers: TServers | null;
  hosts: THost[] | null;
  disk: DiskReport | null;
  refreshedAt: string | null;
  diskRefreshedAt: string | null;
}

export interface FleetSnapshotPoller<TServers, THost> {
  snapshot: FleetSnapshot<TServers, THost>;
  refreshCore: () => Promise<void>;
  refreshDisk: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

/**
 * Poller interne : matérialise en mémoire un snapshot {servers, hosts, disk,
 * refreshedAt} en appelant les collecteurs injectés. Les routes GET de
 * l'admin répondent depuis ce snapshot (instantané) au lieu de refaire des
 * healthchecks synchrones à chaque appel (UI = refresh toutes les 5 s).
 *
 * Contrat :
 *  - premier cycle immédiat au `start()` (disque compris) ;
 *  - jamais réentrant : un cycle (ou scan disque) en cours est réutilisé,
 *    pas relancé (flag « cycle en cours » = promesse in-flight) ;
 *  - le scan disque tourne 1 cycle sur `diskEveryNCycles` (plus lourd) ;
 *  - `refreshCore()` / `refreshDisk()` forcent une collecte immédiate
 *    (param `?fresh=1` côté routes).
 */
export function createFleetSnapshotPoller<TServers, THost>({
  collectServersView,
  collectHostsView,
  collectDiskView,
  intervalMs = 30_000,
  diskEveryNCycles = 4,
  onError = () => {},
}: {
  collectServersView: () => Promise<TServers>;
  collectHostsView?: () => Promise<THost[]>;
  collectDiskView: () => Promise<DiskReport>;
  intervalMs?: number;
  diskEveryNCycles?: number;
  onError?: (e: unknown) => void;
}): FleetSnapshotPoller<TServers, THost> {
  const snapshot: FleetSnapshot<TServers, THost> = {
    servers: null, // { docker, servers }
    hosts: null, // [ { hostId, … } ]
    disk: null, // { ok, instances, filesystem }
    refreshedAt: null,
    diskRefreshedAt: null,
  };
  let coreInFlight: Promise<void> | null = null;
  let diskInFlight: Promise<void> | null = null;
  let cycleCount = 0;
  let timer: NodeJS.Timeout | null = null;

  function refreshCore(): Promise<void> {
    if (coreInFlight) return coreInFlight;
    coreInFlight = (async () => {
      try {
        const [serversView, hosts] = await Promise.all([
          collectServersView(),
          collectHostsView ? collectHostsView() : null,
        ]);
        snapshot.servers = serversView;
        if (collectHostsView) snapshot.hosts = hosts;
        snapshot.refreshedAt = new Date().toISOString();
      } catch (e) {
        onError(e);
      } finally {
        coreInFlight = null;
      }
    })();
    return coreInFlight;
  }

  function refreshDisk(): Promise<void> {
    if (diskInFlight) return diskInFlight;
    diskInFlight = (async () => {
      try {
        snapshot.disk = await collectDiskView();
        snapshot.diskRefreshedAt = new Date().toISOString();
      } catch (e) {
        onError(e);
      } finally {
        diskInFlight = null;
      }
    })();
    return diskInFlight;
  }

  function start(): void {
    refreshCore();
    refreshDisk();
    timer = setInterval(() => {
      cycleCount += 1;
      refreshCore();
      if (cycleCount % diskEveryNCycles === 0) refreshDisk();
    }, intervalMs);
    timer.unref?.();
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { snapshot, refreshCore, refreshDisk, start, stop };
}

/* ------------------------------------------------------- tokens (Bearer) */

/** Hash de token stockable — jamais le token en clair côté serveur. */
export function sha256Hex(s: string): string {
  return "sha256:" + crypto.createHash("sha256").update(String(s)).digest("hex");
}

/** Comparaison temps-constant token présenté ↔ hash stocké. */
export function tokenMatchesHash(token: string, storedHash: string | null | undefined): boolean {
  const a = Buffer.from(sha256Hex(token));
  const b = Buffer.from(String(storedHash || ""));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function newToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}
