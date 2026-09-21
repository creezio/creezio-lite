"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { Button } from "./primitives/button";
import { Input } from "./primitives/input";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchPlaceholder?: string;
  initialPageSize?: number;
  /** Optional remote query/pagination. Existing local mode stays unchanged. */
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
  filterSlot?: ReactNode;
  remoteSorting?: {value:SortingState;onChange:(value:SortingState)=>void};
  remotePage?: {index: number; size: number; total: number; onChange: (index: number) => void};
};

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = "Rechercher…",
  initialPageSize = 25,
  searchValue, onSearchValueChange, filterSlot, remotePage, remoteSorting,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting:remoteSorting?.value??sorting, globalFilter, ...(remotePage ? {pagination:{pageIndex:remotePage.index,pageSize:remotePage.size}} : {}) },
    manualFiltering: Boolean(onSearchValueChange),
    manualPagination: Boolean(remotePage),
    ...(remotePage ? {pageCount:Math.ceil(remotePage.total/remotePage.size)} : {}),
    manualSorting: Boolean(remoteSorting),
    enableMultiSort: !remoteSorting,
    onSortingChange: change=>{if(remoteSorting)remoteSorting.onChange(typeof change==='function'?change(remoteSorting.value):change);else setSorting(change);},
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize } },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3"><Input
        value={searchValue ?? globalFilter ?? ""}
        onChange={(e) => onSearchValueChange ? onSearchValueChange(e.target.value) : setGlobalFilter(e.target.value)}
        placeholder={searchPlaceholder}
        className="max-w-sm"
        aria-label={searchPlaceholder}
      />{filterSlot}</div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    className="cursor-pointer px-4 py-3 font-medium select-none"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/80">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-slate-500">
                  Aucun résultat
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          {remotePage?.total ?? table.getFilteredRowModel().rows.length} ligne(s) — page{" "}
          {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => remotePage ? remotePage.onChange(remotePage.index - 1) : table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Précédent
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => remotePage ? remotePage.onChange(remotePage.index + 1) : table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Suivant
          </Button>
        </div>
      </div>
    </div>
  );
}
