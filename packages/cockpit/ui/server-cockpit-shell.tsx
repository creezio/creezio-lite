"use client";

/**
 * Cockpit autonome app Serveur — hors AppShell CRM.
 * Onglets : Santé · IA · Accès · Logs · Plugins · Invitations (+ extraTabs).
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  AppWindow,
  Bot,
  Copy,
  Download,
  Eye,
  Loader2,
  MonitorX,
  Puzzle,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { getShellUiBrand, cn } from "@creezio/shell-ui";
import { Badge } from "@creezio/shell-ui/ui/kit";
import { Button } from "@creezio/shell-ui/ui/kit";
import { Input } from "@creezio/shell-ui/ui/kit";
import { isRemoteDesktopClient } from "@creezio/shell-ui/ui/kit";
import { AiActivityPanel } from "@creezio/tasks/ui";
import {
  buildJoinLink,
  type CockpitConfig,
} from "@creezio/cockpit";
import { DEFAULT_COCKPIT_TABS, type CockpitTabId } from "@creezio/cockpit";
import { useCockpitDashboard } from "./hooks/use-cockpit-dashboard";
import { ServiceCard } from "./parts/service-card";
import { StatusDot } from "./parts/status-dot";

const NATIVE_TABS: Array<{
  id: CockpitTabId;
  label: string;
  icon: typeof Activity;
}> = [
  { id: "sante", label: "Santé", icon: Activity },
  { id: "ia", label: "Collaborateurs IA", icon: Bot },
  { id: "acces", label: "Accès & sessions", icon: Users },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "plugins", label: "Plugins / ACL", icon: Puzzle },
  { id: "invitations", label: "Invitations", icon: UserPlus },
];

export type ServerCockpitExtraTab = {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  render: () => ReactNode;
};

export type ServerCockpitShellProps = {
  config?: Partial<CockpitConfig>;
  extraTabs?: ServerCockpitExtraTab[];
  className?: string;
};

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copié`);
  } catch {
    toast.error("Copie impossible");
  }
}

export function ServerCockpitShell(props: ServerCockpitShellProps = {}) {
  const d = useCockpitDashboard({ config: props.config, includeLogs: true });
  const productName = getShellUiBrand().productName || "Creezio";
  const enabledTabs = d.cfg.tabs?.length
    ? d.cfg.tabs
    : [...DEFAULT_COCKPIT_TABS];
  const nativeTabs = useMemo(
    () => NATIVE_TABS.filter((t) => enabledTabs.includes(t.id)),
    [enabledTabs],
  );
  const extraTabs = props.extraTabs || [];
  const allTabIds = [
    ...nativeTabs.map((t) => t.id),
    ...extraTabs.map((t) => t.id),
  ];
  const [tab, setTab] = useState<string>(nativeTabs[0]?.id || "sante");
  const [remoteClient, setRemoteClient] = useState(false);
  const [newAiName, setNewAiName] = useState("");
  const [newHumanName, setNewHumanName] = useState("");
  const [newHumanPass, setNewHumanPass] = useState("");

  useEffect(() => {
    void isRemoteDesktopClient().then(setRemoteClient);
  }, []);

  useEffect(() => {
    if (!allTabIds.includes(tab) && allTabIds[0]) {
      setTab(allTabIds[0]);
    }
  }, [allTabIds, tab]);

  const joinLink = buildJoinLink(d.cfg.deepLinkProtocol, d.tunnelHost);
  const serverUrl =
    d.tunnelUrl || (d.tunnelHost ? `https://${d.tunnelHost}` : null);
  const downloadUrl = d.cfg.clientDownloadUrl || "#";

  const activeNative = nativeTabs.find((t) => t.id === tab);
  const activeExtra = extraTabs.find((t) => t.id === tab);
  const headerLabel = activeNative?.label || activeExtra?.label || "Cockpit";

  if (remoteClient) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[#0b1020] p-8 text-slate-100"
        data-creezio-aid="server-cockpit-remote-notice"
      >
        <div className="max-w-md rounded-xl border border-white/10 bg-[#0e1528] p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-sky-400" />
          <h1 className="mt-3 text-lg font-semibold">Cockpit serveur</h1>
          <p className="mt-2 text-sm text-slate-400">
            Cette console s&apos;affiche sur le poste qui héberge {productName}{" "}
            Server. Depuis l&apos;app Client, utilisez le CRM — la supervision
            se fait sur le serveur.
          </p>
          <Button asChild className="mt-4">
            <a href="/dashboard">Retour au CRM</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-screen bg-[#0b1020] text-slate-100",
        props.className,
      )}
      data-creezio-aid="server-cockpit-root"
    >
      <aside className="flex w-56 shrink-0 flex-col border-r border-white/10 bg-[#0e1528]">
        <div className="border-b border-white/10 px-4 py-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">
            {productName} Server
          </div>
          <div className="mt-1 text-sm font-medium text-slate-200">
            Cockpit serveur
          </div>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            Monitoring &amp; workspaces IA — l&apos;app métier s&apos;ouvre
            depuis le client
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nativeTabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                data-creezio-aid={`server-cockpit-tab-${t.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                  active
                    ? "bg-sky-500/15 text-sky-200"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
          {extraTabs.map((t) => {
            const Icon = t.icon || Puzzle;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                data-creezio-aid={`server-cockpit-tab-${t.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                  active
                    ? "bg-sky-500/15 text-sky-200"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3 text-[11px] text-slate-500">
          {d.bridgesOnline} bridge · {d.clientsOnline} client(s) ·{" "}
          {d.health?.ai_collaborators ?? 0} IA
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {headerLabel}
            </h1>
            <p className="text-xs text-slate-500">
              {d.tunnelUrl || "Tunnel non configuré"} · actualisation auto{" "}
              {Math.round((d.cfg.refreshMs ?? 15_000) / 1000)} s
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-white/15 bg-white/5 text-slate-200 hover:bg-white/10"
            onClick={() => void d.load()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Actualiser
          </Button>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {tab === "sante" ? (
            <section
              className="space-y-4"
              data-creezio-aid="server-cockpit-sante"
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
                  <StatusDot
                    ok={Boolean(d.health?.next.ok)}
                    muted={!d.health}
                    variant="dark"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Serveur CRM</div>
                    <div className="truncate text-xs text-slate-400">
                      {d.health
                        ? d.health.next.db
                          ? "Base OK"
                          : "Base absente"
                        : "…"}
                    </div>
                  </div>
                </div>
                <ServiceCard
                  label="Meilisearch"
                  health={d.health?.meili ?? null}
                  variant="dark"
                />
                <ServiceCard
                  label="Hermes"
                  health={d.health?.hermes ?? null}
                  variant="dark"
                />
                <ServiceCard
                  label="n8n"
                  health={d.health?.n8n ?? null}
                  variant="dark"
                />
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
                  <StatusDot
                    ok={d.tunnelOk}
                    muted={!d.health?.tunnel.configured && !d.tunnelLive}
                    variant="dark"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Tunnel</div>
                    <div className="truncate text-xs text-slate-400">
                      {d.tunnelUrl || "Non configuré"}
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-slate-300">
                <ShieldCheck className="mb-2 h-4 w-4 text-sky-400" />
                Cette fenêtre ne contient que la supervision du serveur. Pour
                utiliser {productName} (dashboard, admin…), installez l&apos;app
                Client sur ce PC ou un autre, puis rejoignez{" "}
                <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
                  {serverUrl || "…"}
                </code>
                .
              </div>
            </section>
          ) : null}

          {tab === "ia" ? (
            <section className="space-y-4" data-creezio-aid="server-cockpit-ia">
              <div className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="min-w-[12rem] flex-1">
                  <label className="mb-1 block text-xs text-slate-400">
                    Nouveau collaborateur IA
                  </label>
                  <Input
                    value={newAiName}
                    onChange={(e) => setNewAiName(e.target.value)}
                    placeholder="ex. assistant-ia"
                    className="border-white/15 bg-black/20 text-slate-100"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={d.busy === "create-ai"}
                  onClick={() =>
                    void d.createAi(newAiName).then((ok) => {
                      if (ok) {
                        setNewAiName("");
                        setTab("ia");
                      }
                    })
                  }
                >
                  <Bot className="mr-1.5 h-3.5 w-3.5" /> Créer
                </Button>
              </div>
              {d.aiUsers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/15 p-6 text-sm text-slate-400">
                  Aucun collaborateur IA actif. Créez-en un ci-dessus : son
                  workspace sera chargé en headless, affichable au clic.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {d.aiUsers.map((u) => {
                    const act = d.activity[u.id];
                    return (
                      <div
                        key={u.id}
                        className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-4"
                        data-creezio-aid={`server-cockpit-ai-${u.username}`}
                      >
                        <div className="flex items-center gap-2">
                          <Bot className="h-4 w-4 shrink-0 text-violet-400" />
                          <strong className="truncate">{u.username}</strong>
                          <Badge
                            variant="outline"
                            className={cn(
                              "gap-1 border-0 text-[11px]",
                              act?.running
                                ? "bg-violet-500/20 text-violet-200"
                                : "bg-white/10 text-slate-400",
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
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/15 bg-transparent"
                            disabled={
                              !d.isDesktop || d.busy === `open:${u.id}`
                            }
                            onClick={() =>
                              void d.openWorkspace(u).then((r) => {
                                if (r?.ok)
                                  toast.success(
                                    `Fenêtre de ${u.username} affichée`,
                                  );
                              })
                            }
                          >
                            <AppWindow className="mr-1.5 h-3.5 w-3.5" />
                            Afficher le workspace
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/15 bg-transparent"
                            disabled={d.busy === `close:${u.id}`}
                            onClick={() => void d.closeWorkspace(u)}
                          >
                            <MonitorX className="mr-1.5 h-3.5 w-3.5" />
                            Fermer
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              d.liveUserId === u.id ? "default" : "ghost"
                            }
                            className={
                              d.liveUserId === u.id
                                ? ""
                                : "text-slate-300 hover:bg-white/10"
                            }
                            onClick={() =>
                              d.setLiveUserId((prev) =>
                                prev === u.id ? null : u.id,
                              )
                            }
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                            Vue live
                          </Button>
                        </div>
                        {d.liveUserId === u.id ? (
                          <AiActivityPanel
                            userId={u.id}
                            compact
                            title={u.username}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          {tab === "acces" ? (
            <section
              className="space-y-4"
              data-creezio-aid="server-cockpit-acces"
            >
              <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                <h2 className="mb-2 text-sm font-semibold">
                  Se connecter depuis l&apos;app Client
                </h2>
                <p className="mb-3 text-sm text-slate-400">
                  Admin et employés utilisent l&apos;app Client (pas cette
                  fenêtre). Téléchargez-la, rejoignez le serveur, puis
                  connectez-vous avec vos identifiants.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <a href={downloadUrl} target="_blank" rel="noreferrer">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Télécharger l&apos;app Client
                    </a>
                  </Button>
                  {serverUrl ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-white/15 bg-transparent"
                      onClick={() => void copyText(serverUrl, "URL du serveur")}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copier l&apos;URL serveur
                    </Button>
                  ) : null}
                </div>
                {serverUrl ? (
                  <code className="mt-3 block truncate rounded bg-black/30 px-2 py-1.5 text-xs text-sky-200">
                    {serverUrl}
                  </code>
                ) : (
                  <p className="mt-3 text-xs text-amber-300/90">
                    Configurez le tunnel pour obtenir une URL publique.
                  </p>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <h3 className="mb-2 text-sm font-semibold">
                    Clients connectés
                  </h3>
                  {(d.sessions?.users || []).length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Aucun client en ligne
                    </p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {(d.sessions?.users || []).map((u) => (
                        <li key={u.userId} className="flex items-center gap-2">
                          <StatusDot
                            ok={u.online !== false}
                            variant="dark"
                          />
                          <span className="font-mono text-xs">{u.userId}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                  <h3 className="mb-2 text-sm font-semibold">Comptes humains</h3>
                  {d.humans.length === 0 ? (
                    <p className="text-sm text-slate-500">Aucun compte humain</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {d.humans.map((u) => (
                        <li key={u.id} className="flex items-center gap-2">
                          <Users className="h-3.5 w-3.5 text-slate-500" />
                          {u.username}
                          {u.role === "owner" ? (
                            <Badge
                              variant="outline"
                              className="border-0 bg-sky-500/20 text-[10px] text-sky-200"
                            >
                              owner
                            </Badge>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {tab === "logs" ? (
            <section
              className="space-y-3"
              data-creezio-aid="server-cockpit-logs"
            >
              <p className="text-xs text-slate-500">
                40 dernières requêtes (API / MCP). Les logs détaillés restent
                aussi dans l&apos;app Client → Admin.
              </p>
              <div className="overflow-hidden rounded-lg border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">Heure</th>
                      <th className="px-3 py-2 font-medium">Méthode</th>
                      <th className="px-3 py-2 font-medium">Chemin</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.logs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-6 text-center text-slate-500"
                        >
                          Aucun log pour le moment
                        </td>
                      </tr>
                    ) : (
                      d.logs.map((entry) => (
                        <tr
                          key={entry.id}
                          className="border-t border-white/5 text-slate-300"
                        >
                          <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">
                            {new Date(entry.ts).toLocaleTimeString("fr-FR")}
                          </td>
                          <td className="px-3 py-1.5 font-mono">
                            {entry.method}
                          </td>
                          <td className="max-w-[20rem] truncate px-3 py-1.5 font-mono">
                            {entry.path}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-1.5 font-mono",
                              entry.status >= 400
                                ? "text-red-400"
                                : "text-emerald-400",
                            )}
                          >
                            {entry.status || "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {tab === "plugins" ? (
            <section
              className="space-y-3"
              data-creezio-aid="server-cockpit-plugins"
            >
              <p className="text-xs text-slate-400">
                Fail-closed : sans opt-in, un plugin n&apos;est visible que par
                l&apos;owner. Cochez les collaborateurs autorisés.
              </p>
              {d.acl.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/15 p-6 text-sm text-slate-500">
                  Aucun plugin dans le Product Hub pour le moment.
                </p>
              ) : (
                <div className="space-y-2">
                  {d.acl.map((p) => (
                    <div
                      key={p.plugin_id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3"
                    >
                      <strong className="min-w-40 text-sm">{p.name}</strong>
                      {d.collaborators.length === 0 ? (
                        <span className="text-xs text-slate-500">
                          Aucun collaborateur actif
                        </span>
                      ) : (
                        d.collaborators.map((u) => (
                          <label
                            key={u.id}
                            className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-300"
                          >
                            <input
                              type="checkbox"
                              checked={p.user_ids.includes(u.id)}
                              onChange={() => void d.toggleAcl(p, u.id)}
                            />
                            {u.kind === "ai" ? (
                              <Bot className="h-3.5 w-3.5 text-violet-400" />
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
          ) : null}

          {tab === "invitations" ? (
            <section
              className="space-y-4"
              data-creezio-aid="server-cockpit-invites"
            >
              <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold">
                  Inviter un collaborateur humain
                </h2>
                <ol className="list-decimal space-y-1 pl-4 text-sm text-slate-400">
                  <li>
                    Il installe l&apos;app Client (
                    <a
                      className="text-sky-400 underline"
                      href={downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      téléchargement
                    </a>
                    ).
                  </li>
                  <li>
                    Il rejoint ce serveur via le lien ou l&apos;URL ci-dessous.
                  </li>
                  <li>
                    Vous créez son compte ici et lui transmettez les
                    identifiants par un canal séparé.
                  </li>
                </ol>
                {joinLink && serverUrl ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 truncate rounded bg-black/30 px-2 py-1 text-xs">
                        {joinLink}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-300"
                        onClick={() =>
                          void copyText(joinLink, "Lien d'invitation")
                        }
                      >
                        <Copy className="mr-1 h-3 w-3" /> Copier
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 truncate rounded bg-black/30 px-2 py-1 text-xs">
                        {serverUrl}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-300"
                        onClick={() =>
                          void copyText(serverUrl, "URL du serveur")
                        }
                      >
                        <Copy className="mr-1 h-3 w-3" /> Copier
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-amber-300/90">
                    Tunnel requis pour générer un lien d&apos;invitation.
                    {!d.cfg.deepLinkProtocol
                      ? " Configurez aussi deepLinkProtocol via configureCockpit."
                      : ""}
                  </p>
                )}
              </div>
              <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
                <h2 className="text-sm font-semibold">Créer un compte humain</h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    value={newHumanName}
                    onChange={(e) => setNewHumanName(e.target.value)}
                    placeholder="Identifiant"
                    className="border-white/15 bg-black/20 text-slate-100"
                  />
                  <Input
                    type="password"
                    value={newHumanPass}
                    onChange={(e) => setNewHumanPass(e.target.value)}
                    placeholder="Mot de passe"
                    className="border-white/15 bg-black/20 text-slate-100"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={d.busy === "create-human"}
                  onClick={() =>
                    void d.createHuman(newHumanName, newHumanPass).then(
                      (ok) => {
                        if (ok) {
                          setNewHumanName("");
                          setNewHumanPass("");
                        }
                      },
                    )
                  }
                >
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Créer le compte
                </Button>
              </div>
            </section>
          ) : null}

          {activeExtra ? (
            <section data-creezio-aid={`server-cockpit-extra-${activeExtra.id}`}>
              {activeExtra.render()}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
