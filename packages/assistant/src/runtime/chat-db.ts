import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import fs from "fs";
import path from "path";
import crypto, { randomUUID } from "crypto";
import {
  parseAssistantMode,
  type AssistantMode,
} from "./modes.js";
import { defaultModel, resolveModel } from "./models.js";
import {
  getKitAssistantStore as getKitStoreFromEnv,
} from "../env-store.js";

/** Lazy path — smokes CJS isolés peuvent manquer vendor @creezio. */
function resolveCoreDbPathFromEnv(): string | null {
  try {
    // eslint-disable-next-line
    const mod = require("@creezio/platform-core") as {
      resolveCoreDbPathFromEnv: () => string | null;
    };
    return mod.resolveCoreDbPathFromEnv();
  } catch {
    const explicit = (process.env.CREEZIO_CORE_DB_PATH || "").trim();
    if (explicit) return explicit;
    const brandDb = (process.env.DB_PATH || "").trim();
    if (brandDb) {
      return path.join(path.dirname(brandDb), "sqlite", "core.db");
    }
    if (fs.existsSync("/data")) {
      return path.join("/data", "sqlite", "core.db");
    }
    return null;
  }
}

type KitStore = {
  listConversations: (userId?: string | null) => Array<{
    id: string;
    title: string;
    model?: string;
    mode?: string;
    userId?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  getConversation: (id: string) =>
    | {
        id: string;
        title: string;
        model?: string;
        mode?: string;
        userId?: string | null;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  createConversation: (input: Record<string, unknown>) => {
    id: string;
    title: string;
    model?: string;
    mode?: string;
    userId?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  updateConversationMeta: (
    id: string,
    patch: Record<string, unknown>,
  ) => unknown;
  deleteConversation: (id: string) => boolean;
  appendMessage: (
    conversationId: string,
    input: Record<string, unknown>,
  ) => {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    sourcesJson?: string | null;
    createdAt: string;
  };
  listMessages: (conversationId: string) => Array<{
    id: string;
    conversationId: string;
    role: string;
    content: string;
    sourcesJson?: string | null;
    createdAt: string;
  }>;
};

/** Lazy — évite de casser les smokes CJS isolés sans vendor @creezio. */
function getKitAssistantStore(): KitStore | null {
  try {
    return getKitStoreFromEnv() as unknown as KitStore | null;
  } catch {
    return null;
  }
}

/** C1 — SoT kit quand core.db + adapter dispo ; sinon legacy assistant_chats.db. */
function kitAssistantEnabled(): boolean {
  if (!resolveCoreDbPathFromEnv()) return false;
  try {
    return Boolean(getKitAssistantStore());
  } catch {
    return false;
  }
}

function kitConvToRow(c: {
  id: string;
  title: string;
  model?: string;
  mode?: string;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
}): ConversationRow {
  return {
    id: c.id,
    title: c.title,
    model: c.model || defaultModel(),
    mode: parseAssistantMode(c.mode, "chat"),
    user_id: c.userId ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

/** Migrate one-shot legacy → kit (ids conservés). */
function migrateLegacyAssistantToKitOnce(): void {
  const store = getKitAssistantStore();
  if (!store) return;
  if (store.listConversations().length > 0) return;
  const legacyPath = getAssistantDbPath();
  if (!fs.existsSync(legacyPath)) return;
  try {
    const legacy = new Database(legacyPath, { readonly: true });
    try {
      const convs = legacy
        .prepare(
          `SELECT id, title, model, mode, user_id, created_at, updated_at
           FROM conversations`,
        )
        .all() as Record<string, unknown>[];
      for (const row of convs) {
        store.createConversation({
          id: String(row.id),
          title: String(row.title || "Nouvelle conversation"),
          model: String(row.model || defaultModel()),
          mode: String(row.mode || "chat"),
          userId: row.user_id == null ? null : String(row.user_id),
        });
        const msgs = legacy
          .prepare(
            `SELECT id, role, content, sources_json, created_at
             FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
          )
          .all(String(row.id)) as Record<string, unknown>[];
        for (const m of msgs) {
          store.appendMessage(String(row.id), {
            id: String(m.id),
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content || ""),
            sourcesJson:
              m.sources_json == null ? null : String(m.sources_json),
          });
        }
      }
    } finally {
      legacy.close();
    }
  } catch {
    /* migrate best-effort */
  }
}

export type ConversationRow = {
  id: string;
  title: string;
  model: string;
  mode: AssistantMode;
  /**
   * Propriétaire (users.id du CRM). NULL = conversation d'avant le scoping
   * multi-utilisateur — adoptée par l'owner au premier listing
   * (adoptOrphanConversations).
   */
  user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  sources_json: string | null;
  created_at: string;
};

export type Source = { title: string; url: string; type?: string };

let chatDb: SqliteDatabase | null = null;

export function getAssistantDbPath() {
  if (process.env.ASSISTANT_DB_PATH) return process.env.ASSISTANT_DB_PATH;
  if (fs.existsSync("/data")) return "/data/assistant_chats.db";
  return path.resolve(process.cwd(), "../data/assistant_chats.db");
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function migrate(db: SqliteDatabase) {
  const cols = db.prepare(`PRAGMA table_info(conversations)`).all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("model")) {
    const def = defaultModel().replace(/'/g, "''");
    db.exec(`ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT '${def}'`);
  }
  if (!names.has("mode")) {
    db.exec(
      `ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'`,
    );
  }
  if (!names.has("user_id")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN user_id TEXT`);
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_conversations_user
         ON conversations(user_id, updated_at DESC)`,
    );
  }
}

export function getAssistantDb(): SqliteDatabase {
  if (chatDb) return chatDb;
  const dbPath = getAssistantDbPath();
  ensureDir(dbPath);
  chatDb = new Database(dbPath);
  chatDb.pragma("journal_mode = WAL");
  chatDb.pragma("foreign_keys = ON");
  chatDb.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Nouvelle conversation',
      model TEXT NOT NULL DEFAULT 'o4-mini',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      sources_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated
      ON conversations(updated_at DESC);
    CREATE TABLE IF NOT EXISTS agent_profiles (
      user_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'company' CHECK (kind IN ('company', 'personal')),
      api_url TEXT,
      api_key TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  migrate(chatDb);
  return chatDb;
}

function nowIso() {
  return new Date().toISOString();
}

export function titleFromMessage(content: string) {
  const t = content.replace(/\s+/g, " ").trim();
  if (!t) return "Nouvelle conversation";
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

function mapConversation(row: Record<string, unknown> | undefined): ConversationRow | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    title: String(row.title),
    model: String(row.model),
    mode: parseAssistantMode(row.mode, "chat"),
    user_id: row.user_id == null ? null : String(row.user_id),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

/**
 * Liste scoppée par utilisateur. `userId` obligatoire : chaque collaborateur
 * ne voit que SES conversations (vision multi-agents D1).
 */
export function listConversations(limit = 50, userId?: string | null): ConversationRow[] {
  const capped = Math.min(Math.max(limit, 1), 200);
  if (kitAssistantEnabled()) {
    migrateLegacyAssistantToKitOnce();
    const store = getKitAssistantStore()!;
    let list = store.listConversations(userId || undefined).map(kitConvToRow);
    if (userId) list = list.filter((c) => c.user_id === userId);
    return list.slice(0, capped);
  }
  const db = getAssistantDb();
  const rows = (
    userId
      ? db
          .prepare(
            `SELECT id, title, model, mode, user_id, created_at, updated_at
             FROM conversations
             WHERE user_id = ?
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(userId, capped)
      : db
          .prepare(
            `SELECT id, title, model, mode, user_id, created_at, updated_at
             FROM conversations
             ORDER BY updated_at DESC
             LIMIT ?`,
          )
          .all(capped)
  ) as Record<string, unknown>[];
  return rows.map((r) => mapConversation(r)!);
}

export function getConversation(id: string): ConversationRow | undefined {
  if (kitAssistantEnabled()) {
    migrateLegacyAssistantToKitOnce();
    const c = getKitAssistantStore()!.getConversation(id);
    return c ? kitConvToRow(c) : undefined;
  }
  const row = getAssistantDb()
    .prepare(
      `SELECT id, title, model, mode, user_id, created_at, updated_at FROM conversations WHERE id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return mapConversation(row);
}

/**
 * Adoption des conversations orphelines (user_id NULL, historique
 * pré-multi-user) par l'owner. Idempotent — appelé au listing owner.
 */
export function adoptOrphanConversations(ownerId: string): number {
  if (!ownerId) return 0;
  if (kitAssistantEnabled()) {
    migrateLegacyAssistantToKitOnce();
    const store = getKitAssistantStore()!;
    let n = 0;
    for (const c of store.listConversations()) {
      if (c.userId == null) {
        store.updateConversationMeta(c.id, { userId: ownerId });
        n += 1;
      }
    }
    return n;
  }
  const r = getAssistantDb()
    .prepare(`UPDATE conversations SET user_id = ? WHERE user_id IS NULL`)
    .run(ownerId);
  return r.changes;
}

/** Contrôle d'accès : propriétaire strict, l'owner récupère les orphelines. */
export function canAccessConversation(
  conv: Pick<ConversationRow, "user_id"> | undefined,
  userId: string | null | undefined,
  role?: string | null,
): boolean {
  if (!conv) return false;
  if (conv.user_id == null) return role === "owner";
  return Boolean(userId) && conv.user_id === userId;
}

export function createConversation(opts?: {
  title?: string;
  model?: string;
  mode?: AssistantMode;
  userId?: string | null;
}): ConversationRow {
  const mode = parseAssistantMode(opts?.mode, "chat");
  const model = resolveModel(opts?.model);
  const title = opts?.title?.trim() || "Nouvelle conversation";
  const userId = opts?.userId || null;

  if (kitAssistantEnabled()) {
    migrateLegacyAssistantToKitOnce();
    const c = getKitAssistantStore()!.createConversation({
      title,
      model,
      mode,
      userId,
    });
    return kitConvToRow(c);
  }

  const db = getAssistantDb();
  const id = randomUUID();
  const ts = nowIso();
  const row: ConversationRow = {
    id,
    title,
    model,
    mode,
    user_id: userId,
    created_at: ts,
    updated_at: ts,
  };
  db.prepare(
    `INSERT INTO conversations (id, title, model, mode, user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.title,
    row.model,
    row.mode,
    row.user_id,
    row.created_at,
    row.updated_at,
  );
  return row;
}

export function updateConversationModel(id: string, model: string): ConversationRow | undefined {
  const existing = getConversation(id);
  if (!existing) return undefined;
  const resolved = resolveModel(model);
  if (kitAssistantEnabled()) {
    getKitAssistantStore()!.updateConversationMeta(id, { model: resolved });
    return getConversation(id);
  }
  const db = getAssistantDb();
  const ts = nowIso();
  db.prepare(`UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?`).run(
    resolved,
    ts,
    id,
  );
  return getConversation(id);
}

export function deleteConversation(id: string): boolean {
  if (kitAssistantEnabled()) {
    return getKitAssistantStore()!.deleteConversation(id);
  }
  const db = getAssistantDb();
  const result = db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function listMessages(conversationId: string): MessageRow[] {
  if (kitAssistantEnabled()) {
    return getKitAssistantStore()!
      .listMessages(conversationId)
      .map((m) => ({
        id: m.id,
        conversation_id: m.conversationId,
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
        sources_json: m.sourcesJson ?? null,
        created_at: m.createdAt,
      }));
  }
  return getAssistantDb()
    .prepare(
      `SELECT id, conversation_id, role, content, sources_json, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC`,
    )
    .all(conversationId) as MessageRow[];
}

export function addMessage(opts: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}): MessageRow {
  const conv = getConversation(opts.conversationId);
  if (!conv) throw new Error("Conversation introuvable");

  const id = randomUUID();
  const ts = nowIso();
  const sourcesJson =
    opts.sources && opts.sources.length > 0 ? JSON.stringify(opts.sources) : null;

  if (kitAssistantEnabled()) {
    const store = getKitAssistantStore()!;
    if (opts.role === "user" && conv.title === "Nouvelle conversation") {
      store.updateConversationMeta(opts.conversationId, {
        title: titleFromMessage(opts.content),
      });
    }
    const msg = store.appendMessage(opts.conversationId, {
      id,
      role: opts.role,
      content: opts.content,
      sourcesJson,
    });
    return {
      id: msg.id,
      conversation_id: msg.conversationId,
      role: opts.role,
      content: msg.content,
      sources_json: msg.sourcesJson ?? null,
      created_at: msg.createdAt,
    };
  }

  const db = getAssistantDb();
  const row: MessageRow = {
    id,
    conversation_id: opts.conversationId,
    role: opts.role,
    content: opts.content,
    sources_json: sourcesJson,
    created_at: ts,
  };

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, sources_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(row.id, row.conversation_id, row.role, row.content, row.sources_json, row.created_at);

    if (opts.role === "user" && conv.title === "Nouvelle conversation") {
      db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`).run(
        titleFromMessage(opts.content),
        ts,
        opts.conversationId,
      );
    } else {
      db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
        ts,
        opts.conversationId,
      );
    }
  });
  tx();

  return row;
}

export function ensureConversation(
  conversationId?: string | null,
  firstUserMessage?: string,
  model?: string | null,
  mode?: AssistantMode | null,
  userId?: string | null,
) {
  if (conversationId) {
    const existing = getConversation(conversationId);
    if (existing) return existing;
  }
  return createConversation({
    title: firstUserMessage ? titleFromMessage(firstUserMessage) : undefined,
    model: model || undefined,
    mode: parseAssistantMode(mode, "chat"),
    userId: userId || null,
  });
}

/* ── Profils d'agents (D3) ─────────────────────────────────────────────
 * `company` (défaut) : Hermes embarqué de l'app Serveur, skills skills-*.
 * `personal` : endpoint Hermes propre à l'utilisateur (URL + clé API),
 * utilisé par le mode Work à la place du moteur entreprise. */

/* La clé API personnelle est chiffrée au repos (AES-256-GCM, clé dérivée
 * d'AUTH_SECRET). Si AUTH_SECRET change, le déchiffrement échoue → la clé
 * est considérée absente et l'utilisateur la ressaisit. */
const SECRET_PREFIX = "enc:v1:";

function secretBoxKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  return crypto.createHash("sha256").update(`tf2-agent-profile:${secret}`).digest();
}

function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretBoxKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(SECRET_PREFIX)) return null;
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(SECRET_PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secretBoxKey(),
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export type AgentProfileRow = {
  user_id: string;
  kind: "company" | "personal";
  api_url: string | null;
  api_key: string | null;
  updated_at: string;
};

export function getAgentProfile(userId: string): AgentProfileRow | undefined {
  const db = getAssistantDb();
  const row = db
    .prepare(
      `SELECT user_id, kind, api_url, api_key, updated_at
       FROM agent_profiles WHERE user_id = ?`,
    )
    .get(userId) as AgentProfileRow | undefined;
  if (!row) return undefined;
  return {
    ...row,
    api_key: row.api_key == null ? null : decryptSecret(row.api_key),
  };
}

export function setAgentProfile(
  userId: string,
  opts: {
    kind: "company" | "personal";
    apiUrl?: string | null;
    /** undefined = conserver la clé existante ; "" ou null = effacer. */
    apiKey?: string | null;
  },
): AgentProfileRow {
  const db = getAssistantDb();
  const existing = getAgentProfile(userId);
  const apiUrl =
    opts.apiUrl !== undefined
      ? (opts.apiUrl || "").trim() || null
      : (existing?.api_url ?? null);
  const apiKey =
    opts.apiKey !== undefined
      ? (opts.apiKey || "").trim() || null
      : (existing?.api_key ?? null);
  db.prepare(
    `INSERT INTO agent_profiles (user_id, kind, api_url, api_key, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       kind = excluded.kind,
       api_url = excluded.api_url,
       api_key = excluded.api_key,
       updated_at = excluded.updated_at`,
  ).run(userId, opts.kind, apiUrl, apiKey == null ? null : encryptSecret(apiKey), nowIso());
  return getAgentProfile(userId)!;
}

export function parseSources(sourcesJson: string | null): Source[] {
  if (!sourcesJson) return [];
  try {
    const parsed = JSON.parse(sourcesJson) as Source[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
