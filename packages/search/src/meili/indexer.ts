/**
 * Indexeur Meilisearch catalogue — point d'entrée `runIndexation`.
 *
 * Exécuté comme script Node autonome (PAS dans Electron) :
 *   DB_PATH=… MEILI_HOST=… node build/electron/meili-indexer.js
 *
 * Le descripteur `BrandMeiliFeed` est OBLIGATOIRE : la marque le passe en
 * option (`opts.feed`) ou le configure au préalable via
 * `configureMeiliBrandFeed` (voir `feed.ts`). L'indexation elle-même
 * (streaming SQLite → lots Meili → swap atomique `<uid>_new`) vit dans
 * `generic-indexer.ts` — aucun schéma marque hardcodé dans le kit.
 *
 * Historique : l'ancien chemin d'indexation legacy de la première marque
 * (UIDs marque, SQL agrégateurs) a été retiré du package natif. Une marque
 * qui en a besoin porte ce descripteur chez elle (feed avec ses UIDs) — le
 * kit n'embarque plus de vocabulaire marque.
 */

export type RunIndexationOptions = {
  dbPath?: string;
  meiliHost?: string;
  masterKey?: string;
  log?: (line: string) => void;
  feed?: import("./feed.js").BrandMeiliFeed;
  appVersion?: string;
};

/**
 * Lance l'indexation pilotée par le `BrandMeiliFeed` (option ou configuré).
 * Sans feed → erreur explicite (pas de défaut marque dans le kit).
 */
export async function runIndexation(opts?: RunIndexationOptions): Promise<void> {
  const log = opts?.log ?? ((line: string) => console.log(line));
  const { getMeiliBrandFeed } = await import("./feed.js");
  const feed = opts?.feed ?? getMeiliBrandFeed();
  if (!feed) {
    throw new Error(
      "runIndexation: aucun BrandMeiliFeed — passer opts.feed ou appeler " +
        "configureMeiliBrandFeed(brandMeiliFeed) avant l'indexation " +
        "(voir @creezio/search feed.ts).",
    );
  }
  const { runFeedIndexation } = await import("./generic-indexer.js");
  await runFeedIndexation({
    feed,
    dbPath: opts?.dbPath,
    meiliHost: opts?.meiliHost,
    masterKey: opts?.masterKey,
    log,
    appVersion: opts?.appVersion,
  });
}

/** CLI dual-build safe (pas d'`import.meta` — CJS Electron). */
const cliEntry = process.argv[1] || "";
if (/(^|[\\/])meili-indexer\.(c?js|mjs)$/.test(cliEntry)) {
  void runIndexation().catch((e) => {
    console.error(`[meili] échec indexation: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
}
