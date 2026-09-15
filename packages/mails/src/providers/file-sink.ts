/**
 * Transport `file-sink` : écrit chaque envoi dans un fichier JSON sous
 * `outDir` (dev / tests / CI). Adapté au contrat v2 `MailTransport`.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  MailSendResult,
  MailTransport,
  OutgoingMail,
} from "../transport.js";

export const FILE_SINK_TRANSPORT_ID = "file-sink";

export type CreateFileSinkMailTransportOptions = {
  /** Répertoire de sortie (créé si absent). */
  outDir: string;
};

export function createFileSinkMailTransport(
  opts: CreateFileSinkMailTransportOptions,
): MailTransport {
  const outDir = opts.outDir;

  return {
    id: "file-sink",
    capabilities: {
      attachments: true,
      idempotency: false,
      statusWebhooks: false,
    },
    async send(mail: OutgoingMail): Promise<MailSendResult> {
      if (!mail.to?.length || !mail.subject?.trim()) {
        return {
          ok: false,
          error: "to_and_subject_required",
          retryable: false,
        };
      }
      try {
        fs.mkdirSync(outDir, { recursive: true });
        const file = path.join(outDir, `${mail.id}-${Date.now()}.json`);
        fs.writeFileSync(
          file,
          JSON.stringify(
            {
              id: mail.id,
              from: mail.from || null,
              to: mail.to,
              cc: mail.cc || [],
              bcc: mail.bcc || [],
              replyTo: mail.replyTo || null,
              subject: mail.subject,
              text: mail.text || null,
              html: mail.html || null,
              inReplyTo: mail.inReplyTo || null,
              references: mail.references || [],
              attachments: (mail.attachments || []).map((a) => ({
                filename: a.filename,
                contentType: a.contentType,
                sizeBytes: a.content.length,
              })),
              writtenAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "file_sink_error",
          retryable: false,
        };
      }
    },
    async verify() {
      try {
        fs.mkdirSync(outDir, { recursive: true });
        return { ok: true };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "file_sink_error",
        };
      }
    },
  };
}
