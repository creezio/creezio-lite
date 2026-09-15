/**
 * Recherche keyword Meilisearch (générique).
 * Indexes + mapHit + enrichHits via configureAssistantBrand({ meili }).
 */
import { extractVilleHint, normalizeVilleKey } from "./geo-hint.js";
import { trackServerDebounced } from "../brand/ops-track-shim.js";
import { assistantMeili } from "../brand/registry.js";
import type { AssistantRagHit } from "../brand/types.js";

export type RagHit = AssistantRagHit;

export type SearchKnowledgeResult = {
  mode: "keyword" | "unavailable";
  hits: RagHit[];
  error?: string;
  estimatedTotalHits?: number;
  villeFilter?: string;
  sampleVilles?: string[];
  hint?: string;
};

function meiliHost(): string {
  const cfg = assistantMeili();
  return (cfg?.host || process.env.MEILI_HOST || "http://127.0.0.1:7701").replace(
    /\/$/,
    "",
  );
}

function meiliKey(): string {
  const cfg = assistantMeili();
  return (
    cfg?.apiKey ||
    process.env.MEILI_API_KEY ||
    process.env.MEILI_MASTER_KEY ||
    ""
  );
}

/** Indexes configurés (vide si marque non branchée). */
export function ragIndexes(): readonly string[] {
  return assistantMeili()?.indexes ?? [];
}

/** @deprecated — utiliser ragIndexes() / configureAssistantBrand({ meili }). */
export const RAG_INDEXES: readonly string[] = [];

type MeiliBlock = {
  indexUid?: string;
  hits?: Record<string, unknown>[];
  estimatedTotalHits?: number;
  totalHits?: number;
};

