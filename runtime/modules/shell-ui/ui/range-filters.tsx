"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";

/**
 * Filtres comparateur prix (min/max) + plage de dates (dateFrom/dateTo).
 * Application explicite via bouton (pas de debounce) pour éviter les allers-retours.
 */
export function RangeFilters({
  priceMinKey = "priceMin",
  priceMaxKey = "priceMax",
  dateFromKey = "dateFrom",
  dateToKey = "dateTo",
  amountLabel = "Prix",
  dateFromLabel = "Création du",
  dateHint = "Filtre sur la date de création",
  showAmount = true,
  clearLabel = "Effacer montant/dates",
}: {
  priceMinKey?: string;
  priceMaxKey?: string;
  dateFromKey?: string;
  dateToKey?: string;
  /** Libellé commun aux deux bornes (Prix, Montant…). */
  amountLabel?: string;
  dateFromLabel?: string;
  dateHint?: string;
  /** Masque les bornes montant lorsque la page ne filtre que les dates. */
  showAmount?: boolean;
  clearLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [priceMin, setPriceMin] = useState(params.get(priceMinKey) || "");
  const [priceMax, setPriceMax] = useState(params.get(priceMaxKey) || "");
  const [dateFrom, setDateFrom] = useState(params.get(dateFromKey) || "");
  const [dateTo, setDateTo] = useState(params.get(dateToKey) || "");

  useEffect(() => {
    setPriceMin(params.get(priceMinKey) || "");
    setPriceMax(params.get(priceMaxKey) || "");
    setDateFrom(params.get(dateFromKey) || "");
    setDateTo(params.get(dateToKey) || "");
  }, [params, priceMinKey, priceMaxKey, dateFromKey, dateToKey]);

  function apply(e?: FormEvent) {
    e?.preventDefault();
    const next = new URLSearchParams(params.toString());
    const setOrDel = (key: string, value: string) => {
      const v = value.trim();
      if (v) next.set(key, v);
      else next.delete(key);
    };
    setOrDel(priceMinKey, priceMin);
    setOrDel(priceMaxKey, priceMax);
    setOrDel(dateFromKey, dateFrom);
    setOrDel(dateToKey, dateTo);
    next.delete("page");
    next.delete("preset");
    // Plage custom prioritaire : on retire le raccourci période
    if (dateFrom.trim() || dateTo.trim()) next.delete("period");
    const qs = next.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.push(href);
      router.refresh();
    });
  }

  function clearRanges() {
    setPriceMin("");
    setPriceMax("");
    setDateFrom("");
    setDateTo("");
    const next = new URLSearchParams(params.toString());
    [priceMinKey, priceMaxKey, dateFromKey, dateToKey, "preset"].forEach((k) =>
      next.delete(k),
    );
    next.delete("page");
    const qs = next.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    startTransition(() => {
      router.push(href);
      router.refresh();
    });
  }

  const hasAny =
    Boolean(params.get(priceMinKey)) ||
    Boolean(params.get(priceMaxKey)) ||
    Boolean(params.get(dateFromKey)) ||
    Boolean(params.get(dateToKey));

  return (
    <form
      onSubmit={apply}
      className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
    >
      {showAmount ? (
        <>
          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {amountLabel} min
            </label>
            <Input
              type="number"
              inputMode="decimal"
              step="1"
              placeholder="ex. 300"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              className="w-28"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {amountLabel} max
            </label>
            <Input
              type="number"
              inputMode="decimal"
              step="1"
              placeholder="ex. 800"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              className="w-28"
            />
          </div>
        </>
      ) : null}
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {dateFromLabel}
        </label>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
          title={dateHint}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          au
        </label>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
          title={dateHint}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          Appliquer
        </Button>
        {hasAny ? (
          <Button type="button" size="sm" variant="secondary" onClick={clearRanges}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
      <p className="w-full text-[11px] text-slate-400">{dateHint}</p>
    </form>
  );
}
