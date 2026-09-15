"use client";

import { Fragment } from "react";
import Link from "next/link";
import { GlobalSearchTrigger } from "../global-search";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../primitives/breadcrumb";
import { cn } from "@creezio/shell-ui";
import { normalizeHref } from "../workspace/types";
import type { PageKind, TrailCrumb } from "../workspace/types";
import { usePageToolbarActions } from "./page-toolbar-context";

/**
 * Bandeau unique sous les onglets workspace.
 * - section : recherche + actions (titre = label d'onglet uniquement)
 * - entity  : recherche + fil d'Ariane + actions
 */
export function PageChrome({
  kind,
  href,
  trail,
}: {
  kind: PageKind;
  href: string;
  trail?: TrailCrumb[];
}) {
  const actions = usePageToolbarActions(normalizeHref(href));
  const crumbs: TrailCrumb[] =
    kind === "entity" && trail && trail.length > 0 ? trail : [];

  return (
    <div className="-mx-2 border-b border-slate-200/80 bg-white px-3 py-2 sm:-mx-3 sm:px-4 md:-mx-4 md:px-5">
      <div className="flex min-h-9 items-center gap-2 sm:gap-3">
        <div
          className={cn(
            "min-w-0 shrink-0",
            kind === "entity" ? "w-full max-w-[14rem] sm:max-w-xs" : "max-w-md flex-1",
          )}
        >
          <GlobalSearchTrigger variant="toolbar" />
        </div>

        {kind === "entity" && crumbs.length > 0 ? (
          <div className="min-w-0 flex-1 overflow-hidden">
            <Breadcrumb>
              <BreadcrumbList className="flex-nowrap">
                {crumbs.map((c, i) => {
                  const last = i === crumbs.length - 1;
                  // Le séparateur (un <li>) doit être FRÈRE de BreadcrumbItem
                  // (aussi un <li>) — un <li> imbriqué dans un <li> est du HTML
                  // invalide qui casse l'hydratation React (mismatch #418).
                  return (
                    <Fragment key={`${c.label}-${i}`}>
                      {i > 0 ? <BreadcrumbSeparator /> : null}
                      <BreadcrumbItem className="min-w-0">
                        {last || !c.href ? (
                          <BreadcrumbPage
                            className={cn(!last && "font-normal text-slate-500")}
                          >
                            {c.label}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={c.href}>{c.label}</Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        ) : null}

        {actions ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
