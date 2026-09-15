/**
 * O4r4 — projections entitySources / formatSearchHit déclaratives.
 *
 * Extraite des switches marque (marques) : pas d’invention métier,
 * seulement un moteur kit + règles déclarées par la marque.
 */

import type { AssistantSource } from "./sources-shim.js";

export type EntitySourceKindRule = {
  /** Kind get_entity / SQL (fournisseur, dossier, …). */
  kind: string;
  /** Champs titre, ordre de préférence. */
  titleFields: readonly string[];
  /**
   * `first` (défaut) = premier champ non vide ;
   * `join` = concatène les champs non vides (marque + modèle, prénom + nom).
   */
  titleMode?: "first" | "join";
  /** Si titleFields vide → essayer ces champs en mode first (vin, email…). */
  titleFallbackFields?: readonly string[];
  /** Type source exposé (souvent = kind). */
  type: string;
  /**
   * URL si id local connu. Placeholders : `{id}`, `{fieldName}`.
   * Ex. `/marketplaces/{id}`, `/dossiers/{dossier_id}`.
   */
  urlWhenId: string;
  /**
   * URL fallback recherche. Placeholders : `{q}`, `{id}`, `{fieldName}`.
   */
  urlWhenSearch: string;
  /**
   * Champ id pour urlWhenId (défaut `id` de l’entité).
   * Ex. véhicule → `dossier_id`.
   */
  idField?: string;
};

function enc(s: string): string {
  return encodeURIComponent(s);
}

function titleFromFields(
  ent: Record<string, unknown>,
  fields: readonly string[],
  mode: "first" | "join",
  fallback: string,
): string {
  const parts: string[] = [];
  for (const f of fields) {
    const v = ent[f];
    if (v != null && String(v).trim()) parts.push(String(v).trim());
  }
  if (parts.length === 0) return fallback;
  if (mode === "join") return parts.join(" ");
  return parts[0];
}

function applyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v != null ? enc(v) : "";
  });
}

/**
 * Construit `entitySources(kind, id, ent)` depuis des règles déclaratives marque.
 */
export function createEntitySourcesFromRules(
  rules: readonly EntitySourceKindRule[],
): (
  kind: string,
  id: string,
  ent: Record<string, unknown> | null,
) => AssistantSource[] {
  const byKind = new Map(rules.map((r) => [r.kind, r]));
  return (kind, id, ent) => {
    if (!ent) return [];
    const rule = byKind.get(kind);
    if (!rule) return [];
    const localId = ent.id != null ? String(ent.id).trim() : "";
    let title = titleFromFields(
      ent,
      rule.titleFields,
      rule.titleMode ?? "first",
      "",
    );
    if (!title && rule.titleFallbackFields?.length) {
      title = titleFromFields(ent, rule.titleFallbackFields, "first", "");
    }
    if (!title) title = id;
    const idForUrl = rule.idField
      ? ent[rule.idField] != null
        ? String(ent[rule.idField]).trim()
        : ""
      : localId;
    const vars: Record<string, string> = { id: localId || id, q: title };
    for (const [k, v] of Object.entries(ent)) {
      if (v != null) vars[k] = String(v);
    }
    const url = idForUrl
      ? applyTemplate(rule.urlWhenId, { ...vars, id: idForUrl })
      : applyTemplate(rule.urlWhenSearch, vars);
    return [
      {
        title: title || `${rule.type} ${localId || id}`,
        url,
        type: rule.type,
      },
    ];
  };
}

const DEFAULT_HIT_FIELDS = [
  "id",
  "title",
  "type",
  "url",
  "ville",
  "pays",
  "status",
] as const;

/**
 * `formatSearchHit` déclaratif : allowlist de champs + excerpt body.
 */
export function createFormatSearchHit(
  extraFields: readonly string[] = [],
): (h: Record<string, unknown>) => Record<string, unknown> {
  const fields = [...DEFAULT_HIT_FIELDS, ...extraFields];
  return (h) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (h[f] !== undefined) out[f] = h[f];
    }
    out.excerpt = String(h.body || h.excerpt || "").slice(0, 500);
    return out;
  };
}
