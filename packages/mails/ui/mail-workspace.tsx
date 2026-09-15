"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@creezio/shell-ui/ui/kit";
import { MailFolders } from "./mail-folders";
import { MailList } from "./mail-list";
import { MailDisplay } from "./mail-display";
import { MailComposer, type MailComposerInitial } from "./mail-composer";
import {
  mailFromLabel,
  type MailDetail,
  type MailFolderId,
  type MailListRow,
  type MailMeta,
} from "./mail-types";

export type MailWorkspaceProps = {
  /** Base API (défaut `/api/v1/email`). */
  apiBase?: string;
  emptyStateNoDomainHint?: string;
};

function extractAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m?.[1] || from).trim();
}

/**
 * Webmail kit — 3 panneaux resizable (dossiers / liste / lecture),
 * threads, composer (Tiptap si présent), rendu HTML entrant sandboxé.
 */
export function MailWorkspace(props: MailWorkspaceProps = {}) {
  const apiBase = (props.apiBase || "/api/v1/email").replace(/\/$/, "");
  const [meta, setMeta] = useState<MailMeta | null>(null);
  const [folder, setFolder] = useState<MailFolderId>("inbox");
  const [rows, setRows] = useState<MailListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [thread, setThread] = useState<MailListRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerInitial, setComposerInitial] =
    useState<MailComposerInitial | undefined>(undefined);

  const loadMeta = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/meta`);
      if (r.ok) setMeta((await r.json()) as MailMeta);
    } catch {
      /* ignore */
    }
  }, [apiBase]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "80", folder });
      if (q.trim()) params.set("q", q.trim());
      if (unreadOnly && folder === "inbox") params.set("unread", "1");
      const r = await fetch(`${apiBase}?${params}`);
      const j = await r.json();
      setRows(j.rows || []);
      setTotal(j.total || 0);
      if (folder === "inbox") setUnread(j.unread || 0);
    } finally {
      setLoading(false);
    }
  }, [apiBase, folder, q, unreadOnly]);

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const r = await fetch(`${apiBase}/${id}`);
        if (!r.ok) {
          setDetail(null);
          setThread([]);
          return;
        }
        const j = (await r.json()) as MailDetail;
        setDetail(j);
        if (j.thread_id) {
          try {
            const t = await fetch(`${apiBase}/threads/${j.thread_id}`);
            const tj = await t.json();
            setThread(tj.rows || []);
          } catch {
            setThread([]);
          }
        } else {
          setThread([]);
        }
        if (!j.read_at && j.status === "inbound") {
          await fetch(`${apiBase}/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ read: true }),
          });
          setRows((prev) =>
            prev.map((row) =>
              row.id === id
                ? { ...row, read_at: new Date().toISOString() }
                : row,
            ),
          );
          setUnread((u) => Math.max(0, u - 1));
        }
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const t = window.setTimeout(() => void loadList(), 180);
    return () => window.clearTimeout(t);
  }, [loadList]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    setThread([]);
  }, [folder]);

  useEffect(() => {
    if (selectedId != null) void loadDetail(selectedId);
    else {
      setDetail(null);
      setThread([]);
    }
  }, [selectedId, loadDetail]);

  function openCompose() {
    setComposerInitial(undefined);
    setComposerOpen(true);
  }

  function openReply(d: MailDetail) {
    const references = (d.references || "")
      .split(/\s+/)
      .filter(Boolean);
    if (d.message_id) references.push(d.message_id);
    const quoted = (d.text_body || "").trim();
    setComposerInitial({
      to: [d.reply_to?.trim() || extractAddress(d.from_addr)],
      subject: /^re\s*:/i.test(d.subject) ? d.subject : `Re: ${d.subject}`,
      text: quoted
        ? `\n\n----- ${mailFromLabel(d.from_addr)} a écrit -----\n${quoted}`
        : "",
      inReplyTo: d.message_id,
      references: references.length ? references : null,
    });
    setComposerOpen(true);
  }

  function openDraft(d: MailDetail) {
    setComposerInitial({
      draftId: d.id,
      to: (d.to_addr || "").split(",").map((s) => s.trim()).filter(Boolean),
      cc: (d.cc || "").split(",").map((s) => s.trim()).filter(Boolean),
      subject: d.subject,
      text: d.text_body || "",
      html: d.html_body || "",
      inReplyTo: d.in_reply_to,
      references: d.references
        ? d.references.split(/\s+/).filter(Boolean)
        : null,
    });
    setComposerOpen(true);
  }

  const onChanged = useCallback(() => {
    void loadList();
    if (selectedId) void loadDetail(selectedId);
  }, [loadList, loadDetail, selectedId]);

  const emptyHint =
    folder === "inbox"
      ? meta?.domain
        ? `Les messages envoyés à *@${meta.domain} apparaîtront ici.`
        : props.emptyStateNoDomainHint ||
          meta?.emptyStateNoDomainHint ||
          "Configurez la réception pour recevoir des mails ici."
      : folder === "sent"
        ? "Les messages réellement envoyés (après passage par la file d'attente) apparaissent ici."
        : folder === "outbox"
          ? "Les envois en cours ou en échec restent ici jusqu'à succès."
          : undefined;

  const send = meta?.transport?.send;
  const sendBroken = send?.state === "unavailable";
  const transportOk =
    !sendBroken &&
    send?.state !== "unconfigured" &&
    meta?.transport?.configured !== false;
  const transportHint = sendBroken
    ? send?.message ||
      "Token présent, envoi réel indisponible (domaine non onboardé / 550)."
    : meta?.transport?.error ||
      "Email Sending non configuré. Configurez SMTP, Resend ou Cloudflare pour que les messages quittent la file d'attente.";

  return (
    <div className="flex h-[calc(100vh-8.5rem)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[#e6e0d4] bg-white/80 shadow-sm">
      {meta && !transportOk && (
        <div
          className={
            sendBroken
              ? "flex flex-wrap items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-950"
              : "flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950"
          }
        >
          <p className="min-w-0 flex-1">{transportHint}</p>
          <a
            href="/parametres/email"
            className="shrink-0 rounded-md bg-[#14182f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#232946]"
          >
            Paramètres email
          </a>
        </div>
      )}
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="creezio-mails"
        className="min-h-0 flex-1"
      >
        <ResizablePanel defaultSize={17} minSize={12} maxSize={28}>
          <MailFolders
            folder={folder}
            onSelect={setFolder}
            onCompose={openCompose}
            unread={unread}
            domain={meta?.domain}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={31} minSize={22} maxSize={45}>
          <MailList
            folder={folder}
            rows={rows}
            total={total}
            loading={loading}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
            }}
            q={q}
            onQChange={setQ}
            unreadOnly={unreadOnly}
            onUnreadOnlyChange={setUnreadOnly}
            onRefresh={() => void loadList()}
            emptyHint={emptyHint}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={52} minSize={30}>
          {detail?.status === "draft" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 bg-[#fcfbf8] p-8 text-center">
              <p className="text-sm text-[#5c6478]">
                Brouillon « {detail.subject || "(sans objet)"} »
              </p>
              <button
                type="button"
                onClick={() => openDraft(detail)}
                className="rounded-md bg-[#14182f] px-4 py-2 text-sm font-medium text-white hover:bg-[#232946]"
              >
                Reprendre le brouillon
              </button>
            </div>
          ) : (
            <MailDisplay
              apiBase={apiBase}
              detail={detail}
              loading={detailLoading}
              thread={thread}
              onSelect={(id) => setSelectedId(id)}
              onReply={openReply}
              onChanged={onChanged}
              busy={busy}
              setBusy={setBusy}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

      <MailComposer
        apiBase={apiBase}
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onDone={(kind) => {
          // File d'attente d'abord (async outbox) — « Envoyés » seulement
          // après drain réussi du worker.
          if (kind === "sent") setFolder("outbox");
          else if (kind === "draft") setFolder("drafts");
          onChanged();
        }}
        initial={composerInitial}
      />
    </div>
  );
}
