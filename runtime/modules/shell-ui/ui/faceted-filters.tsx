"use client";

import { useTransition } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./primitives/select";
import { SearchInput } from "./search-input";
import { aidProps } from "./lib/aid";

export type FacetOption = { value: string; c: number; label?: string };

export type FacetDef = {
  key: string;
  label: string;
  options: FacetOption[];
  allLabel?: string;
  /** Valeur affichée si le param URL est absent (ex. period → exercice). */
  defaultValue?: string;
  /** Pas de ligne « Tous » — utile quand les options couvrent déjà le reset (ex. period=all). */
  hideAllOption?: boolean;
};

export function FacetedFilters({
  facets,
  searchKey = "q",
  searchPlaceholder = "Rechercher…",
  showSearchSubmit = false,
  showSearch = true,
  skipRefresh = false,
}: {
  facets: FacetDef[];
  searchKey?: string;
  searchPlaceholder?: string;
  /** Bouton « Filtrer » (inutile avec le debounce par défaut). */
  showSearchSubmit?: boolean;
  /** Masquer la recherche (ex. synthèse : exercice + période seulement). */
  showSearch?: boolean;
  /** Mode filtre client — pas de `router.refresh()` (voir UI-PATTERNS §4). */
  skipRefresh?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function update(
    key: string,
    value: string,
    opts?: { defaultValue?: string; allIsOption?: boolean },
  ) {
    const next = new URLSearchParams(params.toString());
    const isDefault = Boolean(opts?.defaultValue && value === opts.defaultValue);
    const isClearAll = value === "all" && !opts?.allIsOption;
    if (!value || isDefault || isClearAll) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    // Un changement de facette invalide le preset affiché
    next.delete("preset");
    // Période rapide et plage custom sont exclusives
    if (key === "period") {
      next.delete("dateFrom");
      next.delete("dateTo");
    }
    // Changer de famille invalide la catégorie feuille
    if (key === "famille") next.delete("categorie");
    const qs = next.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.push(href);
      if (!skipRefresh) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      {showSearch ? (
        <SearchInput
          searchKey={searchKey}
          placeholder={searchPlaceholder}
          showSubmit={showSearchSubmit}
          skipRefresh={skipRefresh}
        />
      ) : null}
      {facets.map((f) => {
        const current = params.get(f.key) || f.defaultValue || "all";
        const optionsHaveAll = f.options.some((o) => o.value === "all");
        return (
          <Select
            key={f.key}
            value={current}
            onValueChange={(v) =>
              update(f.key, v, {
                defaultValue: f.defaultValue,
                allIsOption: optionsHaveAll,
              })
            }
          >
            <SelectTrigger
              className="w-52"
              {...aidProps(`filter.${f.key}`)}
              aria-label={`Filtre ${f.label}`}
            >
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              {!f.hideAllOption && !optionsHaveAll ? (
                <SelectItem value="all">{f.allLabel || `Tous — ${f.label}`}</SelectItem>
              ) : null}
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {(o.label || o.value)} ({o.c})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      })}
    </div>
  );
}