async function meiliMultiSearch(
  queries: Array<{ indexUid: string; q: string; limit: number }>,
): Promise<{ results?: MeiliBlock[] } | null> {
  const host = meiliHost();
  const API_KEY = meiliKey();
  try {
    const res = await fetch(`${host}/multi-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({ queries }),
      
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        JSON.stringify({
          scope: "assistant",
          event: "meili_fail",
          status: res.status,
          error: text.slice(0, 240),
        }),
      );
      return null;
    }
    return (await res.json()) as { results?: MeiliBlock[] };
  } catch (e) {
    console.warn(
      JSON.stringify({
        scope: "assistant",
        event: "meili_fail",
        error: e instanceof Error ? e.message : "meili failed",
      }),
    );
    return null;
  }
}

function mapHit(index: string, doc: Record<string, unknown>): RagHit {
  const cfg = assistantMeili();
  if (cfg?.mapHit) return cfg.mapHit(index, doc);
  const id = String(doc.id || "");
  const title = String(doc.title || doc.id || "Document");
  return {
    index,
    id,
    type: String(doc.type || index),
    title,
    body: String(doc.body || doc.subtitle || "").slice(0, 1200),
    url: "/",
    status: doc.statut != null ? String(doc.statut) : undefined,
    score: typeof doc._rankingScore === "number" ? doc._rankingScore : undefined,
    ville: doc.ville != null ? String(doc.ville) : undefined,
    pays: doc.pays != null ? String(doc.pays) : undefined,
  };
}

/** Enrichissement optionnel marque (ex. geo SQL). */
export function enrichHitsGeo(hits: RagHit[]): void {
  const fn = assistantMeili()?.enrichHits;
  if (fn) fn(hits);
}

export function villeMatches(ville: string | undefined, wanted: string): boolean {
  if (!ville || !wanted) return false;
  const a = normalizeVilleKey(ville);
  const b = normalizeVilleKey(wanted);
  if (!a || !b) return false;
  if (a === b) return true;
  const words = a.split(/\s+/).filter(Boolean);
  if (words.includes(b)) return true;
  if (a.startsWith(`${b} `) || a.endsWith(` ${b}`)) return true;
  return false;
}

/** Retire géo / verbes de découverte pour laisser Meili matcher le produit. */
export function productQueryForMeili(query: string, ville?: string | null): string {
  let q = query.trim();
  if (ville) {
    const v = ville.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q = q.replace(
      new RegExp(`(?:^|\\s)(?:à|a|sur|dans|en)\\s+${v}(?=\\s|$|[,.?!;])`, "i"),
      " ",
    );
    q = q.replace(new RegExp(`(?:^|\\s)${v}(?=\\s|$|[,.?!;])`, "i"), " ");
  }
  q = q
    .replace(
      /\b(fournisseurs?|marketplaces?|ville|qui\s+vend|qui\s+propose|qui\s+fournit|qui\s+a|cherche|chercher|trouve|trouver|recherche|des?|les?|un|une|du|de|la|le)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return q || query.trim();
}

/**
 * Recherche keyword Meilisearch (typos / accents).
 * Option `ville` : filtre post-Meili si hits portent `ville`.
 */
export async function searchKnowledge(
  query: string,
  opts: { limit?: number; ville?: string | null } = {},
): Promise<SearchKnowledgeResult> {
  const qRaw = query.trim();
  if (!qRaw) return { mode: "unavailable", hits: [], error: "query vide" };

  const cfg = assistantMeili();
  const indexes = cfg?.primaryIndexes ?? cfg?.indexes ?? [];
  if (!indexes.length) {
    return {
      mode: "unavailable",
      hits: [],
      error: "Meili non configuré — configureAssistantBrand({ meili })",
    };
  }

  const villeFilter =
    (opts.ville || extractVilleHint(qRaw) || "").trim() || undefined;
  const q = productQueryForMeili(qRaw, villeFilter);
  const perIndex = Math.min(Math.max(opts.limit || 5, 1), 12);
  const fetchLimit = villeFilter
    ? Math.min(Math.max(perIndex * 8, 40), 50)
    : perIndex;

  const queries = indexes.map((indexUid) => ({
    indexUid,
    q,
    limit: fetchLimit,
  }));

  const data = await meiliMultiSearch(queries);
  if (!data?.results) {
    trackServerDebounced({
      level: "event",
      kind: "assistant.rag",
      outcome: "meili-unavailable",
    });
    return {
      mode: "unavailable",
      hits: [],
      error: "Meilisearch indisponible ou indexes absents — utiliser run_sql",
    };
  }

  let estimatedTotalHits = 0;
  const hits: RagHit[] = [];
  for (const block of data.results) {
    const index = String(block.indexUid || "");
    estimatedTotalHits +=
      Number(block.estimatedTotalHits ?? block.totalHits ?? 0) || 0;
    for (const doc of block.hits || []) {
      hits.push(mapHit(index, doc));
    }
  }

  const fallback = cfg?.fallbackIndex;
  if (!hits.length && fallback) {
    const all = await meiliMultiSearch([
      { indexUid: fallback, q, limit: fetchLimit },
    ]);
    for (const block of all?.results || []) {
      estimatedTotalHits +=
        Number(block.estimatedTotalHits ?? block.totalHits ?? 0) || 0;
      for (const doc of block.hits || []) {
        hits.push(mapHit(fallback, doc));
      }
    }
  }

  enrichHitsGeo(hits);
  hits.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

  if (!villeFilter) {
    const sliced = hits.slice(0, perIndex * 3);
    return {
      mode: "keyword",
      hits: sliced,
      estimatedTotalHits: estimatedTotalHits || undefined,
      error: sliced.length ? undefined : "aucun hit keyword",
    };
  }

  const sampleVilles = Array.from(
    new Set(
      hits
        .map((h) => h.ville?.trim())
        .filter((v): v is string => Boolean(v))
        .slice(0, 20),
    ),
  );
  const filtered = hits.filter((h) => villeMatches(h.ville, villeFilter));
  const sliced = filtered.slice(0, perIndex * 3);

  if (!sliced.length) {
    return {
      mode: "keyword",
      hits: [],
      estimatedTotalHits: estimatedTotalHits || hits.length,
      villeFilter,
      sampleVilles,
      error: "aucun hit après filtre ville",
      hint:
        `Meilisearch a trouvé des résultats pour « ${q} »` +
        (estimatedTotalHits ? ` (~${estimatedTotalHits} hits bruts)` : "") +
        ` mais aucun hit avec ville ≈ « ${villeFilter} » dans l'échantillon.` +
        (sampleVilles.length
          ? ` Villes vues : ${sampleVilles.slice(0, 8).join(", ")}.`
          : " (ville absente sur l'échantillon.)") +
        " Ne pas enchaîner list_tables/describe_table/LIKE SQL pour re-chercher le nom — conclure ou élargir la zone.",
    };
  }

  return {
    mode: "keyword",
    hits: sliced,
    estimatedTotalHits: estimatedTotalHits || undefined,
    villeFilter,
    sampleVilles,
  };
}

export function isKeywordOnlyIndex(uid: string): boolean {
  return ragIndexes().includes(uid);
}
