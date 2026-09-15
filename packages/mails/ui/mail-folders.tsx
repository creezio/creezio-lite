"use client";

import {
  Archive,
  FileText,
  Inbox,
  Send,
  SquarePen,
  Timer,
  Trash2,
} from "lucide-react";
import { Button } from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";
import { MAIL_FOLDERS, type MailFolderId } from "./mail-types";

const FOLDER_ICONS: Record<MailFolderId, typeof Inbox> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  outbox: Timer,
  archive: Archive,
  trash: Trash2,
};

export type MailFoldersProps = {
  folder: MailFolderId;
  onSelect: (folder: MailFolderId) => void;
  onCompose: () => void;
  /** Compteur non-lus (inbox). */
  unread?: number;
  domain?: string | null;
};

export function MailFolders(props: MailFoldersProps) {
  return (
    <div className="flex h-full flex-col gap-1 bg-[#faf7f1]/60 p-3">
      <Button
        type="button"
        className="mb-2 w-full justify-center gap-2"
        onClick={props.onCompose}
      >
        <SquarePen className="h-4 w-4" />
        Nouveau message
      </Button>
      <nav className="flex flex-col gap-0.5">
        {MAIL_FOLDERS.map((f) => {
          const Icon = FOLDER_ICONS[f.id];
          const active = props.folder === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => props.onSelect(f.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                active
                  ? "bg-[#14182f] font-medium text-white"
                  : "text-[#3a4158] hover:bg-[#f3eee4]",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{f.label}</span>
              {f.id === "inbox" && (props.unread || 0) > 0 && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    active
                      ? "bg-white/20 text-white"
                      : "bg-sky-100 text-sky-800",
                  )}
                >
                  {props.unread}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      {props.domain && (
        <p className="mt-auto truncate px-2 pt-3 text-[11px] text-[#9aa1b2]">
          *@{props.domain}
        </p>
      )}
    </div>
  );
}
