"use client";

/**
 * Blocs Usage + Artefacts de l'agent ouvert — possédé par GROKBOT-1.
 *
 * GET agents/:id/usage et GET artifacts (+ download présigné via le
 * mount). Jamais d'appel amont Cursor depuis le browser ; le token
 * reste côté serveur.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card } from "@creezio/shell-ui/ui/kit";

const API = "/api/v1/modules/grokbot";

export type GrokbotUsageArtifactsProps = {
  agentId: string | null;
  prUrl?: string | null;
};

type ArtifactItem = {
  path: string;
  sizeBytes?: number;
  updatedAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function formatCount(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("fr-FR");
  }
  if (typeof value === "string" && value.trim()) return value;
  return null;
}

function pickUsageFields(rec: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "input_tokens",
    "output_tokens",
    "total_tokens",
    "promptTokens",
    "completionTokens",
  ];
  for (const key of keys) {
    const formatted = formatCount(rec[key]);
    if (formatted) rows.push([key, formatted]);
  }
  return rows;
}

function parseUsage(data: unknown): {
  totals: Array<[string, string]>;
  runs: Array<{ id: string; fields: Array<[string, string]> }>;
  extra: Array<[string, string]>;
} {
  const rec = asRecord(data);
  const totalsSrc = asRecord(rec?.totalUsage) ?? asRecord(rec?.usage) ?? rec;
  const totals = totalsSrc ? pickUsageFields(totalsSrc) : [];
  const extra: Array<[string, string]> = [];
  if (totals.length === 0 && rec) {
    for (const [k, v] of Object.entries(rec)) {
      if (k === "runs" || k === "items") continue;
      if (v && typeof v !== "object") {
        const formatted = formatCount(v);
        if (formatted) extra.push([k, formatted]);
      }
    }
  }
  const rawRuns = Array.isArray(rec?.runs)
    ? rec.runs
    : Array.isArray(rec?.items)
      ? rec.items
      : [];
  const runs: Array<{ id: string; fields: Array<[string, string]> }> = [];
  for (const item of rawRuns) {
    const row = asRecord(item);
    if (!row) continue;
    const usage = asRecord(row.usage) ?? row;
    const fields = pickUsageFields(usage);
    const id = typeof row.id === "string" ? row.id : typeof row.runId === "string" ? row.runId : "";
    if (id || fields.length) runs.push({ id: id || "run", fields });
  }
  return { totals, runs, extra };
}

function parseArtifacts(data: unknown): ArtifactItem[] {
  const rec = asRecord(data);
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(rec?.items)
      ? rec.items
      : Array.isArray(rec?.artifacts)
        ? rec.artifacts
        : [];
  const out: ArtifactItem[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ path: item.trim() });
      continue;
    }
    const row = asRecord(item);
    if (!row) continue;
    const path =
      typeof row.path === "string"
        ? row.path
        : typeof row.name === "string"
          ? row.name
          : "";
    if (!path) continue;
    out.push({
      path,
      sizeBytes: typeof row.sizeBytes === "number" ? row.sizeBytes : undefined,
      updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : undefined,
    });
  }
  return out;
}

function parsePrUrl(agent: unknown, fallback?: string | null): string | null {
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  const rec = asRecord(agent);
  if (!rec) return null;
  if (typeof rec.pr_url === "string" && rec.pr_url.trim()) return rec.pr_url.trim();
  if (typeof rec.prUrl === "string" && rec.prUrl.trim()) return rec.prUrl.trim();
  const git = asRecord(rec.git);
  const branches = Array.isArray(git?.branches) ? git.branches : [];
  for (const branch of branches) {
    const row = asRecord(branch);
    if (typeof row?.prUrl === "string" && row.prUrl.trim()) return row.prUrl.trim();
    if (typeof row?.pr_url === "string" && row.pr_url.trim()) return row.pr_url.trim();
  }
  return null;
}

function formatBytes(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function GrokbotUsageArtifacts({ agentId, prUrl }: GrokbotUsageArtifactsProps) {
  const [usage, setUsage] = useState<ReturnType<typeof parseUsage> | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [resolvedPr, setResolvedPr] = useState<string | null>(prUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const [usageRes, artifactsRes, agentRes] = await Promise.all([
        fetch(`${API}/agents/${encodeURIComponent(id)}/usage`, { cache: "no-store" }),
        fetch(`${API}/agents/${encodeURIComponent(id)}/artifacts`, { cache: "no-store" }),
        fetch(`${API}/agents/${encodeURIComponent(id)}`, { cache: "no-store" }),
      ]);
      const usageJson = await usageRes.json().catch(() => null);
      const artifactsJson = await artifactsRes.json().catch(() => null);
      const agentJson = await agentRes.json().catch(() => null);
      if (usageJson?.ok) setUsage(parseUsage(usageJson.data));
      else setUsage(null);
      if (artifactsJson?.ok) setArtifacts(parseArtifacts(artifactsJson.data));
      else setArtifacts([]);
      setResolvedPr(parsePrUrl(agentJson?.agent ?? agentJson?.data, prUrl));
    } catch {
      setUsage(null);
      setArtifacts([]);
    } finally {
      setLoading(false);
    }
  }, [prUrl]);

  useEffect(() => {
    if (!agentId) {
      setUsage(null);
      setArtifacts([]);
      setResolvedPr(prUrl ?? null);
      return;
    }
    void load(agentId);
  }, [agentId, load, prUrl]);

  const download = useCallback(
    async (path: string) => {
      if (!agentId) return;
      setDownloading(path);
      try {
        const r = await fetch(
          `${API}/agents/${encodeURIComponent(agentId)}/artifacts/download?path=${encodeURIComponent(path)}`,
          { cache: "no-store" },
        );
        const j = await r.json().catch(() => null);
        if (r.status === 429) {
          toast.error("Rate limit Cursor — réessayez dans une minute.");
          return;
        }
        const url =
          typeof j?.data?.url === "string"
            ? j.data.url
            : typeof j?.url === "string"
              ? j.url
              : "";
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
          return;
        }
        toast.error(j?.error || "Téléchargement indisponible.");
      } catch {
        toast.error("Téléchargement impossible.");
      } finally {
        setDownloading(null);
      }
    },
    [agentId],
  );

  if (!agentId) return null;

  const totals = usage?.totals ?? [];
  const extra = usage?.extra ?? [];
  const runRows = usage?.runs ?? [];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Usage & artefacts</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void load(agentId)}
        >
          Actualiser
        </Button>
      </div>

      {resolvedPr ? (
        <a
          className="text-xs underline"
          href={resolvedPr}
          target="_blank"
          rel="noreferrer"
        >
          Ouvrir la pull request
        </a>
      ) : null}

      <div>
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Usage
        </h4>
        {loading && !usage ? (
          <p className="text-xs text-muted-foreground">Chargement…</p>
        ) : totals.length === 0 && extra.length === 0 && runRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune donnée d'usage.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {totals.length || extra.length ? (
              <div className="flex flex-wrap gap-1.5">
                {[...totals, ...extra].map(([key, value]) => (
                  <Badge key={key} variant="secondary">
                    {key} : {value}
                  </Badge>
                ))}
              </div>
            ) : null}
            {runRows.map((run) => (
              <div key={run.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{run.id}</span>
                {run.fields.length
                  ? ` — ${run.fields.map(([k, v]) => `${k} ${v}`).join(" · ")}`
                  : ""}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Artefacts
        </h4>
        {artifacts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {loading ? "Chargement…" : "Aucun artefact."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {artifacts.map((item) => (
              <li key={item.path} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate" title={item.path}>
                  {item.path}
                  {item.sizeBytes != null ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatBytes(item.sizeBytes)}
                    </span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={downloading === item.path}
                  onClick={() => void download(item.path)}
                >
                  Télécharger
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
