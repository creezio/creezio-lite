/**
 * Shim workspace onglets — la marque / shell-ui branche le vrai hook via
 * `configureAssistantTabWorkspace` (ex. `useTabWorkspaceOptional` du chrome).
 * Défaut : pas de workspace (null).
 */
import type {
  ActiveSurface,
  ActiveSurfaceTabLike,
} from "../dist/runtime/active-surface.js";

export type AssistantTabWorkspace = {
  activeSurface?: ActiveSurface | null;
  activeTab?: ActiveSurfaceTabLike | null;
  navigate?: (href: string, opts?: { newTab?: boolean; title?: string }) => void;
  activateTab?: (tabId: string) => void;
} | null;

type Hook = () => AssistantTabWorkspace;

let hook: Hook = () => null;

/** Branche le TabWorkspaceProvider (appelé au boot chrome kit / marque). */
export function configureAssistantTabWorkspace(next: Hook): void {
  hook = next;
}

export function useTabWorkspaceOptional(): AssistantTabWorkspace {
  return hook();
}
