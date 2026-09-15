"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));

  function href(p: number) {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    return `${pathname}?${next.toString()}`;
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn =
    "inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium hover:bg-slate-50 disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <p className="text-sm text-slate-500">
        {from}–{to} sur {total.toLocaleString("fr-FR")}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={btn} href={href(page - 1)}>
            Précédent
          </Link>
        ) : (
          <span className={`${btn} opacity-40`}>Précédent</span>
        )}
        <span className="text-sm tabular-nums text-slate-600">
          Page {page} / {pages}
        </span>
        {page < pages ? (
          <Link className={btn} href={href(page + 1)}>
            Suivant
          </Link>
        ) : (
          <span className={`${btn} opacity-40`}>Suivant</span>
        )}
      </div>
    </div>
  );
}
