/**
 * Modes assistant : Chat (guide) vs Work (délégation Hermes).
 * Briefs métier → configureAssistantBrand({ prompts }).
 */
import {
  buildBrandHermesWorkBrief,
  buildBrandPersonalAgentBrief,
} from "../brand/registry.js";
import type { HermesWorkUser } from "../brand/types.js";

export type { HermesWorkUser };

export const ASSISTANT_MODES = ["chat", "work"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export function isAssistantMode(v: unknown): v is AssistantMode {
  return v === "chat" || v === "work";
}

export function parseAssistantMode(
  v: unknown,
  fallback: AssistantMode = "chat",
): AssistantMode {
  return isAssistantMode(v) ? v : fallback;
}

/** Tools UI (souris) — exclus du mode Work côté Hermes. */
export const UI_TOOL_NAMES = [
  "surface_list_targets",
  "surface_click",
  "surface_type",
  "surface_scroll",
  "surface_read",
  "ui_list_targets",
  "ui_click",
  "ui_type",
  "ui_scroll",
  "supplier_list_tabs",
  "supplier_open_tab",
  "supplier_list_targets",
  "supplier_click",
  "supplier_type",
  "supplier_scroll",
  "supplier_read",
] as const;

export function isUiToolName(name: string): boolean {
  return (UI_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Prompt Chat générique (marques peuvent override via prompts.chatModeAddendum).
 *
 * H2 « Hermes cerveau unique » : un seul monde pour l'utilisateur — toute
 * mission est créée puis annoncée comme prise en charge par Hermes (qui
 * choisit lui-même : répondre, métier, plugin, ou clics via collaborateur
 * IA). Ne plus renvoyer vers « le mode Work » comme un second espace.
 */
export const CHAT_MODE_ADDENDUM = `
## Mode Chat (guide)
Tu es en **mode Chat** : priorité à **répondre** et **guider** l'utilisateur.
Tu conserves **tous** tes outils (SQL, Meili, surface_*/ui_*/supplier_*, tâches…).
Pour toute action sur l'écran visible : préfère \`surface_*\` et suis le bloc **Surface active (runtime)**.

### Tâches / missions (OBLIGATOIRE)
Dès qu'il y a une **mission à faire** — rappel, batch, suivi, navigation web, clics — appelle \`create_task\` pour l'ajouter au kanban **/taches**. Par défaut \`executor=hermes\` : la mission est **prise en charge par Hermes**, le cerveau central, qui choisit lui-même la meilleure voie (répondre, appeler le métier, développer un plugin, ou déléguer les clics à un collaborateur IA). Pour un humain précis passe \`executor=human\` + \`assignee_user_id\`.
Après création, annonce : « **Mission prise en charge par Hermes** — suivi sur **/taches** (kanban) et « Voir comme IA » (screencast) ». Ne présente JAMAIS deux mondes (Chat vs Work) ni « passe en mode Work » : un seul point d'entrée, Hermes s'occupe du reste.
Tu peux ensuite \`list_tasks\` pour le statut.
`;

export function buildPersonalAgentWorkBrief(
  nowIso: string,
  user?: HermesWorkUser | null,
): string {
  return buildBrandPersonalAgentBrief(nowIso, user);
}

export function buildHermesWorkSystemBrief(
  nowIso: string,
  user?: HermesWorkUser | null,
): string {
  return buildBrandHermesWorkBrief(nowIso, user);
}
