/**
 * Cadre architecture Creezio (Phase H0+).
 * Bump uniquement au sign-off de phase (H0 → H1 → … → H5 ACL → H6 freeze I*
 * → H7 neutralisation des contrats marque, P1.c — codemods scripts/codemods/H7
 * → H8 extraction des manifests marque du kit, P1.d — codemods scripts/codemods/H8
 * → H9 contrat de module importé du kit, P2.c — codemods scripts/codemods/H9
 * → H10 retrait de la compat desktop legacy, P2.a clôturé — codemods
 *   scripts/codemods/H10
 * → H11 purge de la compat desktop historique (dual-reads env première
 *   marque, manifests prod kit, créateur de feed CHR runtime, alias
 *   password WebUI historique, preload-app.js)
 *   — codemods scripts/codemods/H11
 * → H12 purge des shims P1.b d'electron-shell (ré-exports @deprecated du
 *   barrel + subpath ./meili, alias host nommés marque) et dé-brandage du
 *   module workspace de shell-ui (constantes legacy et vocabulaire métier →
 *   configureWorkspacePaths neutre) — codemods scripts/codemods/H12
 * → H13 résidu allowlist runtime : plus de dual-read crash env première
 *   marque, plus d'heuristique packagée nommée marque, classes/ids UI
 *   titlebar / fake-cursor / cache SW → creezio-* — codemods
 *   scripts/codemods/H13).
 */
export const ARCHITECTURE_VERSION = "H13" as const;

export type ArchitectureVersion = typeof ARCHITECTURE_VERSION;
