"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { Button, Input, Textarea } from "@creezio/shell-ui/ui/kit";
import { cn } from "@creezio/shell-ui";
import { RecipientsInput } from "./recipients-input";

const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

type PendingAttachment = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  base64: string;
};

export type MailComposerInitial = {
  draftId?: string;
  to?: string[];
  cc?: string[];
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string | null;
  references?: string[] | null;
};

export type MailComposerProps = {
  apiBase: string;
  open: boolean;
  onClose: () => void;
  /** Après envoi ou sauvegarde brouillon réussis. */
  onDone: (kind: "sent" | "draft") => void;
  initial?: MailComposerInitial;
};

/* ── Éditeur Tiptap chargé dynamiquement (fallback textarea) ────────────── */

type TiptapModules = {
  react: {
    useEditor: (opts: Record<string, unknown>) => unknown;
    EditorContent: ComponentType<{ editor: unknown; className?: string }>;
  };
  starterKit: unknown;
  link: unknown;
};

let tiptapPromise: Promise<TiptapModules | null> | null = null;

function loadTiptap(): Promise<TiptapModules | null> {
  if (!tiptapPromise) {
    tiptapPromise = Promise.all([
      import("@tiptap/react"),
      import("@tiptap/starter-kit"),
      import("@tiptap/extension-link"),
    ])
      .then(([react, starterKit, link]) => ({
        react: react as unknown as TiptapModules["react"],
        starterKit:
          (starterKit as { default?: unknown }).default ?? starterKit,
        link: (link as { default?: unknown }).default ?? link,
      }))
      .catch(() => null);
  }
  return tiptapPromise;
}

function TiptapEditor(props: {
  mods: TiptapModules;
  initialHtml: string;
  onChange: (html: string, text: string) => void;
}) {
  const { useEditor, EditorContent } = props.mods.react;
  const starterKit = props.mods.starterKit as {
    configure?: (o: Record<string, unknown>) => unknown;
  };
  const link = props.mods.link as {
    configure?: (o: Record<string, unknown>) => unknown;
  };
  const editor = useEditor({
    extensions: [
      starterKit.configure ? starterKit.configure({}) : starterKit,
      link.configure
        ? link.configure({ openOnClick: false, autolink: true })
        : link,
    ],
    content: props.initialHtml,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[160px] px-3 py-2 text-sm text-[#14182f] focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }: { editor: { getHTML: () => string; getText: () => string } }) => {
      props.onChange(e.getHTML(), e.getText());
    },
  });
  return (
    <div className="rounded-md border border-[#e6e0d4] bg-white">
      <EditorContent editor={editor} />
    </div>
  );
}

/* ── Composer ───────────────────────────────────────────────────────────── */

