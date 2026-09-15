/**
 * Agrégation flotte pour l’UI ops (slug → users → activité).
 * Suffixe tunnel / hostnames : opts.tunnelSuffix (injection marque).
 */

import fs from "node:fs";
import path from "node:path";

function onlineOf(lastSeen) {
  if (!lastSeen) return "offline";
  const s = (Date.now() - new Date(lastSeen).getTime()) / 1000;
  if (s < 180) return "online";
  if (s < 900) return "idle";
  return "offline";
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function listJsonDir(dir, limit = 80) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try {
        return { file: f, ...readJson(path.join(dir, f), {}) };
      } catch {
        return { file: f };
      }
    });
}

function installsForSlug(installsMap, slug) {
  return Object.values(installsMap).filter(
    (i) => String(i.tunnelSlug || "") === slug || (!slug && !i.tunnelSlug),
  );
}

function deriveUsers(install) {
  const sessions = Array.isArray(install.sessions) ? install.sessions : [];
  const sessionByUser = new Map(
    sessions.map((s) => [String(s.userId || ""), s]),
  );
  const users = Array.isArray(install.users) ? install.users : [];
  if (users.length) {
    return users.map((u) => {
      const id = String(u.id || u.userId || u.username || "unknown");
      const sess = sessionByUser.get(id);
      const lastSeen = sess?.lastSeen || install.lastSeen || null;
      return {
        id,
        username: String(
          u.username || sess?.username || u.email || u.id || "utilisateur",
        ),
        role: String(u.role || "collaborator"),
        kind: String(u.kind || "human"),
        active: u.active !== false,
        online: onlineOf(lastSeen),
        lastSeen,
      };
    });
  }
  if (sessions.length) {
    return sessions.map((s) => ({
      id: String(s.userId || "unknown"),
      username: String(s.username || s.userId || "utilisateur"),
      role: "collaborator",
      kind: "human",
      active: true,
      online: onlineOf(s.lastSeen),
      lastSeen: s.lastSeen || null,
    }));
  }
  // Fallback : compte hôte implicite
  return [
    {
      id: "host",
      username: install.hostname || "hôte",
      role: "owner",
      kind: "human",
      active: true,
      online: onlineOf(install.lastSeen),
      lastSeen: install.lastSeen || null,
    },
  ];
}

function conversationsFromBundles(bundles, installId) {
  const mine = bundles.filter(
    (b) =>
      b.installId === installId &&
      (b.kind === "assistant_chats" || b.kind === "hermes_chats"),
  );
  const threads = [];
  const seen = new Set();
  for (const b of mine) {
    const items = Array.isArray(b.items) ? b.items : [];
    if (b.kind === "assistant_chats") {
      for (const m of items) {
        const title = String(m.title || "Conversation").slice(0, 120);
        const key = `${m.conversationId || title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const related = items.filter(
          (x) =>
            (m.conversationId && x.conversationId === m.conversationId) ||
            (!m.conversationId && (x.title || "Conversation") === title),
        );
        threads.push({
          id: key,
          source: "assistant",
          title,
          updatedAt: related[0]?.createdAt || b.timestamp,
          preview: String(related[0]?.content || "").slice(0, 160),
          messages: related
            .slice()
            .reverse()
            .slice(0, 40)
            .map((x) => ({
              role: x.role,
              content: String(x.content || ""),
              at: x.createdAt,
            })),
          file: b.file,
        });
      }
    } else if (b.kind === "hermes_chats") {
      for (const m of items.slice(0, 20)) {
        const title = String(m.path || "Hermes").slice(0, 120);
        const key = `hermes:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        threads.push({
          id: key,
          source: "hermes",
          title,
          updatedAt: m.mtime || b.timestamp,
          preview: String(m.preview || "").slice(0, 160),
          messages: [
            {
              role: "assistant",
              content: String(m.preview || ""),
              at: m.mtime,
            },
          ],
          file: b.file,
        });
      }
    }
  }
  threads.sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );
  return threads.slice(0, 40);
}

