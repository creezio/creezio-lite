"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Braces, RefreshCw, Search } from "lucide-react";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import { Card, CardContent, CardHeader, CardTitle } from "./primitives/card";
import { Input } from "./primitives/input";

type Endpoint = {
  method: string;
  path: string;
  documented: boolean;
  summary: string | null;
  description: string | null;
  tags: string[];
};

type RegistryResponse = {
  generatedAt: string;
  source: string;
  openapiUrl: string;
  endpoints: Endpoint[];
  error?: string;
};

const METHOD_STYLE: Record<string, string> = {
  GET: "bg-emerald-100 text-emerald-800",
  POST: "bg-sky-100 text-sky-800",
  PUT: "bg-amber-100 text-amber-800",
  PATCH: "bg-violet-100 text-violet-800",
  DELETE: "bg-red-100 text-red-800",
  OPTIONS: "bg-slate-100 text-slate-700",
  HEAD: "bg-slate-100 text-slate-700",
};

export function ApiEndpointsClient() {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/admin/endpoints");
      const body = (await response.json()) as RegistryResponse;
      if (!response.ok) throw new Error(body.error || "Chargement impossible");
      setRegistry(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const methods = useMemo(
    () =>
      Array.from(
        new Set(registry?.endpoints.map((endpoint) => endpoint.method) || []),
      ).sort(),
    [registry],
  );

  const endpoints = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (registry?.endpoints || []).filter((endpoint) => {
      if (method !== "ALL" && endpoint.method !== method) return false;
      if (!needle) return true;
      return (
        endpoint.path.toLowerCase().includes(needle) ||
        endpoint.method.toLowerCase().includes(needle) ||
        endpoint.summary?.toLowerCase().includes(needle) ||
        endpoint.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [method, query, registry]);

  const documentedCount =
    registry?.endpoints.filter((endpoint) => endpoint.documented).length || 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Routes runtime" value={registry?.endpoints.length || 0} />
        <Stat label="Documentées OpenAPI" value={documentedCount} />
        <Stat
          label="Routes Hono seules"
          value={(registry?.endpoints.length || 0) - documentedCount}
        />
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Braces className="h-4 w-4" />
              Endpoints montés
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Registre Hono enrichi par{" "}
              <a
                href={registry?.openapiUrl || "/api/v1/openapi.json"}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sky-700 hover:underline"
              >
                /api/v1/openapi.json
              </a>
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Chemin, résumé ou tag…"
                className="pl-9"
              />
            </div>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value)}
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="ALL">Toutes les méthodes</option>
              {methods.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Méthode</th>
                  <th className="px-3 py-2">Chemin</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((endpoint) => (
                  <tr
                    key={`${endpoint.method}:${endpoint.path}`}
                    className="border-b last:border-0 hover:bg-slate-50"
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                          METHOD_STYLE[endpoint.method] || METHOD_STYLE.OPTIONS
                        }`}
                      >
                        {endpoint.method}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-800">
                      {endpoint.path}
                    </td>
                    <td className="min-w-[16rem] px-3 py-2 text-xs text-slate-600">
                      {endpoint.summary || endpoint.description || "—"}
                      {endpoint.tags.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {endpoint.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[10px]">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {endpoint.documented ? (
                        <span className="text-emerald-700">OpenAPI</span>
                      ) : (
                        <span className="text-slate-500">Runtime Hono</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!endpoints.length && !loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                      Aucun endpoint pour ce filtre.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </CardContent>
    </Card>
  );
}
