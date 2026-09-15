/**
 * Dérive un plugin_id valide depuis une intention textuelle.
 */

import { isValidPluginId } from "@creezio/platform-core";

const STOP = new Set([
  "un",
  "une",
  "des",
  "le",
  "la",
  "les",
  "de",
  "du",
  "des",
  "et",
  "ou",
  "pour",
  "avec",
  "dans",
  "sur",
  "qui",
  "que",
  "je",
  "nous",
  "vous",
  "ils",
  "elles",
  "veux",
  "voudrais",
  "besoin",
  "plugin",
  "module",
  "outil",
  "creer",
  "créer",
  "faire",
  "ajouter",
  "the",
  "a",
  "an",
  "to",
  "for",
  "with",
  "and",
  "or",
  "my",
  "our",
]);

/**
 * Normalise un libellé en slug plugin (`^[a-z][a-z0-9-]{1,62}$`).
 * Retourne null si impossible.
 */
export function slugifyPluginId(raw: string, fallbackPrefix = "plug"): string {
  const base = String(raw || "")
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  let candidate = base;
  if (!candidate || !/^[a-z]/.test(candidate)) {
    candidate = `${fallbackPrefix}-${candidate || "x"}`.replace(/-{2,}/g, "-");
  }
  candidate = candidate.slice(0, 63).replace(/-+$/g, "");
  if (!isValidPluginId(candidate)) {
    candidate = `${fallbackPrefix}-${Date.now().toString(36)}`.slice(0, 63);
  }
  return candidate;
}

/**
 * Extrait un nom court + slug depuis une phrase d'intention.
 */
export function derivePluginIdentity(intention: string): {
  name: string;
  suggestedPluginId: string;
} {
  const text = String(intention || "").trim();
  const words = text
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const picked = words.slice(0, 4);
  const name =
    picked.length > 0
      ? picked.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
      : "Nouveau plugin";
  const suggestedPluginId = slugifyPluginId(picked.join("-") || "plugin");
  return { name, suggestedPluginId };
}
