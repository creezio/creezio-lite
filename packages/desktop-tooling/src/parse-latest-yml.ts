/** Parse minimal d'un `latest.yml` electron-updater (generic provider). */

export type LatestYmlMeta = {
  version: string | null;
  path: string | null;
  releaseDate: string | null;
  size: number | null;
  sha512: string | null;
};

export function parseLatestYml(text: string | null | undefined): LatestYmlMeta {
  if (!text) {
    return {
      version: null,
      path: null,
      releaseDate: null,
      size: null,
      sha512: null,
    };
  }
  const version = (text.match(/^version:\s*["']?([^\s"']+)/m) || [])[1] || null;
  const filePath = (text.match(/^path:\s*["']?([^\s"']+)/m) || [])[1] || null;
  const releaseDate =
    (text.match(/^releaseDate:\s*['"]?([^'"\n]+)/m) || [])[1] || null;
  const sizeMatch = text.match(/size:\s*(\d+)/);
  const sha512 = (text.match(/^sha512:\s*["']?([^\s"']+)/m) || [])[1] || null;
  return {
    version,
    path: filePath,
    releaseDate: releaseDate ? releaseDate.trim() : null,
    size: sizeMatch ? Number(sizeMatch[1]) : null,
    sha512,
  };
}
