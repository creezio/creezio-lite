/**
 * Routage premier outil assistant (Meili vs SQL vs UI / surface).
 * Module sans alias @/ — importable par les tests Node.
 */

import { looksLikeSurfaceCommand } from "./active-surface.js";

/**
 * Demande d'action sur l'interface (souris virtuelle) → ne pas forcer run_sql.
 */
export function looksLikeUiCommand(userMessage: string): boolean {
  return looksLikeSurfaceCommand(userMessage);
}

export { looksLikeSurfaceCommand };

/**
 * Découverte produit / fournisseur par nom → forcer search_knowledge (Meili).
 * Doit gagner sur shouldForceRunSql quand les deux matchent.
 */
export function shouldPreferSearchKnowledge(userMessage: string): boolean {
  if (looksLikeUiCommand(userMessage)) return false;
  const t = userMessage.toLowerCase();
  if (/\b(cherche|chercher|trouve|trouver|recherche)\b/.test(t)) return true;
  if (/\bqui\s+(vend|propose|fournit|a)\b/.test(t)) return true;
  if (
    /\b(y\s+a[- ]t[- ]il|existe[- ]t[- ]il|as[- ]tu|avez[- ]vous)\b/.test(t) &&
    /\b(produit|article|fournisseur|offre)\b/.test(t)
  ) {
    return true;
  }
  if (/\bfournisseurs?\b.{0,80}\bqui\b/.test(t)) return true;
  if (/\bfournisseurs?\b.{0,60}\b(avec|vendant|proposant)\b/.test(t)) return true;
  if (
    /\b(produits?|articles?)\b/.test(t) &&
    /\b(ville|paris|lyon|marseille|lille|bordeaux|toulouse)\b/.test(t) &&
    !/\b(combien|nombre|count|prix|tarif|variation)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Questions COUNT / prix → forcer run_sql (sauf si découverte Meili prioritaire).
 * Important : ne PAS matcher juste sur le mot « produit » / « fournisseur ».
 */
export function shouldForceRunSql(userMessage: string): boolean {
  if (looksLikeUiCommand(userMessage)) return false;
  if (shouldPreferSearchKnowledge(userMessage)) return false;
  const t = userMessage.toLowerCase();
  const countHint =
    /\b(combien|nombre|count)\b/.test(t) || /\bcombien\s+de\b/.test(t);
  const priceHint =
    /\b(prix|tarif|co[uû]t|variation|promo|moins\s+cher|meilleur\s+prix)\b/.test(
      t,
    );
  return countHint || priceHint;
}
