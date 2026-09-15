"use client";

/**
 * Formulaire « Lancer un agent » — possédé par GROKBOT-1.
 *
 * Charge modèles (une fois / session) et repos (cache mount 1 h).
 * Ne jamais appeler GET /repositories depuis un poll — rate limit amont
 * 1 req/min. `?refresh=1` uniquement sur action explicite.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/grokbot";
const MANUAL_REPO = "__manual__";
const DEFAULT_MODEL = "__default__";

export type GrokbotLaunchAgent = {
  id?: string;
  name?: string | null;
};

export type GrokbotLaunchFormProps = {
  connected: boolean;
  defaultRepoUrl?: string | null;
  defaultModelId?: string | null;
  onLaunched?: (agent: GrokbotLaunchAgent | null) => void;
};

type ModelItem = { id: string; displayName?: string };

type RepoItem = {
  url: string;
  owner?: string;
  name?: string;
};

function repoLabel(repo: RepoItem): string {
  if (repo.owner && repo.name) return `${repo.owner}/${repo.name}`;
  try {
    const parsed = new URL(repo.url);
    const parts = parsed.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0]}/${parts[1]}`;
    }
  } catch {
    /* URL non parseable — fallback brut */
  }
  return repo.url;
}

function parseRepos(data: unknown): RepoItem[] {
  if (!data) return [];
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(rec?.items)
      ? rec.items
      : Array.isArray(rec?.repositories)
        ? rec.repositories
        : [];
  const out: RepoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const ownerObj =
      row.owner && typeof row.owner === "object"
        ? (row.owner as Record<string, unknown>)
        : null;
    const url =
      typeof row.url === "string"
        ? row.url
        : typeof row.htmlUrl === "string"
          ? row.htmlUrl
          : typeof row.html_url === "string"
            ? row.html_url
            : "";
    if (!url.trim()) continue;
    const owner =
      typeof row.owner === "string"
        ? row.owner
        : typeof ownerObj?.login === "string"
          ? ownerObj.login
          : undefined;
    const name = typeof row.name === "string" ? row.name : undefined;
    out.push({ url: url.trim(), owner, name });
  }
  return out;
}

function parseModels(data: unknown): ModelItem[] {
  const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const raw = Array.isArray(rec?.items) ? rec.items : [];
  const out: ModelItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) continue;
    out.push({
      id: row.id,
      displayName: typeof row.displayName === "string" ? row.displayName : undefined,
    });
  }
  return out;
}

