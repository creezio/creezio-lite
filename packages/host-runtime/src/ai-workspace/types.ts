/**
 * Contrats mince pour découpler ai-workspace du métier supplier-tabs marque.
 * N2 — extraction TF gold.
 */

export type AiTabInfo = {
  tabId: string;
  fournisseurId: number;
  url: string;
  title: string;
  active: boolean;
};

export type AiSupplierTab = {
  tabId: string;
  fournisseurId: number;
  view: { webContents: import("electron").WebContents };
  debuggerAttached: boolean;
};

export type AiSupplierTabsLike = {
  suspend(): void;
  resume(): void;
  getActive(): AiSupplierTab | null;
  showCrm(): void;
  list(): AiTabInfo[];
  closeTab(tabId: string): void;
  setOnChanged(cb: () => void): void;
  setOnLoadState(cb: (ev: unknown) => void): void;
};

export type AiSupplierTabsFactory = (
  win: import("electron").BaseWindow,
  view: import("electron").WebContentsView,
  opts: { partitionPrefix: string; suspended: boolean },
) => AiSupplierTabsLike;

export type SupplierActionRequest = {
  actionId: string;
  type: string;
  tabId?: string;
  params: Record<string, unknown>;
};
