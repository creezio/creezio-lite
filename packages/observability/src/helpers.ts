/**
 * Helpers d'émission typés — activité / usages plugins / control-plane.
 */

import type { ObservabilityEvent, ObservabilityStore } from "./types.js";
import type {
  ActivityAction,
  ControlPlaneAction,
  RecordObservabilityEventInput,
} from "./types.js";

export type EmitActor = {
  orgId?: string | null;
  userId?: string | null;
  brandId?: string | null;
};

export function recordActivity(
  store: ObservabilityStore,
  action: ActivityAction | string,
  actor?: EmitActor,
  meta?: Record<string, unknown>,
): ObservabilityEvent {
  return store.record({
    kind: "activity",
    action,
    orgId: actor?.orgId,
    userId: actor?.userId,
    brandId: actor?.brandId,
    meta,
  });
}

export function recordPluginUsage(
  store: ObservabilityStore,
  input: {
    pluginId: string;
    action?: string;
    actor?: EmitActor;
    meta?: Record<string, unknown>;
  },
): ObservabilityEvent {
  return store.record({
    kind: "plugin_usage",
    action: input.action || "execute",
    pluginId: input.pluginId,
    orgId: input.actor?.orgId,
    userId: input.actor?.userId,
    brandId: input.actor?.brandId,
    meta: input.meta,
  });
}

export function recordControlPlaneEvent(
  store: ObservabilityStore,
  action: ControlPlaneAction | string,
  input?: {
    pluginId?: string | null;
    actor?: EmitActor;
    meta?: Record<string, unknown>;
  },
): ObservabilityEvent {
  return store.record({
    kind: "control_plane",
    action,
    pluginId: input?.pluginId,
    orgId: input?.actor?.orgId,
    userId: input?.actor?.userId,
    brandId: input?.actor?.brandId,
    meta: input?.meta,
  } satisfies RecordObservabilityEventInput);
}
