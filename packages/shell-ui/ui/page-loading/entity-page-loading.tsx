import { AppShell } from "../layout/app-shell";
import { Skeleton } from "../primitives/skeleton";
import type { TrailCrumb } from "../workspace/types";

/** Squelette fiche entité (galerie + panneau) — pas un tableau liste. */
export function EntityPageLoading({
  title = "Produit",
  subtitle = "Chargement de la fiche…",
  trail,
}: {
  title?: string;
  subtitle?: string;
  trail?: TrailCrumb[];
}) {
  return (
    <AppShell title={title} subtitle={subtitle} kind="entity" trail={trail}>
      <div
        className="space-y-6"
        aria-busy="true"
        aria-label="Chargement de la fiche"
      >
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7">
            <Skeleton className="aspect-square w-full rounded-xl" />
          </div>
          <aside className="lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
              <Skeleton className="h-7 w-3/4" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="mt-5 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-36" />
                <Skeleton className="h-4 w-28" />
              </div>
              <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
              <Skeleton className="mt-6 h-10 w-full rounded-md" />
            </div>
          </aside>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton className="mb-3 h-4 w-40" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
