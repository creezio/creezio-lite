/**
 * Store SQLite (core.db) des intégrations — source de vérité.
 * Secrets chiffrés au repos (secret-box), jamais exposés dans les listings.
 */
import crypto from "node:crypto";
import {
  openNodeSqliteDatabase,
  type OpenSqliteDatabase,
  type SqliteDatabase,
} from "@creezio/auth";
import { INTEGRATIONS_CORE_SQL } from "./schema.js";
import {
  integrationSecretHint,
  openIntegrationSecret,
  sealIntegrationSecret,
} from "./secret-box.js";
import {
  formatIntegrationReference,
  isValidIntegrationSlug,
  slugifyIntegrationName,
} from "./reference.js";
import { getIntegrationProvider } from "./providers.js";

export type IntegrationPublic = {
  id: string;
  slug: string;
  reference: string;
  provider: string;
  label: string;
  secretHint: string;
  /** false si AUTH_SECRET a changé — re-saisie requise. */
  readable: boolean;
  meta: Record<string, unknown>;
  n8nCredentialId: string | null;
  n8nSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationResolved = {
  id: string;
  slug: string;
  reference: string;
  provider: string;
  label: string;
  secret: string;
  meta: Record<string, unknown>;
};

type Row = {
  id: string;
  slug: string;
  provider: string;
  label: string;
  secret_enc: string;
  secret_hint: string;
  meta: string;
  n8n_credential_id: string | null;
  n8n_synced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SqliteIntegrationsStore = {
  list: () => IntegrationPublic[];
  getById: (id: string) => IntegrationPublic | null;
  getBySlug: (slug: string) => IntegrationPublic | null;
  create: (input: {
    provider: string;
    label: string;
    secret: string;
    slug?: string;
    meta?: Record<string, unknown>;
    createdBy?: string | null;
  }) => IntegrationPublic;
  update: (
    id: string,
    patch: {
      label?: string;
      secret?: string;
      meta?: Record<string, unknown>;
    },
  ) => IntegrationPublic;
  remove: (id: string) => { n8nCredentialId: string | null };
  /** Résolution par slug — valeur en clair (contrôle d'accès en amont). */
  resolveBySlug: (slug: string) => IntegrationResolved | null;
  setN8nSync: (id: string, n8nCredentialId: string | null) => void;
  close: () => void;
};

function now(): string {
  return new Date().toISOString();
}

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toPublic(row: Row): IntegrationPublic {
  return {
    id: row.id,
    slug: row.slug,
    reference: formatIntegrationReference(row.slug),
    provider: row.provider,
    label: row.label,
    secretHint: row.secret_hint,
    readable: openIntegrationSecret(row.secret_enc) !== null,
    meta: parseMeta(row.meta),
    n8nCredentialId: row.n8n_credential_id,
    n8nSyncedAt: row.n8n_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSqliteIntegrationsStore(opts: {
  coreDbPath: string;
  openDatabase?: OpenSqliteDatabase;
}): SqliteIntegrationsStore {
  const open = opts.openDatabase || openNodeSqliteDatabase;
  const db: SqliteDatabase = open(opts.coreDbPath);
  db.exec(INTEGRATIONS_CORE_SQL);

  const rowById = (id: string): Row | null =>
    (db
      .prepare(`SELECT * FROM creezio_integrations WHERE id = ?`)
      .get(id) as Row | undefined) || null;

  const rowBySlug = (slug: string): Row | null =>
    (db
      .prepare(`SELECT * FROM creezio_integrations WHERE slug = ?`)
      .get(slug) as Row | undefined) || null;

  return {
    list: () =>
      (
        db
          .prepare(
            `SELECT * FROM creezio_integrations ORDER BY created_at ASC`,
          )
          .all() as Row[]
      ).map(toPublic),

    getById: (id) => {
      const row = rowById(id);
      return row ? toPublic(row) : null;
    },

    getBySlug: (slug) => {
      const row = rowBySlug(slug);
      return row ? toPublic(row) : null;
    },

    create: (input) => {
      const provider = getIntegrationProvider(input.provider);
      if (!provider) {
        throw new Error(`provider inconnu: ${input.provider}`);
      }
      const label = input.label.trim();
      if (!label) throw new Error("label requis");
      const secret = input.secret.trim();
      if (!secret) throw new Error("secret requis");
      const slug =
        (input.slug || "").trim() ||
        slugifyIntegrationName(
          provider.id === "custom" ? label : provider.id,
        );
      if (!isValidIntegrationSlug(slug)) {
        throw new Error(`slug invalide: ${slug || "(vide)"}`);
      }
      if (rowBySlug(slug)) {
        throw new Error(`slug déjà utilisé: ${slug}`);
      }
      const id = crypto.randomUUID();
      const ts = now();
      db.prepare(
        `INSERT INTO creezio_integrations
           (id, slug, provider, label, secret_enc, secret_hint, meta,
            created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        slug,
        provider.id,
        label,
        sealIntegrationSecret(secret),
        integrationSecretHint(secret),
        JSON.stringify(input.meta || {}),
        input.createdBy ?? null,
        ts,
        ts,
      );
      return toPublic(rowById(id)!);
    },

    update: (id, patch) => {
      const row = rowById(id);
      if (!row) throw new Error("intégration introuvable");
      const label =
        typeof patch.label === "string" && patch.label.trim()
          ? patch.label.trim()
          : row.label;
      const meta =
        patch.meta !== undefined ? JSON.stringify(patch.meta) : row.meta;
      let secretEnc = row.secret_enc;
      let secretHint = row.secret_hint;
      if (typeof patch.secret === "string" && patch.secret.trim()) {
        const secret = patch.secret.trim();
        secretEnc = sealIntegrationSecret(secret);
        secretHint = integrationSecretHint(secret);
      }
      db.prepare(
        `UPDATE creezio_integrations
            SET label = ?, meta = ?, secret_enc = ?, secret_hint = ?,
                updated_at = ?
          WHERE id = ?`,
      ).run(label, meta, secretEnc, secretHint, now(), id);
      return toPublic(rowById(id)!);
    },

    remove: (id) => {
      const row = rowById(id);
      if (!row) throw new Error("intégration introuvable");
      db.prepare(`DELETE FROM creezio_integrations WHERE id = ?`).run(id);
      return { n8nCredentialId: row.n8n_credential_id };
    },

    resolveBySlug: (slug) => {
      const row = rowBySlug(slug);
      if (!row) return null;
      const secret = openIntegrationSecret(row.secret_enc);
      if (secret === null) return null;
      return {
        id: row.id,
        slug: row.slug,
        reference: formatIntegrationReference(row.slug),
        provider: row.provider,
        label: row.label,
        secret,
        meta: parseMeta(row.meta),
      };
    },

    setN8nSync: (id, n8nCredentialId) => {
      db.prepare(
        `UPDATE creezio_integrations
            SET n8n_credential_id = ?, n8n_synced_at = ?
          WHERE id = ?`,
      ).run(n8nCredentialId, n8nCredentialId ? now() : null, id);
    },

    close: () => {
      db.close?.();
    },
  };
}
