/**
 * Host marque pour GlobalSearch (dépend tab-workspace).
 */

export type GlobalSearchHost = {
  useGlobalSearch: () => any;
};

let host: GlobalSearchHost | null = null;

export function configureGlobalSearchHost(next: GlobalSearchHost): void {
  host = next;
}

export function useGlobalSearch(): any {
  if (!host?.useGlobalSearch) {
    return { open: false, setOpen: () => {}, query: "", setQuery: () => {} };
  }
  return host.useGlobalSearch();
}
