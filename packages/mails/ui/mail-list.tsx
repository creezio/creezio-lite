"use client";

import { Loader2, Mail, Paperclip, RefreshCw, Search } from "lucide-react";
import { Button, Input, ScrollArea } from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";
import {
  MAIL_STATUS_LABELS,
  describeMailError,
  formatMailDate,
  mailFromLabel,
  stripHtmlPreview,
  type MailFolderId,
  type MailListRow,
} from "./mail-types";

export type MailListProps = {
  folder: MailFolderId;
  rows: MailListRow[];
  total: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  q: string;
  onQChange: (q: string) => void;
  unreadOnly: boolean;
  onUnreadOnlyChange: (v: boolean) => void;
  onRefresh: () => void;
  emptyHint?: string;
};

function statusBadge(row: MailListRow): { label: string; className: string } | null {
  if (row.folder !== "outbox" && row.status !== "bounced") return null;
  const label = MAIL_STATUS_LABELS[row.status] || row.status;
  if (row.status === "failed_permanent" || row.status === "bounced") {
    return { label, className: "bg-red-100 text-red-800" };
  }
  return { label, className: "bg-amber-100 text-amber-800" };
}

export function MailList(props: MailListProps) {
  const outgoingFolder = ["sent", "drafts", "outbox"].includes(props.folder);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[#ebe4d8] px-3 py-2.5">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#9aa1b2]" />
          <Input
            value={props.q}
            onChange={(e) => props.onQChange(e.target.value)}
            placeholder="Rechercher…"
            className="h-9 border-[#e6e0d4] bg-[#faf7f1]/60 pl-8"
          />
        </div>
        {props.folder === "inbox" && (
          <button
            type="button"
            onClick={() => props.onUnreadOnlyChange(!props.unreadOnly)}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
              props.unreadOnly
                ? "bg-[#14182f] text-white"
                : "bg-[#f3eee4] text-[#5c6478] hover:bg-[#ebe4d8]",
            )}
          >
            Non lus
          </button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={props.onRefresh}
          title="Actualiser"
        >
          <RefreshCw className={cn("h-4 w-4", props.loading && "animate-spin")} />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {props.loading && props.rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-[#5c6478]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        ) : props.rows.length === 0 ? (
          <div className="space-y-2 p-8 text-center">
            <Mail className="mx-auto h-8 w-8 text-[#c9c2b4]" />
            <p className="text-sm font-medium text-[#14182f]">Aucun mail</p>
            {props.emptyHint && (
              <p className="text-xs text-[#5c6478]">{props.emptyHint}</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[#f0ebe1]">
            {props.rows.map((row) => {
              const active = props.selectedId === row.id;
              const unreadRow = !row.read_at && row.status === "inbound";
              const badge = statusBadge(row);
              const who = outgoingFolder
                ? `À ${row.to_addr}`
                : mailFromLabel(row.from_addr);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(row.id)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors",
                      active ? "bg-sky-50" : "hover:bg-[#faf7f1]",
                      unreadRow && "bg-[#fffaf3]",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          unreadRow
                            ? "font-semibold text-[#14182f]"
                            : "font-medium text-[#3a4158]",
                        )}
                      >
                        {who}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#9aa1b2]">
                        {formatMailDate(row.received_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "truncate text-[13px]",
                          unreadRow
                            ? "font-medium text-[#14182f]"
                            : "text-[#5c6478]",
                        )}
                      >
                        {row.subject || "(sans objet)"}
                      </span>
                      {row.has_attachments > 0 && (
                        <Paperclip className="h-3 w-3 shrink-0 text-[#9aa1b2]" />
                      )}
                    </div>
                    {badge && (
                      <span
                        className={cn(
                          "mt-0.5 w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          badge.className,
                        )}
                      >
                        {badge.label}
                      </span>
                    )}
                    {row.last_error && (
                      <p className="truncate text-xs text-red-700">
                        {describeMailError(row.last_error)}
                      </p>
                    )}
                    {row.preview && !row.last_error && (
                      <p className="truncate text-xs text-[#9aa1b2]">
                        {stripHtmlPreview(row.preview)}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
      <p className="border-t border-[#ebe4d8] px-4 py-2 text-[11px] text-[#9aa1b2]">
        {props.total.toLocaleString("fr-FR")} message{props.total > 1 ? "s" : ""}
      </p>
    </div>
  );
}
