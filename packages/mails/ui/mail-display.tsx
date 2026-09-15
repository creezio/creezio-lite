"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Loader2,
  MailOpen,
  Paperclip,
  Reply,
  Trash2,
} from "lucide-react";
import {
  Button,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";
import {
  MAIL_STATUS_LABELS,
  describeMailError,
  formatMailDate,
  mailFromLabel,
  type MailDetail,
  type MailEventRow,
  type MailListRow,
} from "./mail-types";

/**
 * Rendu HTML entrant en iframe SANDBOXÉE (sans `allow-scripts` ni
 * `allow-same-origin`) : le HTML externe ne peut ni exécuter de JS ni
 * accéder au contexte de l'app — corrige le XSS de l'ancienne inbox
 * (injection HTML directe dans le DOM de l'app).
 */
function SandboxedHtml(props: { html: string; title: string }) {
  const srcDoc = useMemo(() => {
    // Base minimale : typographie neutre, liens ouverts dans un nouvel onglet.
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
body { margin: 12px; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.55; color: #14182f; word-break: break-word; }
img { max-width: 100%; height: auto; }
a { color: #0369a1; }
pre { white-space: pre-wrap; }
</style></head><body>${props.html}</body></html>`;
  }, [props.html]);
  return (
    <iframe
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      title={props.title}
      className="h-full min-h-[280px] w-full flex-1 border-0 bg-white"
    />
  );
}

function ThreadItem(props: {
  row: MailListRow;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { row } = props;
  const outgoing = row.status !== "inbound";
  return (
    <button
      type="button"
      onClick={() => props.onSelect(row.id)}
      className={cn(
        "flex w-full items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
        props.active ? "bg-sky-50 text-[#14182f]" : "hover:bg-[#faf7f1] text-[#5c6478]",
      )}
    >
      <span className="truncate">
        {outgoing ? `→ ${row.to_addr}` : mailFromLabel(row.from_addr)}
      </span>
      <span className="shrink-0 tabular-nums text-[#9aa1b2]">
        {formatMailDate(row.received_at)}
      </span>
    </button>
  );
}

export type MailDisplayProps = {
  apiBase: string;
  detail: MailDetail | null;
  loading: boolean;
  thread: MailListRow[];
  onSelect: (id: string) => void;
  onReply: (detail: MailDetail) => void;
  onChanged: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
};

export function MailDisplay(props: MailDisplayProps) {
  const { detail, apiBase } = props;
  const [events, setEvents] = useState<MailEventRow[]>([]);

  const isOutgoing = Boolean(detail && detail.status !== "inbound");
  const showJournal = Boolean(
    detail &&
      ["queued", "sending", "failed", "failed_permanent", "bounced"].includes(
        detail.status,
      ),
  );

  useEffect(() => {
    setEvents([]);
    if (!detail || !showJournal) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`${apiBase}/${detail.id}/events`);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setEvents(j.events || []);
      } catch {
        /* best effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, showJournal, apiBase]);

  async function patch(body: Record<string, unknown>) {
    if (!detail) return;
    props.setBusy(true);
    try {
      const r = await fetch(`${apiBase}/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) props.onChanged();
    } finally {
      props.setBusy(false);
    }
  }

  async function remove() {
    if (!detail) return;
    // Corbeille d'abord ; suppression définitive depuis la corbeille.
    if (detail.folder !== "trash") {
      await patch({ folder: "trash" });
      return;
    }
    props.setBusy(true);
    try {
      const r = await fetch(`${apiBase}/${detail.id}`, { method: "DELETE" });
      if (r.ok) props.onChanged();
    } finally {
      props.setBusy(false);
    }
  }

  if (!detail && !props.loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-[#fcfbf8] p-8 text-center">
        <MailOpen className="h-10 w-10 text-[#d5cec0]" />
        <p className="text-sm text-[#5c6478]">Sélectionnez un message</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-[#fcfbf8] text-sm text-[#5c6478]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Ouverture…
      </div>
    );
  }

  const bodyHtml = detail.html_body?.trim();
  const bodyText = detail.text_body?.trim();
  const statusLabel = MAIL_STATUS_LABELS[detail.status] || detail.status;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 flex-col bg-[#fcfbf8]">
        <div className="flex flex-wrap items-start gap-3 border-b border-[#ebe4d8] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-[#14182f]">
              {detail.subject || "(sans objet)"}
            </h2>
            {isOutgoing ? (
              <p className="mt-1 text-sm text-[#3a4158]">
                À <span className="font-medium">{detail.to_addr}</span>
                {detail.cc ? (
                  <span className="text-[#9aa1b2]"> · Cc {detail.cc}</span>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-sm text-[#3a4158]">
                <span className="font-medium">{mailFromLabel(detail.from_addr)}</span>
                <span className="text-[#9aa1b2]"> &lt;{detail.from_addr}&gt;</span>
              </p>
            )}
            <p className="mt-0.5 text-xs text-[#9aa1b2]">
              {isOutgoing ? statusLabel : `À ${detail.to_addr}`} ·{" "}
              {formatMailDate(detail.received_at)}
              {detail.last_error && (
                <span className="text-red-700">
                  {" "}
                  · {describeMailError(detail.last_error)}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {!isOutgoing && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={props.busy}
                    onClick={() => props.onReply(detail)}
                  >
                    <Reply className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Répondre</TooltipContent>
              </Tooltip>
            )}
            {detail.status === "inbound" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={props.busy}
                onClick={() => void patch({ read: !detail.read_at })}
              >
                {detail.read_at ? "Marquer non lu" : "Marquer lu"}
              </Button>
            )}
            {detail.folder !== "archive" && detail.folder !== "trash" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={props.busy}
                    onClick={() => void patch({ folder: "archive" })}
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Archiver</TooltipContent>
              </Tooltip>
            )}
            {(detail.folder === "archive" || detail.folder === "trash") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    disabled={props.busy}
                    onClick={() => void patch({ folder: "inbox" })}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Restaurer</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-red-600 hover:text-red-700"
                  disabled={props.busy}
                  onClick={() => void remove()}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {detail.folder === "trash"
                  ? "Supprimer définitivement"
                  : "Mettre à la corbeille"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {props.thread.length > 1 && (
          <div className="border-b border-[#ebe4d8] px-4 py-2">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[#9aa1b2]">
              Fil ({props.thread.length})
            </p>
            <div className="flex max-h-28 flex-col gap-0.5 overflow-y-auto">
              {props.thread.map((row) => (
                <ThreadItem
                  key={row.id}
                  row={row}
                  active={row.id === detail.id}
                  onSelect={props.onSelect}
                />
              ))}
            </div>
          </div>
        )}

        {detail.attachments?.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-[#ebe4d8] px-5 py-3">
            {detail.attachments.map((att) => (
              <a
                key={att.id}
                href={`${apiBase}/${detail.id}/attachments/${att.id}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#e6e0d4] bg-white px-2.5 py-1.5 text-xs text-[#3a4158] transition-colors hover:border-sky-300 hover:text-sky-800"
              >
                <Paperclip className="h-3 w-3" />
                {att.filename}
                <span className="text-[#9aa1b2]">
                  ({Math.max(1, Math.round(att.size_bytes / 1024))} Ko)
                </span>
              </a>
            ))}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {bodyHtml ? (
            <SandboxedHtml html={bodyHtml} title={detail.subject || "message"} />
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-5 py-4">
                {bodyText ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#14182f]">
                    {bodyText}
                  </pre>
                ) : (
                  <p className="text-sm text-[#9aa1b2]">(message vide)</p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        {showJournal && events.length > 0 && (
          <div className="border-t border-[#ebe4d8] bg-[#faf7f1]/60 px-5 py-3">
            <p className="pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#9aa1b2]">
              Journal d'envoi
            </p>
            <ul className="max-h-24 space-y-1 overflow-y-auto">
              {events.map((ev) => (
                <li key={ev.id} className="flex gap-2 text-xs text-[#5c6478]">
                  <span className="shrink-0 tabular-nums text-[#9aa1b2]">
                    {formatMailDate(ev.created_at)}
                  </span>
                  <span className="font-medium">
                    {MAIL_STATUS_LABELS[ev.type] || ev.type}
                  </span>
                  {ev.detail && <span className="truncate">{ev.detail}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
