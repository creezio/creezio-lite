"use client";

import type { ReactNode } from "react";
import { AssistantProvider } from "./assistant-provider";

/**
 * Provider UI assistant uniquement.
 * Le FAB / panel / UiDriver sont montés dans WorkspaceRoot (sous
 * TabWorkspaceProvider) pour accéder à `activeSurface`.
 */
export function AssistantRoot({ children }: { children: ReactNode }) {
  return <AssistantProvider>{children}</AssistantProvider>;
}
