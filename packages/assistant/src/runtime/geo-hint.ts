/** Villes FR fréquentes pour détection rapide dans une question utilisateur. */
const KNOWN_CITIES = [
  "Paris",
  "Lyon",
  "Marseille",
  "Lille",
  "Bordeaux",
  "Toulouse",
  "Nantes",
  "Nice",
  "Strasbourg",
  "Montpellier",
  "Rennes",
  "Grenoble",
  "Tours",
  "Dijon",
  "Reims",
  "Le Havre",
  "Saint-Etienne",
  "Saint-Étienne",
  "Angers",
  "Villeurbanne",
  "Aix-en-Provence",
  "Clermont-Ferrand",
  "Saint-Priest",
  "Grigny",
];

const CITY_ALT = KNOWN_CITIES.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

/** Normalise une ville pour comparaison (casse, accents, espaces). */
export function normalizeVilleKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Extrait une ville probable depuis une question (« à Paris », « sur Lyon »…).
 */
export function extractVilleHint(text: string): string | null {
  if (!text.trim()) return null;
  const prep = new RegExp(
    `\\b(?:à|a|sur|dans|en)\\s+(${CITY_ALT})\\b`,
    "i",
  ).exec(text);
  if (prep?.[1]) return prep[1];

  // « fournisseurs Paris », « produits Paris »
  const bare = new RegExp(`\\b(${CITY_ALT})\\b`, "i").exec(text);
  if (bare?.[1]) return bare[1];
  return null;
}
