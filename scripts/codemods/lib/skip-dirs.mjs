/**
 * Répertoires à NE JAMAIS marcher par un codemod d'architecture.
 *
 * SoT partagée (H7, H10, H11, H12, …) — un artefact gitignoré
 * (`dist-electron-server/win-unpacked`, `release/`, `out/`) ne doit
 * jamais être réécrit (vécu H11 : 775 Mo sous win-unpacked).
 */
export const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-cjs",
  "dist-electron-server",
  "win-unpacked",
  "release",
  "out",
  ".next",
  ".git",
  "docker-data",
]);

export function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}
