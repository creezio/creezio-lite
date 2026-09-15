"use client";
import { configureGlobalSearchHost } from "../global-search-host";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTabWorkspaceOptional } from "../workspace/tab-workspace-context";
import { mirrorFleetAction } from "../lib/desktop-host";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  CornerDownLeft,
  History,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../primitives/command";
import {
  loadSearchHistory,
  pushRecentHit,
  pushSearchQuery,
  type SearchHistory,
} from "./search-history";
import { cn } from "@creezio/shell-ui";
import {
  getGlobalSearchConfig,
  type GlobalSearchConfig,
  type GlobalSearchHit,
} from "./global-search-config";

type GlobalSearchContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  /**
   * Ouvre la recherche en mode « nouvel onglet » (façon Notion) : le résultat
   * choisi s'ouvrira dans un nouvel onglet. Annuler (esc) ne crée rien.
   */
  openForNewTab: () => void;
};

const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

export function useGlobalSearch() {
  const ctx = useContext(GlobalSearchContext);
  if (!ctx) {
    throw new Error("useGlobalSearch must be used within GlobalSearchProvider");
  }
  return ctx;
}

function hitKey(hit: GlobalSearchHit) {
  return `${hit.index}:${hit.id}`;
}

function trackSearchEvent(
  config: GlobalSearchConfig,
  event: string,
  payload: Record<string, unknown>,
) {
  if (config.onTrack) {
    config.onTrack(event, payload);
    return;
  }
  mirrorFleetAction({
    type: event,
    label: String(payload.label || event),
    path: typeof payload.href === "string" ? payload.href : "/search",
    meta: payload,
  });
}

function groupHits(
  hits: GlobalSearchHit[],
  labels: Record<string, string>,
): { index: string; label: string; hits: GlobalSearchHit[] }[] {
  const map = new Map<string, GlobalSearchHit[]>();
  for (const hit of hits) {
    const list = map.get(hit.index) || [];
    list.push(hit);
    map.set(hit.index, list);
  }
  return Array.from(map.entries()).map(([index, groupHits]) => ({
    index,
    label: labels[index] || index,
    hits: groupHits,
  }));
}

function FilterChips({
  hits,
  active,
  onChange,
  labels,
}: {
  hits: GlobalSearchHit[];
  active: string | null;
  onChange: (index: string | null) => void;
  labels: Record<string, string>;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of hits) {
      m.set(h.index, (m.get(h.index) || 0) + 1);
    }
    return m;
  }, [hits]);

  if (!hits.length) return null;

  const chips = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-200 px-3 py-2">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
          active === null
            ? "bg-slate-900 text-white"
            : "bg-slate-100 text-slate-600 hover:bg-slate-200",
        )}
      >
        Tous
        <span className="ml-1 opacity-70">{hits.length}</span>
      </button>
      {chips.map(([index, count]) => (
        <button
          key={index}
          type="button"
          onClick={() => onChange(active === index ? null : index)}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            active === index
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200",
          )}
        >
          {labels[index] || index}
          <span className="ml-1 opacity-70">{count}</span>
        </button>
      ))}
    </div>
  );
}

function HitPreview({
  hit,
  labels,
}: {
  hit: GlobalSearchHit | null;
  labels: Record<string, string>;
}) {
  if (!hit) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-400">
        <Search className="h-8 w-8 opacity-40" />
        <p>Sélectionnez un résultat pour l&apos;aperçu</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-5">
      <span className="mb-2 inline-flex w-fit rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {labels[hit.index] || hit.index}
      </span>
      <h3 className="text-lg font-semibold leading-snug text-slate-900">{hit.title}</h3>
      {hit.subtitle ? (
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{hit.subtitle}</p>
      ) : null}
      <div className="mt-auto flex items-center gap-2 pt-6 text-xs text-slate-400">
        <CornerDownLeft className="h-3.5 w-3.5" />
        Ouvrir
        <span className="mx-1">·</span>
        <span className="truncate font-mono text-[11px]">{hit.href}</span>
      </div>
    </div>
  );
}

