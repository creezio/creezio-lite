"use client";

/**
 * Liste agents + panneau runs de l'agent ouvert — possédé par GROKBOT-2.
 *
 * Poll fin, filtre archivés, unarchive, confirmation cancel (AlertDialog
 * = Dialog kit : le kit n'exporte pas de primitive AlertDialog),
 * timeline (durée, result, branches/PR), skeletons, empty/token CTA.
 */

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Skeleton,
  Textarea,
} from "@creezio/shell-ui/ui/kit";

/** Confirmation destructive — alias Dialog (kit n'a pas AlertDialog). */
const AlertDialog = Dialog;
const AlertDialogContent = DialogContent;
const AlertDialogDescription = DialogDescription;
const AlertDialogFooter = DialogFooter;
const AlertDialogHeader = DialogHeader;
const AlertDialogTitle = DialogTitle;

export type GrokbotAgentItem = {
  id: string;
  name?: string | null;
  status?: string | null;
  url?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  latestRunId?: string | null;
  latest_run_id?: string | null;
  repo_url?: string | null;
  pr_url?: string | null;
};

export type GrokbotRunItem = {
  id: string;
  status: string;
  createdAt?: string;
  durationMs?: number;
  result?: string;
  git?: { branches?: Array<{ repoUrl?: string; branch?: string; prUrl?: string }> };
};

export function statusVariant(
  status: string | null | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  const s = (status || "").toUpperCase();
  if (s === "RUNNING" || s === "CREATING" || s === "ACTIVE") return "default";
  if (s === "FINISHED" || s === "IDLE") return "secondary";
  if (s === "ERROR" || s === "EXPIRED") return "destructive";
  return "outline";
}

export function isArchivedStatus(status: string | null | undefined): boolean {
  return (status || "").toUpperCase() === "ARCHIVED";
}

export function isLiveRunStatus(status: string | null | undefined): boolean {
  const s = (status || "").toUpperCase();
  return s === "RUNNING" || s === "CREATING";
}

export function fmtDate(iso: string | null | undefined): string {
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

export function fmtDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec ? `${min} min ${sec} s` : `${min} min`;
}

export type GrokbotAgentListProps = {
  agents: GrokbotAgentItem[];
  openId: string | null;
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  onSelect: (agentId: string) => void;
  onUnarchive: (agentId: string) => void;
  tokenMissing: boolean;
  busy: boolean;
};

