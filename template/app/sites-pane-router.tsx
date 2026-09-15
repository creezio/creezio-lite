"use client";

import { createElement, useContext, useLayoutEffect, useRef, type Context, type ReactNode } from "react";
import {
  ElementsContext, ChildrenContext, ParallelSlotsContext, BfcacheIdentityMapContext,
} from "vinext/shims/slot";
import {
  getBfcacheIdMapContext, getBfcacheSegmentIdContext, getLayoutSegmentContext,
} from "vinext/shims/navigation-context-state";
import { getClientNavigationRenderContext } from "vinext/shims/navigation";

// Vinext resolves layout children through these contexts, not Next's
// LayoutRouterContext. All are scoped to a pane; no global router mutation.
// Pinned to the template's Vinext version and exercised with its real Slot.
const contexts: Context<any>[] = [
  ElementsContext, ChildrenContext, ParallelSlotsContext, BfcacheIdentityMapContext,
  getBfcacheIdMapContext()!, getBfcacheSegmentIdContext()!, getLayoutSegmentContext()!,
  getClientNavigationRenderContext()!,
];

function FreezeContext({ context, live, children }: {
  context: Context<any>;
  live: boolean;
  children: ReactNode;
}) {
  const current = useContext(context);
  const committed = useRef(current);
  // Remember committed pages only: an interrupted transition must not replace
  // the snapshot belonging to a previously rendered tab.
  useLayoutEffect(() => { if (live) committed.current = current; }, [live, current]);
  return createElement(context.Provider, { value: live ? current : committed.current }, children);
}

export function SitesPaneRouter({ live, children }: { live: boolean; children: ReactNode }) {
  return contexts.reduceRight<ReactNode>((node, context) =>
    createElement(FreezeContext, { context, live, children: node }), children);
}
