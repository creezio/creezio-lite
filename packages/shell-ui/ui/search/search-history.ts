import { getGlobalSearchConfig } from "./global-search-config";
import type { GlobalSearchHit } from "./global-search-config";

let configuredStorageKey: string | null = null;
const DEFAULT_STORAGE_KEY = "creezio-global-search-v1";
const MAX_ITEMS = 10;

export type SearchHistory = {
  queries: string[];
  recent: GlobalSearchHit[];
};

export function configureSearchHistoryKey(key: string): void {
  const next = key.trim();
  if (next) configuredStorageKey = next;
}

function storageKey(): string {
  if (configuredStorageKey) return configuredStorageKey;
  try {
    return getGlobalSearchConfig().storageKey || DEFAULT_STORAGE_KEY;
  } catch {
    return DEFAULT_STORAGE_KEY;
  }
}

function read(): SearchHistory {
  if (typeof window === "undefined") return { queries: [], recent: [] };
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return { queries: [], recent: [] };
    const parsed = JSON.parse(raw) as Partial<SearchHistory>;
    return {
      queries: Array.isArray(parsed.queries) ? parsed.queries.filter(Boolean) : [],
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    };
  } catch {
    return { queries: [], recent: [] };
  }
}

function write(history: SearchHistory) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(history));
  } catch {
    /* quota */
  }
}

export function loadSearchHistory(): SearchHistory {
  return read();
}

export function pushSearchQuery(query: string) {
  const q = query.trim();
  if (q.length < 2) return;
  const history = read();
  history.queries = [q, ...history.queries.filter((x) => x !== q)].slice(0, MAX_ITEMS);
  write(history);
}

export function pushRecentHit(hit: GlobalSearchHit) {
  const history = read();
  history.recent = [
    hit,
    ...history.recent.filter((x) => !(x.index === hit.index && x.id === hit.id)),
  ].slice(0, MAX_ITEMS);
  write(history);
}

export function clearSearchHistory() {
  write({ queries: [], recent: [] });
}