export function GrokbotAgentList({
  agents,
  openId,
  showArchived,
  onShowArchivedChange,
  onSelect,
  onUnarchive,
  tokenMissing,
  busy,
}: GrokbotAgentListProps) {
  const visible = agents.filter((a) =>
    showArchived ? isArchivedStatus(a.status) : !isArchivedStatus(a.status),
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Agents ({visible.length}
          {showArchived ? " archivés" : ""})
        </h2>
        <Button
          type="button"
          size="sm"
          variant={showArchived ? "default" : "outline"}
          aria-pressed={showArchived}
          onClick={() => onShowArchivedChange(!showArchived)}
        >
          Archivés
        </Button>
      </div>

      {tokenMissing ? (
        <Card className="flex flex-col gap-2 p-4">
          <p className="text-sm font-medium">Token Cursor manquant</p>
          <p className="text-sm text-muted-foreground">
            Enregistrez un token API Cursor (carte Connexion ci-dessus)
            pour lancer et suivre vos agents cloud. La liste ci-dessous
            resterait vide ou périmée sans clé.
          </p>
        </Card>
      ) : null}

      {!tokenMissing && visible.length === 0 ? (
        <Card className="p-4 text-sm text-muted-foreground">
          {showArchived
            ? "Aucun agent archivé."
            : "Aucun agent pour l'instant."}
        </Card>
      ) : null}

      {visible.map((a) => (
        <Card
          key={a.id}
          role="button"
          tabIndex={0}
          aria-pressed={openId === a.id}
          aria-label={`Agent ${a.name || a.id}`}
          className={`cursor-pointer p-3 transition-colors hover:bg-accent ${
            openId === a.id ? "border-primary" : ""
          }`}
          onClick={() => onSelect(a.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(a.id);
            }
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{a.name || a.id}</span>
            <Badge variant={statusVariant(a.status)}>{a.status || "?"}</Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {a.repo_url || "—"}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{fmtDate(a.createdAt || a.created_at)}</span>
            {isArchivedStatus(a.status) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onUnarchive(a.id);
                }}
              >
                Désarchiver
              </Button>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

export type GrokbotAgentRunsProps = {
  open: GrokbotAgentItem | null;
  runs: GrokbotRunItem[];
  runsLoading?: boolean;
  followup: string;
  onFollowupChange: (value: string) => void;
  onSendFollowup: () => void;
  onCancelRun: (runId: string) => void;
  onArchive: (agentId: string) => void;
  onUnarchive: (agentId: string) => void;
  busy: boolean;
};

export function GrokbotAgentRuns({
  open,
  runs,
  runsLoading = false,
  followup,
  onFollowupChange,
  onSendFollowup,
  onCancelRun,
  onArchive,
  onUnarchive,
  busy,
}: GrokbotAgentRunsProps) {
  const [pendingCancel, setPendingCancel] = useState<string | null>(null);

  if (!open) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Sélectionnez un agent pour voir ses runs.
      </Card>
    );
  }

  const archived = isArchivedStatus(open.status);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate text-base font-semibold">{open.name || open.id}</h2>
        <div className="flex items-center gap-2">
          {open.url ? (
            <Button asChild size="sm" variant="outline">
              <a href={open.url} target="_blank" rel="noreferrer">
                Ouvrir dans Cursor
              </a>
            </Button>
          ) : null}
          {archived ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onUnarchive(open.id)}
            >
              Désarchiver
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void onArchive(open.id)}>
              Archiver
            </Button>
          )}
        </div>
      </div>

      <ol
        className="flex max-h-96 flex-col gap-2 overflow-y-auto"
        aria-label="Timeline des runs"
        aria-busy={runsLoading}
      >
        {runsLoading && runs.length === 0
          ? [0, 1, 2].map((i) => (
              <li key={`sk-${i}`} className="rounded-md bg-muted p-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="mt-2 h-10 w-full" />
              </li>
            ))
          : null}
        {runs.map((r) => {
          const duration = fmtDuration(r.durationMs);
          return (
            <li key={r.id} className="rounded-md bg-muted p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  {duration ? (
                    <span className="text-[11px] text-muted-foreground">
                      {duration}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {fmtDate(r.createdAt)}
                  </span>
                  {isLiveRunStatus(r.status) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingCancel(r.id)}
                    >
                      Annuler
                    </Button>
                  ) : null}
                </div>
              </div>
              {r.result ? (
                <div className="mt-2 whitespace-pre-wrap text-xs">{r.result}</div>
              ) : null}
              {r.git?.branches?.length ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-[11px]">
                  {r.git.branches.map((b, i) => (
                    <li key={`${b.branch || b.prUrl || i}`}>
                      {b.prUrl ? (
                        <a
                          className="underline"
                          href={b.prUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {b.branch ? `PR · ${b.branch}` : "Ouvrir la PR"}
                        </a>
                      ) : b.branch ? (
                        <span className="text-muted-foreground">{b.branch}</span>
                      ) : b.repoUrl ? (
                        <a
                          className="underline"
                          href={
                            b.repoUrl.startsWith("http")
                              ? b.repoUrl
                              : `https://${b.repoUrl}`
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {b.repoUrl}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
        {!runsLoading && runs.length === 0 ? (
          <li className="text-sm text-muted-foreground">Aucun run chargé.</li>
        ) : null}
      </ol>

      <div className="flex flex-col gap-2">
        <Label htmlFor="grokbot-followup">Prompt de suivi</Label>
        <Textarea
          id="grokbot-followup"
          className="min-h-16"
          placeholder="Prompt de suivi…"
          value={followup}
          onChange={(e) => onFollowupChange(e.target.value)}
        />
        <div>
          <Button size="sm" onClick={onSendFollowup} disabled={busy || !followup.trim()}>
            Envoyer
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingCancel != null}
        onOpenChange={(next) => {
          if (!next) setPendingCancel(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler ce run ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le run en cours sera interrompu. Cette action ne peut pas être
              annulée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingCancel(null)}>
              Retour
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (pendingCancel) onCancelRun(pendingCancel);
                setPendingCancel(null);
              }}
            >
              Annuler le run
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
