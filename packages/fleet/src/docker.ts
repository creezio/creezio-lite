/**
 * Client Docker Engine API via socket unix — zéro dépendance npm.
 *
 * Utilisé par server-admin / host-agent / server-lib. Toutes les fonctions
 * sont best-effort côté appelant : une erreur ici (docker down, socket absent)
 * doit être catchée par le handler HTTP, jamais faire crasher le process.
 *
 * Env : CREEZIO_DOCKER_SOCK (défaut /var/run/docker.sock).
 */

import http from "node:http";

export const DEFAULT_DOCKER_SOCK = "/var/run/docker.sock";

export function dockerSockPath(): string {
  return process.env.CREEZIO_DOCKER_SOCK || DEFAULT_DOCKER_SOCK;
}

export interface DockerResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  buffer: Buffer;
  json: unknown;
}

export interface DockerRequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  timeoutMs?: number;
  socketPath?: string;
}

/**
 * Requête brute vers l'Engine API. Résout {status, headers, buffer, json}.
 * `json` est null si le corps n'est pas du JSON (ex. logs binaires).
 */
export function dockerRequest({
  method = "GET",
  path: reqPath,
  body,
  timeoutMs = 10_000,
  socketPath = dockerSockPath(),
}: DockerRequestOptions): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        socketPath,
        path: reqPath,
        method,
        headers: {
          Host: "docker",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          let json: unknown = null;
          try {
            json = buffer.length ? JSON.parse(buffer.toString("utf8")) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, buffer, json });
        });
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("docker request timeout"));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** true si le daemon répond au ping. Ne throw jamais. */
export async function dockerPing(): Promise<boolean> {
  try {
    const r = await dockerRequest({ path: "/_ping", timeoutMs: 2000 });
    return r.status === 200;
  } catch {
    return false;
  }
}

/** Container tel que listé par GET /containers/json (champs consommés). */
export interface DockerContainerSummary {
  Id?: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Labels?: Record<string, string>;
}

/** GET /containers/json — filters ex. {label:["creezio.server=1"]}. */
export async function listContainers({
  all = true,
  filters,
}: { all?: boolean; filters?: Record<string, string[]> } = {}): Promise<
  DockerContainerSummary[]
> {
  const qs = new URLSearchParams();
  if (all) qs.set("all", "1");
  if (filters) qs.set("filters", JSON.stringify(filters));
  const r = await dockerRequest({ path: `/containers/json?${qs}` });
  if (r.status !== 200) {
    throw new Error(`docker list containers → ${r.status}: ${errMessage(r)}`);
  }
  return Array.isArray(r.json) ? (r.json as DockerContainerSummary[]) : [];
}

/** Inspect container (champs consommés par la flotte). */
export interface DockerContainerInspect {
  Id?: string;
  State?: {
    Status?: string;
    StartedAt?: string;
    Health?: { Status?: string };
  };
  Config?: { Image?: string };
}

/** GET /containers/{name}/json — null si le container n'existe pas (404). */
export async function inspectContainer(
  nameOrId: string,
): Promise<DockerContainerInspect | null> {
  const r = await dockerRequest({
    path: `/containers/${encodeURIComponent(nameOrId)}/json`,
  });
  if (r.status === 404) return null;
  if (r.status !== 200) {
    throw new Error(`docker inspect → ${r.status}: ${errMessage(r)}`);
  }
  return r.json as DockerContainerInspect;
}

/** GET /images/{name}/json — true si l'image locale existe. */
export async function imageExists(image: string): Promise<boolean> {
  const r = await dockerRequest({
    path: `/images/${encodeURIComponent(image)}/json`,
  });
  return r.status === 200;
}

/** POST /containers/create?name=… — retourne {Id}. Throw si != 201. */
export async function createContainer(
  name: string,
  spec: unknown,
): Promise<{ Id: string }> {
  const r = await dockerRequest({
    method: "POST",
    path: `/containers/create?name=${encodeURIComponent(name)}`,
    body: spec,
  });
  if (r.status !== 201) {
    throw new Error(`docker create → ${r.status}: ${errMessage(r)}`);
  }
  return r.json as { Id: string };
}

export async function startContainer(nameOrId: string): Promise<void> {
  const r = await dockerRequest({
    method: "POST",
    path: `/containers/${encodeURIComponent(nameOrId)}/start`,
  });
  // 204 démarré, 304 déjà démarré
  if (r.status !== 204 && r.status !== 304) {
    throw new Error(`docker start → ${r.status}: ${errMessage(r)}`);
  }
}