export function MailComposer(props: MailComposerProps) {
  const initial = props.initial;
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [html, setHtml] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [tiptap, setTiptap] = useState<TiptapModules | null | "loading">(
    "loading",
  );
  const [busy, setBusy] = useState<false | "send" | "draft">(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void loadTiptap().then((mods) => setTiptap(mods));
  }, []);

  // Re-seed à chaque ouverture.
  useEffect(() => {
    if (!props.open) return;
    setTo(initial?.to || []);
    setCc(initial?.cc || []);
    setShowCc(Boolean(initial?.cc?.length));
    setSubject(initial?.subject || "");
    setText(initial?.text || "");
    setHtml(initial?.html || "");
    setAttachments([]);
    setDraftId(initial?.draftId || null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const onEditorChange = useCallback((h: string, t: string) => {
    setHtml(h);
    setText(t);
  }, []);

  async function pickFiles(files: FileList | null) {
    if (!files?.length) return;
    const next = [...attachments];
    for (const file of Array.from(files)) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      next.push({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        base64: btoa(binary),
      });
    }
    const total = next.reduce((s, a) => s + a.sizeBytes, 0);
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      setError("Pièces jointes trop volumineuses (max 25 Mo au total).");
      return;
    }
    setError(null);
    setAttachments(next);
  }

  function payloadBase() {
    return {
      to,
      cc: cc.length ? cc : undefined,
      subject,
      text: text || null,
      html: html || null,
      inReplyTo: initial?.inReplyTo ?? null,
      references: initial?.references ?? null,
      attachments: attachments.length
        ? attachments.map((a) => ({
            filename: a.filename,
            content_type: a.contentType,
            content_base64: a.base64,
          }))
        : undefined,
    };
  }

  async function saveDraft() {
    setBusy("draft");
    setError(null);
    try {
      if (draftId) {
        const r = await fetch(`${props.apiBase}/drafts/${draftId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBase()),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "sauvegarde échouée");
        }
        // Nouvelles PJ ajoutées au brouillon existant.
        for (const a of attachments) {
          await fetch(`${props.apiBase}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mailId: draftId,
              filename: a.filename,
              content_type: a.contentType,
              content_base64: a.base64,
            }),
          });
        }
        setAttachments([]);
      } else {
        const r = await fetch(`${props.apiBase}/drafts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBase()),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "sauvegarde échouée");
        setDraftId(j.mail?.id || null);
        setAttachments([]);
      }
      props.onDone("draft");
    } catch (e) {
      setError(e instanceof Error ? e.message : "sauvegarde échouée");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!to.length) {
      setError("Destinataire requis.");
      return;
    }
    if (!subject.trim()) {
      setError("Objet requis.");
      return;
    }
    setBusy("send");
    setError(null);
    try {
      let r: Response;
      if (draftId) {
        // Synchroniser le brouillon puis l'envoyer.
        await fetch(`${props.apiBase}/drafts/${draftId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBase()),
        });
        for (const a of attachments) {
          await fetch(`${props.apiBase}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mailId: draftId,
              filename: a.filename,
              content_type: a.contentType,
              content_base64: a.base64,
            }),
          });
        }
        r = await fetch(`${props.apiBase}/drafts/${draftId}/send`, {
          method: "POST",
        });
      } else {
        r = await fetch(`${props.apiBase}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payloadBase()),
        });
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "envoi échoué");
      props.onDone("sent");
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "envoi échoué");
    } finally {
      setBusy(false);
    }
  }

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#e6e0d4] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#ebe4d8] px-4 py-3">
          <h3 className="text-sm font-semibold text-[#14182f]">
            {initial?.inReplyTo
              ? "Répondre"
              : draftId
                ? "Brouillon"
                : "Nouveau message"}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={props.onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xs text-[#9aa1b2]">À</span>
            <RecipientsInput
              value={to}
              onChange={setTo}
              placeholder="destinataire@exemple.fr"
              className="flex-1"
              disabled={Boolean(busy)}
            />
            {!showCc && (
              <button
                type="button"
                onClick={() => setShowCc(true)}
                className="shrink-0 text-xs text-[#5c6478] hover:text-[#14182f]"
              >
                Cc
              </button>
            )}
          </div>
          {showCc && (
            <div className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-xs text-[#9aa1b2]">Cc</span>
              <RecipientsInput
                value={cc}
                onChange={setCc}
                className="flex-1"
                disabled={Boolean(busy)}
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-xs text-[#9aa1b2]">Objet</span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={Boolean(busy)}
              className="h-9 flex-1 border-[#e6e0d4]"
            />
          </div>

          {tiptap && tiptap !== "loading" ? (
            <TiptapEditor
              mods={tiptap}
              initialHtml={html || (text ? `<p>${text}</p>` : "")}
              onChange={onEditorChange}
            />
          ) : (
            /* Fallback sans Tiptap (module absent) : texte brut. */
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setHtml("");
              }}
              disabled={Boolean(busy)}
              rows={8}
              placeholder="Votre message…"
            />
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a, i) => (
                <span
                  key={`${a.filename}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#e6e0d4] bg-[#faf7f1] px-2 py-1 text-xs text-[#3a4158]"
                >
                  <Paperclip className="h-3 w-3" />
                  {a.filename}
                  <span className="text-[#9aa1b2]">
                    ({Math.max(1, Math.round(a.sizeBytes / 1024))} Ko)
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-[#9aa1b2] hover:text-[#14182f]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-[#ebe4d8] px-4 py-3">
          <Button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void send()}
            className="gap-2"
          >
            {busy === "send" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Envoyer
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() => void saveDraft()}
          >
            {busy === "draft" ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            Enregistrer le brouillon
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void pickFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-9 w-9"
            disabled={Boolean(busy)}
            onClick={() => fileRef.current?.click()}
            title="Joindre un fichier"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
