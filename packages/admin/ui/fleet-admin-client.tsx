"use client";

/**
 * Module Flotte — UI de l'app admin (design system kit).
 *
 * Parité fonctionnelle avec l'ancienne console `admin.html` (backend flotte
 * backend flotte @creezio/fleet) : hôtes VPS enrôlés + token d'enrôlement, création de
 * serveur, start/stop/update (async 202 + poll), update en masse, logs
 * docker, ops JSONL, boot-status live, disque, suppression (+purge).
 *
 * Depuis F2 (DB flotte) : la LISTE des serveurs lit le registre matérialisé
 * `/api/v1/modules/fleet-registry/servers` (lecture DB instantanée, statut
 * online dérivé heartbeat/poller) ; les GESTES restent inchangés via le
 * proxy `/api/v1/modules/fleet/*` (backend flotte = SoT des gestes).
 *
 * Depuis F5/F6 (updates en pull) : section « Releases » — rollout piloté
 * (canary → vagues → 100 %), pause / reprise / kill-switch (abort), et
 * pilotage par serveur (pin / hold / channel) via
 * `/api/v1/modules/fleet-releases/*`. Les agents hôtes POLLENT — aucun
 * update n'est poussé par l'admin.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Input } from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/fleet";
const REGISTRY_API = "/api/v1/modules/fleet-registry";
const RELEASES_API = "/api/v1/modules/fleet-releases";

type DockerState = {
  state: string;
  health: string | null;
  startedAt: string | null;
  image: string | null;
};

type BootStep = {
  id: string;
  label?: string;
  status: string;
  detail?: string;
};

type BootModel = {
  booting?: boolean;
  headline?: string;
  overallPercent?: number;
  steps?: BootStep[];
  footer?: string;
};

type Server = {
  brandId: string;
  name: string;
  containerName: string | null;
  port: number | null;
  env: Record<string, string>;
  image: string | null;
  version: string | null;
  /** Version lockstep @creezio/* annoncée par l'instance (heartbeat, P3.b). */
  kitVersion?: string | null;
  /** Version d'architecture annoncée (ex. H9). */
  architectureVersion?: string | null;
  orphan: boolean;
  docker: DockerState;
  hostId?: string;
  hostLabel?: string;
  /** Champs registre flotte (fleet-registry, F2). */
  registryId?: string;
  online?: boolean;
  registered?: boolean;
  source?: string | null;
  lastHeartbeatAt?: string | null;
  lastPolledAt?: string | null;
  bootHeadline?: string | null;
  /** Pilotage rollout (F6). */
  pinnedImage?: string | null;
  hold?: boolean;
  channel?: string;
};

/** Row brute du registre matérialisé (fleet-registry/servers). */
type RegistryRow = {
  id: string;
  host_id: string;
  brand_id: string;
  name: string;
  container_name: string | null;
  port: number | null;
  tunnel_slug: string | null;
  server_url: string | null;
  image: string | null;
  version: string | null;
  kit_version: string | null;
  architecture_version: string | null;
  orphan: number;
  docker_state: string | null;
  health: string | null;
  boot_headline: string | null;
  last_heartbeat_at: string | null;
  last_polled_at: string | null;
  source: string | null;
  online: boolean;
  registered: boolean;
  /** Pilotage rollout (F6). */
  pinned_image: string | null;
  hold: number;
  channel: string;
};

/** Release flotte (updates en pull, F5/F6). */
type FleetRelease = {
  id: string;
  created_at: string;
  brand_id: string;
  tag: string;
  image: string;
  digest: string | null;
  variant: string;
  channel: string;
  status: "draft" | "rolling" | "paused" | "done" | "aborted";
  wave_pct: number;
  reports_done: number;
  reports_failed: number;
  reports_rolled_back: number;
  active_slots: number;
};

function rowToServer(r: RegistryRow, hosts: FleetHost[]): Server {
  const host = hosts.find((h) => h.hostId === r.host_id);
  return {
    brandId: r.brand_id,
    name: r.name,
    containerName: r.container_name,
    port: r.port,
    env: r.tunnel_slug ? { CREEZIO_TUNNEL_SLUG: r.tunnel_slug } : {},
    image: r.image,
    version: r.version,
    kitVersion: r.kit_version,
    architectureVersion: r.architecture_version,
    orphan: Boolean(r.orphan),
    docker: {
      state: r.docker_state || "unknown",
      health: r.health,
      startedAt: null,
      image: r.image,
    },
    hostId: r.host_id,
    hostLabel: host?.label || r.host_id,
    registryId: r.id,
    online: r.online,
    registered: r.registered,
    source: r.source,
    lastHeartbeatAt: r.last_heartbeat_at,
    lastPolledAt: r.last_polled_at,
    bootHeadline: r.boot_headline,
    pinnedImage: r.pinned_image,
    hold: Boolean(r.hold),
    channel: r.channel || "stable",
  };
}

