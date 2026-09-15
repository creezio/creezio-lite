import type { ReactNode } from "react";
import { cn } from "@creezio/shell-ui";

/**
 * En-tête standard des fiches entité (contenu, sous le chrome sticky).
 * Titre obligatoire — pas de H1 hors de ce composant.
 */
export function EntityHeader({
  title,
  description,
  badges,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        {badges ? (
          <div className="flex flex-wrap items-center gap-2">{badges}</div>
        ) : null}
        <h1 className="text-xl font-semibold leading-snug tracking-tight text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <div className="text-sm text-slate-500">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