function activityFrom(install, bundles, crashes) {
  const out = [];
  for (const b of bundles) {
    if (b.installId !== install.installId) continue;
    if (b.kind === "actions" && Array.isArray(b.items)) {
      for (const a of b.items) {
        const meta = a.meta && typeof a.meta === "object" ? a.meta : {};
        out.push({
          at: a.at || b.timestamp,
          type: a.type || a.name || "action",
          name: a.name || a.type || "action",
          category: a.category || meta.category || "ui",
          label: a.label || "Action",
          path: a.path,
          referrerPath: a.referrerPath || meta.referrerPath,
          userId: a.userId,
          username: a.username,
          sessionId: a.sessionId || meta.sessionId,
          durationMs:
            typeof a.durationMs === "number"
              ? a.durationMs
              : typeof meta.durationMs === "number"
                ? meta.durationMs
                : undefined,
          meta,
          surface: a.surface || meta.surface || "crm",
        });
      }
    }
    if (b.kind === "request_logs" && Array.isArray(b.items)) {
      for (const a of b.items.slice(0, 40)) {
        out.push({
          at: a.at || b.timestamp,
          type: "api",
          name: "api.request",
          category: "system",
          label: `${a.method || "HTTP"} ${a.path || ""}`.trim(),
          path: a.path,
          durationMs: a.durationMs,
        });
      }
    }
    if (b.kind === "assistant_chats" && Array.isArray(b.items)) {
      for (const m of b.items.filter((x) => x.role === "user").slice(0, 20)) {
        out.push({
          at: m.createdAt || b.timestamp,
          type: "chat",
          name: "chat.message",
          category: "chat",
          label: String(m.content || m.title || "Message").slice(0, 140),
          path: "/assistant",
        });
      }
    }
  }
  for (const c of crashes) {
    if (c.installId !== install.installId) continue;
    out.push({
      at: c.timestamp,
      type: "incident",
      name: "system.crash",
      category: "system",
      label: `Incident ${c.kind || "crash"} — ${String(c?.detail?.message || c.message || "").slice(0, 100)}`,
      path: null,
    });
  }
  out.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return out.slice(0, 300);
}

export function buildFleetOverview(dataDir, opts = {}) {
  const tunnelSuffix = opts.tunnelSuffix || "";
  const installsMap = readJson(path.join(dataDir, "installs.json"), {});
  const bySlug = new Map();
  for (const inst of Object.values(installsMap)) {
    const slug = String(inst.tunnelSlug || "(sans-slug)");
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(inst);
  }
  const servers = [];
  for (const [slug, list] of bySlug) {
    list.sort((a, b) =>
      String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")),
    );
    const primary = list[0];
    const users = deriveUsers(primary);
    servers.push({
      slug,
      hostname:
        primary.tunnelHostname ||
        (tunnelSuffix ? `${slug}.${tunnelSuffix}` : slug),
      online: onlineOf(primary.lastSeen),
      lastSeen: primary.lastSeen || null,
      appVersion: primary.appVersion || "?",
      platform: primary.platform || "?",
      health: primary.health || {},
      crashCount: list.reduce((n, i) => n + (i.crashCount || 0), 0),
      userCount: users.length,
      usersOnline: users.filter((u) => u.online === "online").length,
      installId: primary.installId,
      consent: primary.consent || null,
      // Extras marque (opaque) — agrégés si présents (ex. CV dossiers).
      dossierStats: primary.dossierStats || null,
    });
  }
  servers.sort((a, b) => {
    const rank = { online: 0, idle: 1, offline: 2 };
    return (rank[a.online] ?? 9) - (rank[b.online] ?? 9) ||
      String(a.slug).localeCompare(String(b.slug));
  });
  // Agrégats génériques : extras dossierStats + répartition versions.
  const dossiers = { total: 0, parEtat: {}, actifs7j: 0 };
  const versions = {};
  for (const s of servers) {
    const v = s.appVersion || "?";
    versions[v] = (versions[v] || 0) + 1;
    const d = s.dossierStats;
    if (d && typeof d === "object") {
      dossiers.total += Number(d.total) || 0;
      dossiers.actifs7j += Number(d.actifs7j) || 0;
      for (const [etat, n] of Object.entries(d.parEtat || {})) {
        dossiers.parEtat[etat] = (dossiers.parEtat[etat] || 0) + (Number(n) || 0);
      }
    }
  }
  return {
    ok: true,
    servers,
    stats: {
      servers: servers.length,
      online: servers.filter((s) => s.online === "online").length,
      users: servers.reduce((n, s) => n + s.userCount, 0),
      crashes: servers.reduce((n, s) => n + s.crashCount, 0),
      dossiers,
      versions,
    },
  };
}

/** Boîte noire : événements ops (bundles kind=ops_events) d'une install. */
function opsEventsFromBundles(bundles, installId, limit = 200) {
  const events = [];
  for (const b of bundles) {
    if (b.installId !== installId || b.kind !== "ops_events") continue;
    for (const e of Array.isArray(b.items) ? b.items : []) {
      events.push({
        ts: e.ts,
        bootId: e.bootId,
        seq: e.seq,
        source: e.source,
        level: e.level,
        kind: e.kind,
        outcome: e.outcome,
        reason: e.reason,
        durationMs: e.durationMs,
        ctx: e.ctx,
      });
    }
  }
  events.sort(
    (a, b) =>
      String(b.ts || "").localeCompare(String(a.ts || "")) ||
      (b.seq || 0) - (a.seq || 0),
  );
  return events.slice(0, limit);
}