type FleetHost = {
  hostId: string;
  label: string | null;
  agentUrl: string;
  enrolledAt: string;
  lastSeen: string | null;
  online: boolean;
};

type DiskReport = {
  instances: Array<{
    brandId: string;
    name: string;
    dataDir: string;
    sizeBytes: number;
  }>;
  filesystem: { freeBytes: number; totalBytes: number } | null;
};

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}/${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* vide */
  }
  return { status: res.status, json };
}

async function registryApi(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${REGISTRY_API}/${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* vide */
  }
  return { status: res.status, json };
}

async function releasesApi(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${RELEASES_API}/${path}`, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* vide */
  }
  return { status: res.status, json };
}

function releaseStatusBadge(status: FleetRelease["status"]): string {
  if (status === "rolling") return "border-emerald-500/40 text-emerald-400";
  if (status === "paused") return "border-amber-500/40 text-amber-400";
  if (status === "aborted") return "border-red-500/40 text-red-400";
  if (status === "done") return "border-sky-500/40 text-sky-400";
  return "border-zinc-500/30 text-zinc-400";
}

function keyOf(s: Server): string {
  return `${s.hostId || "local"}/${s.brandId}/${s.name}`;
}

function isLocal(s: Server): boolean {
  return !s.hostId || s.hostId === "local";
}

function apiBase(s: Server): string {
  return isLocal(s)
    ? `servers/${encodeURIComponent(s.brandId)}/${encodeURIComponent(s.name)}`
    : `hosts/${encodeURIComponent(s.hostId!)}/servers/${encodeURIComponent(s.brandId)}/${encodeURIComponent(s.name)}`;
}

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "?";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function crmUrlOf(s: Server, running: boolean, hosts: FleetHost[]): string | null {
  if (!running) return null;
  if (isLocal(s)) return s.port ? `http://127.0.0.1:${s.port}/` : null;
  const slug = s.env?.CREEZIO_TUNNEL_SLUG;
  const host = hosts.find((h) => h.hostId === s.hostId);
  const m = (host?.agentUrl || "").match(/^https:\/\/agent\.(.+)$/);
  if (slug && m) {
    const rest = m[1]!;
    const zone = rest.split(".").slice(1).join(".");
    return `https://${slug}.${zone || rest}/`;
  }
  if (m) return `https://${m[1]}/`;
  return null;
}

function stateBadgeVariant(state: string): string {
  if (state === "running") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (state === "exited" || state === "absent")
    return "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
  return "bg-amber-500/15 text-amber-400 border-amber-500/30";
}