function GlobalSearchModal({
  open,
  onOpenChange,
  newTabMode = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Le résultat choisi s'ouvre dans un nouvel onglet (bouton + de la tab bar). */
  newTabMode?: boolean;
}) {
  const router = useRouter();
  const workspace = useTabWorkspaceOptional();
  const config = getGlobalSearchConfig();
  const indexLabels = config.indexLabels || {};
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterIndex, setFilterIndex] = useState<string | null>(null);
  const [history, setHistory] = useState<SearchHistory>({ queries: [], recent: [] });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filteredHits = useMemo(
    () => (filterIndex ? hits.filter((h) => h.index === filterIndex) : hits),
    [hits, filterIndex],
  );

  const grouped = useMemo(
    () => groupHits(filteredHits, indexLabels),
    [filteredHits, indexLabels],
  );

  const flatHits = useMemo(() => grouped.flatMap((g) => g.hits), [grouped]);

  const selectedHit = useMemo(() => {
    if (!selectedKey) return flatHits[0] || null;
    return flatHits.find((h) => hitKey(h) === selectedKey) || flatHits[0] || null;
  }, [flatHits, selectedKey]);

  useEffect(() => {
    if (open) {
      setHistory(loadSearchHistory());
      setQ("");
      setHits([]);
      setFilterIndex(null);
      setSelectedKey(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        trackSearchEvent(config, "search", {
          label: `Recherche "${trimmed}"`,
          query: trimmed,
        });
        const next = await config.search(trimmed, controller.signal);
        setHits(next);
        setFilterIndex(null);
        setSelectedKey(next[0] ? hitKey(next[0]) : null);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setHits([]);
        setSelectedKey(null);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [q, open, config]);

  useEffect(() => {
    if (flatHits.length && !flatHits.some((h) => hitKey(h) === selectedKey)) {
      setSelectedKey(hitKey(flatHits[0]));
    }
  }, [flatHits, selectedKey]);

  const navigateTo = useCallback(
    (hit: GlobalSearchHit) => {
      pushSearchQuery(q.trim());
      pushRecentHit(hit);
      trackSearchEvent(config, "search_open", {
        label: `Ouverture "${hit.title || hit.href}"`,
        href: hit.href,
        query: q.trim(),
        index: hit.index,
      });
      onOpenChange(false);
      if (workspace) {
        workspace.navigate(hit.href, {
          newTab: newTabMode,
          preferCatalogue: config.preferCatalogueHref?.(hit.href) ?? false,
        });
      } else {
        router.push(hit.href);
      }
    },
    [q, onOpenChange, router, workspace, newTabMode, config],
  );

  const showHistory = q.trim().length < 2;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            "creezio-search-palette fixed z-50 flex flex-col overflow-hidden bg-white shadow-2xl outline-none",
            "inset-0 h-[100dvh] w-full rounded-none",
            "md:inset-x-auto md:left-1/2 md:top-[8%] md:h-auto md:max-h-[min(680px,85vh)] md:w-[min(920px,calc(100vw-2rem))] md:-translate-x-1/2 md:rounded-xl md:border md:border-slate-200",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">Recherche globale</DialogPrimitive.Title>
          <Command
            shouldFilter={false}
            className="flex h-full flex-col md:h-auto"
            loop
          >
            {newTabMode ? (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-medium text-slate-500">
                <Plus className="h-3 w-3" />
                Le résultat s&apos;ouvrira dans un nouvel onglet
              </div>
            ) : null}
            <div className="relative shrink-0">
              <CommandInput
                value={q}
                onValueChange={setQ}
                placeholder={config.placeholder || "Rechercher..."}
                autoFocus
              />
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:hidden"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 md:inline">
                esc
              </kbd>
            </div>

            {!showHistory && (
              <FilterChips
                hits={hits}
                active={filterIndex}
                onChange={setFilterIndex}
                labels={indexLabels}
              />
            )}

            <div className="flex min-h-0 flex-1 md:grid md:grid-cols-[1fr_280px]">
              <CommandList className="max-h-none flex-1 md:max-h-[min(480px,60vh)]">
                {loading ? (
                  <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Recherche en cours…
                  </div>
                ) : null}

                {showHistory ? (
                  <>
                    {history.recent.length > 0 ? (
                      <CommandGroup heading="Récemment consultés">
                        {history.recent.map((hit) => (
                          <CommandItem
                            key={`recent-${hitKey(hit)}`}
                            value={`recent-${hitKey(hit)}`}
                            onSelect={() => navigateTo(hit)}
                            onMouseEnter={() => setSelectedKey(hitKey(hit))}
                            className="flex items-start justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="truncate font-medium">{hit.title}</p>
                              {hit.subtitle ? (
                                <p className="truncate text-xs text-slate-500">{hit.subtitle}</p>
                              ) : null}
                            </div>
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                              {indexLabels[hit.index] || hit.index}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : null}
                    {history.queries.length > 0 ? (
                      <>
                        {history.recent.length > 0 ? <CommandSeparator /> : null}
                        <CommandGroup heading="Recherches récentes">
                          {history.queries.map((query) => (
                            <CommandItem
                              key={`query-${query}`}
                              value={`query-${query}`}
                              onSelect={() => setQ(query)}
                            >
                              <History className="mr-2 h-4 w-4 text-slate-400" />
                              {query}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </>
                    ) : null}
                    {!history.recent.length && !history.queries.length ? (
                      <div className="px-4 py-10 text-center text-sm text-slate-500">
                        <Clock className="mx-auto mb-2 h-6 w-6 opacity-40" />
                        Tapez au moins 2 caractères pour rechercher
                      </div>
                    ) : null}
                  </>
                ) : null}

                {!loading && !showHistory && !filteredHits.length ? (
                  <CommandEmpty>Aucun résultat pour "{q.trim()}"</CommandEmpty>
                ) : null}

                {!showHistory &&
                  grouped.map((group) => (
                    <CommandGroup key={group.index} heading={group.label}>
                      {group.hits.map((hit) => (
                        <CommandItem
                          key={hitKey(hit)}
                          value={hitKey(hit)}
                          onSelect={() => navigateTo(hit)}
                          onMouseEnter={() => setSelectedKey(hitKey(hit))}
                          className={cn(
                            "flex items-start justify-between gap-2",
                            selectedHit && hitKey(selectedHit) === hitKey(hit) && "bg-slate-100",
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{hit.title}</p>
                            {hit.subtitle ? (
                              <p className="truncate text-xs text-slate-500">{hit.subtitle}</p>
                            ) : null}
                          </div>
                          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
              </CommandList>

              <aside className="hidden border-l border-slate-200 bg-slate-50/80 md:block">
                <HitPreview hit={selectedHit} labels={indexLabels} />
              </aside>
            </div>

            <footer className="hidden shrink-0 items-center gap-4 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 md:flex">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-white px-1">↑</kbd>
                <kbd className="rounded border border-slate-200 bg-white px-1">↓</kbd>
                naviguer
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-white px-1">↵</kbd>
                ouvrir
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-slate-200 bg-white px-1">esc</kbd>
                fermer
              </span>
            </footer>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function GlobalSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false);
  const [newTabMode, setNewTabMode] = useState(false);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (!next) setNewTabMode(false);
  }, []);

  const openForNewTab = useCallback(() => {
    setNewTabMode(true);
    setOpenState(true);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpenState((v) => {
          if (v) setNewTabMode(false);
          return !v;
        });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({ open, setOpen, openForNewTab }),
    [open, setOpen, openForNewTab],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
      <GlobalSearchModal open={open} onOpenChange={setOpen} newTabMode={newTabMode} />
    </GlobalSearchContext.Provider>
  );
}


configureGlobalSearchHost({
  useGlobalSearch,
});
