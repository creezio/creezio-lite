/**
 * Rapport d'impact — logique pure (evidence injectée, pas de FS/DB hardcodés).
 */

export type PluginImpactEvidence = Record<string, unknown> & {
  type: string;
  name?: string;
  description?: string;
  pluginId?: string;
  plugin_id?: string;
};

export type PluginImpactReport = {
  recommendation: "create" | "evolve";
  summary: string;
  evidence: PluginImpactEvidence[];
  candidatePluginId: string | null;
  score: number;
};

function words(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("fr")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 2),
  );
}

export function textOverlapScore(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const word of Array.from(wa)) if (wb.has(word)) common += 1;
  return common / new Set(Array.from(wa).concat(Array.from(wb))).size;
}

/**
 * Construit le rapport d'impact à partir d'evidences déjà collectées
 * (manifests, products, workflows…). Seuil evolve = 0.2 (TF2/Certivan).
 */
export function buildPluginImpactReport(input: {
  name: string;
  description: string;
  evidence?: PluginImpactEvidence[];
  evolveThreshold?: number;
}): PluginImpactReport {
  const evidence = input.evidence || [];
  const requestText = `${input.name} ${input.description}`;
  let best: { score: number; pluginId: string | null; label: string } = {
    score: 0,
    pluginId: null,
    label: "",
  };
  for (const item of evidence) {
    if (!["plugin_manifest", "product_prd"].includes(String(item.type))) {
      continue;
    }
    const label = `${item.name || ""} ${item.description || ""}`;
    const score = textOverlapScore(requestText, label);
    if (score > best.score) {
      best = {
        score,
        pluginId: String(item.pluginId || item.plugin_id || "") || null,
        label: String(item.name || ""),
      };
    }
  }
  const threshold = input.evolveThreshold ?? 0.2;
  const evolve = best.score >= threshold && Boolean(best.pluginId);
  return {
    recommendation: evolve ? "evolve" : "create",
    candidatePluginId: evolve ? best.pluginId : null,
    score: best.score,
    summary: evolve
      ? `Une capacité proche existe (${best.label}, similarité ${(best.score * 100).toFixed(0)} %). Faire évoluer le plugin est recommandé.`
      : "Aucun recouvrement significatif détecté. La création d’un nouveau plugin est recommandée.",
    evidence,
  };
}

/** Collecte evidence depuis un arbre plugins (injectable pour tests). */
export function collectPluginManifestEvidence(
  manifests: Array<{
    id: string;
    name?: string;
    description?: string;
    path?: string;
  }>,
): PluginImpactEvidence[] {
  return manifests.map((m) => ({
    type: "plugin_manifest",
    path: m.path,
    pluginId: m.id,
    name: m.name || m.id,
    description: m.description || "",
  }));
}
