/**
 * Helper des smokes kit/marques — cohérence éventuelle Meili (contrat kit
 * délibéré : PAS de write-through ; la liste d'une entité indexée est servie
 * par Meili et répond `engine:"indexing"` + 0 item pendant l'indexation
 * initiale — le client réessaie).
 *
 * Deux primitives pour l'assertion « créé puis listé » des smokes :
 *
 * 1. `assertModuleRowHydratedById` — read-after-write DÉTERMINISTE via
 *    `GET <listPath>?ids=<id>` : l'hydratation par PK est un chemin SQL
 *    légitime du contrat (jamais Meili), la réponse est immédiate.
 * 2. `pollModuleListUntilVisible` — visibilité dans la LISTE (chemin Meili
 *    pour une entité indexée) : polling borné (défaut 60 s / 250 ms) tant
 *    que le prédicat est faux ; échec explicite IMMÉDIAT si
 *    `engine:"meili"` (indexation terminée, index figé) sans que le
 *    prédicat soit satisfait — le doc a manqué la fenêtre d'indexation et
 *    ne réapparaîtra pas avant une réindexation. `engine:"sql"` / absent =
 *    liste SQL read-your-writes : le prédicat est vrai dès la 1re lecture,
 *    sinon le timeout borné remonte le diagnostic (engine/total).
 *
 * `json` = helper `(method, urlPath, body?) => Promise<payload>` du smoke
 * appelant (il asserte déjà res.ok). Les erreurs levées ici sont des
 * échecs de smoke explicites — jamais un affaiblissement d'assertion.
 */

/**
 * @param {(method: string, urlPath: string, body?: unknown) => Promise<any>} json
 * @param {string} listPath chemin de liste (`/api/v1/modules/<entité>`)
 * @param {string} id id créé à hydrater
 * @param {string} [label] label lisible pour le message d'échec
 */
export async function assertModuleRowHydratedById(
  json,
  listPath,
  id,
  label = listPath,
) {
  const byId = await json(
    "GET",
    `${listPath}?ids=${encodeURIComponent(id)}`,
  );
  const items = byId.items || [];
  if (!items.some((x) => x && x.id === id)) {
    throw new Error(
      `${label} : hydratation ?ids= doit rendre la row créée (chemin SQL ` +
        `déterministe, jamais Meili) — reçu: ${JSON.stringify(byId).slice(0, 400)}`,
    );
  }
  return byId;
}

/**
 * @param {(method: string, urlPath: string, body?: unknown) => Promise<any>} json
 * @param {string} listPath chemin de liste (query string incluse si besoin)
 * @param {(items: any[], list: any) => boolean} predicate visibilité attendue
 * @param {{ label?: string, timeoutMs?: number, intervalMs?: number }} [opts]
 * @returns {Promise<any>} le payload de liste satisfaisant le prédicat
 */
export async function pollModuleListUntilVisible(
  json,
  listPath,
  predicate,
  opts = {},
) {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 250;
  const label = opts.label || listPath;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = await json("GET", listPath);
    const items = list.items || [];
    if (predicate(items, list)) return list;
    if (list.engine === "meili") {
      // Indexation initiale terminée SANS satisfaire le prédicat (l'indexeur
      // a lu la table avant le POST) : pas de write-through, le doc ne
      // réapparaîtra pas avant une réindexation — échec explicite immédiat
      // plutôt que 60 s d'attente stérile.
      throw new Error(
        `${label} : engine:"meili" (indexation terminée) sans satisfaire ` +
          `le prédicat — le doc créé a manqué la fenêtre d'indexation ` +
          `(total=${list.total ?? "?"} items=${items.length}). ` +
          `Réindexer ou corriger le feed.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `${label} : prédicat non satisfait après ${Math.round(timeoutMs / 1000)}s ` +
          `de polling (engine=${list?.engine ?? "?"} total=${list?.total ?? "?"} ` +
          `items=${items.length})`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
