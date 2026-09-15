export type ProductDetailCtxAdapter = {
  isDetailPath(path: string): boolean;
  withInferredCtx(href: string, fromHref?: string | null): string;
  withCatalogueCtx(href: string): string;
};

let sidebarCollapsedKey = "creezio-sidebar-collapsed";
let defaultNewTabHref = "/dashboard";
let preferCatalogueSelector = "[data-creezio-assistant-ui]";
let productDetailCtxAdapter: ProductDetailCtxAdapter | null = null;

export function configureSidebarCollapsedKey(key: string): void {
  const next = key.trim();
  if (next) sidebarCollapsedKey = next;
}

export function getSidebarCollapsedKey(): string {
  return sidebarCollapsedKey;
}

export function configureDefaultNewTabHref(href: string): void {
  const next = href.trim();
  if (next) defaultNewTabHref = next;
}

export function getDefaultNewTabHref(): string {
  return defaultNewTabHref;
}

export function configurePreferCatalogueSelector(sel: string): void {
  const next = sel.trim();
  if (next) preferCatalogueSelector = next;
}

export function getPreferCatalogueSelector(): string {
  return preferCatalogueSelector;
}

export function configureProductDetailCtx(
  adapter: ProductDetailCtxAdapter | null,
): void {
  productDetailCtxAdapter = adapter;
}

export function getProductDetailCtxAdapter(): ProductDetailCtxAdapter | null {
  return productDetailCtxAdapter;
}
