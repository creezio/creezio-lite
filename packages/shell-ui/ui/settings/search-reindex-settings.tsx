"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Réindexation Meili GED — sans factory-reset.
 * Desktop uniquement (IPC search:reindex).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";

type HealthPayload = {
  health?: { ok?: boolean; status?: string; error?: string };
  coherence?: {
    stale?: boolean;
    reason?: string;
    sql?: Record<string, number>;
    meili?: Record<string, number>;
  };
};

export function SearchReindexSettings() {
  const [desktop, setDesktop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  // Web serveur : la réindexation passe par la route kit owner
  // /api/v1/platform/search/reindex (miroir HTTP de l'IPC desktop).
  const [httpReindex, setHttpReindex] = useState(false);

  useEffect(() => {
    setDesktop(Boolean(getShellDesktopApi()?.reindexSearch));
  }, []);

  const refreshHealth = useCallback(async () => {
    // Route kit canonique (owner) d'abord, route marque historique ensuite.
    for (const url of [
      "/api/v1/platform/search/health",
      "/api/v1/search/health",
    ]) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok) {
          setHealth((await res.json()) as HealthPayload);
          if (url.startsWith("/api/v1/platform/")) setHttpReindex(true);
          return;
        }
      } catch {
        /* route absente */
      }
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  if (!desktop && !health) return null;

  async function onReindex() {
    const api = getShellDesktopApi();
    setBusy(true);
    try {
      if (api?.reindexSearch) {
        const r = await api.reindexSearch();
        if (!r.ok) {
          toast.error(r.error || "Échec de la réindexation");
          return;
        }
        toast.success(
          r.ready
            ? "Recherche réindexée"
            : `Réindexation terminée (${r.reason || "vérifiez le health"})`,
        );
      } else if (httpReindex) {
        const res = await fetch("/api/v1/platform/search/reindex", {
          method: "POST",
        });
        const body = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast.error(body.error || "Échec de la réindexation");
          return;
        }
        toast.success("Recherche réindexée");
      } else {
        toast.error("Réindexation réservée au compte propriétaire");
        return;
      }
      await refreshHealth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  const stale = Boolean(health?.coherence?.stale);
  const reason = health?.coherence?.reason;

  return (
    <Card className={stale ? "border-amber-300" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Search className="h-4 w-4" /> Recherche (Meilisearch)
        </CardTitle>
        <CardDescription>
          Recalcule l&apos;index de recherche sans effacer vos données. Utile
          si Ctrl+K ne trouve plus un élément pourtant présent en base.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {health?.coherence ? (
          <p className="text-xs text-slate-500">
            État :{" "}
            <span className={stale ? "font-medium text-amber-700" : "text-emerald-700"}>
              {stale ? `désynchronisé (${reason})` : "cohérent"}
            </span>
            {health.coherence.sql ? (
              <>
                {" "}
                · SQL{" "}
                {Object.entries(health.coherence.sql)
                  .map(([k, v]) => `${k}=${v ?? "?"}`)
                  .join(" / ")}
              </>
            ) : null}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {desktop || httpReindex ? (
            <Button type="button" onClick={() => void onReindex()} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Indexation…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" /> Réindexer la recherche
                </>
              )}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => void refreshHealth()}
            disabled={busy}
          >
            Actualiser l&apos;état
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
