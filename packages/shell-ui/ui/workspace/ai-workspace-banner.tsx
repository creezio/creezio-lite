"use client";

/**
 * Bandeau visible uniquement dans une WebContentsView espace IA.
 * « Retour au workspace principal » = showOwner (pas stop-impersonate).
 *
 * P4 (missions) : abonné au flux SSE d'activité de l'IA
 * (/api/v1/tasks/activity/:userId/stream) — quand un run démarre, une
 * notification visuelle apparaît dans le bandeau (pulse + titre de la
 * mission) ; elle passe en « terminé » à la fin du run.
 */

import { useEffect, useState } from "react";
import { Bot, ListTodo, Loader2, Undo2 } from "lucide-react";
import Link from "next/link";
import { Button } from "../primitives/button";
import { AiActivityPanelHost } from "./ai-activity-panel-host";
import { cn, getShellDesktopApi } from "@creezio/shell-ui";
import { aidProps } from "../lib/aid";

type Identity = {
  userId: string;
  label: string;
  active: boolean;
};

type RunNotice = {
  runId: string;
  status: string;
  taskTitle: string | null;
};

const RUNNING_STATUSES = new Set(["queued", "running", "hitl_waiting"]);

export function AiWorkspaceBanner() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [notice, setNotice] = useState<RunNotice | null>(null);

  useEffect(() => {
    const api = typeof window !== "undefined" ? getShellDesktopApi() : undefined;
    if (!api?.getAiWorkspaceIdentity) return;

    let cancelled = false;
    void api.getAiWorkspaceIdentity().then((id: { userId?: string; label?: string; active?: boolean } | null) => {
      if (cancelled) return;
      if (id?.userId) {
        setIdentity({
          userId: id.userId,
          label: id.label || id.userId,
          active: Boolean(id.active),
        });
        return;
      }
      // Pas d’espace IA — ignorer un éventuel sessionStorage fantôme.
      setIdentity(null);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Notification de mission : flux SSE d'activité existant (event `run`).
  useEffect(() => {
    if (!identity?.userId) return;
    const es = new EventSource(
      `/api/v1/tasks/activity/${encodeURIComponent(identity.userId)}/stream`,
    );
    const onRun = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data)) as {
          run?: { id?: string; status?: string } | null;
          task?: { title?: string } | null;
        };
        if (!data.run?.id) return;
        setNotice({
          runId: data.run.id,
          status: String(data.run.status || ""),
          taskTitle: data.task?.title || null,
        });
      } catch {
        /* frame illisible — ignorer */
      }
    };
    es.addEventListener("run", onRun);
    es.onerror = () => {
      /* reconnexion auto EventSource */
    };
    return () => {
      es.removeEventListener("run", onRun);
      es.close();
    };
  }, [identity?.userId]);

  if (!identity?.userId) return null;

  const running = notice ? RUNNING_STATUSES.has(notice.status) : false;

  return (
    <div className="border-b border-sky-300 bg-sky-50 text-sky-950">
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Espace collaborateur IA <strong>{identity.label}</strong>
            <span className="ml-1 opacity-70">
              — vue workspace réelle (fake-cursor live)
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            asChild
          >
            <Link
              href={`/taches?assignee=${encodeURIComponent(identity.userId)}`}
              {...aidProps("ai-banner-missions")}
            >
              <ListTodo className="mr-1.5 h-3.5 w-3.5" />
              Mes missions
            </Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 border-sky-400 bg-white"
            onClick={() => {
              void getShellDesktopApi()?.showOwnerWorkspace?.();
            }}
          >
            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
            Retour au workspace principal
          </Button>
        </div>
      </div>
      {notice ? (
        <div
          {...aidProps("ai-banner-run-notice")}
          data-creezio-run-status={notice.status}
          className={cn(
            "flex items-center gap-2 border-t px-3 py-1.5 text-xs",
            running
              ? "animate-pulse border-violet-200 bg-violet-50 text-violet-900"
              : "border-sky-200 bg-white/70 text-slate-600",
          )}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {running
            ? `Mission en cours${notice.taskTitle ? ` : ${notice.taskTitle}` : ""}`
            : `Dernière mission ${notice.status === "succeeded" ? "terminée" : notice.status}${notice.taskTitle ? ` : ${notice.taskTitle}` : ""}`}
        </div>
      ) : null}
      <div className="border-t border-sky-200 bg-white/80 px-3 py-2">
        <AiActivityPanelHost
          userId={identity.userId}
          compact
          title={`Logs — ${identity.label}`}
          className="border-sky-200"
        />
      </div>
    </div>
  );
}
