/**
 * @creezio/support — support natif OS côté serveur marque.
 *
 * ADR : docs/adr/ADR-admin-app-os.md §5. Chaque serveur marque expose une
 * page `/support` (le détenteur du serveur, ex. restaurateur, ouvre des
 * tickets et lit les réponses) et un export consommé par l'app admin de la
 * marque via le host-agent (« l'admin initie tous les appels » — jamais de
 * push serveur → admin).
 *
 * Montage natif : `create-brand-kernel.ts` (@creezio/app-runtime) enregistre
 * `platform-support` comme tasks/mails → HTTP
 * `/api/v1/platform/platform-support/*`, données en core.db.
 */

import type { ApiMount } from "@creezio/api-kernel";

/* ------------------------------------------------------------ schéma */

export const SUPPORT_CORE_SQL = `-- Support natif OS (@creezio/support)

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sujet TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'ouvert',
  auteur TEXT
);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  origine TEXT NOT NULL DEFAULT 'client',
  auteur TEXT,
  corps TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
  ON support_messages (ticket_id, created_at);
`;

export const SUPPORT_STATUTS = [
  "ouvert",
  "repondu",
  "resolu",
  "ferme",
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

/* ------------------------------------------------------------- mount */

/**
 * Mount `platform-support` (serveur marque).
 *
 * - GET    ``               → liste tickets (dernier message inclus)
 * - POST   ``               → créer ticket { sujet, corps, auteur? }
 * - GET    `export`         → tickets + messages (pull admin via agent)
 * - GET    `<id>`           → ticket + fil de messages
 * - POST   `<id>/messages`  → message client { corps, auteur? } (réouvre)
 * - POST   `<id>/reply`     → réponse admin { corps, auteur? } (statut → repondu)
 * - POST   `<id>/statut`    → { statut }
 */
/** Optional repository for asynchronous hosting; original SQLite path is preserved. */
export type SupportPersistence = {
  list(): Promise<Record<string, unknown>[]>;
  get(id: string): Promise<Record<string, unknown> | null>;
  messages(id: string): Promise<Record<string, unknown>[]>;
  create(ticket: {id:string;ts:string;sujet:string;auteur:string|null;corps:string}): Promise<void>;
  reply(message: {id:string;ts:string;origine:string;auteur:string|null;corps:string;statut:string}): Promise<void>;
  setStatus(id: string, statut: string, ts: string): Promise<void>;
};
export function createSupportServerMount(opts: {persistence?: SupportPersistence} = {}): ApiMount {
  return {
    dbLayer: "core",
    handle: async ({ req, subPath, db }) => {
      if (!db && !opts.persistence) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);

      if (!parts.length && method === "GET") {
        const items = opts.persistence ? await opts.persistence.list() : db!
          .prepare(
            `SELECT t.*,
               (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS messages_count,
               (SELECT m.corps FROM support_messages m WHERE m.ticket_id = t.id
                ORDER BY m.created_at DESC LIMIT 1) AS dernier_message
             FROM support_tickets t
             ORDER BY t.updated_at DESC`,
          )
          .all();
        return { status: 200, body: { ok: true, items } };
      }

      if (!parts.length && method === "POST") {
        const body = (req.body || {}) as Record<string, unknown>;
        const sujet = String(body.sujet || "").trim();
        const corps = String(body.corps || "").trim();
        if (!sujet) {
          return { status: 400, body: { ok: false, error: "sujet requis" } };
        }
        const id = newId();
        const ts = nowIso();
        const auteur = String(body.auteur || "").trim() || null;
        if (opts.persistence) await opts.persistence.create({id, ts, sujet, auteur, corps});
        else { db!.prepare(
          `INSERT INTO support_tickets (id, created_at, updated_at, sujet, statut, auteur)
           VALUES (?,?,?,?,?,?)`,
        ).run(id, ts, ts, sujet, "ouvert", auteur);
        if (corps) {
          db!.prepare(
            `INSERT INTO support_messages (id, ticket_id, created_at, origine, auteur, corps)
             VALUES (?,?,?,?,?,?)`,
          ).run(newId(), id, ts, "client", auteur, corps);
        }
        }
        const item = opts.persistence ? await opts.persistence.get(id) : db!
          .prepare(`SELECT * FROM support_tickets WHERE id = ?`)
          .get(id);
        return { status: 201, body: { ok: true, item } };
      }

      if (parts.length === 1 && parts[0] === "export" && method === "GET") {
        const tickets = opts.persistence ? await opts.persistence.list() : db!
          .prepare(`SELECT * FROM support_tickets ORDER BY updated_at DESC`)
          .all() as Array<Record<string, unknown>>;
        const out = await Promise.all(tickets.map(async (t) => ({
          ...t,
          messages: opts.persistence ? await opts.persistence.messages(String(t.id)) : db!
            .prepare(
              `SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
            )
            .all(t.id),
        })));
        return { status: 200, body: { ok: true, tickets: out } };
      }

      if (parts.length >= 1) {
        const id = parts[0]!;
        const ticket = opts.persistence ? await opts.persistence.get(id) : db!
          .prepare(`SELECT * FROM support_tickets WHERE id = ?`)
          .get(id) as Record<string, unknown> | undefined;
        if (!ticket) return { status: 404, body: { ok: false } };

        if (parts.length === 1 && method === "GET") {
          const messages = opts.persistence ? await opts.persistence.messages(id) : db!
            .prepare(
              `SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
            )
            .all(id);
          return { status: 200, body: { ok: true, item: ticket, messages } };
        }

        if (parts.length === 2 && method === "POST") {
          const body = (req.body || {}) as Record<string, unknown>;
          const action = parts[1]!;

          if (action === "messages" || action === "reply") {
            const corps = String(body.corps || "").trim();
            if (!corps) {
              return { status: 400, body: { ok: false, error: "corps requis" } };
            }
            const origine = action === "reply" ? "admin" : "client";
            const ts = nowIso();
            if (opts.persistence) await opts.persistence.reply({id, ts, origine, auteur:String(body.auteur || "").trim() || null, corps, statut:origine === "admin" ? "repondu" : "ouvert"});
            else db!.prepare(
              `INSERT INTO support_messages (id, ticket_id, created_at, origine, auteur, corps)
               VALUES (?,?,?,?,?,?)`,
            ).run(
              newId(),
              id,
              ts,
              origine,
              String(body.auteur || "").trim() || null,
              corps,
            );
            // Réponse admin → repondu ; message client → réouvre.
            const statut = origine === "admin" ? "repondu" : "ouvert";
            if (!opts.persistence) db!.prepare(
              `UPDATE support_tickets SET statut = ?, updated_at = ? WHERE id = ?`,
            ).run(statut, ts, id);
            return { status: 200, body: { ok: true, statut } };
          }

          if (action === "statut") {
            const statut = String(body.statut || "").trim();
            if (!(SUPPORT_STATUTS as readonly string[]).includes(statut)) {
              return { status: 400, body: { ok: false, error: "statut invalide" } };
            }
            if (opts.persistence) await opts.persistence.setStatus(id, statut, nowIso());
            else db!.prepare(
              `UPDATE support_tickets SET statut = ?, updated_at = ? WHERE id = ?`,
            ).run(statut, nowIso(), id);
            return { status: 200, body: { ok: true } };
          }
        }
      }

      return { status: 404, body: { ok: false } };
    },
  };
}