export function FleetAdminClient() {
  const [servers, setServers] = useState<Server[]>([]);
  const [releases, setReleases] = useState<FleetRelease[]>([]);
  const [hosts, setHosts] = useState<FleetHost[]>([]);
  const [disk, setDisk] = useState<DiskReport | null>(null);
  const [brandRoots, setBrandRoots] = useState<string[]>([]);
  const [dockerOk, setDockerOk] = useState<boolean | null>(null);
  const dockerFails = useRef(0);
  const [panels, setPanels] = useState<Record<string, "logs" | "ops">>({});
  const [panelText, setPanelText] = useState<Record<string, string>>({});
  const [bootModels, setBootModels] = useState<Record<string, BootModel>>({});
  const bootPollers = useRef<Record<string, boolean>>({});
  const [enrollLabel, setEnrollLabel] = useState("");
  const [enrollMsg, setEnrollMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [createForm, setCreateForm] = useState({ brandRoot: "", name: "", port: "" });
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyMsg, setBusyMsg] = useState<string>("");

  const startBootPoll = useCallback((s: Server) => {
    const key = keyOf(s);
    if (bootPollers.current[key]) return;
    bootPollers.current[key] = true;
    const base = apiBase(s);
    const tick = async () => {
      const r = await api(`${base}/boot-status`).catch(() => null);
      const model: BootModel | null = r && r.status === 200 ? r.json : null;
      if (model) {
        setBootModels((prev) => ({ ...prev, [key]: model }));
        const donePct = (model.overallPercent ?? 0) >= 100;
        if (model.booting === false && donePct) {
          delete bootPollers.current[key];
          setTimeout(() => {
            setBootModels((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
          }, 4000);
          return;
        }
      }
      if (bootPollers.current[key]) setTimeout(tick, 2000);
    };
    void tick();
  }, []);

  const syncedOnce = useRef(false);

  const refresh = useCallback(async () => {
    // Liste = registre matérialisé (DB, instantané) ; hôtes/disque/ping
    // docker = backend flotte (proxy fleet) comme avant.
    const [reg, dsk, hst, hlt, rel] = await Promise.all([
      registryApi("servers").catch(() => null),
      api("disk").catch(() => null),
      api("hosts").catch(() => null),
      api("health").catch(() => null),
      releasesApi("releases").catch(() => null),
    ]);
    if (rel?.json?.ok) setReleases(rel.json.releases || []);
    const hostList: FleetHost[] = hst?.json?.ok ? hst.json.hosts || [] : [];
    if (hst?.json?.ok) setHosts(hostList);
    if (hlt?.json) {
      // Badge docker durci : « indisponible » seulement après 2 échecs
      // consécutifs (un timeout ponctuel du ping daemon ne doit pas alarmer).
      if (hlt.json.docker) {
        dockerFails.current = 0;
        setDockerOk(true);
      } else {
        dockerFails.current += 1;
        if (dockerFails.current >= 2) setDockerOk(false);
      }
    }
    if (reg?.json?.ok) {
      let rows: RegistryRow[] = reg.json.servers || [];
      // Premier passage sur un registre vide : backfill immédiat depuis le
      // backend flotte (POST sync), puis relecture.
      if (!rows.length && !syncedOnce.current) {
        syncedOnce.current = true;
        await registryApi("sync", { method: "POST" }).catch(() => null);
        const again = await registryApi("servers").catch(() => null);
        if (again?.json?.ok) rows = again.json.servers || [];
      }
      const list = rows.map((r) => rowToServer(r, hostList));
      setServers(list);
      for (const s of list) {
        if (s.docker.state === "running" && s.docker.health === "starting") {
          startBootPoll(s);
        }
      }
    }
    if (dsk?.json?.ok) setDisk(dsk.json);
  }, [startBootPoll]);

  const syncNow = useCallback(async () => {
    setBusyMsg("Synchronisation du registre flotte…");
    const r = await registryApi("sync", { method: "POST" }).catch(() => null);
    setBusyMsg(
      r?.json?.ok
        ? `Registre synchronisé (${r.json.upserted} serveurs)`
        : `Sync KO : ${r?.json?.error || "backend flotte injoignable"}`,
    );
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let stop = false;
    (async () => {
      const h = await api("health").catch(() => null);
      if (!stop) setBrandRoots(h?.json?.brandRoots || []);
      await refresh();
    })();
    const t = setInterval(() => void refresh(), 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    if (createForm.brandRoot === "" && brandRoots.length) {
      setCreateForm((f) => ({ ...f, brandRoot: brandRoots[0]! }));
    }
  }, [brandRoots, createForm.brandRoot]);

  const loadPanel = useCallback(async (s: Server, kind: "logs" | "ops") => {
    const key = keyOf(s);
    const base = apiBase(s);
    if (kind === "logs") {
      const r = await api(`${base}/logs?tail=200`);
      setPanelText((prev) => ({
        ...prev,
        [key]: r.json?.ok
          ? (r.json.lines || []).join("\n") || "(vide)"
          : `erreur: ${r.json?.error || r.status}`,
      }));
    } else {
      const r = await api(`${base}/ops?limit=100`);
      const ev = r.json?.events || [];
      setPanelText((prev) => ({
        ...prev,
        [key]: ev.length
          ? ev.map((e: unknown) => JSON.stringify(e)).join("\n")
          : "(aucun événement ops)",
      }));
    }
  }, []);

  const pollUpdateStatus = useCallback(async (base: string, timeoutMs = 15 * 60 * 1000) => {
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const r = await api(`${base}/update-status`);
        const u = r.json?.update;
        if (u && u.status !== "running") return u;
      } catch {
        /* injoignable pendant le recreate */
      }
      if (Date.now() - t0 > timeoutMs) {
        return { status: "error", result: { error: "timeout suivi update" } };
      }
    }
  }, []);

  const doUpdate = useCallback(
    async (s: Server) => {
      const key = keyOf(s);
      const current = s.image || "";
      const input = window.prompt(
        `Mettre à jour ${key}\n\nImage actuelle : ${current}\nVersion actuelle : ${s.version || "?"}\n\nEntrer un TAG (ex. 0.2.0) ou une image complète :`,
      );
      if (!input) return;
      let image = input.trim();
      if (!image.includes("/") && !image.includes(":") && current.includes(":")) {
        image = `${current.slice(0, current.lastIndexOf(":"))}:${image}`;
      }
      if (
        !window.confirm(
          `Recréer ${key} avec :\n${image}\n\n(sans nouveau backup — volume /data + archives docker-data/backups/ conservés ; rollback image auto si santé KO)`,
        )
      )
        return;
      const base = apiBase(s);
      const r = await api(`${base}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Défaut API = pas de nouveau tar.gz ; backup:true seulement si opt-in CLI/API.
        body: JSON.stringify({ image }),
      });
      if (!r.json?.ok) {
        window.alert(`Update refusé : ${r.json?.error || r.status}`);
        return;
      }
      startBootPoll(s);
      const final = await pollUpdateStatus(base);
      const out = final?.result || {};
      window.alert(
        final?.status === "done"
          ? `Update OK → ${out.image || image} (version ${out.version || "?"})`
          : `Update KO : ${out.error || final?.status || "?"}${out.rolledBack ? "\nRollback effectué → " + out.previousImage : ""}`,
      );
      startBootPoll(s);
      await refresh();
    },
    [pollUpdateStatus, refresh, startBootPoll],
  );

  const updateAll = useCallback(async () => {
    const candidates = servers.filter((s) => !s.orphan);
    if (!candidates.length) return window.alert("Aucun serveur à mettre à jour.");
    const brands = [...new Set(candidates.map((s) => s.brandId))];
    const brand =
      brands.length === 1
        ? brands[0]!
        : window.prompt(`Marque à mettre à jour (${brands.join(", ")}) :`, brands[0]);
    if (!brand) return;
    const targets = candidates.filter((s) => s.brandId === brand);
    const sample = targets.find((s) => (s.image || "").includes(":"));
    const input = window.prompt(
      `Mettre à jour ${targets.length} serveur(s) « ${brand} »\n\nImage actuelle (exemple) : ${sample?.image || "?"}\n\nEntrer un TAG (ex. 0.2.1) ou une image complète :`,
    );
    if (!input) return;
    let image = input.trim();
    if (!image.includes("/") && !image.includes(":") && sample?.image?.includes(":")) {
      image = `${sample.image.slice(0, sample.image.lastIndexOf(":"))}:${image}`;
    }
    const todo = targets.filter((s) => s.image !== image);
    if (!todo.length)
      return window.alert(`Tous les serveurs « ${brand} » sont déjà sur :\n${image}`);
    if (
      !window.confirm(
        `Mettre à jour ${todo.length}/${targets.length} serveur(s) vers :\n${image}\n\n(séquentiel — sans nouveau backup ; rollback image auto par serveur)`,
      )
    )
      return;
    const results: string[] = [];
    for (const s of todo) {
      const key = keyOf(s);
      setBusyMsg(`Update ${results.length + 1}/${todo.length} : ${key}…`);
      const base = apiBase(s);
      const r = await api(`${base}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      if (!r.json?.ok) {
        results.push(`✗ ${key} : refusé (${r.json?.error || r.status})`);
        continue;
      }
      startBootPoll(s);
      const final = await pollUpdateStatus(base);
      const out = final?.result || {};
      results.push(
        final?.status === "done"
          ? `✓ ${key} → ${out.version || image}`
          : `✗ ${key} : ${out.error || final?.status}${out.rolledBack ? " (rollback OK)" : ""}`,
      );
      await refresh();
    }
    const failed = results.filter((l) => l.startsWith("✗")).length;
    setBusyMsg(`Update en masse terminé — ${todo.length - failed}/${todo.length} OK`);
    window.alert(`Update en masse terminé :\n\n${results.join("\n")}`);
    await refresh();
  }, [pollUpdateStatus, refresh, servers, startBootPoll]);

  const doAction = useCallback(
    async (s: Server, act: string) => {
      const key = keyOf(s);
      const base = apiBase(s);
      if (act === "start") {
        await api(`${base}/start`, { method: "POST" });
        startBootPoll(s);
      } else if (act === "stop") {
        await api(`${base}/stop`, { method: "POST" });
        setBootModels((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } else if (act === "update") {
        await doUpdate(s);
        return;
      } else if (act === "rm") {
        const go = window.confirm(
          `Supprimer le serveur ${key} ?\n\nOK = container supprimé, données conservées.\n(Une seconde confirmation propose la purge des données.)`,
        );
        if (!go) return;
        const purgeData = window.confirm(
          "Supprimer AUSSI le dossier de données ? (irréversible)",
        );
        await api(`${base}?purgeData=${purgeData ? 1 : 0}`, { method: "DELETE" });
        setPanels((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } else if (act === "logs" || act === "ops") {
        setPanels((prev) => {
          const next = { ...prev };
          if (next[key] === act) delete next[key];
          else next[key] = act as "logs" | "ops";
          return next;
        });
        if (panels[key] !== act) void loadPanel(s, act as "logs" | "ops");
        return;
      }
      await refresh();
    },
    [doUpdate, loadPanel, panels, refresh, startBootPoll],
  );

  const generateEnrollToken = useCallback(async () => {
    setEnrollMsg(null);
    const r = await api("hosts/enroll-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: enrollLabel.trim() }),
    });
    if (r.json?.ok) {
      setEnrollMsg({
        ok: true,
        text: `Token (affiché UNE fois) : ${r.json.enrollToken}\nSur le VPS : creezio server-docker enroll --brand-root . --admin <URL admin> --token ${r.json.enrollToken} --slug <slug>`,
      });
    } else {
      setEnrollMsg({ ok: false, text: r.json?.error || `erreur HTTP ${r.status}` });
    }
  }, [enrollLabel]);

  const removeHost = useCallback(
    async (hostId: string) => {
      if (!window.confirm(`Retirer l'hôte ${hostId} du registre flotte ?`)) return;
      await api(`hosts/${encodeURIComponent(hostId)}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  /* ------------------------------------------ rollout piloté (F5/F6) */

  const patchRelease = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const r = await releasesApi(`releases/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.json?.ok) window.alert(`Release : ${r.json?.error || r.status}`);
      await refresh();
    },
    [refresh],
  );

  const startRollout = useCallback(
    async (rel: FleetRelease) => {
      const input = window.prompt(
        `Démarrer le rollout de ${rel.brand_id}:${rel.tag} (${rel.variant}, canal ${rel.channel})\n\n% de la flotte ciblé (canary — promouvoir ensuite) :`,
        String(rel.wave_pct || 10),
      );
      if (input === null) return;
      const pct = Math.max(0, Math.min(100, Number(input) || 0));
      await patchRelease(rel.id, { status: "rolling", wavePct: pct });
    },
    [patchRelease],
  );

  const promoteRelease = useCallback(
    async (rel: FleetRelease) => {
      const input = window.prompt(
        `Promouvoir ${rel.brand_id}:${rel.tag} — vague actuelle ${rel.wave_pct}%\n\nNouveau % de la flotte (les serveurs déjà servis le restent) :`,
        "100",
      );
      if (input === null) return;
      const pct = Math.max(0, Math.min(100, Number(input) || 0));
      await patchRelease(rel.id, { wavePct: pct });
    },
    [patchRelease],
  );

  const abortRelease = useCallback(
    async (rel: FleetRelease) => {
      if (
        !window.confirm(
          `KILL-SWITCH — arrêter définitivement le rollout ${rel.brand_id}:${rel.tag} ?\n\nLes agents cessent au prochain poll, les téléchargements en cours ne sont pas relancés. Les serveurs déjà mis à jour restent tels quels (pin/rollback manuels si besoin).`,
        )
      )
        return;
      await patchRelease(rel.id, { status: "aborted" });
    },
    [patchRelease],
  );

  const deleteRelease = useCallback(
    async (rel: FleetRelease) => {
      if (!window.confirm(`Supprimer la release ${rel.brand_id}:${rel.tag} ?`)) return;
      const r = await releasesApi(`releases/${encodeURIComponent(rel.id)}`, {
        method: "DELETE",
      });
      if (!r.json?.ok) window.alert(`Suppression : ${r.json?.error || r.status}`);
      await refresh();
    },
    [refresh],
  );

  const serverRollout = useCallback(
    async (s: Server, patch: Record<string, unknown>) => {
      if (!s.registryId) return;
      const r = await releasesApi(
        `servers/${encodeURIComponent(s.registryId)}/rollout`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!r.json?.ok) window.alert(`Rollout : ${r.json?.error || r.status}`);
      await refresh();
    },
    [refresh],
  );

  const pinServer = useCallback(
    async (s: Server) => {
      const input = window.prompt(
        `Épingler ${keyOf(s)} sur une image (prioritaire sur toute release).\n\nImage actuelle : ${s.image || "?"}\nVide = retirer le pin :`,
        s.pinnedImage || "",
      );
      if (input === null) return;
      await serverRollout(s, { pinnedImage: input.trim() || null });
    },
    [serverRollout],
  );

  const createServer = useCallback(async () => {
    setCreateMsg(null);
    const { brandRoot, name, port } = createForm;
    if (!brandRoot || !name.trim()) {
      setCreateMsg({ ok: false, text: "Marque et nom requis." });
      return;
    }
    const body: Record<string, unknown> = { brandRoot, name: name.trim() };
    if (port.trim()) body.port = Number(port.trim());
    setCreateMsg({ ok: true, text: "Création en cours…" });
    const r = await api("servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.json?.ok) {
      setCreateMsg({
        ok: true,
        text: `Serveur ${name} créé (port ${r.json.instance.port}) — boot en cours…`,
      });
      setCreateForm((f) => ({ ...f, name: "", port: "" }));
      await refresh();
      startBootPoll({
        hostId: "local",
        brandId: r.json.instance.brandId,
        name: name.trim(),
      } as Server);
    } else {
      setCreateMsg({ ok: false, text: r.json?.error || `erreur HTTP ${r.status}` });
    }
  }, [createForm, refresh, startBootPoll]);

  const diskOf = useCallback(
    (s: Server) => {
      if (!disk || !isLocal(s)) return null;
      return (disk.instances || []).find(
        (d) => d.brandId === s.brandId && d.name === s.name,
      );
    },
    [disk],
  );

  const fsInfo = disk?.filesystem;
  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
    [servers],
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Flotte</h1>
        <div className="flex-1" />
        <Badge
          variant="outline"
          className={
            dockerOk === false
              ? "border-red-500/40 text-red-400"
              : "border-emerald-500/40 text-emerald-400"
          }
        >
          docker : {dockerOk === null ? "…" : dockerOk ? "ok" : "indisponible"}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground">
          {fsInfo
            ? `disque : ${fmtBytes(fsInfo.freeBytes)} libres / ${fmtBytes(fsInfo.totalBytes)}`
            : "disque : …"}
        </Badge>
      </div>

      {/* Hôtes flotte */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Hôtes flotte (VPS enrôlés)
        </div>
        {hosts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun VPS enrôlé — générer un token puis, sur le VPS distant :{" "}
            <code className="text-xs">
              creezio server-docker enroll --brand-root . --admin &lt;URL&gt; --token
              &lt;token&gt; --slug &lt;slug&gt;
            </code>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {hosts.map((h) => (
              <div key={h.hostId} className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{h.label || h.hostId}</span>
                <span className="text-xs text-muted-foreground">{h.agentUrl}</span>
                <Badge
                  variant="outline"
                  className={
                    h.online
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-red-500/40 text-red-400"
                  }
                >
                  {h.online ? "online" : "offline"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {h.lastSeen
                    ? `vu ${new Date(h.lastSeen).toLocaleString()}`
                    : "jamais vu"}
                </span>
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void removeHost(h.hostId)}
                >
                  Retirer
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Label du prochain VPS
            </label>
            <Input
              placeholder="resto-lyon-1"
              value={enrollLabel}
              onChange={(e) => setEnrollLabel(e.target.value)}
              className="w-56"
            />
          </div>
          <Button variant="secondary" onClick={() => void generateEnrollToken()}>
            Générer un token d'enrôlement
          </Button>
        </div>
        {enrollMsg ? (
          <pre
            className={`mt-2 whitespace-pre-wrap break-all rounded-md border p-2 text-xs ${enrollMsg.ok ? "border-emerald-500/30 text-emerald-300" : "border-red-500/30 text-red-300"}`}
          >
            {enrollMsg.text}
          </pre>
        ) : null}
      </Card>

      {/* Releases — updates en pull (F5/F6) */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Releases (updates en pull)
        </div>
        {releases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune release — publier avec{" "}
            <code className="text-xs">
              creezio server-docker publish --brand-root . --tag &lt;tag&gt;
              --public-host registry.&lt;zone&gt; --release
            </code>{" "}
            puis démarrer le rollout ici. Les agents hôtes tirent les updates
            (poll ~5 min), rien n'est poussé.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {releases.map((rel) => (
              <div key={rel.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {rel.brand_id}:{rel.tag}
                </span>
                <span className="text-xs text-muted-foreground">
                  {rel.variant} · canal {rel.channel}
                  {rel.digest ? " · digest" : ""}
                </span>
                <Badge variant="outline" className={releaseStatusBadge(rel.status)}>
                  {rel.status}
                </Badge>
                {rel.status === "rolling" || rel.status === "paused" ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    vague {rel.wave_pct}%
                  </Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  ✓{rel.reports_done} ✗{rel.reports_failed + rel.reports_rolled_back}
                  {rel.active_slots ? ` · ${rel.active_slots} téléchargement(s)` : ""}
                </span>
                <div className="flex-1" />
                {rel.status === "draft" ? (
                  <Button size="sm" onClick={() => void startRollout(rel)}>
                    Démarrer…
                  </Button>
                ) : null}
                {rel.status === "rolling" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void promoteRelease(rel)}
                    >
                      Promouvoir…
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void patchRelease(rel.id, { status: "paused" })}
                    >
                      Pause
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void patchRelease(rel.id, { status: "done" })}
                    >
                      Terminer
                    </Button>
                  </>
                ) : null}
                {rel.status === "paused" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void patchRelease(rel.id, { status: "rolling" })}
                  >
                    Reprendre
                  </Button>
                ) : null}
                {rel.status === "rolling" || rel.status === "paused" ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    title="kill-switch : les agents cessent au prochain poll"
                    onClick={() => void abortRelease(rel)}
                  >
                    STOP
                  </Button>
                ) : null}
                {rel.status === "draft" || rel.status === "aborted" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void deleteRelease(rel)}
                  >
                    Supprimer
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Nouveau serveur */}
      <Card className="p-4">
        <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Nouveau serveur (hôte local)
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Marque
            </label>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={createForm.brandRoot}
              onChange={(e) =>
                setCreateForm((f) => ({ ...f, brandRoot: e.target.value }))
              }
            >
              {brandRoots.length ? (
                brandRoots.map((r) => (
                  <option key={r} value={r}>
                    {r.split("/").pop() || r} — {r}
                  </option>
                ))
              ) : (
                <option value="">(aucune marque)</option>
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Nom
            </label>
            <Input
              placeholder="demo"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Port (optionnel)
            </label>
            <Input
              placeholder="auto"
              value={createForm.port}
              onChange={(e) => setCreateForm((f) => ({ ...f, port: e.target.value }))}
              className="w-28"
            />
          </div>
          <Button onClick={() => void createServer()}>Créer + démarrer</Button>
        </div>
        {createMsg ? (
          <p
            className={`mt-2 text-sm ${createMsg.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {createMsg.text}
          </p>
        ) : null}
      </Card>

      {/* Serveurs */}
      <div className="flex items-center gap-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Serveurs
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void syncNow()}>
          Synchroniser
        </Button>
        <Button variant="outline" size="sm" onClick={() => void updateAll()}>
          Tout mettre à jour…
        </Button>
      </div>
      {busyMsg ? <p className="text-sm text-muted-foreground">{busyMsg}</p> : null}
      {sortedServers.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Aucun serveur — créer une instance ci-dessus.
        </Card>
      ) : (
        sortedServers.map((s) => {
          const key = keyOf(s);
          const st = s.docker?.state || "unknown";
          const running = st === "running";
          const health = s.docker?.health;
          const d = diskOf(s);
          const panel = panels[key];
          const crmUrl = crmUrlOf(s, running, hosts);
          const boot = bootModels[key];
          return (
            <Card key={key} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {s.brandId || "?"}
                  {s.port ? ` · :${s.port}` : ""}
                </span>
                {!isLocal(s) ? (
                  <Badge variant="outline" className="border-orange-500/40 text-orange-400">
                    {s.hostLabel || s.hostId}
                  </Badge>
                ) : null}
                <Badge variant="outline" className={stateBadgeVariant(st)}>
                  {st}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    s.online
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-zinc-500/30 text-zinc-400"
                  }
                  title={
                    s.lastHeartbeatAt
                      ? `heartbeat ${new Date(s.lastHeartbeatAt).toLocaleString()}`
                      : s.lastPolledAt
                        ? `poll ${new Date(s.lastPolledAt).toLocaleString()}`
                        : "jamais vu"
                  }
                >
                  {s.online ? "online" : "offline"}
                </Badge>
                {s.registered ? (
                  <Badge
                    variant="outline"
                    className="border-sky-500/40 text-sky-400"
                    title="auto-inscrit (heartbeat)"
                  >
                    inscrit
                  </Badge>
                ) : null}
                {health ? (
                  <span
                    className={`text-xs ${health === "healthy" ? "text-emerald-400" : "text-amber-400"}`}
                  >
                    {health}
                  </span>
                ) : null}
                {s.version ? (
                  <span className="text-xs text-muted-foreground">v{s.version}</span>
                ) : null}
                {s.kitVersion || s.architectureVersion ? (
                  <span
                    className="text-xs text-muted-foreground"
                    title="version kit @creezio/* annoncée par l'instance (heartbeat)"
                  >
                    kit {s.kitVersion || "?"}
                    {s.architectureVersion ? ` · ${s.architectureVersion}` : ""}
                  </span>
                ) : null}
                {s.image ? (
                  <span className="text-xs text-muted-foreground" title="image">
                    {s.image}
                  </span>
                ) : null}
                {s.orphan ? (
                  <Badge variant="outline" className="border-orange-500/40 text-orange-400">
                    orphelin
                  </Badge>
                ) : null}
                {s.hold ? (
                  <Badge
                    variant="outline"
                    className="border-red-500/40 text-red-400"
                    title="exclu des updates en pull"
                  >
                    hold
                  </Badge>
                ) : null}
                {s.pinnedImage ? (
                  <Badge
                    variant="outline"
                    className="border-purple-500/40 text-purple-400"
                    title={`épinglé sur ${s.pinnedImage}`}
                  >
                    pin
                  </Badge>
                ) : null}
                {s.channel && s.channel !== "stable" ? (
                  <Badge variant="outline" className="border-sky-500/40 text-sky-400">
                    {s.channel}
                  </Badge>
                ) : null}
                {crmUrl ? (
                  <a
                    className="text-sm font-medium text-orange-400 hover:underline"
                    href={crmUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    ouvrir le CRM ↗
                  </a>
                ) : null}
              </div>
              {!s.orphan ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={running}
                    onClick={() => void doAction(s, "start")}
                  >
                    Start
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!running}
                    onClick={() => void doAction(s, "stop")}
                  >
                    Stop
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void doAction(s, "update")}
                  >
                    Mettre à jour
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void doAction(s, "logs")}
                  >
                    Logs
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void doAction(s, "ops")}
                  >
                    Ops
                  </Button>
                  {s.registryId ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        title={
                          s.hold
                            ? "réintégrer dans les updates en pull"
                            : "exclure des updates en pull"
                        }
                        onClick={() => void serverRollout(s, { hold: !s.hold })}
                      >
                        {s.hold ? "Unhold" : "Hold"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        title="épingler sur une image (prioritaire sur les releases)"
                        onClick={() => void pinServer(s)}
                      >
                        Pin…
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        title="basculer le canal de release stable/canary"
                        onClick={() =>
                          void serverRollout(s, {
                            channel: s.channel === "canary" ? "stable" : "canary",
                          })
                        }
                      >
                        {s.channel === "canary" ? "→ stable" : "→ canary"}
                      </Button>
                    </>
                  ) : null}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void doAction(s, "rm")}
                  >
                    Supprimer
                  </Button>
                </div>
              ) : null}
              {d ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  données : {fmtBytes(d.sizeBytes)} ({d.dataDir || ""})
                </p>
              ) : null}
              {boot ? (
                <div className="mt-3 rounded-md border border-border/60 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span>{boot.headline || "Démarrage…"}</span>
                    <div className="flex-1" />
                    <span className="text-xs text-muted-foreground">
                      {Math.max(0, Math.min(100, Math.round(boot.overallPercent || 0)))}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full bg-orange-500 transition-all"
                      style={{
                        width: `${Math.max(0, Math.min(100, Math.round(boot.overallPercent || 0)))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex flex-col gap-0.5">
                    {(boot.steps || []).map((step) => (
                      <div key={step.id} className="flex items-center gap-2 text-xs">
                        <span
                          className={
                            step.status === "done"
                              ? "text-emerald-400"
                              : step.status === "error"
                                ? "text-red-400"
                                : step.status === "running"
                                  ? "text-orange-400"
                                  : "text-muted-foreground"
                          }
                        >
                          {step.status === "done"
                            ? "✓"
                            : step.status === "running"
                              ? "●"
                              : step.status === "error"
                                ? "!"
                                : step.status === "skip"
                                  ? "–"
                                  : "○"}
                        </span>
                        <span>{step.label || step.id}</span>
                        {step.detail ? (
                          <span className="text-muted-foreground">{step.detail}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {panel ? (
                <div className="mt-3 rounded-md border border-border/60">
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <span>
                      {panel === "logs"
                        ? "docker logs (tail 200)"
                        : "événements ops (JSONL)"}
                    </span>
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={() => void loadPanel(s, panel)}>
                      Rafraîchir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPanels((prev) => {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        })
                      }
                    >
                      Fermer
                    </Button>
                  </div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs">
                    {panelText[key] ?? "Chargement…"}
                  </pre>
                </div>
              ) : null}
            </Card>
          );
        })
      )}
    </div>
  );
}
