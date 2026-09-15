import { AppShell } from "../layout/app-shell";
import { Skeleton } from "../primitives/skeleton";
import type { PageKind, TrailCrumb } from "../workspace/types";

/** Shell immédiat pour pages liste lourdes — même pattern JustRent. */
export function ListPageLoading({
  title,
  subtitle = "Chargement des données…",
  kpiCount = 0,
  filterRows = 1,
  tableRows = 8,
  kind = "section",
  trail,
}: {
  title: string;
  subtitle?: string;
  kpiCount?: number;
  filterRows?: number;
  tableRows?: number;
  kind?: PageKind;
  trail?: TrailCrumb[];
}) {
  return (
    <AppShell title={title} subtitle={subtitle} kind={kind} trail={trail}>
      <div className="space-y-4" aria-busy="true" aria-label="Chargement de la page">
        {kpiCount > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: kpiCount }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : null}
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <Skeleton className="h-9 w-full max-w-md" />
          {Array.from({ length: filterRows }).map((_, i) => (
            <div key={i} className="flex flex-wrap gap-2">
              <Skeleton className="h-8 w-28 rounded-md" />
              <Skeleton className="h-8 w-32 rounded-md" />
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="divide-y divide-slate-100">
            {Array.from({ length: tableRows }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
