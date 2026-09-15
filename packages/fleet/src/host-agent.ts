/**
 * Agent hôte flotte — petit serveur Node qui tourne sur CHAQUE VPS client
 * (hors container applicatif), avec accès socket Docker + brand roots.
 * Exposé via l'ingress tunnel `agent.{slug}.{zone}` — c'est TOUJOURS l'admin
 * qui initie les appels (jamais de polling agent → admin).
 *
 * Actions (déléguées au registre/server-lib partagés avec le CLI) :
 *   list / create / start / stop / rm / update / logs / boot-status / disk
 *
 * Auth : Bearer tokens HASHÉS (sha256) + révocables — state file
 * docker-data/host-agent.json (généré par `creezio server-docker agent`).
 *
 * Protocole (F4.4d, strict depuis 0.19.0) : toutes les réponses portent
 * le header `x-creezio-fleet-protocol` ; une requête admin sans header
 * ou avec une version ≠ v1 est REFUSÉE (409, message actionnable).
 *
 * Env :
 *   CREEZIO_AGENT_PORT        (défaut 18810)
 *   CREEZIO_AGENT_HOSTS       (défaut 127.0.0.1 — liste "," ; ajouter
 *                              172.17.0.1 pour l'ingress tunnel du container)
 *   CREEZIO_AGENT_BRAND_ROOTS (chemins racines marques séparés par ":")
 *   CREEZIO_AGENT_STATE_FILE  (défaut {brandRoot0}/docker-data/host-agent.json)
 *   CREEZIO_DOCKER_SOCK       (défaut /var/run/docker.sock)
 *   CREEZIO_REGISTRY_AUTH     (base64 auth registre privé — pulls update)
 *   CREEZIO_AGENT_ADMIN_URL   (opt-in F5 : app admin — updates en pull ;
 *                              défaut state.adminAppUrl posé par enroll)
 *   CREEZIO_AGENT_FLEET_KEY   (opt-in F5 : credential flotte = agentToken ;
 *                              défaut state.fleetKey posé par enroll)
 *   CREEZIO_AGENT_TUNNEL_CONTAINER (T7 : container cloudflared dédié agent —
 *                              défaut creezio-agent-tunnel)
 *
 * 0 domaine marque hardcodé — injection env uniquement.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  containerLogs,
  dockerPing,
  inspectContainer,
  removeContainer,
  startContainer,
  stopContainer,
} from "./docker.js";
import {
  AGENT_TUNNEL_CONTAINER,
  resolveAgentTunnelRespawnPolicy,
  startAgentTunnelWatch,
} from "./agent-tunnel.js";
import { startAgentUpdateLoop } from "./agent-updates.js";
import {
  buildDiskReport,
  collectServers,
  createServer,
  fetchJson,
  findInstance,
  instanceDataDirAbs,
  loadRegistry,
  proxyInstanceSupport,
  readJson,
  readOpsEvents,
  saveRegistry,
  tokenMatchesHash,
  updateServer,
} from "./server-lib.js";
import {
  FLEET_PROTOCOL_HEADER,
  FLEET_PROTOCOL_VERSION,
  checkFleetProtocol,
  shouldWarnProtocol,
} from "./protocol.js";
import {
  HOST_AGENT_UPDATES_BASENAME,
  createUpdateStatusStore,
} from "./update-status-store.js";
import type { HostAgentState, UpdateEntry } from "./types.js";

export function startHostAgent(): void {
  const PORT = Number(process.env.CREEZIO_AGENT_PORT || 18810);
  const HOSTS = String(process.env.CREEZIO_AGENT_HOSTS || "127.0.0.1")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  const BRAND_ROOTS = String(process.env.CREEZIO_AGENT_BRAND_ROOTS || "")
    .split(":")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p));
  const STATE_FILE =
    process.env.CREEZIO_AGENT_STATE_FILE ||
    (BRAND_ROOTS[0]
      ? path.join(BRAND_ROOTS[0], "docker-data", "host-agent.json")
      : "");
  const MAX_BODY = 1 * 1024 * 1024;

  // T7 : surveillance respawn du container cloudflared dédié agent —
  // best-effort absolu (jamais d'impact sur le service HTTP), démarrée
  // plus bas après le listen.
  let tunnelWatch: ReturnType<typeof startAgentTunnelWatch> | null = null;

  if (!BRAND_ROOTS.length) {
    console.error("[host-agent] CREEZIO_AGENT_BRAND_ROOTS requis");
    process.exit(1);
  }
  if (!STATE_FILE) {
    console.error("[host-agent] CREEZIO_AGENT_STATE_FILE requis");
    process.exit(1);
  }

  function loadState(): HostAgentState {
    const st = readJson<HostAgentState | null>(STATE_FILE, null);
    if (st && st.hostId && Array.isArray(st.tokens)) return st;
    return { version: 1, hostId: null, label: null, tokens: [], adminUrl: null };
  }

  function audit(line: string): void {
    console.log(`[host-agent] ${new Date().toISOString()} ${line}`);
  }

  function authorized(req: IncomingMessage): boolean {
    const h = req.headers.authorization || "";
    const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!bearer) return false;
    const state = loadState();
    return state.tokens.some(
      (t) => !t.revokedAt && tokenMatchesHash(bearer, t.hash),
    );
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

  function send(res: ServerResponse, code: number, body?: unknown): void {
    const payload = body === undefined ? "" : JSON.stringify(body);
    res.writeHead(code, {
      [FLEET_PROTOCOL_HEADER]: String(FLEET_PROTOCOL_VERSION),
      ...(payload
        ? { "Content-Type": "application/json; charset=utf-8" }
        : {}),
    });
    res.end(payload);
  }

  /**
   * Updates par container — mutex + suivi ASYNCHRONE.
   * Le POST /update répond 202 immédiatement : une requête synchrone qui dure
   * (pull + backup + recreate + boot) ne survit pas au proxy Cloudflare
   * (~100 s max par requête). L'admin/UI suit via GET /update-status.
   * containerName → { status, image, startedAt, finishedAt?, result? }
   *
   * PERSISTÉ (T8) : journal host-agent-updates.json à côté du state file —
   * un restart de l'agent pendant un update n'efface plus le suivi (reload
   * au boot, résolution via servers.json, flag additif `agentRestarted`,
   * TTL 24 h sur les entrées terminées).
   */
  const updates = createUpdateStatusStore({
    file: path.join(path.dirname(STATE_FILE), HOST_AGENT_UPDATES_BASENAME),
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
    if (!found) return send(res, 404, { ok: false, error: "instance inconnue" });
    const { inst, brandRoot, registry } = found;

    if (action === "start" && req.method === "POST") {
      await startContainer(inst.containerName);
      audit(`start brand=${brandId} name=${name}`);
      return send(res, 200, { ok: true });
    }

    if (action === "stop" && req.method === "POST") {
      await stopContainer(inst.containerName);
      audit(`stop brand=${brandId} name=${name}`);
      return send(res, 200, { ok: true });
    }

    if (action === "update" && req.method === "POST") {
      let body: { image?: string; backup?: boolean };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { ok: false, error: "json" });
      }
      const image = String(body.image || "").trim();
      if (!image) return send(res, 400, { ok: false, error: "image requise" });
      const cur = updates.get(inst.containerName);
      if (cur?.status === "running") {
        return send(res, 409, { ok: false, error: "update déjà en cours", update: cur });
      }
      const entry: UpdateEntry = {
        status: "running",
        image,
        startedAt: new Date().toISOString(),
      };
      updates.set(inst.containerName, entry);
      // Fire-and-forget : le résultat (rollback inclus) est consultable via
      // GET …/update-status — le POST ne bloque jamais plus d'un aller-retour.
      updateServer({
        brandRoot,
        registry,
        inst,
        image,
        audit,
        // Chaque étape est persistée : un restart de l'agent en plein update
        // laisse au minimum la dernière étape connue dans le journal.
        onStep: (step) => {
          entry.lastStep = step;
          updates.save();
        },
        // Opt-in : seul backup:true crée un tar.gz frais (défaut = skip).
        backup: body.backup === true,
      })
        .then((r) => {
          entry.status = r.ok ? "done" : "error";
          entry.finishedAt = new Date().toISOString();
          entry.result = r;
          updates.save();
        })
        .catch((e) => {
          entry.status = "error";
          entry.finishedAt = new Date().toISOString();
          entry.result = { ok: false, error: String((e as Error)?.message || e) };
          updates.save();
          audit(`update KO brand=${brandId} name=${name}: ${(e as Error)?.message || e}`);
        });
      return send(res, 202, { ok: true, started: true, update: entry });
    }

    if (action === "update-status" && req.method === "GET") {
      const entry = updates.get(inst.containerName) || null;
      return send(res, 200, { ok: true, update: entry });
    }

    if (!action && req.method === "DELETE") {
      try {
        await removeContainer(inst.containerName, { force: true });
      } catch (e) {
        audit(`rm container KO brand=${brandId} name=${name}: ${(e as Error)?.message || e}`);
      }
      registry.instances = registry.instances.filter((i) => i.name !== name);
      saveRegistry(brandRoot, registry);
      const purge = url.searchParams.get("purgeData") === "1";
      if (purge) {
        const dataAbs = instanceDataDirAbs(brandRoot, inst);
        if (dataAbs.startsWith(brandRoot + path.sep)) {
          fs.rmSync(dataAbs, { recursive: true, force: true });
        }
      }
      audit(`rm brand=${brandId} name=${name} purgeData=${purge}`);
      return send(res, 200, { ok: true, purgedData: purge });
    }

    if (req.method !== "GET") return send(res, 405, { ok: false });

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

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    const p = url.pathname;

    // Sonde anonyme minimale (l'ingress tunnel peut être vérifié sans token).
    if (req.method === "GET" && p === "/agent/ping") {
      return send(res, 200, { ok: true, service: "creezio-host-agent" });
    }

    if (!authorized(req)) {
      return send(res, 401, { ok: false, error: "unauthorized" });
    }

    // Protocole flotte : refus fail-closed (409) si header absent ou ≠ v1.
    const proto = checkFleetProtocol(
      req.headers[FLEET_PROTOCOL_HEADER] as string | undefined,
      "backend flotte appelant",
    );
    if (proto.action === "refuse") {
      audit(`protocole flotte: refus — ${proto.message}`);
      return send(res, 409, { ok: false, error: "protocol_mismatch", detail: proto.message });
    }
    if (proto.action === "warn-missing" && shouldWarnProtocol("host-agent:inbound")) {
      audit(`protocole flotte: ${proto.message}`);
    }

    if (req.method === "GET" && p === "/agent/api/health") {
      const state = loadState();
      return send(res, 200, {
        ok: true,
        service: "creezio-host-agent",
        hostId: state.hostId,
        label: state.label,
        brandRoots: BRAND_ROOTS,
        docker: await dockerPing(),
        protocol: FLEET_PROTOCOL_VERSION,
        // Champ ADDITIF (protocole v1 intact) : état du tunnel dédié (T7).
        agentTunnel: tunnelWatch ? tunnelWatch.getStatus() : null,
      });
    }

    if (req.method === "GET" && p === "/agent/api/servers") {
      const { servers, docker } = await collectServers(BRAND_ROOTS);
      return send(res, 200, { ok: true, docker, servers });
    }

    if (req.method === "POST" && p === "/agent/api/servers") {
      let body: {
        brandRoot?: string;
        brandId?: string;
        [k: string]: unknown;
      };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { ok: false, error: "json" });
      }
      if (!body.brandRoot && BRAND_ROOTS.length === 1) {
        body.brandRoot = BRAND_ROOTS[0];
      }
      if (!body.brandRoot && body.brandId) {
        const match = BRAND_ROOTS.find(
          (root) => loadRegistry(root).brandId === body.brandId,
        );
        if (match) body.brandRoot = match;
      }
      try {
        const r = await createServer(BRAND_ROOTS, body, audit);
        return send(res, r.code, r.out);
      } catch (e) {
        audit(`create KO: ${(e as Error)?.message || e}`);
        return send(res, 502, { ok: false, error: String((e as Error)?.message || e) });
      }
    }

    if (req.method === "GET" && p === "/agent/api/disk") {
      return send(res, 200, await buildDiskReport(BRAND_ROOTS));
    }

    // /agent/api/servers/<brandId>/<name>/support[/*] → relais vers le mount
    // support natif de l'instance (GET liste/export, POST reply/statut…).
    const mSupport = p.match(
      /^\/agent\/api\/servers\/([^/]+)\/([^/]+)\/support(\/.*)?$/,
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

    // /agent/api/servers/<brandId>/<name>[/<action>]
    const m = p.match(
      /^\/agent\/api\/servers\/([^/]+)\/([^/]+)(?:\/(start|stop|update|update-status|boot-status|health|logs|ops))?$/,
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

  for (const host of HOSTS) {
    const server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        console.error("[host-agent] error", e);
        if (!res.writableEnded) send(res, 500, { ok: false });
      });
    });
    server.listen(PORT, host, () => {
      console.log(
        `[host-agent] écoute ${host}:${PORT} brandRoots=${BRAND_ROOTS.join(",")} state=${STATE_FILE}`,
      );
    });
  }

  // Updates en PULL (F5) — opt-in : env prioritaire, sinon state posé par
  // `creezio server-docker enroll`. Best-effort absolu : ne touche jamais le
  // service HTTP de l'agent.
  {
    const state = loadState();
    const adminUrl = (
      process.env.CREEZIO_AGENT_ADMIN_URL ||
      state.adminAppUrl ||
      ""
    ).trim();
    const fleetKey = (
      process.env.CREEZIO_AGENT_FLEET_KEY ||
      state.fleetKey ||
      ""
    ).trim();
    if (adminUrl && fleetKey && state.hostId) {
      startAgentUpdateLoop({
        adminUrl,
        fleetKey,
        hostId: state.hostId,
        brandRoots: BRAND_ROOTS,
        findInstance,
        updateServer,
        updates,
        audit,
      });
      audit(`pull-updates activés (admin ${adminUrl}, hostId ${state.hostId})`);
    } else {
      audit(
        "pull-updates inactifs (CREEZIO_AGENT_ADMIN_URL / CREEZIO_AGENT_FLEET_KEY absents)",
      );
    }
  }

  // T7 : respawn surveillé du container cloudflared dédié agent
  // (`creezio-agent-tunnel`) — même politique bornée que les autres
  // cloudflared (miroir host-runtime). Container absent = idle (pas encore
  // provisionné).
  const container =
    String(process.env.CREEZIO_AGENT_TUNNEL_CONTAINER || "").trim() ||
    AGENT_TUNNEL_CONTAINER;
  tunnelWatch = startAgentTunnelWatch({
    container,
    policy: resolveAgentTunnelRespawnPolicy(process.env),
    deps: {
      inspect: async (name) => {
        const i = await inspectContainer(name);
        if (!i) return null;
        const startedRaw = i.State?.StartedAt || "";
        const startedMs = Date.parse(startedRaw);
        return {
          exists: true,
          running: i.State?.Status === "running",
          status: i.State?.Status || "unknown",
          startedAtMs: Number.isFinite(startedMs) && startedMs > 0 ? startedMs : null,
        };
      },
      start: (name) => startContainer(name),
      log: audit,
    },
  });
  audit(`tunnel agent dédié : surveillance respawn active (${container})`);
}
