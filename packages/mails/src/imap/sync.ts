/**
 * Sync IMAP — comptes en base (`creezio_platform_mail_accounts`), moteur
 * incrémental par UID (reset si UIDVALIDITY change), parsing `mailparser`,
 * insertion dédupliquée par `message_id` via `insertInboundFull`.
 *
 * `imapflow` / `mailparser` sont des peers optionnels chargés dynamiquement :
 * absents → capacité refusée proprement (`imap_module_absent`), jamais de
 * crash. Lecture seule côté serveur IMAP en v1 (pas de write-back \\Seen).
 */

import type { MailAccount } from "../types.js";
import type { SqliteMailsStore } from "../sqlite-store.js";
import { resolveMailSecret } from "../transport-resolve.js";

export const MAIL_IMAP_DEFAULT_POLL_MS = 120_000;
/** Borne de messages ingérés par cycle (serveurs hostiles / gros historiques). */
export const MAIL_IMAP_SYNC_BATCH_MAX = 200;

type DynImport = (specifier: string) => Promise<unknown>;
const dynImport = new Function(
  "specifier",
  "return import(specifier)",
) as DynImport;

type ImapFlowClient = {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  getMailboxLock(path: string): Promise<{ release: () => void }>;
  mailbox: { uidValidity?: bigint; uidNext?: number; exists?: number } | boolean;
  fetch(
    range: string | { uid: string },
    query: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): AsyncIterable<{
    uid: number;
    source?: Buffer;
  }>;
};

type ImapFlowModule = {
  ImapFlow: new (config: Record<string, unknown>) => ImapFlowClient;
};

type ParsedMail = {
  messageId?: string;
  from?: { text?: string };
  to?: { text?: string } | Array<{ text?: string }>;
  subject?: string;
  text?: string;
  html?: string | false;
  date?: Date;
  headers?: Map<string, unknown>;
  attachments?: Array<{
    filename?: string;
    contentType?: string;
    content?: Buffer;
  }>;
};

type MailparserModule = {
  simpleParser: (source: Buffer) => Promise<ParsedMail>;
};

export async function loadImapModules(): Promise<
  | { ok: true; imapflow: ImapFlowModule; mailparser: MailparserModule }
  | { ok: false; error: string }
> {
  let imapflow: ImapFlowModule;
  try {
    imapflow = (await dynImport("imapflow")) as ImapFlowModule;
  } catch {
    return { ok: false, error: "imap_module_absent (npm i imapflow)" };
  }
  let mailparser: MailparserModule;
  try {
    mailparser = (await dynImport("mailparser")) as MailparserModule;
  } catch {
    return { ok: false, error: "imap_module_absent (npm i mailparser)" };
  }
  return { ok: true, imapflow, mailparser };
}

function headerText(parsed: ParsedMail, name: string): string | null {
  const raw = parsed.headers?.get(name.toLowerCase());
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map(String).join(" ");
  if (typeof raw === "object" && "text" in (raw as object)) {
    return String((raw as { text?: unknown }).text ?? "");
  }
  return String(raw);
}

function toText(v: ParsedMail["to"]): string {
  if (!v) return "";
  if (Array.isArray(v)) return v.map((x) => x.text || "").filter(Boolean).join(", ");
  return v.text || "";
}

export type ImapConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  logger: false;
};

export function buildImapConfig(
  account: MailAccount,
  pass: string,
): ImapConnectionConfig {
  return {
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.username, pass },
    logger: false,
  };
}

export type SyncImapAccountResult =
  | {
      ok: true;
      inserted: number;
      duplicates: number;
      lastUid: number;
      uidValidityReset: boolean;
    }
  | { ok: false; error: string };

/**
 * Sync incrémentale d'un compte : fetch des UID > `last_uid` sur INBOX
 * (mapping folders v1 : INBOX → inbox), reset si UIDVALIDITY a changé.
 */
