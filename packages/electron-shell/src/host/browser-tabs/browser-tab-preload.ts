/**
 * Preload onglet navigateur (WebContentsView) — gold TF `preload-supplier`.
 *
 * Volontairement MINIMAL : contextIsolation + sandbox actifs, rien n'est
 * exposé au site tiers. Le pilotage bot passe par CDP + monde isolé
 * (browser-tab-driver), pas par ce preload.
 *
 * O1 : SoT kit — marques hors TF pointent ici via `browserTabPreloadPath()`.
 */

export {};
