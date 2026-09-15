"use client";

/**
 * Page /grokbot côté serveur marque — compose les panneaux extraits :
 * - `grokbot-launch-form.tsx` (GROKBOT-1) — prompt, repos, modèle, mode, PR
 * - `grokbot-usage-artifacts.tsx` (GROKBOT-1) — usage tokens + artefacts
 * - `grokbot-agent-runs.tsx` (GROKBOT-2) — liste, timeline, follow-up
 *
 * Poll ciblé : uniquement l'agent ouvert — GET agents/:id + GET …/runs
 * toutes les 4 s si un run est RUNNING/CREATING, sinon 15 s.
 * Jamais GET /models ni GET /repositories dans ce poll.
 *
 * API : /api/v1/modules/grokbot/* (mount natif @creezio/grokbot).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, Input } from "@creezio/shell-ui/ui/kit";
import { GrokbotLaunchForm } from "./grokbot-launch-form";
import { GrokbotUsageArtifacts } from "./grokbot-usage-artifacts";
import {
  GrokbotAgentList,
  GrokbotAgentRuns,
  isLiveRunStatus,
  type GrokbotAgentItem,
  type GrokbotRunItem,
} from "./grokbot-agent-runs";

const API = "/api/v1/modules/grokbot";
const LIVE_POLL_MS = 4000;
const IDLE_POLL_MS = 15000;
const MODULE_UNMOUNTED =
  "Le module GrokBot n'est pas enregistré sur ce serveur";

type StatusView = {
  connected: boolean;
  apiKeyName?: string | null;
  userEmail?: string | null;
  reason?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function upstreamMessage(body: unknown, fallback: string): string {
  const rec = asRecord(body);
  if (!rec) return fallback;
  if (rec.error === "cursor_api_key_missing") {
    return "Clé API Cursor manquante. Enregistrez un token pour suivre les agents.";
  }
  if (rec.error === "cursor_api_error") {
    const detail = asRecord(rec.detail);
    if (detail) {
      const err = detail.error;
      if (typeof err === "string") return err;
      const nested = asRecord(err);
      if (typeof nested?.message === "string") return nested.message;
      if (typeof detail.message === "string") return detail.message;
    }
  }
  if (typeof rec.error === "string") return rec.error;
  return fallback;
}

async function parseJsonResponse(
  r: Response,
): Promise<{ status: number; body: unknown; json: boolean }> {
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    return { status: r.status, body: null, json: false };
  }
  try {
    return { status: r.status, body: await r.json(), json: true };
  } catch {
    return { status: r.status, body: null, json: false };
  }
}

function isModuleUnmounted(status: number, json: boolean): boolean {
  return status === 404 || (status === 200 && !json);
}

function normalizeAgent(
  raw: unknown,
  fallback?: GrokbotAgentItem | null,
): GrokbotAgentItem | null {
  const rec = asRecord(raw);
  if (!rec) return fallback ?? null;
  const id = typeof rec.id === "string" ? rec.id : fallback?.id;
  if (!id) return fallback ?? null;
  const repos = Array.isArray(rec.repos) ? rec.repos : [];
  const first = asRecord(repos[0]);
  const repoFromRemote = typeof first?.url === "string" ? first.url : null;
  return {
    id,
    name:
      typeof rec.name === "string"
        ? rec.name
        : (fallback?.name ?? null),
    status:
      typeof rec.status === "string"
        ? rec.status
        : (fallback?.status ?? null),
    url: typeof rec.url === "string" ? rec.url : (fallback?.url ?? null),
    createdAt:
      typeof rec.createdAt === "string"
        ? rec.createdAt
        : typeof rec.created_at === "string"
          ? rec.created_at
          : (fallback?.createdAt ?? fallback?.created_at ?? null),
    latestRunId:
      typeof rec.latestRunId === "string"
        ? rec.latestRunId
        : typeof rec.latest_run_id === "string"
          ? rec.latest_run_id
          : (fallback?.latestRunId ?? fallback?.latest_run_id ?? null),
    repo_url:
      typeof rec.repo_url === "string"
        ? rec.repo_url
        : (fallback?.repo_url ?? repoFromRemote),
    pr_url:
      typeof rec.pr_url === "string" ? rec.pr_url : (fallback?.pr_url ?? null),
  };
}

export function GrokbotClient() {
  const [status, setStatus] = useState<StatusView | null>(null);
  const [agents, setAgents] = useState<GrokbotAgentItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [token, setToken] = useState("");
  const [maskedToken, setMaskedToken] = useState<string | null>(null);
  const [defaultRepoUrl, setDefaultRepoUrl] = useState<string | null>(null);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<GrokbotAgentItem | null>(null);
  const [runs, setRuns] = useState<GrokbotRunItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [followup, setFollowup] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`${API}/status`, { cache: "no-store" }),
        fetch(`${API}/config`, { cache: "no-store" }),
      ]);
      const s = await parseJsonResponse(sRes);
      const c = await parseJsonResponse(cRes);
      if (isModuleUnmounted(s.status, s.json) || isModuleUnmounted(c.status, c.json)) {
        setError(MODULE_UNMOUNTED);
        return;
      }
      if (s.status === 409 || c.status === 409) {
        setError(upstreamMessage(s.body ?? c.body, "Erreur API Cursor."));
        return;
      }
      const sBody = asRecord(s.body);
      const cBody = asRecord(c.body);
      if (sBody?.ok) {
        setStatus({
          connected: Boolean(sBody.connected),
          apiKeyName:
            typeof sBody.apiKeyName === "string" ? sBody.apiKeyName : null,
          userEmail: typeof sBody.userEmail === "string" ? sBody.userEmail : null,
          reason: typeof sBody.reason === "string" ? sBody.reason : undefined,
        });
      }
      if (cBody?.ok) {
        const cfg = asRecord(cBody.config);
        setMaskedToken(typeof cfg?.apiKey === "string" ? cfg.apiKey : null);
        setDefaultRepoUrl(
          typeof cfg?.defaultRepoUrl === "string" ? cfg.defaultRepoUrl : null,
        );
        setDefaultModelId(
          typeof cfg?.defaultModelId === "string" ? cfg.defaultModelId : null,
        );
      }
      const connected = Boolean(sBody?.ok && sBody.connected);
      const agentsPath = connected
        ? `${API}/agents?limit=50`
        : `${API}/agents?source=local`;
      const aRes = await fetch(agentsPath, { cache: "no-store" });
      const a = await parseJsonResponse(aRes);
      if (isModuleUnmounted(a.status, a.json)) {
        setError(MODULE_UNMOUNTED);
        return;
      }
      if (a.status === 409) {
        setError(upstreamMessage(a.body, "Erreur API Cursor."));
        return;
      }
      const aBody = asRecord(a.body);
      if (aBody?.ok && Array.isArray(aBody.items)) {
        setAgents(aBody.items as GrokbotAgentItem[]);
      }
      if (sBody?.ok && !sBody.connected && sBody.reason === "cursor_api_error") {
        setError("Erreur API Cursor. Vérifiez le token enregistré.");
      } else {
        setError(null);
      }
    } catch {
      setError("Module GrokBot injoignable");
    }
  }, []);

  const pollOpenAgent = useCallback(async (agentId: string) => {
    try {
      const [agentRes, runsRes] = await Promise.all([
        fetch(`${API}/agents/${encodeURIComponent(agentId)}`, {
          cache: "no-store",
        }),
        fetch(`${API}/agents/${encodeURIComponent(agentId)}/runs`, {
          cache: "no-store",
        }),
      ]);
      const agentParsed = await parseJsonResponse(agentRes);
      const runsParsed = await parseJsonResponse(runsRes);
      if (
        isModuleUnmounted(agentParsed.status, agentParsed.json) ||
        isModuleUnmounted(runsParsed.status, runsParsed.json)
      ) {
        setError(MODULE_UNMOUNTED);
        return;
      }
      if (agentParsed.status === 409 || runsParsed.status === 409) {
        setError(
          upstreamMessage(
            agentParsed.status === 409 ? agentParsed.body : runsParsed.body,
            "Erreur API Cursor.",
          ),
        );
        return;
      }
      const agentBody = asRecord(agentParsed.body);
      if (agentBody?.ok && agentBody.agent) {
        const next = normalizeAgent(agentBody.agent, null);
        if (next) {
          setOpenAgent((prev) => normalizeAgent(agentBody.agent, prev) ?? next);
          setAgents((list) =>
            list.map((item) =>
              item.id === next.id ? { ...item, ...next } : item,
            ),
          );
        }
      }
      const runsBody = asRecord(runsParsed.body);
      if (runsBody?.ok) {
        const data = asRecord(runsBody.data);
        const items = Array.isArray(data?.items)
          ? data.items
          : Array.isArray(runsBody.items)
            ? runsBody.items
            : [];
        setRuns(items as GrokbotRunItem[]);
      }
    } catch {
      /* prochain tick */
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const selectAgent = useCallback(
    (agentId: string) => {
      const fromList = agents.find((a) => a.id === agentId) || null;
      setOpenId(agentId);
      setOpenAgent(fromList);
      setRuns([]);
      setRunsLoading(true);
    },
    [agents],
  );

  const livePoll =
    runsLoading || runs.some((r) => isLiveRunStatus(r.status));

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await pollOpenAgent(openId);
    };
    void tick();
    const t = setInterval(() => {
      void tick();
    }, livePoll ? LIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [openId, livePoll, pollOpenAgent]);

  const saveToken = useCallback(async () => {
    if (!token.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey: token.trim() }),
      });
      const parsed = await parseJsonResponse(r);
      if (isModuleUnmounted(parsed.status, parsed.json)) {
        setError(MODULE_UNMOUNTED);
        return;
      }
      const j = asRecord(parsed.body);
      if (j?.ok) {
        setToken("");
        toast.success("Token Cursor enregistré.");
        await refresh();
      } else {
        toast.error(upstreamMessage(parsed.body, "Enregistrement impossible."));
      }
    } catch {
      toast.error("Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }, [token, refresh]);

  const sendFollowup = useCallback(async () => {
    if (!openId || !followup.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`${API}/agents/${encodeURIComponent(openId)}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: followup.trim() }),
      });
      const parsed = await parseJsonResponse(r);
      const j = asRecord(parsed.body);
      if (j?.ok) {
        setFollowup("");
        setRunsLoading(true);
        await pollOpenAgent(openId);
      } else if (parsed.status === 409) {
        toast.error(upstreamMessage(parsed.body, "Échec du follow-up."));
      } else {
        toast.error(upstreamMessage(parsed.body, `Échec : ${parsed.status}`));
      }
    } finally {
      setBusy(false);
    }
  }, [openId, followup, pollOpenAgent]);

  const cancelRun = useCallback(
    async (runId: string) => {
      if (!openId) return;
      const r = await fetch(
        `${API}/agents/${encodeURIComponent(openId)}/runs/${encodeURIComponent(runId)}/cancel`,
        { method: "POST" },
      );
      const parsed = await parseJsonResponse(r);
      if (parsed.status === 409) {
        toast.error(upstreamMessage(parsed.body, "Annulation impossible."));
      }
      await pollOpenAgent(openId);
    },
    [openId, pollOpenAgent],
  );

  const archiveAgent = useCallback(
    async (agentId: string) => {
      await fetch(`${API}/agents/${encodeURIComponent(agentId)}/archive`, {
        method: "POST",
      });
      if (openId === agentId) {
        setOpenId(null);
        setOpenAgent(null);
        setRuns([]);
      }
      await refresh();
    },
    [openId, refresh],
  );

  const unarchiveAgent = useCallback(
    async (agentId: string) => {
      const r = await fetch(
        `${API}/agents/${encodeURIComponent(agentId)}/unarchive`,
        { method: "POST" },
      );
      const parsed = await parseJsonResponse(r);
      const j = asRecord(parsed.body);
      if (j?.ok) {
        toast.success("Agent désarchivé.");
        if (openId === agentId) {
          setOpenAgent((prev) =>
            prev ? { ...prev, status: "IDLE" } : prev,
          );
        }
        await refresh();
        if (openId === agentId) await pollOpenAgent(agentId);
      } else if (parsed.status === 409) {
        toast.error(upstreamMessage(parsed.body, "Désarchivage impossible."));
      } else {
        toast.error(upstreamMessage(parsed.body, "Désarchivage impossible."));
      }
    },
    [openId, refresh, pollOpenAgent],
  );

  const tokenMissing = !status?.connected;
  const open =
    openAgent || agents.find((a) => a.id === openId) || null;

  if (error === MODULE_UNMOUNTED) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-semibold">GrokBot</h1>
          <p className="text-sm text-muted-foreground">
            Pilotez vos agents cloud depuis l'app : lancez un agent sur un
            dépôt, suivez ses runs, envoyez des prompts de suivi.
          </p>
        </div>
        <Card className="border-destructive p-4 text-sm text-destructive">
          {MODULE_UNMOUNTED}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">GrokBot</h1>
        <p className="text-sm text-muted-foreground">
          Pilotez vos agents cloud depuis l'app : lancez un agent sur un
          dépôt, suivez ses runs, envoyez des prompts de suivi.
        </p>
      </div>

      {error ? (
        <Card className="border-destructive p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Connexion Cursor</h2>
          <Badge variant={status?.connected ? "default" : "destructive"}>
            {status?.connected
              ? `Connecté${status.userEmail ? ` — ${status.userEmail}` : ""}`
              : "Non connecté"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="flex-1"
            type="password"
            placeholder={
              maskedToken
                ? `Token actuel : ${maskedToken} (remplacer…)`
                : "Token API Cursor (Dashboard → API Keys)"
            }
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-label="Token API Cursor"
          />
          <Button size="sm" onClick={saveToken} disabled={busy || !token.trim()}>
            Enregistrer
          </Button>
        </div>
      </Card>

      <GrokbotLaunchForm
        connected={Boolean(status?.connected)}
        defaultRepoUrl={defaultRepoUrl}
        defaultModelId={defaultModelId}
        onLaunched={(agent) => {
          void refresh();
          if (agent?.id) selectAgent(agent.id);
        }}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <GrokbotAgentList
          agents={agents}
          openId={openId}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          onSelect={selectAgent}
          onUnarchive={(id) => void unarchiveAgent(id)}
          tokenMissing={tokenMissing}
          busy={busy}
        />

        <div className="flex flex-col gap-3">
          {open ? (
            <GrokbotUsageArtifacts agentId={open.id} prUrl={open.pr_url} />
          ) : null}
          <GrokbotAgentRuns
            open={open}
            runs={runs}
            runsLoading={runsLoading}
            followup={followup}
            onFollowupChange={setFollowup}
            onSendFollowup={() => void sendFollowup()}
            onCancelRun={(id) => void cancelRun(id)}
            onArchive={(id) => void archiveAgent(id)}
            onUnarchive={(id) => void unarchiveAgent(id)}
            busy={busy}
          />
        </div>
      </div>
    </div>
  );
}
