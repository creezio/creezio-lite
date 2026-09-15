"use client";

/**
 * Page /granola côté serveur marque — compose le workspace notes
 * (`GranolaNotesPanel`, GRANOLA-1) et le panneau config/webhook
 * (`GranolaConnectPanel`, GRANOLA-2).
 *
 * API : /api/v1/modules/granola/* (mount natif @creezio/granola).
 */

import { useCallback } from "react";
import { Toaster } from "@creezio/shell-ui/ui/kit";
import { GranolaConnectPanel } from "./granola-connect-panel";
import { GranolaNotesPanel } from "./granola-notes-panel";

export function GranolaClient() {
  const onSelectNote = useCallback((noteId: string) => {
    document
      .getElementById("granola-notes-workspace")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      window.history.replaceState(
        null,
        "",
        `#note-${encodeURIComponent(noteId)}`,
      );
    } catch {
      /* hash optionnel */
    }
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Granola</h1>
        <p className="text-sm text-muted-foreground">
          Recevez vos notes de réunion Granola directement ici : collez l'URL
          webhook dans Granola (Settings → Connectors → Webhooks) et chaque
          note générée ou éditée est synchronisée automatiquement.
        </p>
      </div>

      <div id="granola-notes-workspace">
        <GranolaNotesPanel />
      </div>
      <GranolaConnectPanel onSelectNote={onSelectNote} />
      <Toaster />
    </div>
  );
}
