/**
 * Échantillons télémétrie flotte (best-effort, lecture seule, redactée).
 * Pas de better-sqlite3 dans le process Electron (ABI) — spawn Node vanilla.
 * Samples diagnostics (M7) — chemins = hooks marque.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type FleetSamplesPaths = {
  assistantDbPath: () => string;
  dbPath: () => string;
  hermesHomeDir: () => string;
  nodeBinary: () => string;
  /** NODE_PATH pour scripts spawn (better-sqlite3). */
  nodeModulesPathForScripts: () => string | undefined;
  userDataDir: () => string;
};

export type FleetSamples = {
  sampleAssistantChats: (limit?: number) => Array<Record<string, unknown>>;
  sampleHermesChats: (limit?: number) => Array<Record<string, unknown>>;
  sampleUsers: () => Array<{
    id: string;
    username: string;
    role: string;
    kind: string;
    active: boolean;
  }>;
  sampleSessions: () => Array<{
    userId: string;
    username?: string;
    lastSeen?: string;
  }>;
  sampleRequestLogs: (limit?: number) => Array<Record<string, unknown>>;
};

function redactText(s: string, max = 800): string {
  return String(s || "")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***")
    .replace(/sk-[A-Za-z0-9]{10,}/g, "sk-***")
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^\s"']+/gi, "api_key=***")
    .slice(0, max);
}

function walkRecent(dir: string, out: string[], max: number, depth = 0): void {
  if (out.length >= max || depth > 3) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= max) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      walkRecent(full, out, max, depth + 1);
    } else if (/\.(json|jsonl|md|txt)$/i.test(e.name)) {
      out.push(full);
    }
  }
}

export function createFleetSamples(paths: FleetSamplesPaths): FleetSamples {
  function sampleAssistantChats(limit = 30): Array<Record<string, unknown>> {
    const dbFile = paths.assistantDbPath();
    if (!fs.existsSync(dbFile)) return [];
    const script = `
const Database = require("better-sqlite3");
const db = new Database(process.env.CREEZIO_ASSISTANT_DB, { readonly: true, fileMustExist: true });
const rows = db.prepare(\`
  SELECT m.id, m.conversation_id, m.role, m.content, m.created_at, c.title
  FROM messages m
  LEFT JOIN conversations c ON c.id = m.conversation_id
  ORDER BY m.created_at DESC
  LIMIT ?
\`).all(Number(process.env.CREEZIO_SAMPLE_LIMIT || 30));
db.close();
process.stdout.write(JSON.stringify(rows));
`;
    try {
      const r = spawnSync(paths.nodeBinary(), ["-e", script], {
        env: {
          ...process.env,
          CREEZIO_ASSISTANT_DB: dbFile,
          CREEZIO_SAMPLE_LIMIT: String(limit),
          NODE_PATH: paths.nodeModulesPathForScripts(),
        },
        encoding: "utf8",
        timeout: 8_000,
        maxBuffer: 2 * 1024 * 1024,
      });
      if (r.status !== 0 || !r.stdout) return [];
      const rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        role: row.role,
        content: redactText(String(row.content || "")),
        createdAt: row.created_at,
      }));
    } catch {
      return [];
    }
  }

  function sampleHermesChats(limit = 20): Array<Record<string, unknown>> {
    const home = paths.hermesHomeDir();
    const candidates = [
      path.join(home, "sessions"),
      path.join(home, "workspace"),
      path.join(home, ".hermes"),
    ];
    const files: string[] = [];
    for (const dir of candidates) {
      try {
        if (!fs.existsSync(dir)) continue;
        walkRecent(dir, files, 40);
      } catch {
        /* ignore */
      }
    }
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return files.slice(0, limit).map((f) => {
      let preview = "";
      try {
        preview = redactText(fs.readFileSync(f, "utf8"), 600);
      } catch {
        preview = "";
      }
      return {
        path: path.relative(home, f).slice(0, 200),
        mtime: fs.statSync(f).mtime.toISOString(),
        preview,
      };
    });
  }

  function sampleUsers(): Array<{
    id: string;
    username: string;
    role: string;
    kind: string;
    active: boolean;
  }> {
    const db = paths.dbPath();
    if (!fs.existsSync(db)) return [];
    const script = `
const Database = require("better-sqlite3");
const db = new Database(process.env.CREEZIO_DB, { readonly: true, fileMustExist: true });
const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
if (!has) { db.close(); process.stdout.write("[]"); process.exit(0); }
const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
const kindSel = cols.includes("kind") ? "kind" : "'human' AS kind";
const rows = db.prepare(\`SELECT id, username, role, \${kindSel}, active FROM users ORDER BY role, username COLLATE NOCASE\`).all();
db.close();
process.stdout.write(JSON.stringify(rows));
`;
    try {
      const r = spawnSync(paths.nodeBinary(), ["-e", script], {
        env: {
          ...process.env,
          CREEZIO_DB: db,
          NODE_PATH: paths.nodeModulesPathForScripts(),
        },
        encoding: "utf8",
        timeout: 8_000,
        maxBuffer: 1024 * 1024,
      });
      if (r.status !== 0 || !r.stdout) return [];
      const rows = JSON.parse(r.stdout) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: String(row.id || ""),
        username: String(row.username || ""),
        role: String(row.role || "collaborator"),
        kind: String(row.kind || "human"),
        active: Number(row.active) === 1,
      }));
    } catch {
      return [];
    }
  }

  function sampleSessions(): Array<{
    userId: string;
    username?: string;
    lastSeen?: string;
  }> {
    const file = path.join(paths.userDataDir(), "fleet-state", "sessions.json");
    try {
      if (!fs.existsSync(file)) return [];
      const map = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
        string,
        { userId?: string; username?: string; lastSeen?: string }
      >;
      return Object.values(map).map((s) => ({
        userId: String(s.userId || ""),
        username: s.username ? String(s.username) : undefined,
        lastSeen: s.lastSeen ? String(s.lastSeen) : undefined,
      }));
    } catch {
      return [];
    }
  }

  function sampleRequestLogs(limit = 40): Array<Record<string, unknown>> {
    const root = paths.userDataDir();
    const candidates = [
      path.join(root, "fleet-state", "request-logs.jsonl"),
      path.join(root, "logs", "request-logs.jsonl"),
      path.join(root, "request-logs.jsonl"),
    ];
    for (const file of candidates) {
      try {
        if (!fs.existsSync(file)) continue;
        const lines = fs
          .readFileSync(file, "utf8")
          .trim()
          .split("\n")
          .slice(-limit);
        return lines.map((line) => {
          try {
            const j = JSON.parse(line) as Record<string, unknown>;
            return {
              at: j.at || j.timestamp,
              method: j.method,
              path: j.path || j.url,
              status: j.status,
              summary: redactText(JSON.stringify(j), 400),
            };
          } catch {
            return { summary: redactText(line, 200) };
          }
        });
      } catch {
        /* next */
      }
    }
    return [];
  }

  return {
    sampleAssistantChats,
    sampleHermesChats,
    sampleUsers,
    sampleSessions,
    sampleRequestLogs,
  };
}
