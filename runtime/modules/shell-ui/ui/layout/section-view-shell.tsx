import { Suspense, type ReactNode } from "react";
import { AppShell } from "./app-shell";
import {
  ViewToggle,
  ViewToggleSkeleton,
  type ViewOption,
} from "../list-toolbar";

/** À ré-exporter depuis page.tsx des sections catalogue avec vues. */
export const SECTION_VIEW_DYNAMIC = "force-dynamic" as const;

export type SectionViewShellProps = {
  title: string;
  subtitle: string;
  view: string;
  viewOptions: readonly ViewOption[];
  suspenseKey: string;
  fallback: ReactNode;
  children: ReactNode;
};

/**
 * Shell section immédiat : AppShell + ViewToggle optimiste + Suspense catalogue.
 * Le fetch lourd vit dans *-catalog.tsx (async server component).
 */
export function SectionViewShell({
  title,
  subtitle,
  view,
  viewOptions,
  suspenseKey,
  fallback,
  children,
}: SectionViewShellProps) {
  return (
    <AppShell
      kind="section"
      title={title}
      subtitle={subtitle}
      actions={<ViewToggle view={view} options={[...viewOptions]} />}
    >
      <Suspense key={suspenseKey} fallback={fallback}>
        {children}
      </Suspense>
    </AppShell>
  );
}

export type SectionViewLoadingProps = {
  title: string;
  subtitle?: string;
  viewOptions: readonly ViewOption[];
  contentFallback: ReactNode;
};

/** loading.tsx — même chrome que SectionViewShell (toggle skeleton + contenu). */
export function SectionViewLoading({
  title,
  subtitle = "Chargement…",
  viewOptions,
  contentFallback,
}: SectionViewLoadingProps) {
  return (
    <AppShell
      kind="section"
      title={title}
      subtitle={subtitle}
      actions={<ViewToggleSkeleton options={viewOptions} />}
    >
      {contentFallback}
    </AppShell>
  );
}
