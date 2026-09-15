/** Modèles chat exposés dans le select UI (configurable via env). */

export type ModelTier = "reasoning" | "standard" | "fast";

export type ModelOption = {
  id: string;
  tier: ModelTier;
  /** Libellé UI, ex. "o4-mini · Reasoning" */
  label: string;
};

/**
 * Liste utile (pas les snapshots datés / pro / codex / deep-research).
 * Tri : reasoning d'abord, puis standard, puis rapide.
 */
const CURATED: { id: string; tier: ModelTier }[] = [
  { id: "o3", tier: "reasoning" },
  { id: "o3-mini", tier: "reasoning" },
  { id: "o4-mini", tier: "reasoning" },
  { id: "o1", tier: "reasoning" },
  { id: "gpt-5.2", tier: "reasoning" },
  { id: "gpt-5", tier: "reasoning" },
  { id: "gpt-5-mini", tier: "reasoning" },
  { id: "gpt-4.1", tier: "standard" },
  { id: "gpt-4o", tier: "standard" },
  { id: "gpt-4.1-mini", tier: "fast" },
  { id: "gpt-4o-mini", tier: "fast" },
  { id: "gpt-5-nano", tier: "fast" },
];

const DEFAULT_OPTIONS = CURATED.map((m) => m.id);

/** Préférence de défaut si OPENAI_MODEL absent / trop faible. */
const PREFERRED_DEFAULTS = ["o4-mini", "o3-mini", "gpt-4o", "gpt-4.1", "gpt-4o-mini"];

const TIER_SUFFIX: Record<ModelTier, string> = {
  reasoning: "Reasoning",
  standard: "Standard",
  fast: "Rapide",
};

/** Modèles qui n'acceptent pas temperature custom (reasoning / gpt-5). */
const NO_TEMPERATURE = new Set([
  "o4-mini",
  "o3-mini",
  "o3",
  "o1",
  "o1-mini",
  "o1-pro",
  "o3-pro",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5.4",
  "gpt-5.5",
]);

function tierOf(id: string): ModelTier {
  const known = CURATED.find((m) => m.id === id);
  if (known) return known.tier;
  const m = id.trim().toLowerCase();
  if (
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    (m.startsWith("gpt-5") && !m.includes("nano"))
  ) {
    return "reasoning";
  }
  if (m.includes("mini") || m.includes("nano")) return "fast";
  return "standard";
}

export function modelLabel(id: string): string {
  return `${id} · ${TIER_SUFFIX[tierOf(id)]}`;
}

export function defaultModel(): string {
  const fromEnv = (process.env.OPENAI_MODEL || "").trim();
  if (fromEnv) return fromEnv;
  for (const pref of PREFERRED_DEFAULTS) {
    if (DEFAULT_OPTIONS.includes(pref)) return pref;
  }
  return "o4-mini";
}

export function modelOptions(): string[] {
  const raw = (process.env.OPENAI_MODEL_OPTIONS || "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_OPTIONS;
  const def = defaultModel();
  const set = new Set(fromEnv);
  if (!set.has(def)) {
    return [def, ...fromEnv];
  }
  return [def, ...fromEnv.filter((m) => m !== def)];
}

/** Options enrichies pour l'UI (label Reasoning / Rapide / Standard). */
export function modelOptionsDetailed(): ModelOption[] {
  return modelOptions().map((id) => ({
    id,
    tier: tierOf(id),
    label: modelLabel(id),
  }));
}

export function resolveModel(candidate?: string | null): string {
  const opts = modelOptions();
  const c = (candidate || "").trim();
  if (c && opts.includes(c)) return c;
  if (c) {
    // Accepter un modèle hors liste si explicitement stocké (compat)
    return c;
  }
  return defaultModel();
}

export function supportsTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (NO_TEMPERATURE.has(m)) return false;
  if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return false;
  if (m.startsWith("gpt-5")) return false;
  return true;
}
