/**
 * Store assistant persisté dans sqlite **core** (Phase I2 + C1 rich).
 */

import crypto from "node:crypto";
import { ASSISTANT_CORE_SQL, ensureAssistantRichColumnsSql } from "./schema.js";
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantRole,
  AssistantStore,
} from "./types.js";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "./sqlite-driver.js";

function now(): string {
  return new Date().toISOString();
}

export type SqliteAssistantStore = AssistantStore & {
  close(): void;
  readonly dbPath: string;
  /** Accès bas niveau pour migrations marques (C1). */
  readonly db: SqliteDatabase;
  updateConversationMeta(
    id: string,
    patch: Partial<{
      title: string;
      model: string;
      mode: string;
      userId: string | null;
    }>,
  ): AssistantConversation | undefined;
  deleteConversation(id: string): boolean;
};

export type CreateSqliteAssistantStoreOptions = {
  /** Chemin sqlite core (recommandé). */
  coreDbPath: string;
  openDatabase?: OpenSqliteDatabase;
};

type ConvRow = {
  id: string;
  title: string;
  model?: string;
  mode?: string;
  user_id?: string | null;
  created_at: string;
  updated_at: string;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  sources_json?: string | null;
  created_at: string;
};

function convFrom(r: ConvRow): AssistantConversation {
  return {
    id: r.id,
    title: r.title,
    model: r.model || "",
    mode: r.mode || "chat",
    userId: r.user_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function msgFrom(r: MsgRow): AssistantMessage {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role as AssistantRole,
    content: r.content,
    sourcesJson: r.sources_json ?? null,
    createdAt: r.created_at,
  };
}

function ensureRichColumns(db: SqliteDatabase): void {
  for (const sql of ensureAssistantRichColumnsSql()) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
}

export function createSqliteAssistantStore(
  opts: CreateSqliteAssistantStoreOptions,
): SqliteAssistantStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(ASSISTANT_CORE_SQL);
  ensureRichColumns(db);

  const store: SqliteAssistantStore = {
    dbPath: opts.coreDbPath,
    db,

    close() {
      db.close?.();
    },

    createConversation(input) {
      const ts = now();
      const c: AssistantConversation = {
        id: input?.id || crypto.randomUUID(),
        title: (input?.title || "Nouvelle conversation").trim(),
        model: input?.model || "",
        mode: input?.mode || "chat",
        userId: input?.userId ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      db.prepare(
        `INSERT INTO creezio_assistant_conversations
        (id, title, model, mode, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        c.id,
        c.title,
        c.model,
        c.mode,
        c.userId,
        c.createdAt,
        c.updatedAt,
      );
      return c;
    },

    listConversations(userId) {
      if (userId) {
        const rows = db
          .prepare(
            `SELECT * FROM creezio_assistant_conversations
             WHERE user_id = ? OR user_id IS NULL
             ORDER BY updated_at DESC`,
          )
          .all(userId) as ConvRow[];
        return rows.map(convFrom);
      }
      const rows = db
        .prepare(
          `SELECT * FROM creezio_assistant_conversations
           ORDER BY updated_at DESC`,
        )
        .all() as ConvRow[];
      return rows.map(convFrom);
    },

    getConversation(id) {
      const row = db
        .prepare(`SELECT * FROM creezio_assistant_conversations WHERE id = ?`)
        .get(id) as ConvRow | undefined;
      return row ? convFrom(row) : undefined;
    },

    updateConversationMeta(id, patch) {
      const existing = store.getConversation(id);
      if (!existing) return undefined;
      const next = {
        title: patch.title ?? existing.title,
        model: patch.model ?? existing.model ?? "",
        mode: patch.mode ?? existing.mode ?? "chat",
        userId:
          patch.userId !== undefined ? patch.userId : (existing.userId ?? null),
        updatedAt: now(),
      };
      db.prepare(
        `UPDATE creezio_assistant_conversations
         SET title = ?, model = ?, mode = ?, user_id = ?, updated_at = ?
         WHERE id = ?`,
      ).run(next.title, next.model, next.mode, next.userId, next.updatedAt, id);
      return store.getConversation(id);
    },

    deleteConversation(id) {
      const r = db
        .prepare(`DELETE FROM creezio_assistant_conversations WHERE id = ?`)
        .run(id) as { changes?: number };
      return Number(r?.changes || 0) > 0;
    },

    appendMessage(conversationId, input) {
      const c = store.getConversation(conversationId);
      if (!c) throw new Error("conversation_not_found");
      const msg: AssistantMessage = {
        id: input.id || crypto.randomUUID(),
        conversationId,
        role: input.role,
        content: input.content,
        sourcesJson: input.sourcesJson ?? null,
        createdAt: now(),
      };
      db.prepare(
        `INSERT INTO creezio_assistant_messages
        (id, conversation_id, role, content, sources_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        msg.id,
        msg.conversationId,
        msg.role,
        msg.content,
        msg.sourcesJson,
        msg.createdAt,
      );
      db.prepare(
        `UPDATE creezio_assistant_conversations SET updated_at = ? WHERE id = ?`,
      ).run(msg.createdAt, conversationId);
      return msg;
    },

    listMessages(conversationId) {
      const rows = db
        .prepare(
          `SELECT * FROM creezio_assistant_messages
           WHERE conversation_id = ?
           ORDER BY created_at ASC`,
        )
        .all(conversationId) as MsgRow[];
      return rows.map(msgFrom);
    },
  };

  return store;
}
