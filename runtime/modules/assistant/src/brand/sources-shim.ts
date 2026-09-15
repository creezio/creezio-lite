/**
 * Sources CRM — délégué à AssistantBrandTools (pas de schéma panier/catalogue en kit).
 */
import { assistantBrandTools } from "./registry.js";

export type AssistantSourceType = string;

export type AssistantSource = {
  title: string;
  url: string;
  type?: AssistantSourceType;
};

export function collectSourcesFromSqlRows(
  rows: Record<string, unknown>[],
): AssistantSource[] {
  const fn = assistantBrandTools().collectSourcesFromSqlRows;
  if (fn) return fn(rows) as AssistantSource[];
  return [];
}

/**
 * Matchers pour linker les titres de sources dans le markdown assistant.
 * Override marque possible via tools.sourceLinkMatchers.
 */
export function sourceLinkMatchers(
  sources: AssistantSource[] | undefined,
): { text: string; url: string; type?: string }[] {
  const brand = assistantBrandTools() as {
    sourceLinkMatchers?: typeof sourceLinkMatchers;
  };
  if (typeof brand.sourceLinkMatchers === "function") {
    return brand.sourceLinkMatchers(sources);
  }
  if (!sources?.length) return [];
  const out: { text: string; url: string; type?: string }[] = [];
  const seen = new Set<string>();

  const add = (text: string, url: string, type?: string) => {
    const t = text.trim();
    if (!t || t.length < 2) return;
    if (!url.startsWith("/")) return;
    const key = `${t.toLowerCase()}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, url, type });
  };

  for (const s of sources) {
    add(s.title, s.url, s.type);
  }

  out.sort((a, b) => b.text.length - a.text.length);
  return out;
}
