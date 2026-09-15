/**
 * Contrats PRD étendu — sections structurées obligatoires.
 */

export type PluginPrdSections = {
  /** Données consommées : [{ data, sourceEndpoint }]. */
  data_inputs: Array<{ data: string; sourceEndpoint: string }>;
  /** Données produites : [{ data, destination }]. */
  data_outputs: Array<{ data: string; destination: string }>;
  /** Schéma DB du plugin : tables + colonnes. */
  db_schema: Array<{
    table: string;
    columns: Array<{ name: string; type?: string; description?: string }>;
  }>;
  /** User stories — source du kanban à la validation. */
  user_stories: string[];
  /** Écrans : { name, kind: single|tab, description }. */
  screens: Array<{ name: string; kind: "single" | "tab"; description: string }>;
  /** Wireframes ASCII par écran. */
  wireframes: Array<{ screen: string; ascii: string }>;
};

export const PLUGIN_PRD_REQUIRED_SECTIONS: Array<keyof PluginPrdSections> = [
  "data_inputs",
  "data_outputs",
  "db_schema",
  "user_stories",
  "screens",
  "wireframes",
];

export type PluginPrdRevisionInput = {
  problem: string;
  users: string;
  scope: string;
  outOfScope?: string;
  acceptanceCriteria: string;
  sections?: Partial<PluginPrdSections>;
};

export function parsePluginPrdSections(
  raw: unknown,
): Partial<PluginPrdSections> {
  if (typeof raw === "string") {
    try {
      return parsePluginPrdSections(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Partial<PluginPrdSections>;
}

/** Sections obligatoires absentes ou vides — vide = PRD complet. */
export function missingPrdSections(raw: unknown): string[] {
  const sections = parsePluginPrdSections(raw);
  const missing: string[] = [];
  for (const name of PLUGIN_PRD_REQUIRED_SECTIONS) {
    const value = sections[name];
    if (!Array.isArray(value) || value.length === 0) missing.push(name);
  }
  return missing;
}

/**
 * Détecte les U+FFFD issus d'un payload mal encodé (cp1252 → UTF-8 cassé).
 */
export function containsReplacementChar(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\uFFFD");
  if (Array.isArray(value)) return value.some(containsReplacementChar);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(
      containsReplacementChar,
    );
  }
  return false;
}

/** Champs texte minimum pour valider une révision PRD. */
export function missingPrdCoreFields(revision: {
  problem?: unknown;
  scope?: unknown;
  acceptance_criteria?: unknown;
  acceptanceCriteria?: unknown;
}): string[] {
  const missing: string[] = [];
  if (!String(revision.problem || "").trim()) missing.push("problem");
  if (!String(revision.scope || "").trim()) missing.push("scope");
  const criteria =
    revision.acceptance_criteria ?? revision.acceptanceCriteria ?? "";
  if (!String(criteria).trim()) missing.push("acceptance_criteria");
  return missing;
}