export async function stopContainer(
  nameOrId: string,
  { timeoutSec = 15 }: { timeoutSec?: number } = {},
): Promise<void> {
  const r = await dockerRequest({
    method: "POST",
    path: `/containers/${encodeURIComponent(nameOrId)}/stop?t=${timeoutSec}`,
    timeoutMs: (timeoutSec + 10) * 1000,
  });
  // 204 arrêté, 304 déjà arrêté
  if (r.status !== 204 && r.status !== 304) {
    throw new Error(`docker stop → ${r.status}: ${errMessage(r)}`);
  }
}

/** DELETE /containers/{name}?force=1 — 404 toléré (déjà supprimé). */
export async function removeContainer(
  nameOrId: string,
  { force = true }: { force?: boolean } = {},
): Promise<void> {
  const r = await dockerRequest({
    method: "DELETE",
    path: `/containers/${encodeURIComponent(nameOrId)}?force=${force ? 1 : 0}`,
    timeoutMs: 30_000,
  });
  if (r.status !== 204 && r.status !== 404) {
    throw new Error(`docker rm → ${r.status}: ${errMessage(r)}`);
  }
}

/**
 * GET /containers/{name}/logs — retourne les lignes texte.
 * Les containers non-tty renvoient un flux multiplexé Docker :
 * frames [stream(1), 0, 0, 0, size(4 BE)] + payload — démultiplexés ici.
 */
export async function containerLogs(
  nameOrId: string,
  { tail = 200 }: { tail?: number } = {},
): Promise<string[]> {
  const qs = new URLSearchParams({
    stdout: "1",
    stderr: "1",
    tail: String(tail),
    timestamps: "0",
  });
  const r = await dockerRequest({
    path: `/containers/${encodeURIComponent(nameOrId)}/logs?${qs}`,
    timeoutMs: 15_000,
  });
  if (r.status !== 200) {
    throw new Error(`docker logs → ${r.status}: ${errMessage(r)}`);
  }
  return demuxDockerStream(r.buffer)
    .split("\n")
    .filter((l) => l.length > 0);
}

/**
 * Démultiplexe un flux Docker (format attach/logs non-tty) en texte.
 * Si le buffer ne ressemble pas à un flux multiplexé (container tty),
 * il est retourné tel quel.
 */
export function demuxDockerStream(buffer: Buffer | null | undefined): string {
  if (!buffer || buffer.length === 0) return "";
  // Frame valide : type ∈ {0,1,2} et 3 octets zéro ensuite.
  const looksMuxed =
    buffer.length >= 8 &&
    (buffer[0] ?? 255) <= 2 &&
    buffer[1] === 0 &&
    buffer[2] === 0 &&
    buffer[3] === 0;
  if (!looksMuxed) return buffer.toString("utf8");
  const parts: string[] = [];
  let off = 0;
  while (off + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(off + 4);
    const start = off + 8;
    const end = Math.min(start + size, buffer.length);
    parts.push(buffer.subarray(start, end).toString("utf8"));
    off = start + size;
  }
  return parts.join("");
}

/**
 * POST /images/create?fromImage=…&tag=… — pull d'une image registry.
 * Le flux de progression est bufferisé ; les erreurs Docker apparaissent
 * DANS le flux (status 200) → on parse les lignes JSON pour les détecter.
 * `authB64` : base64 de {"username","password","serveraddress"} (registres privés).
 */
export async function pullImage(
  image: string,
  { authB64, timeoutMs = 900_000 }: { authB64?: string; timeoutMs?: number } = {},
): Promise<void> {
  const slash = image.lastIndexOf("/");
  const colon = image.lastIndexOf(":");
  const hasTag = colon > slash;
  const fromImage = hasTag ? image.slice(0, colon) : image;
  const tag = hasTag ? image.slice(colon + 1) : "latest";
  const qs = new URLSearchParams({ fromImage, tag });
  const r = await new Promise<{ status: number; text: string }>(
    (resolve, reject) => {
      const req = http.request(
        {
          socketPath: dockerSockPath(),
          path: `/images/create?${qs}`,
          method: "POST",
          headers: {
            Host: "docker",
            ...(authB64 ? { "X-Registry-Auth": authB64 } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode || 0,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("docker pull timeout"));
      });
      req.on("error", reject);
      req.end();
    },
  );
  if (r.status !== 200) {
    throw new Error(`docker pull ${image} → ${r.status}: ${r.text.slice(0, 300)}`);
  }
  for (const line of r.text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line) as { error?: string };
      if (j.error) throw new Error(`docker pull ${image}: ${j.error}`);
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
}

function errMessage(r: DockerResponse): string {
  const j = r.json as { message?: unknown } | null;
  if (j && typeof j.message === "string") return j.message;
  return r.buffer ? r.buffer.toString("utf8").slice(0, 300) : "?";
}
