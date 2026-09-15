"use client";

/**
 * Workspace notes Granola — liste filtrable + fiche (résumé / transcript).
 * Possédé par GRANOLA-1.
 *
 * Tous les appels réseau passent par `/api/v1/modules/granola/*` (jamais
 * `public-api.granola.ai` depuis le browser).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/granola";
const ALL_FOLDERS = "__all__";
const SYNC_BATCH = 10;

type NoteRow = {
  id: string;
  title: string | null;
  summary: string | null;
  note_created_at: string | null;
  note_updated_at?: string | null;
  synced_at: string;
  folder_id?: string | null;
};

type FolderRow = {
  id: string;
  name?: string;
  title?: string;
};

type TranscriptEntry = {
  text?: string;
  speaker?: string;
  start?: number;
  end?: number;
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function folderLabel(folder: FolderRow): string {
  return folder.name || folder.title || folder.id;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function extractTranscript(payload: unknown): TranscriptEntry[] {
  if (typeof payload === "string" && payload.trim()) {
    return [{ text: payload }];
  }
  if (Array.isArray(payload)) {
    return payload.filter(
      (x): x is TranscriptEntry => Boolean(x) && typeof x === "object",
    );
  }
  const rec = asRecord(payload);
  if (!rec) return [];
  if (typeof rec.transcript === "string" && rec.transcript.trim()) {
    return [{ text: rec.transcript }];
  }
  for (const key of ["transcript", "entries", "segments", "items"]) {
    const v = rec[key];
    if (Array.isArray(v)) {
      return v.filter(
        (x): x is TranscriptEntry => Boolean(x) && typeof x === "object",
      );
    }
  }
  return [];
}

function extractNextCursor(payload: unknown): string | null {
  const rec = asRecord(payload);
  if (!rec) return null;
  if (typeof rec.next_cursor === "string" && rec.next_cursor) {
    return rec.next_cursor;
  }
  return null;
}

function parseFolderList(data: unknown): FolderRow[] {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(asRecord(data)?.folders)
      ? (asRecord(data)?.folders as unknown[])
      : [];
  return raw.filter((x): x is FolderRow => {
    const rec = asRecord(x);
    return Boolean(rec && typeof rec.id === "string");
  });
}

function parseRemoteNotes(data: unknown): { id: string }[] {
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(asRecord(data)?.notes)
      ? (asRecord(data)?.notes as unknown[])
      : [];
  return raw.filter((x): x is { id: string } => {
    const rec = asRecord(x);
    return Boolean(rec && typeof rec.id === "string");
  });
}

export function GranolaNotesPanel() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState(ALL_FOLDERS);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [transcriptCursor, setTranscriptCursor] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  const folderNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of folders) map.set(folder.id, folderLabel(folder));
    return map;
  }, [folders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (folderId !== ALL_FOLDERS && (n.folder_id || "") !== folderId) {
        return false;
      }
      if (!q) return true;
      return (n.title || "").toLowerCase().includes(q);
    });
  }, [notes, query, folderId]);

  const refreshNotes = useCallback(async () => {
    try {
      const r = await fetch(`${API}/notes?limit=200`, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) setNotes(Array.isArray(j.items) ? j.items : []);
    } catch {
      toast.error("Impossible de charger les notes");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshFolders = useCallback(async () => {
    try {
      const r = await fetch(`${API}/remote/folders`, { cache: "no-store" });
      if (r.status === 409 || r.status === 401 || !r.ok) {
        setFolders([]);
        return;
      }
      const j = await r.json();
      if (!j?.ok) {
        setFolders([]);
        return;
      }
      setFolders(parseFolderList(j.data));
    } catch {
      setFolders([]);
    }
  }, []);

  useEffect(() => {
    void refreshNotes();
    void refreshFolders();
    const t = setInterval(() => void refreshNotes(), 20000);
    return () => clearInterval(t);
  }, [refreshNotes, refreshFolders]);

  const loadTranscript = useCallback(
    async (id: string, cursor?: string | null, append = false) => {
      setTranscriptLoading(true);
      try {
        const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
        const r = await fetch(
          `${API}/notes/${encodeURIComponent(id)}/transcript${qs}`,
          { cache: "no-store" },
        );
        const j = await r.json();
        if (!j?.ok) {
          if (r.status !== 409 && r.status !== 401) {
            toast.error(
              typeof j?.error === "string" ? j.error : "Transcript indisponible",
            );
          }
          if (!append) setTranscript([]);
          setTranscriptCursor(null);
          return;
        }
        const entries = extractTranscript(j.data);
        setTranscript((prev) => (append ? [...prev, ...entries] : entries));
        setTranscriptCursor(extractNextCursor(j.data));
      } catch {
        if (!append) setTranscript([]);
        setTranscriptCursor(null);
      } finally {
        setTranscriptLoading(false);
      }
    },
    [],
  );

  const openNote = useCallback(
    async (id: string) => {
      setOpenId(id);
      setDetail(null);
      setTranscript([]);
      setTranscriptCursor(null);
      setDetailLoading(true);
      try {
        const r = await fetch(`${API}/notes/${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!j?.ok) {
          toast.error(
            typeof j?.error === "string" ? j.error : "Note introuvable",
          );
          return;
        }
        const note = asRecord(j.note) ?? {};
        setDetail(note);
        const local = extractTranscript(note);
        if (local.length > 0) {
          setTranscript(local);
          setTranscriptCursor(extractNextCursor(note));
        } else {
          await loadTranscript(id);
        }
      } catch {
        toast.error("Impossible d'ouvrir la note");
      } finally {
        setDetailLoading(false);
      }
    },
    [loadTranscript],
  );

  const closeNote = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setTranscript([]);
    setTranscriptCursor(null);
  }, []);

  const resyncNote = useCallback(
    async (id: string) => {
      setResyncing(true);
      try {
        const r = await fetch(`${API}/notes/${encodeURIComponent(id)}/sync`, {
          method: "POST",
        });
        const j = await r.json();
        if (!j?.ok) {
          toast.error(
            j?.error === "granola_api_key_missing"
              ? "Clé API Granola manquante."
              : typeof j?.error === "string"
                ? j.error
                : "Re-synchronisation impossible",
          );
          return;
        }
        toast.success("Note re-synchronisée");
        await refreshNotes();
        await openNote(id);
      } catch {
        toast.error("Re-synchronisation impossible");
      } finally {
        setResyncing(false);
      }
    },
    [openNote, refreshNotes],
  );

  const syncFromRemote = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await fetch(`${API}/remote/notes`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) {
        toast.error(
          j?.error === "granola_api_key_missing"
            ? "Clé API Granola manquante — configurez-la dans le panneau ci-dessous."
            : typeof j?.error === "string"
              ? j.error
              : "Liste distante indisponible",
        );
        return;
      }
      const remote = parseRemoteNotes(j.data);
      const localIds = new Set(notes.map((n) => n.id));
      const missing = remote
        .map((n) => n.id)
        .filter((id) => id && !localIds.has(id));
      if (missing.length === 0) {
        toast.success("Déjà à jour — aucune note distante manquante.");
        await refreshNotes();
        return;
      }
      let ok = 0;
      let fail = 0;
      for (let i = 0; i < missing.length; i += SYNC_BATCH) {
        const chunk = missing.slice(i, i + SYNC_BATCH);
        const results = await Promise.allSettled(
          chunk.map((id) =>
            fetch(`${API}/notes/${encodeURIComponent(id)}/sync`, {
              method: "POST",
            }).then((res) => res.json()),
          ),
        );
        for (const res of results) {
          if (res.status === "fulfilled" && res.value?.ok) ok += 1;
          else fail += 1;
        }
      }
      await refreshNotes();
      toast.success(
        fail
          ? `${ok} note(s) synchronisée(s), ${fail} échec(s).`
          : `${ok} note(s) synchronisée(s) depuis Granola.`,
      );
    } catch {
      toast.error("Synchronisation distante impossible");
    } finally {
      setSyncing(false);
    }
  }, [notes, refreshNotes]);

  const openFolderId =
    (typeof detail?.folder_id === "string" && detail.folder_id) ||
    notes.find((n) => n.id === openId)?.folder_id ||
    null;
  const openFolderName = openFolderId
    ? folderNameById.get(openFolderId) || openFolderId
    : null;
  const openTitle =
    (typeof detail?.title === "string" && detail.title) ||
    notes.find((n) => n.id === openId)?.title ||
    openId ||
    "Note";
  const openCreated =
    (typeof detail?.created_at === "string" && detail.created_at) ||
    notes.find((n) => n.id === openId)?.note_created_at ||
    null;
  const openUpdated =
    (typeof detail?.updated_at === "string" && detail.updated_at) ||
    notes.find((n) => n.id === openId)?.note_updated_at ||
    null;
  const openSummary =
    (typeof detail?.summary === "string" && detail.summary) ||
    notes.find((n) => n.id === openId)?.summary ||
    "";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Notes</h2>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Chargement…"
              : `${filtered.length} note${filtered.length > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <Label htmlFor="granola-notes-search">Rechercher</Label>
            <Input
              id="granola-notes-search"
              placeholder="Filtrer par titre"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="sm:w-56"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="granola-notes-folder">Dossier</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="granola-notes-folder" className="sm:w-52">
                <SelectValue placeholder="Tous les dossiers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FOLDERS}>Tous les dossiers</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folderLabel(folder)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={() => void syncFromRemote()}
            disabled={syncing}
          >
            {syncing ? "Synchronisation…" : "Synchroniser depuis Granola"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-full" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aucune note</CardTitle>
            <CardDescription>
              {notes.length === 0
                ? "Aucune note synchronisée pour l'instant. Enregistrez le webhook ci-dessous ou importez les notes déjà présentes dans Granola."
                : "Aucune note ne correspond à ce filtre."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {notes.length === 0 ? (
              <Button
                size="sm"
                onClick={() => void syncFromRemote()}
                disabled={syncing}
              >
                {syncing ? "Synchronisation…" : "Synchroniser depuis Granola"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setFolderId(ALL_FOLDERS);
                }}
              >
                Réinitialiser les filtres
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((n) => {
            const folderName = n.folder_id
              ? folderNameById.get(n.folder_id) || n.folder_id
              : null;
            return (
              <Card
                key={n.id}
                className="cursor-pointer transition-colors hover:bg-accent"
                onClick={() => void openNote(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void openNote(n.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <CardHeader className="p-4 pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="truncate text-sm">
                      {n.title || n.id}
                    </CardTitle>
                    {folderName ? (
                      <Badge variant="secondary">{folderName}</Badge>
                    ) : null}
                  </div>
                  <CardDescription className="line-clamp-2">
                    {n.summary || "Pas de résumé"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0 text-[11px] text-muted-foreground">
                  {fmtDate(n.note_created_at || n.synced_at)}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet
        open={Boolean(openId)}
        onOpenChange={(open) => {
          if (!open) closeNote();
        }}
      >
        <SheetContent
          side="right"
          className="w-full max-w-full sm:max-w-xl lg:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle className="pr-6">{openTitle}</SheetTitle>
            <SheetDescription>
              {openFolderName ? `${openFolderName} · ` : ""}
              Créée {fmtDate(openCreated)} · MAJ {fmtDate(openUpdated)}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2">
              {openFolderName ? (
                <Badge variant="secondary">{openFolderName}</Badge>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={!openId || resyncing}
                onClick={() => openId && void resyncNote(openId)}
              >
                {resyncing ? "Synchronisation…" : "Re-synchroniser"}
              </Button>
            </div>
            {detailLoading ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : (
              <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col">
                <TabsList>
                  <TabsTrigger value="summary">Résumé</TabsTrigger>
                  <TabsTrigger value="transcript">Transcript</TabsTrigger>
                </TabsList>
                <TabsContent value="summary" className="min-h-0 flex-1">
                  <ScrollArea className="h-[min(28rem,60vh)] pr-3">
                    <div className="whitespace-pre-wrap text-sm">
                      {openSummary || "Pas de résumé pour cette note."}
                    </div>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="transcript" className="min-h-0 flex-1">
                  <ScrollArea className="h-[min(28rem,60vh)] pr-3">
                    {transcript.length === 0 && !transcriptLoading ? (
                      <p className="text-sm text-muted-foreground">
                        Aucun transcript pour cette note.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {transcript.map((seg, i) => (
                          <div key={`${seg.speaker || "seg"}-${i}`}>
                            {seg.speaker ? (
                              <div className="text-xs font-medium">
                                {seg.speaker}
                              </div>
                            ) : null}
                            <p className="whitespace-pre-wrap text-sm">
                              {seg.text || "—"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {transcriptLoading ? (
                      <Skeleton className="mt-3 h-8 w-full" />
                    ) : null}
                    {transcriptCursor && openId ? (
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        disabled={transcriptLoading}
                        onClick={() =>
                          void loadTranscript(openId, transcriptCursor, true)
                        }
                      >
                        Charger la suite
                      </Button>
                    ) : null}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
