"use client";

/**
 * Cockpit CRM (owner) — sous-ensemble santé / IA / accès admin / ACL.
 * Shell autonome : `@creezio/cockpit/ui` ServerCockpitShell.
 */

import Link from "next/link";
import {
  Activity,
  AppWindow,
  Bot,
  ExternalLink,
  Eye,
  Loader2,
  MonitorX,
  Puzzle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@creezio/shell-ui/ui/kit";
import { Button } from "@creezio/shell-ui/ui/kit";
import { AiActivityPanel } from "@creezio/tasks/ui";
import { cn } from "@creezio/shell-ui";
import type { CockpitConfig } from "@creezio/cockpit";
import { useCockpitDashboard } from "./hooks/use-cockpit-dashboard";
import { ServiceCard } from "./parts/service-card";
import { StatusDot } from "./parts/status-dot";

export type CockpitClientProps = {
  config?: Partial<CockpitConfig>;
  className?: string;
};

export function CockpitClient(props: CockpitClientProps = {}) {
  const d = useCockpitDashboard({ config: props.config });

  return (
    <div
      className={cn("space-y-6", props.className)}
      data-creezio-aid="cockpit-root"
    >
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Activity className="h-4 w-4" /> Santé des services
          </h2>
          <Button size="sm" variant="ghost" onClick={() => void d.load()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Actualiser
          </Button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <div className="flex items-center gap-2 rounded border p-3">
            <StatusDot ok={Boolean(d.health?.next.ok)} muted={!d.health} />
            <div className="min-w-0">
              <div className="text-sm font-medium">Serveur CRM</div>
              <div className="truncate text-xs text-muted-foreground">
                {d.health
                  ? d.health.next.db
                    ? "Base OK"
                    : "Base absente"
                  : "…"}
              </div>
            </div>
          </div>
          <ServiceCard label="Meilisearch" health={d.health?.meili ?? null} />
          <ServiceCard label="Hermes" health={d.health?.hermes ?? null} />
          <ServiceCard label="n8n" health={d.health?.n8n ?? null} />
          <div className="flex items-center gap-2 rounded border p-3">
            <StatusDot
              ok={d.tunnelOk}
              muted={!d.health?.tunnel.configured && !d.tunnelLive}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium">Tunnel</div>
              <div className="truncate text-xs text-muted-foreground">
                {d.tunnelUrl || "Non configuré"}
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {d.bridgesOnline} hôte(s) desktop connecté(s) ·{" "}
          {d.health?.ai_collaborators ?? 0} collaborateur(s) IA actif(s)
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Bot className="h-4 w-4" /> Collaborateurs IA
        </h2>
        {d.aiUsers.length === 0 ? (
          <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            Aucun collaborateur IA actif —{" "}
            <Link className="underline" href="/collaborateurs">
              en créer un
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {d.aiUsers.map((u) => {
              const act = d.activity[u.id];
              return (
                <div
                  key={u.id}
                  className="space-y-2 rounded border p-3"
                  data-creezio-aid={`cockpit-ai-${u.username}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Bot className="h-4 w-4 shrink-0 text-violet-600" />
                      <strong className="truncate">{u.username}</strong>
                      <Badge
                        variant="outline"
                        className={cn(
                          "gap-1 border-0 text-[11px]",
                          act?.running
                            ? "bg-violet-100 text-violet-900"
                            : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {act?.running ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {act.taskTitle
                              ? `Travaille : ${act.taskTitle}`
                              : "En train de travailler"}
                          </>
                        ) : (
                          "Au repos"
                        )}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!d.isDesktop || d.busy === `open:${u.id}`}
                      onClick={() => void d.openWorkspace(u)}
                      title={
                        d.isDesktop
                          ? "Ouvrir la fenêtre workspace de cette IA"
                          : "Disponible dans l'app desktop hôte"
                      }
                    >
                      <AppWindow className="mr-1.5 h-3.5 w-3.5" />
                      Ouvrir le workspace
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={d.busy === `close:${u.id}`}
                      onClick={() => void d.closeWorkspace(u)}
                      title="Vraie fermeture — libère la RAM de la fenêtre IA"
                    >
                      <MonitorX className="mr-1.5 h-3.5 w-3.5" />
                      Fermer la fenêtre
                    </Button>
                    <Button
                      size="sm"
                      variant={d.liveUserId === u.id ? "default" : "ghost"}
                      onClick={() =>
                        d.setLiveUserId((prev) =>
                          prev === u.id ? null : u.id,
                        )
                      }
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Vue live
                    </Button>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/taches?q=${encodeURIComponent(u.username)}`}>
                        Ses tâches
                      </Link>
                    </Button>
                  </div>
                  {d.liveUserId === u.id ? (
                    <AiActivityPanel userId={u.id} compact title={u.username} />
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="h-4 w-4" /> Accès &amp; administration
        </h2>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            onClick={() => void d.openAdminApp()}
            data-creezio-aid="cockpit-open-admin"
          >
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Ouvrir l&apos;app admin
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/api">API &amp; endpoints</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/request-logs">Logs requêtes</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/mcp">MCP</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/admin/plugins">Plugins (admin)</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/configuration">Clés API &amp; diagnostic</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href="/collaborateurs">Inviter un collaborateur</Link>
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Puzzle className="h-4 w-4" /> Visibilité des plugins (ACL)
        </h2>
        <p className="text-xs text-muted-foreground">
          Fail-closed : sans opt-in, un plugin n&apos;est visible que par vous.
          Cochez les collaborateurs (humains ou IA) autorisés à voir chaque
          plugin.
        </p>
        {d.acl.length === 0 ? (
          <p className="rounded border border-dashed p-4 text-sm text-muted-foreground">
            Aucun plugin dans le Product Hub pour le moment.
          </p>
        ) : (
          <div className="space-y-2">
            {d.acl.map((p) => (
              <div
                key={p.plugin_id}
                className="flex flex-wrap items-center gap-3 rounded border p-3"
                data-creezio-aid={`cockpit-acl-${p.plugin_id}`}
              >
                <strong className="min-w-40 text-sm">{p.name}</strong>
                {d.collaborators.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Aucun collaborateur actif
                  </span>
                ) : (
                  d.collaborators.map((u) => (
                    <label
                      key={u.id}
                      className="flex cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={p.user_ids.includes(u.id)}
                        onChange={() => void d.toggleAcl(p, u.id)}
                      />
                      {u.kind === "ai" ? (
                        <Bot className="h-3.5 w-3.5 text-violet-600" />
                      ) : null}
                      {u.username}
                    </label>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
