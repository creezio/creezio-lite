"use client";

import type { ComponentType } from "react";

type AnyProps = Record<string, unknown>;

let Panel: ComponentType<AnyProps> | null = null;

/** O9p : brancher `AiActivityPanel` depuis `@creezio/tasks/ui`. */
export function configureAiActivityPanel(
  next: ComponentType<AnyProps> | null,
): void {
  Panel = next;
}

export function AiActivityPanelHost(props: AnyProps) {
  if (!Panel) return null;
  return <Panel {...props} />;
}
