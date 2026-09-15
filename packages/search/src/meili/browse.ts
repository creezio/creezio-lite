/**
 * Browse paginé Meili — API publique `@creezio/search`.
 * Meili est un composant CORE (fail-closed) pour le browse catalogue.
 *
 * Contrat (SoT AGENTS.md section Meili) :
 * - `q` vide = browse filtré / page catalogue (POST `q:""` + filter).
 * - Meili KO sur une liste catalogue = **erreur visible côté appelant**
 *   (503 `meili_unavailable`, ou `engine:"indexing"` pendant l'indexation
 *   initiale) — plus jamais de LIKE SQL de secours. Utiliser
 *   `browseMeiliIndexOutcome` pour distinguer incident / hors index.
 * - SQL légitime UNIQUEMENT hors index (agrégats, joins métier, écritures,
 *   filtre rejeté visible) ou avec `CREEZIO_ALLOW_NO_MEILI=1` (dev/tests).
 * - 0 hit sur un index peuplé = succès (pas un fallback SQL).
 * - Interdit : `if (q) meili else sql`.
 * - Ne pas utiliser `searchMeiliIndexes` pour le browse (retourne [] si q vide).
 */

export type MeiliBrowseRequest = {
  host: string;
  apiKey?: string;
  indexUid: string;
  query?: string;
  filters?: string[];
  sort?: string[];
  page?: number;
  hitsPerPage?: number;
  attributesToRetrieve?: string[];
  facets?: string[];
  timeoutMs?: number;
};

export type MeiliBrowseResult = {
  hits: Array<Record<string, unknown>>;
  total: number;
  facetDistribution?: Record<string, Record<string, number>>;
};

function meiliHeaders(apiKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function meiliFilterEq(attr: string, raw: string): string {
  const n = Number(raw);
  if (raw !== "" && Number.isFinite(n) && String(n) === raw) {
    return `${attr} = ${n}`;
  }
  const escaped = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${attr} = "${escaped}"`;
}

/** Issue détaillée d'un browse — incident (fail-closed) vs hors index. */
export type MeiliBrowseOutcome =
  | { kind: "ok"; result: MeiliBrowseResult }
  | { kind: "empty_index" }
  | { kind: "index_missing" }
  | { kind: "filter_rejected" }
  | { kind: "unavailable"; reason: string }
  | { kind: "unconfigured" };

export async function browseMeiliIndexOutcome(
  req: MeiliBrowseRequest,
): Promise<MeiliBrowseOutcome> {
  const host = (req.host || "").replace(/\/+$/, "");
  if (!host || !req.indexUid) return { kind: "unconfigured" };
  const timeoutMs = req.timeoutMs ?? 3000;
  const headers = meiliHeaders(req.apiKey);
  try {
    const statsRes = await fetch(`${host}/indexes/${req.indexUid}/stats`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (statsRes.status === 404) return { kind: "index_missing" };
    if (!statsRes.ok) {
      return { kind: "unavailable", reason: `stats_${statsRes.status}` };
    }
    const stats = (await statsRes.json()) as { numberOfDocuments?: number };
    if (Number(stats.numberOfDocuments || 0) <= 0) {
      return { kind: "empty_index" };
    }

    const page = Math.max(1, req.page ?? 1);
    const hitsPerPage = Math.min(Math.max(req.hitsPerPage ?? 20, 1), 200);
    const searchRes = await fetch(`${host}/indexes/${req.indexUid}/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        q: req.query ?? "",
        filter: req.filters?.length ? req.filters : undefined,
        sort: req.sort?.length ? req.sort : undefined,
        page,
        hitsPerPage,
        attributesToRetrieve: req.attributesToRetrieve ?? ["id"],
        facets: req.facets?.length ? req.facets : undefined,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (searchRes.status === 400) return { kind: "filter_rejected" };
    if (!searchRes.ok) {
      return { kind: "unavailable", reason: `search_${searchRes.status}` };
    }
    const data = (await searchRes.json()) as {
      hits?: Array<Record<string, unknown>>;
      totalHits?: number;
      estimatedTotalHits?: number;
      facetDistribution?: Record<string, Record<string, number>>;
    };
    const hits = Array.isArray(data.hits) ? data.hits : [];
    return {
      kind: "ok",
      result: {
        hits,
        total: Number(data.totalHits ?? data.estimatedTotalHits ?? hits.length),
        facetDistribution: data.facetDistribution,
      },
    };
  } catch (err) {
    return {
      kind: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compat historique : `null` = tout sauf `ok`. Préférer
 * `browseMeiliIndexOutcome` (fail-closed) pour le browse catalogue.
 */
export async function browseMeiliIndex(
  req: MeiliBrowseRequest,
): Promise<MeiliBrowseResult | null> {
  const outcome = await browseMeiliIndexOutcome(req);
  return outcome.kind === "ok" ? outcome.result : null;
}