export function buildServerDetail(dataDir, slug, opts = {}) {
  const tunnelSuffix = opts.tunnelSuffix || "";
  const installsMap = readJson(path.join(dataDir, "installs.json"), {});
  const bundles = listJsonDir(path.join(dataDir, "bundles"), 120);
  const crashes = listJsonDir(path.join(dataDir, "crashes"), 80);
  const list = installsForSlug(installsMap, slug);
  if (!list.length && slug !== "(sans-slug)") {
    // try exact match without filter quirk
    const all = Object.values(installsMap).filter(
      (i) => String(i.tunnelSlug || "(sans-slug)") === slug,
    );
    list.push(...all);
  }
  if (!list.length) return { ok: false, error: "not_found" };
  list.sort((a, b) =>
    String(b.lastSeen || "").localeCompare(String(a.lastSeen || "")),
  );
  const primary = list[0];
  const users = deriveUsers(primary);
  const conversations = conversationsFromBundles(bundles, primary.installId);
  const activity = activityFrom(primary, bundles, crashes);
  const opsEvents = opsEventsFromBundles(bundles, primary.installId);
  const incidents = crashes
    .filter((c) => c.installId === primary.installId)
    .map((c) => ({
      file: c.file,
      at: c.timestamp,
      kind: c.kind,
      message: String(c?.detail?.message || c.message || "").slice(0, 240),
      bootStage: c.bootStage,
      appVersion: c.appVersion,
    }));

  return {
    ok: true,
    server: {
      slug,
      hostname:
        primary.tunnelHostname ||
        (tunnelSuffix ? `${slug}.${tunnelSuffix}` : slug),
      online: onlineOf(primary.lastSeen),
      lastSeen: primary.lastSeen,
      appVersion: primary.appVersion,
      platform: primary.platform,
      arch: primary.arch,
      osRelease: primary.osRelease,
      machine: primary.hostname,
      health: primary.health || {},
      hermesStats: primary.hermesStats || null,
      consent: primary.consent || null,
      plugins: Array.isArray(primary.plugins) ? primary.plugins : [],
      sessions: Array.isArray(primary.sessions) ? primary.sessions : [],
      installId: primary.installId,
      crashCount: primary.crashCount || 0,
      dossierStats: primary.dossierStats || null,
    },
    users,
    activity,
    conversations,
    incidents,
    // Boîte noire : dernier résumé de boot (heartbeat) + événements détaillés.
    ops: {
      lastBootSummary: primary.lastBootSummary || null,
      events: opsEvents,
    },
  };
}

export function buildUserDetail(dataDir, slug, userId, opts = {}) {
  const detail = buildServerDetail(dataDir, slug, opts);
  if (!detail.ok) return detail;
  const user =
    detail.users.find((u) => u.id === userId) ||
    detail.users.find((u) => u.username === userId) ||
    null;
  if (!user) return { ok: false, error: "user_not_found" };
  // Events de cet user + orphelins (sans userId) si user unique / owner seul.
  const humans = detail.users.filter((u) => u.kind !== "ai");
  const soleHuman = humans.length === 1 ? humans[0] : null;
  const soleOwner =
    user.role === "owner" &&
    humans.filter((u) => u.role === "owner").length === 1
      ? user
      : null;
  const activity = detail.activity.filter((a) => {
    if (a.userId && a.userId === user.id) return true;
    if (a.username && a.username === user.username) return true;
    if (!a.userId && !a.username) {
      if (user.id === "host") return true;
      if (soleHuman && soleHuman.id === user.id) return true;
      if (soleOwner && soleOwner.id === user.id) return true;
    }
    return false;
  });
  const pageStats = {};
  for (const a of activity) {
    if (a.name === "page.hide" && a.path && typeof a.durationMs === "number") {
      if (!pageStats[a.path]) pageStats[a.path] = { path: a.path, views: 0, dwellMs: 0 };
      pageStats[a.path].views += 1;
      pageStats[a.path].dwellMs += a.durationMs;
    }
    if (a.name === "page.view" && a.path) {
      if (!pageStats[a.path]) pageStats[a.path] = { path: a.path, views: 0, dwellMs: 0 };
      pageStats[a.path].views += 1;
    }
  }
  const heatmap = Object.values(pageStats)
    .sort((a, b) => b.dwellMs - a.dwellMs || b.views - a.views)
    .slice(0, 30);

  return {
    ok: true,
    server: detail.server,
    user,
    activity,
    conversations: detail.conversations,
    incidents: detail.incidents,
    heatmap,
    sessions: Array.isArray(detail.server?.sessions)
      ? detail.server.sessions
      : [],
  };
}
