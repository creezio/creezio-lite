/**
 * Registre d'instances serveur Docker par marque — SoT `docker-data/servers.json`.
 *
 * Conventions partagées avec l'admin web (fleet-collector server-admin) :
 *   - image     : `creezio-server-<brandId>:local`
 *   - container : `<brandId>-server-<nom>`
 *   - labels    : creezio.server=1, creezio.brand, creezio.instance,
 *                 creezio.port, creezio.brand-root
 *   - ports     : auto à partir de 18790+n, publiés sur 127.0.0.1 par défaut
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  isFsPermissionError,
  readTextFileDirectOrSudo,
  writeTextFileDirectOrSudo,
} from "./server-docker-agent-tunnel.js";

export const SERVER_PORT_BASE = 18790;
export const SERVER_CONTAINER_PORT = 18791;
export const SERVER_LABEL = "creezio.server";

export type ServerVariant = "base" | "browser";

export type ServerRegistryInstance = {
  name: string;
  containerName: string;
  port: number;
  bind: string;
  /** Relatif à brandRoot (volume /data). */
  dataDir: string;
  createdAt: string;
  env?: Record<string, string>;
  /** Variant image (base par défaut ; browser = sidecar navigateur IA). */
  variant?: ServerVariant;
  /**
   * Stack compose autonome (M2) : app + cloudflared sidecar, ports internes
   * fixes (18791), port hôte loopback persisté (`hostPort`) puis réutilisé
   * au recreate (0/absent = attribution auto au premier up seulement).
   * Absent/false = legacy `docker run` (port hôte = inst.port).
   */
  stack?: boolean;
  /**
   * Port hôte loopback persisté. 0/absent au premier create = attribution
   * auto Docker ; après up, égal au port alloué et réutilisé à l'update.
   */
  hostPort?: number;
};

export type ServerRegistry = {
  version: 1;
  brandId: string;
  image: string;
  instances: ServerRegistryInstance[];
};

export function serverImageName(
  brandId: string,
  variant: ServerVariant = "base",
): string {
  if (variant === "browser") {
    return (
      process.env.SERVER_IMAGE_BROWSER ||
      `creezio-server-${brandId}-browser:local`
    );
  }
  return process.env.SERVER_IMAGE || `creezio-server-${brandId}:local`;
}

export function serverContainerName(brandId: string, name: string): string {
  return `${brandId}-server-${name}`;
}

export function registryPath(brandRoot: string): string {
  return path.join(brandRoot, "docker-data", "servers.json");
}

export function validInstanceName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(name);
}

export function loadServerRegistry(
  brandRoot: string,
  brandId: string,
): ServerRegistry {
  const file = registryPath(brandRoot);
  try {
    const raw = JSON.parse(readTextFileDirectOrSudo(file)) as ServerRegistry;
    if (raw && Array.isArray(raw.instances)) {
      return {
        version: 1,
        brandId: raw.brandId || brandId,
        image: raw.image || serverImageName(brandId),
        instances: raw.instances,
      };
    }
  } catch (e) {
    if (isFsPermissionError(e)) throw e;
    /* premier create / JSON invalide */
  }
  return {
    version: 1,
    brandId,
    image: serverImageName(brandId),
    instances: [],
  };
}

export function saveServerRegistry(
  brandRoot: string,
  registry: ServerRegistry,
): void {
  const file = registryPath(brandRoot);
  const body = JSON.stringify(registry, null, 2) + "\n";
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, file);
  } catch (e) {
    if (!isFsPermissionError(e)) throw e;
    writeTextFileDirectOrSudo(file, body);
  }
}

function portBusy(port: number, host = "127.0.0.1"): Promise<boolean> {
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
 * Alloue le prochain port libre : 18790+n, en évitant le registre
 * ET les ports réellement occupés sur l'hôte (compose legacy 18791/18792 inclus).
 */
export async function allocateServerPort(
  registry: ServerRegistry,
): Promise<number> {
  const used = new Set(registry.instances.map((i) => i.port));
  for (let n = 1; n < 200; n++) {
    const candidate = SERVER_PORT_BASE + n;
    if (used.has(candidate)) continue;
    if (await portBusy(candidate)) continue;
    return candidate;
  }
  throw new Error("aucun port libre entre 18791 et 18990");
}

export function instanceDataDirAbs(
  brandRoot: string,
  inst: ServerRegistryInstance,
): string {
  return path.isAbsolute(inst.dataDir)
    ? inst.dataDir
    : path.join(brandRoot, inst.dataDir);
}

/** Arguments `docker run` d'une instance (SoT unique CLI + doc). */
export function buildDockerRunArgs(opts: {
  brandRoot: string;
  brandId: string;
  image: string;
  inst: ServerRegistryInstance;
}): string[] {
  const { brandRoot, brandId, image, inst } = opts;
  const dataAbs = instanceDataDirAbs(brandRoot, inst);
  const args = [
    "run",
    "-d",
    "--name",
    inst.containerName,
    "--restart",
    "unless-stopped",
    // Chromium sidecar : /dev/shm 64 Mo par défaut = crashs renderer.
    ...(inst.variant === "browser" ? ["--shm-size=1g"] : []),
    "-p",
    `${inst.bind}:${inst.port}:${SERVER_CONTAINER_PORT}`,
    "-v",
    `${dataAbs}:/data`,
    "--label",
    `${SERVER_LABEL}=1`,
    "--label",
    `creezio.brand=${brandId}`,
    "--label",
    `creezio.instance=${inst.name}`,
    "--label",
    `creezio.port=${inst.port}`,
    "--label",
    `creezio.variant=${inst.variant || "base"}`,
    "--label",
    `creezio.brand-root=${brandRoot}`,
    "-e",
    `BRAND_ID=${brandId}`,
    "-e",
    `INSTANCE_ID=server-${inst.name}`,
    "-e",
    `PORT=${SERVER_CONTAINER_PORT}`,
    "-e",
    `METIER_PORT=${SERVER_CONTAINER_PORT}`,
    "-e",
    "CREEZIO_HTTP_HOST=0.0.0.0",
  ];
  for (const [k, v] of Object.entries(inst.env || {})) {
    args.push("-e", `${k}=${v}`);
  }
  args.push(image);
  return args;
}
