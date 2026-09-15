import { getAssistantBrandConfig } from "./registry.js";

export type ServerOpsEvent = {
  level: string;
  kind: string;
  outcome?: string;
  reason?: string;
  durationMs?: number;
  ctx?: Record<string, unknown>;
};

export function trackServer(evt: ServerOpsEvent): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`CREEZIO_OPS ${JSON.stringify({ ...evt, source: "assistant" })}`);
  } catch {
    /* best-effort */
  }
}

export function trackServerDebounced(
  evt: ServerOpsEvent,
  intervalMs = 5 * 60_000,
): void {
  const brand = getAssistantBrandConfig()?.trackServerDebounced;
  if (brand) {
    brand(evt, intervalMs);
    return;
  }
  trackServer(evt);
}