export function GrokbotLaunchForm({
  connected,
  defaultRepoUrl,
  defaultModelId,
  onLaunched,
}: GrokbotLaunchFormProps) {
  const [prompt, setPrompt] = useState("");
  const [repoUrl, setRepoUrl] = useState(defaultRepoUrl ?? "");
  const [repoSelect, setRepoSelect] = useState("");
  const [modelId, setModelId] = useState(defaultModelId ?? "");
  const [mode, setMode] = useState<"agent" | "plan">("agent");
  const [autoCreatePR, setAutoCreatePR] = useState(false);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshingRepos, setRefreshingRepos] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const reposFetchedRef = useRef(false);

  useEffect(() => {
    if (!defaultRepoUrl) return;
    setRepoUrl((cur) => cur || defaultRepoUrl);
    setRepoSelect((cur) => {
      if (cur && cur !== MANUAL_REPO) return cur;
      const match = repos.find((item) => item.url === defaultRepoUrl);
      return match ? match.url : MANUAL_REPO;
    });
  }, [defaultRepoUrl, repos]);

  useEffect(() => {
    if (defaultModelId) setModelId((cur) => cur || defaultModelId);
  }, [defaultModelId]);

  const loadModels = useCallback(async () => {
    if (modelsLoaded) return;
    try {
      const r = await fetch(`${API}/models`, { cache: "no-store" });
      const j = await r.json();
      if (j?.ok) {
        setModels(parseModels(j.data));
        setModelsLoaded(true);
      }
    } catch {
      /* retry au prochain passage connected */
    }
  }, [modelsLoaded]);

  const applyRepos = useCallback(
    (items: RepoItem[], preferred?: string) => {
      setRepos(items);
      const want = (preferred || repoUrl || defaultRepoUrl || "").trim();
      if (want) {
        const match = items.find((item) => item.url === want);
        setRepoSelect(match ? match.url : MANUAL_REPO);
        setRepoUrl(want);
        return;
      }
      if (items.length === 0) {
        setRepoSelect(MANUAL_REPO);
      }
    },
    [defaultRepoUrl, repoUrl],
  );

  const loadRepos = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshingRepos(true);
      try {
        const qs = refresh ? "?refresh=1" : "";
        const r = await fetch(`${API}/repositories${qs}`, { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (r.status === 429) {
          toast.error("Rate limit Cursor (1 req/min) — réessayez dans une minute.");
          if (j?.data) applyRepos(parseRepos(j.data));
          return;
        }
        if (j?.ok) {
          applyRepos(parseRepos(j.data));
          if (refresh && j.stale) {
            toast.message("Liste servie depuis le cache (amont limité ou indisponible).");
          } else if (refresh) {
            toast.success("Dépôts actualisés.");
          }
          return;
        }
        if (refresh) {
          toast.error(j?.error || `Impossible d'actualiser les dépôts (${r.status}).`);
        }
      } catch {
        if (refresh) toast.error("Impossible d'actualiser les dépôts.");
      } finally {
        if (refresh) setRefreshingRepos(false);
      }
    },
    [applyRepos],
  );

  useEffect(() => {
    if (!connected) return;
    void loadModels();
    if (!reposFetchedRef.current) {
      reposFetchedRef.current = true;
      void loadRepos(false);
    }
  }, [connected, loadModels, loadRepos]);

  const showManual = repos.length === 0 || repoSelect === MANUAL_REPO || repoSelect === "";

  const launch = useCallback(async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        text: prompt.trim(),
        mode,
      };
      if (repoUrl.trim()) body.repoUrl = repoUrl.trim();
      if (modelId) body.modelId = modelId;
      if (autoCreatePR) body.autoCreatePR = true;
      const r = await fetch(`${API}/agents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j?.ok) {
        setPrompt("");
        toast.success(`Agent lancé : ${j.agent?.name || j.agent?.id}`);
        onLaunched?.(j.agent ?? null);
      } else {
        toast.error(`Échec : ${j?.detail?.error?.message || j?.error || r.status}`);
      }
    } catch {
      toast.error("Impossible de lancer l'agent.");
    } finally {
      setBusy(false);
    }
  }, [prompt, repoUrl, modelId, autoCreatePR, mode, onLaunched]);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-base font-semibold">Lancer un agent</h2>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="grokbot-prompt">Mission</Label>
        <Textarea
          id="grokbot-prompt"
          className="min-h-24"
          placeholder="Décrivez la mission de l'agent…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="grokbot-repo">Dépôt</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!connected || refreshingRepos}
              onClick={() => void loadRepos(true)}
            >
              Rafraîchir les repos
            </Button>
          </div>
          {repos.length > 0 ? (
            <Select
              value={repoSelect || undefined}
              onValueChange={(value) => {
                setRepoSelect(value);
                if (value !== MANUAL_REPO) setRepoUrl(value);
              }}
            >
              <SelectTrigger id="grokbot-repo" aria-label="Dépôt">
                <SelectValue placeholder="Choisir un dépôt" />
              </SelectTrigger>
              <SelectContent>
                {repos.map((repo) => (
                  <SelectItem key={repo.url} value={repo.url}>
                    {repoLabel(repo)}
                  </SelectItem>
                ))}
                <SelectItem value={MANUAL_REPO}>URL manuelle</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">
              Aucun dépôt listé — saisissez une URL manuelle.
            </p>
          )}
          {showManual ? (
            <Input
              id="grokbot-repo-url"
              aria-label="URL du dépôt"
              placeholder="https://github.com/org/repo (optionnel)"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                setRepoSelect(MANUAL_REPO);
              }}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grokbot-model">Modèle</Label>
          <Select
            value={modelId || DEFAULT_MODEL}
            onValueChange={(value) => setModelId(value === DEFAULT_MODEL ? "" : value)}
          >
            <SelectTrigger id="grokbot-model" aria-label="Modèle">
              <SelectValue placeholder="Modèle par défaut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_MODEL}>Modèle par défaut</SelectItem>
              {models.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.displayName || m.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grokbot-mode">Mode</Label>
          <Select
            value={mode}
            onValueChange={(value) => setMode(value === "plan" ? "plan" : "agent")}
          >
            <SelectTrigger id="grokbot-mode" aria-label="Mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="plan">Plan</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 self-end pb-1">
          {/* Switch kit absent de shell-ui/ui/kit — checkbox labellisée. */}
          <input
            id="grokbot-pr"
            type="checkbox"
            className="h-4 w-4 accent-slate-900"
            checked={autoCreatePR}
            onChange={(e) => setAutoCreatePR(e.target.checked)}
          />
          <Label htmlFor="grokbot-pr">Ouvrir une PR à la fin</Label>
        </div>
      </div>
      <div>
        <Button onClick={() => void launch()} disabled={busy || !prompt.trim() || !connected}>
          Lancer l'agent
        </Button>
      </div>
    </Card>
  );
}
