/**
 * Attribut data-* analytics / UiDriver — SoT = configureShellUiBrand({ aidAttr }).
 * Défaut kit : data-creezio-aid (plus de data-tf2-aid hardcodé).
 */
import { getShellUiBrand } from "@creezio/shell-ui";

export const DEFAULT_AID_ATTR = "data-creezio-aid";

export function resolveAidAttr(): string {
  return getShellUiBrand().aidAttr ?? DEFAULT_AID_ATTR;
}

/** Props React pour un élément instrumenté : { [aidAttr]: value }. */
export function aidProps(value: string): Record<string, string> {
  return { [resolveAidAttr()]: value };
}

/** Sélecteur CSS pour tout élément portant l'attribut aid courant. */
export function aidSelector(value?: string): string {
  const attr = resolveAidAttr();
  return value != null ? `[${attr}="${value}"]` : `[${attr}]`;
}
