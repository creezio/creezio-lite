/**
 * Tags n8n génériques — préfixe depuis AppManifest / ProductHubBrandTokens.
 * n8n 2.29 limite les tags à 24 caractères.
 */

import crypto from "node:crypto";
import type { AppManifest } from "@creezio/brand-config";
import {
  productHubTokensFromManifest,
  type ProductHubBrandTokens,
} from "./brand-tokens.js";

export const N8N_TAG_MAX_LENGTH = 24;

export type N8nPluginIdentityMode = "tag-registry";

/**
 * Tag obligatoire `{brandId}-plugin:<identité>`.
 * Si trop long → suffixe SHA-256 stable sur 7 caractères.
 */
export function pluginN8nTag(
  pluginProductId: string,
  tokens: Pick<ProductHubBrandTokens, "n8nTagPrefix"> | AppManifest | string,
): string {
  const prefix =
    typeof tokens === "string"
      ? tokens.endsWith(":")
        ? tokens
        : `${tokens}:`
      : "n8nTagPrefix" in tokens
        ? tokens.n8nTagPrefix
        : productHubTokensFromManifest(tokens).n8nTagPrefix;
  const full = `${prefix}${pluginProductId}`;
  if (full.length <= N8N_TAG_MAX_LENGTH) return full;
  const suffix = crypto
    .createHash("sha256")
    .update(pluginProductId)
    .digest("hex")
    .slice(0, 7);
  return `${prefix}${suffix}`;
}

/** Vérifie qu'un tag appartient au préfixe marque. */
export function isBrandPluginN8nTag(
  tag: string,
  tokens: Pick<ProductHubBrandTokens, "n8nTagPrefix">,
): boolean {
  return tag.startsWith(tokens.n8nTagPrefix);
}
