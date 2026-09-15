"use client";

import { FormEvent, useEffect, useRef, useState, useTransition, type ChangeEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "./primitives/input";
import { Button } from "./primitives/button";
import { cn } from "@creezio/shell-ui";
import { aidProps } from "./lib/aid";

export const SEARCH_DEBOUNCE_MS = 300;

type SearchInputProps = {
  searchKey?: string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  /** Affiche un bouton submit optionnel (défaut : masqué, debounce suffit). */
  showSubmit?: boolean;
  submitLabel?: string;
  debounceMs?: number;
  /**
   * Mode filtre client (données déjà en props) : met à jour l’URL sans
   * `router.refresh()` — évite un re-fetch RSC/SQLite à chaque frappe.
   */
  skipRefresh?: boolean;
};

/**
 * Champ de recherche URL-driven avec debounce (replace, sans empiler l’historique).
 * Centralisé pour les listes ops (clients, véhicules, assurances, etc.).
 *
 * Next.js 14 : `router.replace` met à jour l’URL ; `router.refresh()` force le
 * re-fetch RSC (sinon soft-nav peut laisser le tableau stale). Un seul refresh
 * après replace — pas de history.replaceState seul (refresh ignore alors le `q`).
 */
export function SearchInput({
  searchKey = "q",
  placeholder = "Rechercher…",
  className,
  inputClassName,
  showSubmit = false,
  submitLabel = "Filtrer",
  debounceMs = SEARCH_DEBOUNCE_MS,
  skipRefresh = false,
}: SearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const urlSearch = params.get(searchKey) || "";
  const [searchValue, setSearchValue] = useState(urlSearch);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsRef = useRef(params);
  const pathnameRef = useRef(pathname);
  const navSeqRef = useRef(0);
  /** Dernière valeur poussée vers l’URL (ou reçue de l’extérieur). */
  const appliedRef = useRef(urlSearch);
  /** true tant que l’utilisateur tape et que le debounce n’a pas appliqué. */
  const dirtyRef = useRef(false);
  paramsRef.current = params;
  pathnameRef.current = pathname;

  // Sync input ← URL (back/forward, lien, clear externe) sans écraser une frappe en cours.
  useEffect(() => {
    if (dirtyRef.current) {
      if (urlSearch === searchValue.trim()) {
        dirtyRef.current = false;
        appliedRef.current = urlSearch;
      }
      return;
    }
    if (urlSearch !== appliedRef.current) {
      appliedRef.current = urlSearch;
      setSearchValue(urlSearch);
    }
  }, [urlSearch, searchValue]);

  function applySearch(raw: string) {
    const q = raw.trim();
    const next = new URLSearchParams(paramsRef.current.toString());
    const current = next.get(searchKey) || "";
    if (q === current) {
      dirtyRef.current = false;
      appliedRef.current = q;
      return;
    }
    if (q) next.set(searchKey, q);
    else next.delete(searchKey);
    next.delete("page");
    const qs = next.toString();
    const href = qs ? `${pathnameRef.current}?${qs}` : pathnameRef.current;
    const seq = ++navSeqRef.current;
    dirtyRef.current = false;
    appliedRef.current = q;
    startTransition(() => {
      if (seq !== navSeqRef.current) return;
      router.replace(href, { scroll: false });
      if (!skipRefresh) router.refresh();
    });
  }

  useEffect(() => {
    if (searchValue.trim() === urlSearch && !dirtyRef.current) return;
    if (searchValue.trim() === appliedRef.current && !dirtyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      applySearch(searchValue);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce sur la frappe uniquement
  }, [searchValue, urlSearch, searchKey, debounceMs]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    applySearch(searchValue);
  }

  return (
    <form onSubmit={onSubmit} className={cn("flex min-w-[200px] flex-1 gap-2", className)}>
      <Input
        name={searchKey}
        value={searchValue}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          dirtyRef.current = true;
          setSearchValue(e.target.value);
        }}
        placeholder={placeholder}
        {...aidProps(`search.${searchKey}`)}
        className={cn("max-w-sm", inputClassName)}
        autoComplete="off"
      />
      {showSubmit ? (
        <Button type="submit" variant="secondary">
          {submitLabel}
        </Button>
      ) : (
        <button type="submit" className="sr-only">
          Rechercher
        </button>
      )}
    </form>
  );
}
