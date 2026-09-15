/**
 * O9 — tokens marque pour shell-ui (desktop API, hosts, titlebar).
 */

/**
 * Panneau brand de la page login split-screen (@creezio/auth LoginPage).
 * Tout est optionnel : une marque sans config obtient le défaut neutre
 * (gradient encre du thème kit, tuile initiale, sans tagline ni highlights).
 */
export type ShellUiLoginBrand = {
  /** Tagline sous le nom produit dans le panneau (défaut : aucune). */
  tagline?: string;
  /** Points marketing en liste à puces (défaut : aucun — 3 ou 4 recommandés). */
  highlights?: string[];
  /** URL d'un logo image (défaut : tuile avec l'initiale du produit). */
  logoUrl?: string;
  /**
   * Fond du panneau — valeur CSS `background` complète (couleur ou gradient).
   * Défaut : gradient encre neutre du thème kit.
   */
  panelBackground?: string;
  /** Image de fond du panneau (sous un voile sombre, par-dessus le fond). */
  panelImageUrl?: string;
  /** Côté du panneau sur desktop (défaut "right"). */
  panelSide?: "left" | "right";
  /**
   * Lien d'action secondaire sous le formulaire de connexion (ex.
   * inscription POS de la marque : { label: "Créer un compte", href:
   * "/inscription" }). Absent = aucun lien affiché — jamais de défaut kit.
   */
  secondaryLink?: { label: string; href: string };
};

export type ShellUiBrand = {
  /** Ex. creezioDesktop / certivanDesktop / fiduDesktop */
  desktopApiGlobal: string;
  /** Suffixe hôte public (ex. app.example.com / tenant.creez.io) */
  publicHostSuffix: string;
  /** Classe CSS titlebar no-drag */
  titlebarDragClass: string;
  titlebarNoDragClass: string;
  /** Préfixe clés API live (ex. product_live_) */
  apiKeyPrefix: string;
  /** Nom produit UI — injecté par la marque */
  productName: string;
  /** Attribut data-* analytics clics (défaut data-creezio-aid). */
  aidAttr?: string;
  /** Config page login split-screen (défauts neutres si absente). */
  login?: ShellUiLoginBrand;
};

const DEFAULT: ShellUiBrand = {
  desktopApiGlobal: "creezioDesktop",
  publicHostSuffix: "creez.io",
  titlebarDragClass: "creezio-titlebar-drag",
  titlebarNoDragClass: "creezio-titlebar-no-drag",
  apiKeyPrefix: "creezio_live_",
  productName: "Creezio",
  aidAttr: "data-creezio-aid",
};

let brand: ShellUiBrand = { ...DEFAULT };

const listeners = new Set<() => void>();

function notifyBrandChanged(): void {
  for (const listener of listeners) listener();
}

export function configureShellUiBrand(next: Partial<ShellUiBrand>): void {
  const merged: ShellUiBrand = { ...brand, ...next };
  // No-op si aucune clé ne change — CreezioUiBoot appelle au render (marque
  // correcte dès le 1er paint, zéro flash du défaut) : la détection évite
  // les boucles de re-render des abonnés useSyncExternalStore. `login` est
  // comparé en profondeur (objet littéral → nouvelle identité à chaque render).
  const changed = (Object.keys(merged) as (keyof ShellUiBrand)[]).some((k) =>
    k === "login"
      ? JSON.stringify(merged.login ?? null) !== JSON.stringify(brand.login ?? null)
      : merged[k] !== brand[k],
  );
  if (!changed) return;
  brand = merged;
  notifyBrandChanged();
}

export function getShellUiBrand(): ShellUiBrand {
  return brand;
}

/**
 * Abonnement aux changements de brand — la marque est appliquée par
 * CreezioUiBoot en useEffect (après le 1er render) : les composants qui
 * lisent la brand au render (page login…) doivent passer par le hook
 * useShellUiBrand (@creezio/shell-ui/ui/kit) pour re-render.
 */
export function subscribeShellUiBrand(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetShellUiBrandForTests(): void {
  brand = { ...DEFAULT };
  notifyBrandChanged();
}

/** Accès typé soft à window[desktopApiGlobal]. */
export function getShellDesktopApi(): any {
  if (typeof window === "undefined") return undefined;
  const key = getShellUiBrand().desktopApiGlobal;
  return (window as any)[key];
}
