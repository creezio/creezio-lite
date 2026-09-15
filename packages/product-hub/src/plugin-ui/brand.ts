/**
 * Tokens marque pour admin plugins UI / desktop API (N6).
 */

export type ProductHubUiBrand = {
  /** Nom global window.*Desktop (ex. acmeDesktop). */
  desktopApiGlobal: string;
  /** Nom produit pour toasts / messages. */
  productName: string;
  /** Label app serveur (HostManagedNotice). */
  serverLabel: string;
  /** Event DOM plugins-changed. */
  pluginsChangedEvent: string;
};

const DEFAULT: ProductHubUiBrand = {
  desktopApiGlobal: "creezioDesktop",
  productName: "Creezio",
  serverLabel: "Creezio Server",
  pluginsChangedEvent: "creezio:plugins-changed",
};

let brand: ProductHubUiBrand = { ...DEFAULT };

export function configureProductHubUiBrand(
  next: Partial<ProductHubUiBrand>,
): void {
  brand = { ...brand, ...next };
}

export function getProductHubUiBrand(): ProductHubUiBrand {
  return brand;
}

export function resetProductHubUiBrandForTests(): void {
  brand = { ...DEFAULT };
}

/**
 * Accès typé minimal au bridge desktop (IPC marque — shapes souples).
 * Index signature `any` : les marques exposent des méthodes hétérogènes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DesktopApiBridge = Record<string, any>;

type BrowserWindow = Record<string, unknown> & {
  dispatchEvent?: (ev: unknown) => boolean;
  open?: (...args: unknown[]) => unknown;
};

function browserWindow(): BrowserWindow | undefined {
  const g = globalThis as typeof globalThis & { window?: BrowserWindow };
  return g.window;
}

export function getDesktopApi(): DesktopApiBridge | undefined {
  const w = browserWindow();
  if (!w) return undefined;
  const key = getProductHubUiBrand().desktopApiGlobal;
  return w[key] as DesktopApiBridge | undefined;
}

export { browserWindow };

