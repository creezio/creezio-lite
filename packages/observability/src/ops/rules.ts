/**
 * Boîte noire — moteur d'anomalies générique.
 * Règles boot ops (R4).
 */

import {
  currentBootSummary,
  readPreviousBootSummaries,
  track,
} from "./journal.js";
import type { OpsBootSummary } from "./types.js";

/**
 * Règle 1 — décision négative répétée : si la MÊME décision négative est
 * prise à N boots consécutifs, quelque chose ne s'auto-répare pas.
 */
const NEGATIVE_OUTCOMES: Record<string, string[]> = {
  "meili.ready": ["full-reindex", "skip-no-meili"],
  "meili.start": ["unavailable"],
  "tunnel.connect": ["error"],
};
const REPEAT_BOOTS = 2;

/** Règle 2 — durée anormale par kind (ms). */
const DURATION_THRESHOLDS_MS: Record<string, number> = {
  "boot.done": 8 * 60_000,
  "index.run": 10 * 60_000,
  "migrations.done": 3 * 60_000,
  "catalog.ensure": 30 * 60_000,
};

/** Règle 3 — erreurs récurrentes dans un même boot. */
const ERROR_COUNT_THRESHOLD = 10;

function isNegative(kind: string, outcome?: string): boolean {
  if (!outcome) return false;
  return (NEGATIVE_OUTCOMES[kind] || []).includes(outcome);
}

export type BootRuleFinding = {
  rule:
    | "repeated-negative-decision"
    | "duration-over-threshold"
    | "recurring-errors";
  kind: string;
  detail: string;
  ctx?: Record<string, unknown>;
};

/** Pure — testable sans I/O. */
export function evaluateRulesPure(
  current: OpsBootSummary,
  previous: OpsBootSummary[],
): BootRuleFinding[] {
  const findings: BootRuleFinding[] = [];

  for (const [kind, d] of Object.entries(current.decisions || {})) {
    if (!isNegative(kind, d.outcome)) continue;
    let consecutive = 1;
    for (const prev of previous) {
      const pd = prev.decisions?.[kind];
      if (pd && isNegative(kind, pd.outcome)) consecutive++;
      else break;
    }
    if (consecutive >= REPEAT_BOOTS) {
      findings.push({
        rule: "repeated-negative-decision",
        kind,
        detail: `${kind} outcome=${d.outcome} sur ${consecutive} boots consécutifs (reason=${d.reason || "?"})`,
        ctx: {
          outcome: d.outcome,
          reason: d.reason,
          consecutiveBoots: consecutive,
        },
      });
    }
  }

  for (const [kind, threshold] of Object.entries(DURATION_THRESHOLDS_MS)) {
    const observed = current.durations?.[kind];
    if (observed != null && observed > threshold) {
      findings.push({
        rule: "duration-over-threshold",
        kind,
        detail: `${kind} a duré ${Math.round(observed / 1000)}s (seuil ${Math.round(threshold / 1000)}s)`,
        ctx: { durationMs: observed, thresholdMs: threshold },
      });
    }
  }

  const errorCount = (current.counts?.error || 0) + (current.counts?.crash || 0);
  if (errorCount >= ERROR_COUNT_THRESHOLD) {
    findings.push({
      rule: "recurring-errors",
      kind: "boot.errors",
      detail: `${errorCount} erreurs/crashes pendant le boot`,
      ctx: { errorCount },
    });
  }

  return findings;
}

/** À appeler en fin de boot (après persistBootSummary). Jamais de throw. */
export function evaluateBootRules(): BootRuleFinding[] {
  try {
    const findings = evaluateRulesPure(
      currentBootSummary(),
      readPreviousBootSummaries(REPEAT_BOOTS + 2),
    );
    for (const f of findings) {
      track({
        level: "anomaly",
        kind: `anomaly.${f.rule}`,
        outcome: f.kind,
        reason: f.detail,
        ctx: f.ctx,
      });
    }
    return findings;
  } catch {
    return [];
  }
}
