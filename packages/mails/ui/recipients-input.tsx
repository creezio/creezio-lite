"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@creezio/shell-ui";

export type RecipientsInputProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Saisie destinataires en puces (Entrée / virgule / collage de listes). */
export function RecipientsInput(props: RecipientsInputProps) {
  const [draft, setDraft] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...props.value];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    props.onChange(next);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && props.value.length) {
      props.onChange(props.value.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-[#e6e0d4] bg-white px-2 py-1",
        props.disabled && "opacity-50",
        props.className,
      )}
    >
      {props.value.map((addr) => (
        <span
          key={addr}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
            looksLikeEmail(addr)
              ? "bg-[#f3eee4] text-[#3a4158]"
              : "bg-red-100 text-red-800",
          )}
        >
          {addr}
          <button
            type="button"
            disabled={props.disabled}
            onClick={() =>
              props.onChange(props.value.filter((v) => v !== addr))
            }
            className="text-[#9aa1b2] hover:text-[#14182f]"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={props.disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder={props.value.length === 0 ? props.placeholder : undefined}
        className="min-w-[120px] flex-1 bg-transparent py-1 text-sm text-[#14182f] placeholder:text-[#9aa1b2] focus:outline-none"
      />
    </div>
  );
}
