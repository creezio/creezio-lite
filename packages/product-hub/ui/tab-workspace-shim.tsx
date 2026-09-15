"use client";

/**
 * Shim workspace onglets — la marque peut remplacer via
 * `configureTabWorkspaceHook` pour brancher son TabWorkspaceContext.
 */

export type TabWorkspaceShim = {
  openExternalSite?: (o: {
    siteId: number;
    url: string;
    title: string;
  }) => void;
} | null;

type Hook = () => TabWorkspaceShim;

let hook: Hook = () => null;

export function configureTabWorkspaceHook(next: Hook): void {
  hook = next;
}

export function useTabWorkspaceOptional(): TabWorkspaceShim {
  return hook();
}
