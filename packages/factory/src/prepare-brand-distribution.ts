/**
 * Prépare une marque fraîche pour Docker / clone GitHub (mode npm) :
 * package-lock cohérents (racine workspace = SoT, server/ui, client).
 *
 * Doit tourner APRÈS chaque scaffold (brand create / new-app / brand apply),
 * pas seulement au push — sinon une marque locale part sans lock et
 * `npm ci` Docker échoue. Sans `--link-kit` : CREEZIO_NPM_TOKEN (registre).
 * Avec `--link-kit` / `CREEZIO_LINK_KIT=1` : packages du worktree kit.
 */
import { ensureBrandPackageLocks } from "./package-lock.js";

export function prepareBrandDistribution(
  brandRoot: string,
  opts?: {
    kitRoot?: string;
    log?: (line: string) => void;
    /** Défaut lock-only (pas de node_modules commité). */
    lockMode?: "lock-only" | "install";
    /** Pin `@creezio/*` sur le kit local (sinon env `CREEZIO_LINK_KIT`). */
    linkKit?: boolean;
  },
): { locksRefreshed: string[] } {
  const log = opts?.log || ((l: string) => console.log(l));
  // Escape hatch tests unitaires (pas pour une vraie marque).
  if (process.env.CREEZIO_SKIP_BRAND_DIST === "1") {
    log("CREEZIO_SKIP_BRAND_DIST=1 — locks non préparés");
    return { locksRefreshed: [] };
  }
  const locks = ensureBrandPackageLocks(brandRoot, {
    mode: opts?.lockMode || "lock-only",
    kitRoot: opts?.kitRoot,
    linkKit: opts?.linkKit,
    log,
  });
  if (locks.refreshed.length) {
    log(`✓ package-lock prêt : ${locks.refreshed.join(", ")}`);
  }
  return { locksRefreshed: locks.refreshed };
}
