/**
 * Creezio Server Admin — backend flotte.
 *
 * Admin web multi-serveurs ET multi-VPS pour les serveurs marque headless
 * (docker/server). Point d'entrée SÉPARÉ du fleet collector télémétrie
 * (observability) — aucun endpoint partagé.
 *
 * Deux plans :
 *   - local  : serveurs de CE VPS via socket Docker + registres
 *              {brandRoot}/docker-data/servers.json (mode historique)
 *   - flotte : hôtes distants enrôlés via leur agent hôte tunnelisé
 *              `https://agent-{slug}.{zone}` (tunnel dédié) — l'admin INITIE tous
 *              les appels (Bearer token par hôte, jamais de polling inverse)
 *
 * Registre d'hôtes : {adminRoot}/docker-data/fleet-hosts.json (runtime, avec
 * tokens — gitignoré) + miroir versionnable SANS token.
 *
 * Protocole (F4.4d) : les appels vers les agents portent le header
 * `x-creezio-fleet-protocol` ; une réponse d'agent avec version explicite
 * différente = refus explicite (message actionnable) ; une réponse sans
 * header (agent ≤ 0.14 déployé) = warn throttlé, accepté UNE version.
 *
 * Env :
 *   CREEZIO_ADMIN_PORT        (défaut 18800)
 *   CREEZIO_ADMIN_HOST        (défaut 127.0.0.1 — loopback only)
 *   CREEZIO_ADMIN_USER        (défaut admin)
 *   CREEZIO_ADMIN_PASS        (obligatoire — refus de démarrer sinon)
 *   CREEZIO_ADMIN_BRAND_ROOTS (chemins racines marques séparés par ":")
 *   CREEZIO_ADMIN_ROOT        (racine admin — défaut 1er brand root ;
 *                              repo admin dédié : son propre chemin)
 *   CREEZIO_DOCKER_SOCK       (défaut /var/run/docker.sock)
 *   CREEZIO_REGISTRY          (registre images, ex. 127.0.0.1:5000 — tags)
 *   CREEZIO_REGISTRY_BASIC    (user:pass API registre si protégé)
 *
 * 0 domaine marque hardcodé — injection env uniquement.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  removeContainer,
  startContainer,
  stopContainer,
  containerLogs,
  dockerPing,
} from "./docker.js";
import {
  buildDiskReport,
  collectServers,
  createFleetSnapshotPoller,
  createServer,
  fetchJson,
  findInstance,
  instanceDataDirAbs,
  loadRegistry,
  newToken,
  proxyInstanceSupport,
  readJson,
  readOpsEvents,
  saveRegistry,
  sha256Hex,
  tokenMatchesHash,
  updateServer,
  writeJson,
} from "./server-lib.js";
import {
  SERVER_ADMIN_UPDATES_BASENAME,
  createUpdateStatusStore,
} from "./update-status-store.js";
import { createRegistryPullProxy } from "./registry-pull-proxy.js";
import {
  FLEET_PROTOCOL_HEADER,
  FLEET_PROTOCOL_VERSION,
  checkFleetProtocol,
  shouldWarnProtocol,
} from "./protocol.js";
import type {
  CollectedServer,
  FleetHost,
  FleetHostsFile,
  UpdateEntry,
} from "./types.js";

export function startServerAdmin(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const PUBLIC_DIR = path.join(__dirname, "..", "public");

  const PORT = Number(process.env.CREEZIO_ADMIN_PORT || 18800);
  const HOST = process.env.CREEZIO_ADMIN_HOST || "127.0.0.1";
  const ADMIN_USER = process.env.CREEZIO_ADMIN_USER || "admin";
  const ADMIN_PASS = process.env.CREEZIO_ADMIN_PASS || "";
  const BRAND_ROOTS = String(process.env.CREEZIO_ADMIN_BRAND_ROOTS || "")
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const ADMIN_ROOT = path.resolve(
    process.env.CREEZIO_ADMIN_ROOT || BRAND_ROOTS[0] || process.cwd(),
  );
  const REGISTRY = (process.env.CREEZIO_REGISTRY || "").trim();
  const MAX_BODY = 1 * 1024 * 1024;
  const AGENT_TIMEOUT = 8000;
  const AGENT_UPDATE_TIMEOUT = 15 * 60 * 1000;

  if (!ADMIN_PASS) {
    console.error(
      "[server-admin] CREEZIO_ADMIN_PASS requis (auth Basic obligatoire)",
    );
    process.exit(1);
  }

  /* ---------------------------------------------------------------- utils */

  function safeEqualStr(a: string, b: string): boolean {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (aa.length !== bb.length) {
      crypto.timingSafeEqual(aa, aa);
      return false;
    }
    return crypto.timingSafeEqual(aa, bb);
  }

  function audit(line: string): void {
    console.log(`[server-admin] ${new Date().toISOString()} ${line}`);
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error("too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function send(
    res: ServerResponse,
    code: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ): void {
    const payload =
      body === undefined || body === null
        ? ""
        : typeof body === "string"
          ? body
          : JSON.stringify(body);
    const h: Record<string, string> = {
      "Content-Type":
        typeof body === "string" && body.trimStart().startsWith("<")
          ? "text/html; charset=utf-8"
          : "application/json; charset=utf-8",
      [FLEET_PROTOCOL_HEADER]: String(FLEET_PROTOCOL_VERSION),
      ...headers,
    };
    if (!payload) delete h["Content-Type"];
    res.writeHead(code, h);
    res.end(payload);
  }

  function parseBasicAuth(header: string): { user: string; pass: string } | null {
    if (!header || !header.startsWith("Basic ")) return null;
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i < 0) return null;
      return { user: decoded.slice(0, i), pass: decoded.slice(i + 1) };
    } catch {
      return null;
    }
  }

  function authorized(req: IncomingMessage): boolean {
    const basic = parseBasicAuth(req.headers.authorization || "");
    return (
      basic !== null &&
      safeEqualStr(basic.user, ADMIN_USER) &&
      safeEqualStr(basic.pass, ADMIN_PASS)
    );
  }

  function sendUnauthorized(res: ServerResponse): void {
    send(
      res,
      401,
      { ok: false, error: "unauthorized" },
      { "WWW-Authenticate": 'Basic realm="Creezio Server Admin", charset="UTF-8"' },
    );
  }

  /* ------------------------------------------------------- registre hôtes */

  function fleetHostsRuntimePath(): string {
    return path.join(ADMIN_ROOT, "docker-data", "fleet-hosts.json");
  }

  /** Miroir versionnable SANS tokens : admin/fleet-hosts.json (monorepo) ou racine (repo admin dédié). */
  function fleetHostsMirrorPath(): string {
    const adminDir = path.join(ADMIN_ROOT, "admin");
    if (fs.existsSync(adminDir) && fs.statSync(adminDir).isDirectory()) {
      return path.join(adminDir, "fleet-hosts.json");
    }
    return path.join(ADMIN_ROOT, "fleet-hosts.json");
  }

  function loadFleetHosts(): FleetHostsFile {
    const raw = readJson<Partial<FleetHostsFile> | null>(
      fleetHostsRuntimePath(),
      null,
    );
    if (raw && Array.isArray(raw.hosts)) {
      return {
        version: 1,
        hosts: raw.hosts,
        enrollTokens: Array.isArray(raw.enrollTokens) ? raw.enrollTokens : [],
      };
    }
    return { version: 1, hosts: [], enrollTokens: [] };
  }

  function saveFleetHosts(data: FleetHostsFile): void {
    writeJson(fleetHostsRuntimePath(), data);
    try {
      fs.chmodSync(fleetHostsRuntimePath(), 0o600);
    } catch {
      /* fs sans chmod */
    }
    // Miroir sans secrets (agentToken / hashes enrollTokens exclus).
    const mirror = {
      version: 1,
      hosts: data.hosts.map((h) => ({
        hostId: h.hostId,
        label: h.label,
        agentUrl: h.agentUrl,
        enrolledAt: h.enrolledAt,
      })),
    };
    try {
      writeJson(fleetHostsMirrorPath(), mirror);
    } catch {
      /* miroir best-effort */
    }
  }

  function findHost(hostId: string): FleetHost | null {
    return loadFleetHosts().hosts.find((h) => h.hostId === hostId) || null;
  }

  /**
   * Appel agent hôte (Bearer + header protocole) — retourne {status,json}
   * ou throw. Écart de version explicite = throw (message actionnable) ;
   * réponse sans header protocole (agent ≤ 0.14) = warn throttlé.
   */
  async function agentCall(
    host: FleetHost,
    method: string,
    subPath: string,
    body?: unknown,
    timeoutMs: number = AGENT_TIMEOUT,
  ): Promise<{ status: number; json: unknown }> {
    const url = `${host.agentUrl.replace(/\/$/, "")}${subPath}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${host.agentToken}`,
          [FLEET_PROTOCOL_HEADER]: String(FLEET_PROTOCOL_VERSION),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const decision = checkFleetProtocol(
        res.headers.get(FLEET_PROTOCOL_HEADER),
        `agent ${host.hostId} (${host.label || host.agentUrl})`,
      );
      if (decision.action === "refuse") {
        audit(`protocole flotte: refus — ${decision.message}`);
        throw new Error(decision.message);
      }
      if (
        decision.action === "warn-missing" &&
        shouldWarnProtocol(`server-admin:agent:${host.hostId}`)
      ) {
        console.warn(`[server-admin] protocole flotte: ${decision.message}`);
      }
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

  function touchHostSeen(hostId: string): void {
    const data = loadFleetHosts();
    const h = data.hosts.find((x) => x.hostId === hostId);
    if (h) {
      h.lastSeen = new Date().toISOString();
      saveFleetHosts(data);
    }
  }

  /* ------------------------------------------------- snapshot flotte (F1) */

  interface ServersView {
    docker: boolean;
    servers: Array<CollectedServer & { hostId: string; hostLabel: string }>;
  }

  interface HostView {
    hostId: string;
    label: string;
    agentUrl: string;
    enrolledAt: string;
    lastSeen: string | null;
    online: boolean;
    live: unknown;
  }

  /** Vue consolidée serveurs : locaux (socket Docker) + hôtes distants (agents). */
  async function collectServersView(): Promise<ServersView> {
    const { servers, docker } = await collectServers(BRAND_ROOTS);
    const local = servers.map((s) => ({
      ...s,
      hostId: "local",
      hostLabel: "local",
    }));
    const data = loadFleetHosts();
    const remoteLists = await Promise.all(
      data.hosts.map(async (h) => {
        try {
          const r = await agentCall(h, "GET", "/agent/api/servers");
          const j = r.json as { ok?: boolean; servers?: CollectedServer[] } | null;
          if (r.status === 200 && j?.ok) {
            touchHostSeen(h.hostId);
            return (j.servers || []).map((s) => ({
              ...s,
              hostId: h.hostId,
              hostLabel: h.label,
            }));
          }
        } catch {
          /* hôte injoignable — signalé via /admin/api/hosts */
        }
        return [];
      }),
    );
    // Dédup : un hôte enrôlé peut être CE VPS (self-enroll) — le même
    // container ne doit apparaître qu'une fois, rattaché à l'hôte enrôlé.
    const merged = new Map<string, CollectedServer & { hostId: string; hostLabel: string }>();
    for (const s of [...local, ...remoteLists.flat()]) {
      const key = `${s.brandId}/${s.containerName || s.name}`;
      const prev = merged.get(key);
      if (!prev || prev.hostId === "local") merged.set(key, s);
    }
    return { docker, servers: [...merged.values()] };
  }

  /** Vue hôtes enrôlés : probe /agent/api/health de chaque agent. */
  async function collectHostsView(): Promise<HostView[]> {
    const data = loadFleetHosts();
    return Promise.all(
      data.hosts.map(async (h) => {
        let live: unknown = null;
        try {
          const r = await agentCall(h, "GET", "/agent/api/health", null, 3500);
          const j = r.json as { ok?: boolean } | null;
          if (r.status === 200 && j?.ok) {
            live = r.json;
            touchHostSeen(h.hostId);
          }
        } catch {
          /* hôte injoignable */
        }
        return {
          hostId: h.hostId,
          label: h.label,
          agentUrl: h.agentUrl,
          enrolledAt: h.enrolledAt,
          lastSeen: h.lastSeen || null,
          online: Boolean(live),
          live,
        };
      }),
    );
  }

  /**
   * Snapshot en mémoire {servers, hosts, disk, refreshedAt} — les routes GET
   * servers/hosts/disk répondent instantanément depuis ce snapshot ; `?fresh=1`
   * force une collecte immédiate. Poller ~30 s, jamais réentrant, scan disque
   * 1 cycle sur 4 (voir createFleetSnapshotPoller, server-lib).
   */
  const fleetSnapshot = createFleetSnapshotPoller<ServersView, HostView>({
    collectServersView,
    collectHostsView,
    collectDiskView: () => buildDiskReport(BRAND_ROOTS),
    intervalMs: Number(process.env.CREEZIO_ADMIN_SNAPSHOT_INTERVAL_MS || 30_000),
    diskEveryNCycles: 4,
    onError: (e) => console.error("[server-admin] snapshot", (e as Error)?.message || e),
  });

  /** Après un geste mutateur (create/rm/start/stop/update) : resync best-effort. */
  function requestSnapshotRefresh(): void {
    fleetSnapshot.refreshCore();
  }

  /* --------------------------------------------------------- routes local */

  /**
   * Updates locaux par container — mutex + suivi asynchrone (même contrat que
   * l'agent hôte : POST → 202, suivi via GET /update-status).
   *
   * PERSISTÉ (T8) : journal server-admin-updates.json dans le docker-data de
   * l'admin — même sémantique que l'agent (reload au boot, résolution via
   * servers.json, flag additif `agentRestarted`, TTL 24 h).
   */
  const localUpdates = createUpdateStatusStore({
    file: path.join(ADMIN_ROOT, "docker-data", SERVER_ADMIN_UPDATES_BASENAME),
    resolveInstanceImage: (containerName) => {
      for (const root of BRAND_ROOTS) {
        const reg = loadRegistry(root);
        const inst = reg.instances.find(
          (i) => i.containerName === containerName,
        );
        if (inst) return inst.image ?? null;
      }
      return null;
    },
  });

  async function handleInstanceRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    brandId: string,
    name: string,
    action: string,
  ): Promise<void> {
    const found = findInstance(BRAND_ROOTS, brandId, name);

    if (action === "start" && req.method === "POST") {
      if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
      await startContainer(found.inst.containerName);
      audit(`start brand=${brandId} name=${name}`);
      requestSnapshotRefresh();
      return send(res, 200, { ok: true });
    }

    if (action === "stop" && req.method === "POST") {
      if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
      await stopContainer(found.inst.containerName);
      audit(`stop brand=${brandId} name=${name}`);
      requestSnapshotRefresh();
      return send(res, 200, { ok: true });
    }

    if (action === "update" && req.method === "POST") {
      if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
      let body: { image?: string; backup?: boolean };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { ok: false, error: "json" });
      }
      const image = String(body.image || "").trim();
      if (!image) return send(res, 400, { ok: false, error: "image requise" });
      const cur = localUpdates.get(found.inst.containerName);
      if (cur?.status === "running") {
        return send(res, 409, { ok: false, error: "update déjà en cours", update: cur });
      }
      const entry: UpdateEntry = {
        status: "running",
        image,
        startedAt: new Date().toISOString(),
      };
      localUpdates.set(found.inst.containerName, entry);
      updateServer({
        brandRoot: found.brandRoot,
        registry: found.registry,
        inst: found.inst,
        image,
        audit,
        // Chaque étape est persistée (suivi retrouvable après restart).
        onStep: (step) => {
          entry.lastStep = step;
          localUpdates.save();
        },
        // Opt-in : seul backup:true crée un tar.gz frais (défaut = skip).
        backup: body.backup === true,
      })
        .then((r) => {
          entry.status = r.ok ? "done" : "error";
          entry.finishedAt = new Date().toISOString();
          entry.result = r;
          localUpdates.save();
          requestSnapshotRefresh();
        })
        .catch((e) => {
          entry.status = "error";
          entry.finishedAt = new Date().toISOString();
          entry.result = { ok: false, error: String((e as Error)?.message || e) };
          localUpdates.save();
          audit(`update KO brand=${brandId} name=${name}: ${(e as Error)?.message || e}`);
        });
      return send(res, 202, { ok: true, started: true, update: entry });
    }

    if (action === "update-status" && req.method === "GET") {
      if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
      return send(res, 200, {
        ok: true,
        update: localUpdates.get(found.inst.containerName) || null,
      });
    }

    if (!action && req.method === "DELETE") {
      if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
      try {
        await removeContainer(found.inst.containerName, { force: true });
      } catch (e) {
        // Container déjà absent ou docker KO : le registre reste la SoT.
        audit(`rm container KO brand=${brandId} name=${name}: ${(e as Error)?.message || e}`);
      }
      found.registry.instances = found.registry.instances.filter(
        (i) => i.name !== name,
      );
      saveRegistry(found.brandRoot, found.registry);
      const purge = url.searchParams.get("purgeData") === "1";
      if (purge) {
        const dataAbs = instanceDataDirAbs(found.brandRoot, found.inst);
        // Garde-fou : ne purger que sous brandRoot.
        if (dataAbs.startsWith(found.brandRoot + path.sep)) {
          fs.rmSync(dataAbs, { recursive: true, force: true });
        }
      }
      audit(`rm brand=${brandId} name=${name} purgeData=${purge}`);
      requestSnapshotRefresh();
      return send(res, 200, { ok: true, purgedData: purge });
    }

    if (req.method !== "GET") return send(res, 405, { ok: false });
    if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
    const { inst, brandRoot } = found;

    if (action === "boot-status") {
      try {
        const r = await fetchJson(
          `http://127.0.0.1:${inst.port}/api/v1/os/boot-status`,
          2000,
        );
        if (!r.json)
          return send(res, 504, { ok: false, error: "boot-status injoignable" });
        return send(res, 200, r.json);
      } catch {
        return send(res, 504, { ok: false, error: "boot-status injoignable" });
      }
    }

    if (action === "health") {
      const out: { ok: true; health: unknown; ready: unknown } = {
        ok: true,
        health: null,
        ready: null,
      };
      try {
        out.health = await fetchJson(
          `http://127.0.0.1:${inst.port}/api/v1/core/health`,
          2000,
        );
      } catch {
        /* injoignable */
      }
      try {
        out.ready = await fetchJson(
          `http://127.0.0.1:${inst.port}/api/v1/os/ready`,
          2000,
        );
      } catch {
        /* injoignable */
      }
      return send(res, 200, out);
    }

    if (action === "logs") {
      const tail = Math.min(
        Math.max(Number(url.searchParams.get("tail") || 200), 1),
        2000,
      );
      try {
        const lines = await containerLogs(inst.containerName, { tail });
        return send(res, 200, { ok: true, lines });
      } catch (e) {
        return send(res, 502, { ok: false, error: String((e as Error)?.message || e) });
      }
    }

    if (action === "ops") {
      const limit = Math.min(
        Math.max(Number(url.searchParams.get("limit") || 100), 1),
        1000,
      );
      return send(res, 200, {
        ok: true,
        events: readOpsEvents(brandRoot, inst, limit),
      });
    }

    return send(res, 404, { ok: false });
  }

  /* --------------------------------------------------------- routes hôtes */

  async function handleHostsRoute(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void | null> {
    const p = url.pathname;

    if (req.method === "GET" && p === "/admin/api/hosts") {
      // Snapshot poller (F1) : probes agents servies depuis le snapshot ;
      // enrollTokens lus à chaque appel (pas de latence, doit être frais).
      if (url.searchParams.get("fresh") === "1" || !fleetSnapshot.snapshot.hosts) {
        await fleetSnapshot.refreshCore();
      }
      const data = loadFleetHosts();
      return send(res, 200, {
        ok: true,
        hosts: fleetSnapshot.snapshot.hosts || [],
        refreshedAt: fleetSnapshot.snapshot.refreshedAt,
        enrollTokens: data.enrollTokens.map((t) => ({
          id: t.id,
          label: t.label,
          createdAt: t.createdAt,
          usedAt: t.usedAt || null,
        })),
      });
    }

    if (req.method === "POST" && p === "/admin/api/hosts/enroll-token") {
      let body: { label?: string } = {};
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { ok: false, error: "json" });
      }
      const data = loadFleetHosts();
      const token = newToken();
      const entry = {
        id: crypto.randomBytes(4).toString("hex"),
        hash: sha256Hex(token),
        label: String(body.label || "").slice(0, 80) || null,
        createdAt: new Date().toISOString(),
      };
      data.enrollTokens.push(entry);
      saveFleetHosts(data);
      audit(`enroll-token créé id=${entry.id} label=${entry.label || "-"}`);
      // Le token n'est restitué qu'ICI, une seule fois.
      return send(res, 200, { ok: true, id: entry.id, enrollToken: token });
    }

    // Vérification d'un credential flotte hostId:agentToken (F5) — utilisée
    // par le module fleet-releases de l'app admin (Bearer des agents en pull).
    // fleet-hosts.json reste la SoT des credentials ; comparaison temps
    // constant, jamais de token restitué.
    if (req.method === "POST" && p === "/admin/api/hosts/verify") {
      let body: { hostId?: string; token?: string } = {};
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { ok: false, error: "json" });
      }
      const hostId = String(body.hostId || "").trim();
      const token = String(body.token || "").trim();
      const host = hostId ? findHost(hostId) : null;
      let valid = false;
      if (host && token && host.agentToken) {
        const a = Buffer.from(token);
        const b = Buffer.from(String(host.agentToken));
        valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      }
      return send(res, 200, {
        ok: true,
        valid,
        label: valid && host ? host.label : undefined,
      });
    }

    const mDel = p.match(/^\/admin\/api\/hosts\/([^/]+)$/);
    if (mDel && req.method === "DELETE") {
      const hostId = decodeURIComponent(mDel[1] ?? "");
      const data = loadFleetHosts();
      const before = data.hosts.length;
      data.hosts = data.hosts.filter((h) => h.hostId !== hostId);
      if (data.hosts.length === before) {
        return send(res, 404, { ok: false, error: "hôte inconnu" });
      }
      saveFleetHosts(data);
      audit(`host retiré ${hostId}`);
      return send(res, 200, { ok: true });
    }

    // /admin/api/hosts/<hostId>/servers[...] → proxy vers l'agent hôte.
    const mProxy = p.match(/^\/admin\/api\/hosts\/([^/]+)(\/servers.*)$/);
    if (mProxy) {
      const hostId = decodeURIComponent(mProxy[1] ?? "");
      const host = findHost(hostId);
      if (!host) return send(res, 404, { ok: false, error: "hôte inconnu" });
      const proxyRest = mProxy[2] ?? "";
      const sub = `/agent/api${proxyRest}${url.search || ""}`;
      const isUpdate = /\/update$/.test(proxyRest);
      let body: unknown = null;
      if (req.method === "POST") {
        try {
          const raw = await readBody(req);
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(res, 400, { ok: false, error: "json" });
        }
      }
      try {
        const r = await agentCall(
          host,
          req.method || "GET",
          sub,
          body,
          isUpdate ? AGENT_UPDATE_TIMEOUT : AGENT_TIMEOUT,
        );
        touchHostSeen(hostId);
        return send(res, r.status || 502, r.json ?? { ok: false });
      } catch (e) {
        return send(res, 502, {
          ok: false,
          error: `agent injoignable: ${(e as Error)?.message || e}`,
        });
      }
    }

    return null;
  }

  /**
   * Pousse l'URL publique canonique du tunnel dédié (agent up / migration).
   * Auth par agentToken de l'hôte déjà enrôlé — pas de Basic (même contrat
   * que enroll : le VPS distant n'a pas le mot de passe admin).
   */
  async function handleHostAgentUrlUpdate(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let body: { hostId?: string; agentUrl?: string; agentToken?: string };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false, error: "json" });
    }
    const hostId = String(body.hostId || "").trim();
    const agentUrl = String(body.agentUrl || "").trim().replace(/\/+$/, "");
    const agentToken = String(body.agentToken || "").trim();
    if (!hostId || !agentUrl || !agentToken) {
      return send(res, 400, {
        ok: false,
        error: "hostId, agentUrl, agentToken requis",
      });
    }
    if (!/^https:\/\//.test(agentUrl)) {
      return send(res, 400, { ok: false, error: "agentUrl invalide (https requis)" });
    }
    const data = loadFleetHosts();
    const host = data.hosts.find((h) => h.hostId === hostId);
    if (!host) {
      return send(res, 404, { ok: false, error: "hôte inconnu" });
    }
    const a = Buffer.from(agentToken);
    const b = Buffer.from(String(host.agentToken || ""));
    const valid =
      a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
    if (!valid) {
      audit(`agent-url refusé (token) hostId=${hostId}`);
      return send(res, 401, { ok: false, error: "agentToken invalide" });
    }
    const prev = host.agentUrl;
    host.agentUrl = agentUrl;
    saveFleetHosts(data);
    requestSnapshotRefresh();
    audit(`host agentUrl ${hostId} ${prev} → ${agentUrl}`);
    return send(res, 200, {
      ok: true,
      hostId,
      agentUrl,
      changed: prev !== agentUrl,
    });
  }

  /** Enrôlement d'un hôte — PAS de Basic auth : authentifié par enrollToken. */
  async function handleEnroll(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: {
      enrollToken?: string;
      hostId?: string;
      agentUrl?: string;
      agentToken?: string;
      label?: string;
    };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { ok: false, error: "json" });
    }
    const enrollToken = String(body.enrollToken || "").trim();
    const hostId = String(body.hostId || "").trim();
    const agentUrl = String(body.agentUrl || "").trim();
    const agentToken = String(body.agentToken || "").trim();
    const label = String(body.label || "").slice(0, 80);
    if (!enrollToken || !hostId || !agentUrl || !agentToken) {
      return send(res, 400, {
        ok: false,
        error: "enrollToken, hostId, agentUrl, agentToken requis",
      });
    }
    if (!/^https?:\/\//.test(agentUrl)) {
      return send(res, 400, { ok: false, error: "agentUrl invalide" });
    }
    const data = loadFleetHosts();
    const tok = data.enrollTokens.find(
      (t) => !t.usedAt && tokenMatchesHash(enrollToken, t.hash),
    );
    if (!tok) {
      audit(`enroll refusé (token invalide/consommé) hostId=${hostId}`);
      return send(res, 401, { ok: false, error: "enrollToken invalide" });
    }
    tok.usedAt = new Date().toISOString();
    const existing = data.hosts.find((h) => h.hostId === hostId);
    const record: FleetHost = {
      hostId,
      label: label || existing?.label || hostId,
      agentUrl,
      agentToken,
      enrolledAt: existing?.enrolledAt || new Date().toISOString(),
      lastSeen: null,
    };
    data.hosts = data.hosts.filter((h) => h.hostId !== hostId);
    data.hosts.push(record);
    saveFleetHosts(data);
    audit(`host enrôlé ${hostId} (${record.label}) → ${agentUrl}`);
    // Vérification immédiate best-effort de l'agent.
    let verified = false;
    try {
      const r = await agentCall(record, "GET", "/agent/api/health", null, 5000);
      verified = r.status === 200 && (r.json as { ok?: unknown } | null)?.ok === true;
      if (verified) touchHostSeen(hostId);
    } catch {
      /* le tunnel peut mettre quelques secondes */
    }
    return send(res, 200, { ok: true, hostId, verified });
  }

  /* -------------------------------------------------------------- registry */

  async function handleRegistryTags(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const image = String(url.searchParams.get("image") || "").trim();
    if (!image) return send(res, 400, { ok: false, error: "image requise" });
    // "127.0.0.1:5000/creezio-server-x" → host=127.0.0.1:5000, repo=creezio-server-x
    const firstSlash = image.indexOf("/");
    let host = REGISTRY;
    let repo = image;
    if (firstSlash > 0 && /[.:]/.test(image.slice(0, firstSlash))) {
      host = image.slice(0, firstSlash);
      repo = image.slice(firstSlash + 1);
    }
    if (!host) {
      return send(res, 400, {
        ok: false,
        error: "registre inconnu (CREEZIO_REGISTRY ou image qualifiée)",
      });
    }
    const proto = /^(127\.|localhost|0\.0\.0\.0)/.test(host) ? "http" : "https";
    const headers: Record<string, string> = {};
    const basic = (process.env.CREEZIO_REGISTRY_BASIC || "").trim();
    if (basic) {
      headers.Authorization = `Basic ${Buffer.from(basic).toString("base64")}`;
    }
    try {
      const r = await fetchJson(
        `${proto}://${host}/v2/${repo}/tags/list`,
        6000,
        { headers },
      );
      if (r.status !== 200 || !r.json) {
        return send(res, 502, {
          ok: false,
          error: `registre → ${r.status}`,
        });
      }
      const j = r.json as { tags?: unknown };
      const tags = Array.isArray(j.tags) ? [...(j.tags as string[])].sort() : [];
      return send(res, 200, { ok: true, host, repo, tags });
    } catch (e) {
      return send(res, 502, { ok: false, error: String((e as Error)?.message || e) });
    }
  }

  /* ---------------------------------------------------------------- routes */

  async function handleAdmin(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const p = url.pathname;

    // Enrôlement : auth par enrollToken (les VPS distants n'ont pas le Basic).
    if (req.method === "POST" && p === "/admin/api/enroll") {
      return handleEnroll(req, res);
    }
    // agent up : l'hôte pousse l'URL dédiée (auth par son agentToken).
    if (req.method === "POST" && p === "/admin/api/hosts/agent-url") {
      return handleHostAgentUrlUpdate(req, res);
    }

    if (!authorized(req)) return sendUnauthorized(res);

    if (req.method === "GET" && (p === "/admin" || p === "/admin/")) {
      return send(
        res,
        200,
        fs.readFileSync(path.join(PUBLIC_DIR, "admin.html"), "utf8"),
      );
    }

    if (req.method === "GET" && p === "/admin/api/health") {
      return send(res, 200, {
        ok: true,
        service: "creezio-server-admin",
        brandRoots: BRAND_ROOTS,
        adminRoot: ADMIN_ROOT,
        registry: REGISTRY || null,
        docker: await dockerPing(),
        protocol: FLEET_PROTOCOL_VERSION,
      });
    }

    if (req.method === "GET" && p === "/admin/api/servers") {
      // Snapshot poller (F1) : réponse instantanée ; ?fresh=1 = collecte immédiate.
      if (url.searchParams.get("fresh") === "1" || !fleetSnapshot.snapshot.servers) {
        await fleetSnapshot.refreshCore();
      }
      const view = fleetSnapshot.snapshot.servers || { docker: false, servers: [] };
      return send(res, 200, {
        ok: true,
        docker: view.docker,
        servers: view.servers,
        refreshedAt: fleetSnapshot.snapshot.refreshedAt,
      });
    }

    if (req.method === "POST" && p === "/admin/api/servers") {
      let body: Parameters<typeof createServer>[1];
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { ok: false, error: "json" });
      }
      try {
        const r = await createServer(BRAND_ROOTS, body, audit);
        if (r.out?.ok) requestSnapshotRefresh();
        return send(res, r.code, r.out);
      } catch (e) {
        audit(`create KO: ${(e as Error)?.message || e}`);
        return send(res, 502, { ok: false, error: String((e as Error)?.message || e) });
      }
    }

    if (req.method === "GET" && p === "/admin/api/disk") {
      // Snapshot poller (F1) : scan disque async 1 cycle sur 4 ; ?fresh=1 force.
      if (url.searchParams.get("fresh") === "1" || !fleetSnapshot.snapshot.disk) {
        await fleetSnapshot.refreshDisk();
      }
      const disk = fleetSnapshot.snapshot.disk || { ok: true, instances: [], filesystem: null };
      return send(res, 200, {
        ...disk,
        refreshedAt: fleetSnapshot.snapshot.diskRefreshedAt,
      });
    }

    if (req.method === "GET" && p === "/admin/api/registry/tags") {
      return handleRegistryTags(req, res, url);
    }

    // Hôtes distants (registre + enroll-token + proxy agents).
    if (p.startsWith("/admin/api/hosts")) {
      const handled = await handleHostsRoute(req, res, url);
      if (handled !== null) return handled;
      return send(res, 404, { ok: false });
    }

    // /admin/api/servers/<brandId>/<name>/support[/*] — relais vers le mount
    // support natif d'une instance LOCALE (les hôtes distants passent par le
    // proxy /admin/api/hosts/<id>/servers/…/support → agent).
    const mSupport = p.match(
      /^\/admin\/api\/servers\/([^/]+)\/([^/]+)\/support(\/.*)?$/,
    );
    if (mSupport) {
      const brandId = decodeURIComponent(mSupport[1] ?? "");
      const name = decodeURIComponent(mSupport[2] ?? "");
      const found = findInstance(BRAND_ROOTS, brandId, name);
      if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
      let body: unknown = null;
      if (req.method === "POST") {
        try {
          const raw = await readBody(req);
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return send(res, 400, { ok: false, error: "json" });
        }
      }
      try {
        const r = await proxyInstanceSupport(
          found.inst,
          req.method || "GET",
          mSupport[3] || "",
          url.search || "",
          body,
        );
        return send(res, r.status || 502, r.json ?? { ok: false });
      } catch (e) {
        return send(res, 502, { ok: false, error: String((e as Error)?.message || e) });
      }
    }

    // /admin/api/servers/<brandId>/<name>[/<action>] — serveurs locaux.
    const m = p.match(
      /^\/admin\/api\/servers\/([^/]+)\/([^/]+)(?:\/(start|stop|update|update-status|boot-status|health|logs|ops))?$/,
    );
    if (m) {
      const [, brandIdEnc = "", nameEnc = "", action] = m;
      try {
        return await handleInstanceRoute(
          req,
          res,
          url,
          decodeURIComponent(brandIdEnc),
          decodeURIComponent(nameEnc),
          action || "",
        );
      } catch (e) {
        audit(`route KO ${p}: ${(e as Error)?.message || e}`);
        return send(res, 502, { ok: false, error: String((e as Error)?.message || e) });
      }
    }

    return send(res, 404, { ok: false });
  }

  // Proxy PULL-ONLY du registre d'images (F4) — /v2/* pour l'ingress public
  // registry.{zone}. Auth Basic hostId:agentToken (hôtes enrôlés) ou admin ;
  // GET/HEAD seulement, push refusé (405) — publish reste loopback-only.
  const registryPullProxy = createRegistryPullProxy({
    upstream: REGISTRY,
    loadHosts: () => loadFleetHosts().hosts,
    adminUser: ADMIN_USER,
    adminPass: ADMIN_PASS,
    audit,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
      if (registryPullProxy(req, res, url)) return;
      if (url.pathname === "/") {
        return send(res, 302, "", { Location: "/admin" });
      }
      if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
        return await handleAdmin(req, res, url);
      }
      return send(res, 404, { ok: false });
    } catch (e) {
      console.error("[server-admin] error", e);
      if (!res.writableEnded) send(res, 500, { ok: false });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(
      `[server-admin] écoute ${HOST}:${PORT} brandRoots=${BRAND_ROOTS.join(",") || "(aucun)"} adminRoot=${ADMIN_ROOT} sock=${process.env.CREEZIO_DOCKER_SOCK || "/var/run/docker.sock"}`,
    );
    // Snapshot flotte (F1) : premier cycle immédiat, puis poller ~30 s.
    fleetSnapshot.start();
  });
}
