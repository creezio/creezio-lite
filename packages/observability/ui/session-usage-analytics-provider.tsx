"use client";

/**
 * Bridge session auth → tracker usage (POST /api/v1/analytics/events).
 * À monter sous `SessionProvider` (typiquement BrandChrome factory).
 * Suspense interne pour `useSearchParams` (App Router Next).
 */

import { Suspense, type ReactNode } from "react";
import { useSession } from "@creezio/auth/ui";
import { UsageAnalyticsProvider } from "./usage-analytics-provider";

function SessionUsageAnalyticsInner({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return <UsageAnalyticsProvider me={me}>{children}</UsageAnalyticsProvider>;
}

export function SessionUsageAnalyticsProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <SessionUsageAnalyticsInner>{children}</SessionUsageAnalyticsInner>
    </Suspense>
  );
}
