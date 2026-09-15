/**
 * Migration one-shot tables marque `emails` / `email_attachments` → kit SoT.
 * Idempotent via message_id / brand_email_id.
 */

import type { SqliteDatabase } from "./sqlite-driver.js";
import { ensureMailsInboxSchema, insertInboundEmail } from "./inbox-queries.js";

export type MigrateBrandEmailsResult = {
  migrated: number;
  skipped: number;
  errors: string[];
};

/**
 * Lit `emails` + `email_attachments` sur `brandDb` et écrit dans `kitDb` (core).
 */
export function migrateBrandEmailsToKit(
  brandDb: SqliteDatabase,
  kitDb: SqliteDatabase,
): MigrateBrandEmailsResult {
  ensureMailsInboxSchema(kitDb);
  const result: MigrateBrandEmailsResult = {
    migrated: 0,
    skipped: 0,
    errors: [],
  };

  let emails: Array<{
    id: number;
    message_id: string | null;
    from_addr: string;
    to_addr: string;
    subject: string;
    text_body: string | null;
    html_body: string | null;
    received_at: string;
    read_at: string | null;
    folder: string;
    raw_headers: string | null;
  }>;
  try {
    emails = brandDb
      .prepare(
        `SELECT id, message_id, from_addr, to_addr, subject, text_body, html_body,
                received_at, read_at, folder, raw_headers
         FROM emails ORDER BY id`,
      )
      .all() as typeof emails;
  } catch (e) {
    result.errors.push(
      e instanceof Error ? e.message : "table emails introuvable",
    );
    return result;
  }

  for (const row of emails) {
    try {
      if (row.message_id) {
        const existing = kitDb
          .prepare(
            `SELECT id FROM creezio_platform_mails WHERE message_id = ? LIMIT 1`,
          )
          .get(row.message_id) as { id: string } | undefined;
        if (existing) {
          result.skipped += 1;
          continue;
        }
      }
      const byBrand = kitDb
        .prepare(
          `SELECT id FROM creezio_platform_mails WHERE brand_email_id = ? LIMIT 1`,
        )
        .get(String(row.id)) as { id: string } | undefined;
      if (byBrand) {
        result.skipped += 1;
        continue;
      }

      let headers: Record<string, string> | null = null;
      if (row.raw_headers) {
        try {
          headers = JSON.parse(row.raw_headers) as Record<string, string>;
        } catch {
          headers = null;
        }
      }

      const atts = brandDb
        .prepare(
          `SELECT filename, content_type, data FROM email_attachments WHERE email_id = ?`,
        )
        .all(row.id) as Array<{
        filename: string;
        content_type: string;
        data: Buffer | Uint8Array;
      }>;

      const attachments = atts.map((a) => {
        const buf = Buffer.isBuffer(a.data)
          ? a.data
          : Buffer.from(a.data as Uint8Array);
        return {
          filename: a.filename,
          content_type: a.content_type,
          content_base64: buf.toString("base64"),
        };
      });

      const inserted = insertInboundEmail(kitDb, {
        message_id: row.message_id,
        from: row.from_addr,
        to: row.to_addr,
        subject: row.subject,
        text: row.text_body,
        html: row.html_body,
        received_at: row.received_at,
        headers,
        attachments,
        userId: "system",
      });
      if (!inserted.ok) {
        result.errors.push(`email#${row.id}: ${inserted.error}`);
        continue;
      }
      if (inserted.duplicate) {
        result.skipped += 1;
        continue;
      }
      kitDb
        .prepare(
          `UPDATE creezio_platform_mails
           SET brand_email_id = ?, read_at = ?, folder = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          String(row.id),
          row.read_at,
          row.folder || "inbox",
          new Date().toISOString(),
          inserted.id,
        );
      result.migrated += 1;
    } catch (e) {
      result.errors.push(
        `email#${row.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return result;
}
