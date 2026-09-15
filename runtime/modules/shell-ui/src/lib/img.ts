/**
 * Réécrit les URLs d'images externes vers leur variante miniature CDN.
 * Évite de charger des originaux de 20+ Mpx dans des cartes de 300 px.
 */
const WIKIMEDIA_SIZES = [330, 500, 960] as const; // seules tailles acceptées par upload.wikimedia.org

export function thumbUrl(url: string | null | undefined, width = 500): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }

  if (
    u.host === "upload.wikimedia.org" &&
    u.pathname.includes("/commons/") &&
    !u.pathname.includes("/thumb/")
  ) {
    const size = WIKIMEDIA_SIZES.find((s) => s >= width) ?? 960;
    const file = u.pathname.split("/").pop();
    if (!file) return url;
    return `https://upload.wikimedia.org${u.pathname.replace(
      "/commons/",
      "/commons/thumb/",
    )}/${size}px-${file}`;
  }

  if (u.host === "images.pexels.com") {
    u.search = "";
    u.searchParams.set("auto", "compress");
    u.searchParams.set("cs", "tinysrgb");
    u.searchParams.set("w", String(width));
    return u.toString();
  }

  if (u.host === "images.unsplash.com") {
    u.searchParams.set("auto", "format");
    u.searchParams.set("w", String(width));
    u.searchParams.set("q", "70");
    return u.toString();
  }

  return url; // S3 fournisseur et autres : inchangé
}
