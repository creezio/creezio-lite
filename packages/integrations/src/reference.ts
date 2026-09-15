/**
 * Références d'intégration — `integration://<slug>`.
 * Les modules/plugins/Hermes ne stockent JAMAIS la valeur d'une clé,
 * seulement sa référence, résolue à l'exécution via
 * POST /api/v1/platform/integrations/resolve.
 */

export const INTEGRATION_REFERENCE_SCHEME = "integration://";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidIntegrationSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

/** Normalise un libellé/slug libre en slug valide (ou "" si impossible). */
export function slugifyIntegrationName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function formatIntegrationReference(slug: string): string {
  return `${INTEGRATION_REFERENCE_SCHEME}${slug}`;
}

/** `integration://openai` → `openai` ; accepte aussi le slug nu. */
export function parseIntegrationReference(reference: string): string | null {
  const raw = String(reference || "").trim();
  const slug = raw.startsWith(INTEGRATION_REFERENCE_SCHEME)
    ? raw.slice(INTEGRATION_REFERENCE_SCHEME.length)
    : raw;
  return isValidIntegrationSlug(slug) ? slug : null;
}
