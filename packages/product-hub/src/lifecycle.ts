/**
 * Machine d'état Product Hub — contrats purs (TF2/Certivan plugin-product-hub).
 */

export const PLUGIN_LIFECYCLE_STATES = [
  "request_received",
  "impact_analysis",
  "clarification_required",
  "prd_draft",
  "awaiting_prd_approval",
  "planning",
  "ready_for_execution",
  "executing",
  "automated_testing",
  "awaiting_human_qa",
  "released",
  "blocked",
  "cancelled",
] as const;

export type PluginLifecycleState = (typeof PLUGIN_LIFECYCLE_STATES)[number];

export const PLUGIN_TASK_STATUSES = [
  "backlog",
  "specification",
  "ready",
  "in_progress",
  "automated_tests",
  "human_qa",
  "done",
  "cancelled",
  "archived",
] as const;

export type PluginTaskStatus = (typeof PLUGIN_TASK_STATUSES)[number];

export const PLUGIN_LIFECYCLE_TRANSITIONS: Record<
  PluginLifecycleState,
  PluginLifecycleState[]
> = {
  request_received: ["impact_analysis", "cancelled"],
  impact_analysis: ["clarification_required", "prd_draft", "cancelled"],
  clarification_required: ["prd_draft", "cancelled"],
  prd_draft: ["awaiting_prd_approval", "clarification_required", "cancelled"],
  awaiting_prd_approval: ["planning", "prd_draft", "cancelled"],
  planning: ["ready_for_execution", "blocked", "cancelled"],
  ready_for_execution: ["executing", "blocked", "cancelled"],
  executing: ["automated_testing", "blocked", "cancelled"],
  automated_testing: ["awaiting_human_qa", "executing", "blocked", "cancelled"],
  awaiting_human_qa: ["released", "executing", "blocked", "cancelled"],
  released: ["impact_analysis"],
  blocked: [
    "impact_analysis",
    "planning",
    "ready_for_execution",
    "executing",
    "cancelled",
  ],
  cancelled: [],
};

export function isPluginLifecycleState(
  value: string,
): value is PluginLifecycleState {
  return (PLUGIN_LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function canTransitionPluginLifecycle(
  from: PluginLifecycleState,
  to: PluginLifecycleState,
): boolean {
  return PLUGIN_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function assertPluginLifecycleTransition(
  from: PluginLifecycleState,
  to: PluginLifecycleState,
): void {
  if (!canTransitionPluginLifecycle(from, to)) {
    throw new Error(`Transition invalide: ${from} → ${to}`);
  }
}