export async function syncImapAccount(
  store: SqliteMailsStore,
  account: MailAccount,
  opts?: {
    log?: (line: string) => void;
    batchMax?: number;
  },
): Promise<SyncImapAccountResult> {
  const log = opts?.log || (() => {});
  const batchMax = opts?.batchMax ?? MAIL_IMAP_SYNC_BATCH_MAX;

  const modules = await loadImapModules();
  if (!modules.ok) {
    store.updateAccountSync(account.id, {
      syncState: "error",
      lastError: modules.error,
    });
    return { ok: false, error: modules.error };
  }

  const pass = resolveMailSecret(account.secretRef);
  if (!pass) {
    const error = "imap_secret_unresolved";
    store.updateAccountSync(account.id, {
      syncState: "error",
      lastError: error,
    });
    return { ok: false, error };
  }

  const client = new modules.imapflow.ImapFlow(
    buildImapConfig(account, pass) as unknown as Record<string, unknown>,
  );

  try {
    store.updateAccountSync(account.id, { syncState: "syncing" });
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    let inserted = 0;
    let duplicates = 0;
    let uidValidityReset = false;
    try {
      const mailbox = client.mailbox;
      const uidValidity =
        mailbox && typeof mailbox === "object" && mailbox.uidValidity != null
          ? String(mailbox.uidValidity)
          : null;
      let sinceUid = account.lastUid;
      if (
        uidValidity &&
        account.lastUidvalidity &&
        uidValidity !== account.lastUidvalidity
      ) {
        // UIDVALIDITY a changé : les UID ne sont plus comparables — resync
        // complète (la dédup message_id évite les doublons).
        sinceUid = 0;
        uidValidityReset = true;
        log(`imap ${account.label}: UIDVALIDITY reset — resync complète`);
      }

      let maxUid = sinceUid;
      let handled = 0;
      const range = `${sinceUid + 1}:*`;
      for await (const msg of client.fetch(
        range,
        { uid: true, source: true },
        { uid: true },
      )) {
        if (!msg?.uid || msg.uid <= sinceUid) continue;
        if (handled >= batchMax) break;
        handled += 1;
        maxUid = Math.max(maxUid, msg.uid);
        if (!msg.source) continue;
        let parsed: ParsedMail;
        try {
          parsed = await modules.mailparser.simpleParser(msg.source);
        } catch (e) {
          log(
            `imap ${account.label}: parse uid=${msg.uid} échoué — ${e instanceof Error ? e.message : e}`,
          );
          continue;
        }
        const headers: Record<string, string> = {};
        for (const name of ["in-reply-to", "references"]) {
          const v = headerText(parsed, name);
          if (v) headers[name] = v;
        }
        const result = store.insertInboundFull({
          message_id: parsed.messageId || `<imap-${account.id}-${msg.uid}>`,
          from: parsed.from?.text || "(inconnu)",
          to: toText(parsed.to) || account.username,
          subject: parsed.subject,
          text: parsed.text ?? null,
          html: typeof parsed.html === "string" ? parsed.html : null,
          received_at: parsed.date ? parsed.date.toISOString() : null,
          headers: Object.keys(headers).length ? headers : null,
          attachments: (parsed.attachments || [])
            .filter((a) => a.content?.length)
            .map((a) => ({
              filename: a.filename,
              content_type: a.contentType,
              content_base64: a.content!.toString("base64"),
            })),
          account_id: account.id,
        });
        if (result.ok) {
          if (result.duplicate) duplicates += 1;
          else inserted += 1;
        }
      }

      store.updateAccountSync(account.id, {
        lastUidvalidity: uidValidity,
        lastUid: maxUid,
        syncState: "idle",
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      });
      return { ok: true, inserted, duplicates, lastUid: maxUid, uidValidityReset };
    } finally {
      lock.release();
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    store.updateAccountSync(account.id, {
      syncState: "error",
      lastError: error,
    });
    return { ok: false, error };
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* déjà fermé */
      }
    }
  }
}

/** Test de connexion (bouton verify UI) — jamais de crash. */
export async function verifyImapAccount(
  account: MailAccount,
): Promise<{ ok: boolean; error?: string }> {
  const modules = await loadImapModules();
  if (!modules.ok) return { ok: false, error: modules.error };
  const pass = resolveMailSecret(account.secretRef);
  if (!pass) return { ok: false, error: "imap_secret_unresolved" };
  const client = new modules.imapflow.ImapFlow(
    buildImapConfig(account, pass) as unknown as Record<string, unknown>,
  );
  try {
    await client.connect();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* déjà fermé */
      }
    }
  }
}

export type ImapSyncScheduler = {
  stop(): void;
  /** Sync tous les comptes activés une fois (tests / drain manuel). */
  syncOnce(): Promise<void>;
};

export function resolveImapPollMs(): number {
  const raw = Number(process.env.CREEZIO_MAIL_IMAP_POLL_MS || "");
  if (Number.isFinite(raw) && raw >= 5_000) return raw;
  return MAIL_IMAP_DEFAULT_POLL_MS;
}

/**
 * Scheduler poll (défaut 120 s, `CREEZIO_MAIL_IMAP_POLL_MS`).
 * v1 : connexion par cycle (poll) — le maintien IDLE
 * (`CREEZIO_MAIL_IMAP_IDLE`) est documenté comme évolution.
 */
export function startImapSyncScheduler(opts: {
  store: SqliteMailsStore;
  pollMs?: number;
  log?: (line: string) => void;
  manual?: boolean;
}): ImapSyncScheduler {
  const log = opts.log || (() => {});
  const pollMs = opts.pollMs ?? resolveImapPollMs();
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function syncOnce(): Promise<void> {
    if (running) return;
    running = true;
    try {
      let accounts: ReturnType<SqliteMailsStore["listAccounts"]> = [];
      try {
        accounts = opts.store.listAccounts().filter((a) => a.enabled);
      } catch {
        accounts = [];
      }
      for (const account of accounts) {
        if (stopped) break;
        const result = await syncImapAccount(opts.store, account, { log });
        if (!result.ok) {
          log(`imap ${account.label}: sync échouée — ${result.error}`);
        } else if (result.inserted > 0) {
          log(`imap ${account.label}: ${result.inserted} nouveau(x) mail(s)`);
        }
      }
    } finally {
      running = false;
    }
  }

  function scheduleNext(): void {
    if (stopped || opts.manual) return;
    timer = setTimeout(() => {
      void syncOnce()
        .catch((e) =>
          log(`imap: sync error — ${e instanceof Error ? e.message : e}`),
        )
        .finally(scheduleNext);
    }, pollMs);
    (timer as { unref?: () => void }).unref?.();
  }

  scheduleNext();

  return {
    syncOnce,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
