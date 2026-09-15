/**
 * Réécrit les URLs de covers (secteurs / catégories) vers une taille vignette.
 * Les /img/familles/*.webp locaux sont déjà optimisés — pass-through.
 */

const DEFAULT_WIDTH = 640;

/** Wikimedia Commons : fichier full → thumb 640px. */
function wikimediaThumb(url: string, width: number): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("wikimedia.org") && !u.hostname.endsWith("wikipedia.org")) {
      return null;
    }
    // Déjà un thumb
    if (u.pathname.includes("/thumb/")) {
      // Remplacer la largeur du thumb si présente (…/640px-Foo.jpg)
      return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
    }
    // /wikipedia/commons/a/ab/File.jpg → /wikipedia/commons/thumb/a/ab/File.jpg/640px-File.jpg
    const m = u.pathname.match(
      /^(\/wikipedia\/commons\/)([0-9a-f]\/[0-9a-f]{2}\/)([^/]+)$/i,
    );
    if (!m) return null;
    const file = m[3]!;
    u.pathname = `${m[1]}thumb/${m[2]}${file}/${width}px-${file}`;
    return u.toString();
  } catch {
    return null;
  }
}

function pexelsSized(url: string, width: number): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("pexels.com")) return null;
    u.searchParams.set("auto", "compress");
    u.searchParams.set("cs", "tinysrgb");
    u.searchParams.set("w", String(width));
    u.searchParams.set("fit", "crop");
    return u.toString();
  } catch {
    return null;
  }
}

function unsplashSized(url: string, width: number): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("unsplash.com")) return null;
    u.searchParams.set("w", String(width));
    u.searchParams.set("q", "75");
    u.searchParams.set("auto", "format");
    u.searchParams.set("fit", "crop");
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Retourne une URL adaptée à une vignette ~width CSS pixels (×2 DPR géré par le navigateur
 * sur les CDNs qui le supportent ; Wikimedia/Pexels reçoivent width logique).
 */
export function optimizeCoverUrl(
  url: string | null | undefined,
  width = DEFAULT_WIDTH,
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Assets locaux déjà compressés
  if (trimmed.startsWith("/img/")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;

  return (
    wikimediaThumb(trimmed, width) ||
    pexelsSized(trimmed, width) ||
    unsplashSized(trimmed, width) ||
    trimmed
  );
}
