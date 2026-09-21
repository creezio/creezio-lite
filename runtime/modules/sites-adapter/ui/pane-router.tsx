"use client";

import { createElement, useContext, useLayoutEffect, useRef, type Context, type ReactNode } from "react";
import {
  ElementsContext, ChildrenContext, ParallelSlotsContext, BfcacheIdentityMapContext,
} from "vinext/shims/slot";
import {
  getBfcacheIdMapContext, getBfcacheSegmentIdContext, getLayoutSegmentContext,
} from "vinext/shims/navigation-context-state";
import {WorkspaceRenderedLocationContext} from "../../shell-ui/ui/workspace/use-location-search";
import { getClientNavigationRenderContext } from "vinext/shims/navigation";

// Vinext resolves layout children through these contexts, not Next's
// LayoutRouterContext. All are scoped to a pane; no global router mutation.
// Pinned to the template's Vinext version and exercised with its real Slot.
const contexts: Context<unknown>[] = [
  ElementsContext, ChildrenContext, ParallelSlotsContext, BfcacheIdentityMapContext,
  getBfcacheIdMapContext()!, getBfcacheSegmentIdContext()!, getLayoutSegmentContext()!,
  getClientNavigationRenderContext()!,
].map(context => context as unknown as Context<unknown>);

function FreezeContext({ context, live, children }: {
  context: Context<unknown>;
  live: boolean;
  children?: ReactNode;
}) {
  const current = useContext(context);
  const committed = useRef(current);
  // Remember committed pages only: an interrupted transition must not replace
  // the snapshot belonging to a previously rendered tab.
  useLayoutEffect(() => { if (live) committed.current = current; }, [live, current]);
  // eslint-disable-next-line react-hooks/refs
  return createElement(context.Provider, { value: live ? current : committed.current }, children);
}

export function SitesPaneRouter({ live, children }: { live: boolean; children: ReactNode }) {
  return contexts.reduceRight<ReactNode>((node, context) =>
    createElement(FreezeContext, { context, live }, node), children);
}

/** Keep the shell's cache key in the same render snapshot as its RSC children.
 * Vinext's public navigation hooks can fall back to the global committed URL
 * while a retained layout already receives the next ElementsContext. */
export function SitesWorkspaceLocation({children}:{children:ReactNode}) {
 const snapshot=useContext(getClientNavigationRenderContext()!);
 return createElement(WorkspaceRenderedLocationContext.Provider,{value:snapshot?{pathname:snapshot.pathname,search:snapshot.searchParams.toString()}:null},children);
}
