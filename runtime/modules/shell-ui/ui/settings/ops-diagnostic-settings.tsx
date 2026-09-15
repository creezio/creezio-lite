"use client";

/**
 * Diagnostic — boîte noire locale (Configuration → Système).
 *
 * Affiche le journal structuré du poste (décisions de boot, durées,
 * anomalies, erreurs) lu via /api/v1/ops/events. C'est la réponse locale à
 * « pourquoi l'app a réindexé / mis 3 minutes à démarrer ? » — sans SSH ni
 * fichier de log à envoyer.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "../primitives/badge";
import { Button } from "../primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../primitives/card";

type OpsEvent = {
  ts: string;
  bootId: string;
  seq: number;
  source: string;
  level: "decision" | "event" | "anomaly" | "error" | "crash";
  kind: string;
  outcome?: string;
  reason?: string;
  durationMs?: number;
  ctx?: Record<string, unknown>;
};

type OpsBoot = {
  bootId: string;
  startedAt?: string;
  durationMs?: number;
  appVersion?: string;
  decisions?: Record<string, { outcome?: string; reason?: string }>;
};

type OpsPayload = {
  available: boolean;
  events: OpsEvent[];
  boots: OpsBoot[];
};

const LEVEL_STYLE: Record<OpsEvent["level"], string> = {
  decision: "bg-indigo-50 text-indigo-700 border-indigo-200",
  event: "bg-emerald-50 text-emerald-700 border-emerald-200",
  anomaly: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
  crash: "bg-red-100 text-red-900 border-red-300",
};

const FILTERS = [
  { id: "", label: "Tout" },
  { id: "decision", label: "Décisions" },
  { id: "anomaly", label: "Anomalies" },
  { id: "error", label: "Erreurs" },
] as const;

function fmtDuration(ms?: number): string | null {
  if (ms == null) return null;
  return ms >= 10_000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`;
}

function fmtTs(ts: string): string {
  try {
    return new Date(ts).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

export function OpsDiagnosticSettings() {
  const [data, setData] = useState<OpsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<string>("");

  const load = useCallback(async (lvl: string) => {
    setBusy(true);
    try {
      const qs = lvl ? `&level=${lvl}` : "";
      // Route kit canonique (owner, journal {dataDir}/ops du harness) puis
      // route marque historique (TF2_OPS_DIR desktop).
      let emptyKit: OpsPayload | null = null;
      for (const base of ["/api/v1/platform/ops/events", "/api/v1/ops/events"]) {
        try {
          const res = await fetch(`${base}?limit=120${qs}`, {
            cache: "no-store",
          });
          if (res.ok) {
            const payload = (await res.json()) as OpsPayload;
            // Kit OK mais journal vide : la route marque (TF2_OPS_DIR) peut
            // encore avoir les événements en desktop — on la tente avant de
            // conclure.
            if (!payload.available && base.startsWith("/api/v1/platform/")) {
              emptyKit = payload;
              continue;
            }
            setData(payload);
            return;
          }
        } catch {
          /* route absente */
        }
      }
      if (emptyKit) setData(emptyKit);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(level);
  }, [load, level]);

  // Mode serveur pur (Docker) : pas de journal local — section masquée.
  if (data && !data.available) return null;

  const lastBoot = data?.boots?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> Diagnostic (boîte noire)
        </CardTitle>
        <CardDescription>
          Journal des décisions et événements du poste : pourquoi la recherche a
          été réindexée, durée de chaque étape du démarrage, anomalies
          détectées. Conservé localement (30 derniers démarrages).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {lastBoot ? (
          <p className="text-xs text-slate-500">
            Dernier démarrage : {lastBoot.startedAt ? fmtTs(lastBoot.startedAt) : "?"}
            {lastBoot.durationMs ? ` · ${fmtDuration(lastBoot.durationMs)}` : ""}
            {lastBoot.appVersion ? ` · v${lastBoot.appVersion}` : ""}
            {lastBoot.decisions?.["meili.ready"] ? (
              <>
                {" · recherche : "}
                <span
                  className={
                    lastBoot.decisions["meili.ready"].outcome === "skip"
                      ? "text-emerald-700"
                      : "font-medium text-amber-700"
                  }
                >
                  {lastBoot.decisions["meili.ready"].outcome === "skip"
                    ? "index conservé"
                    : `réindexation (${lastBoot.decisions["meili.ready"].reason || "?"})`}
                </span>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={level === f.id ? "default" : "outline"}
              onClick={() => setLevel(f.id)}
            >
              {f.label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void load(level)}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-slate-100 p-2">
          {(data?.events || []).map((e) => (
            <div
              key={`${e.bootId}-${e.seq}`}
              className="flex items-start gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
            >
              <Badge
                variant="outline"
                className={`shrink-0 ${LEVEL_STYLE[e.level] || ""}`}
              >
                {e.level}
              </Badge>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-slate-800">{e.kind}</span>
                {e.outcome ? (
                  <span className="text-slate-600"> → {e.outcome}</span>
                ) : null}
                {fmtDuration(e.durationMs) ? (
                  <span className="text-slate-400"> · {fmtDuration(e.durationMs)}</span>
                ) : null}
                {e.reason ? (
                  <div className="truncate text-slate-500" title={e.reason}>
                    {e.reason}
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 text-slate-400">
                {fmtTs(e.ts)}
                <span className="ml-1 text-[10px] text-slate-300">{e.source}</span>
              </span>
            </div>
          ))}
          {data && data.events.length === 0 ? (
            <p className="p-2 text-xs text-slate-400">
              Aucun événement {level ? `de type « ${level} »` : ""} sur les
              derniers démarrages.
            </p>
          ) : null}
          {!data ? (
            <p className="p-2 text-xs text-slate-400">Chargement…</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
