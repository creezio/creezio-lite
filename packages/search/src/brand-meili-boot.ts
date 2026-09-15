/**
 * Boot Meili des marques — composant CORE (comme SQLite), fail-closed.
 *
 * Contrat (décision plateforme 2026-08-28) : si le feed déclare ≥ 1 index,
 * l'absence de binaire Meili ou un échec de démarrage = **échec de boot
 * explicite** (throw `MEILI_REQUIRED`), comme une DB absente. Plus jamais
 * de `engine:"sql-fallback"` silencieux pour le browse catalogue.
 *
 * Unique échappatoire : env `CREEZIO_ALLOW_NO_MEILI=1` (dev / tests
 * hors-browse uniquement) — warning bruyant + `engine:"sql-fallback"`
 * assumé (les listes indexées répondent alors en SQL visible côté
 * entity-list, jamais en prod).
 */
import type { BrandMeiliFeed } from "./meili/feed.js";
import { configureMeiliBrandFeed } from "./meili/feed.js";
import { startMeili, type RunningMeili } from "./meili-launcher.js";
import {
  ensureMeiliPaginationSettings,
  runFeedIndexation,
} from "./meili/generic-indexer.js";
import {
  configureMeiliCoherencePaths,
  decideMeiliReady,
  type MeiliCoherencePaths,
} from "./meili/coherence.js";

/** Erreur fail-closed du boot Meili (binaire absent / start KO). */
export class MeiliRequiredError extends Error {
  readonly code = "MEILI_REQUIRED";
  constructor(message: string) {
    super(message);
    this.name = "MeiliRequiredError";
  }
}

export function isMeiliRequiredError(err: unknown): err is MeiliRequiredError {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === "MEILI_REQUIRED"
  );
}

export type BrandMeiliBootResult = {
  meili: RunningMeili | null;
  /** `sql-fallback` n'existe plus qu'avec `CREEZIO_ALLOW_NO_MEILI=1`. */
  engine: "meili" | "sql-fallback";
  indexed?: Record<string, number>;
  /**
   * Mode background : résolue à la fin de l'indexation (null si échec).
   * Le boot ne doit PAS l'attendre — une réindexation complète (bump de
   * schemaVersion sur un gros catalogue) peut dépasser les timeouts de
   * health des updates flotte ; /search sert `source:"indexing"` entre-temps.
   */
  indexation?: Promise<Record<string, number> | null>;
  /**
   * true quand l'indexation a été sautée parce que le fingerprint persisté
   * est à jour (option `skipIfCoherent`) — aucune fenêtre dégradée au boot.
   */
  indexSkipped?: boolean;
};

/**
 * Démarre Meili (fail-closed si le feed déclare des index), indexe le feed,
 * pose MEILI_HOST/KEY. Throw `MeiliRequiredError` si binaire absent / start
 * KO sans `CREEZIO_ALLOW_NO_MEILI=1`.
 */
export async function maybeBootBrandMeili(opts: {
  binaryPath: string | null;
  dataDir: string;
  userDataDir: string;
  dbPath: string;
  feed: BrandMeiliFeed;
  log?: (line: string) => void;
  /** Si false, ne lance pas l'indexation (défaut true). */
  index?: boolean;
  /** Si true, l'indexation part en tâche de fond (résultat via `indexation`). */
  backgroundIndex?: boolean;
  /**
   * Si true, sonde la cohérence fingerprint + compteurs (stricts) avant
   * d'indexer : index persistant à jour → indexation sautée (les ~7 min de
   * réindexation complète à chaque boot de container sur un gros catalogue
   * dégradent tout le serveur pour rien). Nécessite `coherencePaths`.
   */
  skipIfCoherent?: boolean;
  /** Chemins de la sonde de cohérence (harness serveur : Node courant). */
  coherencePaths?: MeiliCoherencePaths;
}): Promise<BrandMeiliBootResult> {
  const log = opts.log ?? ((l: string) => console.log(`[meili-boot] ${l}`));
  const meili = await startMeili({
    binaryPath: opts.binaryPath,
    dataDir: opts.dataDir,
    userDataDir: opts.userDataDir,
    log,
  });

  if (!meili) {
    delete process.env.MEILI_HOST;
    delete process.env.MEILI_MASTER_KEY;
    const indexUids = (opts.feed.indexes ?? []).map((i) => i.uid);
    if (indexUids.length > 0) {
      if (process.env.CREEZIO_ALLOW_NO_MEILI === "1") {
        log(
          "⚠️ CREEZIO_ALLOW_NO_MEILI=1 — Meili absent ACCEPTÉ (dev/tests " +
            `hors-browse uniquement). Index non servis : ${indexUids.join(", ")}. ` +
            "INTERDIT en production : le browse catalogue répondra en SQL visible.",
        );
        return { meili: null, engine: "sql-fallback" };
      }
      throw new MeiliRequiredError(
        `Meili est un composant core : le feed déclare ${indexUids.length} index ` +
          `(${indexUids.join(", ")}) mais le binaire Meilisearch est absent ou n'a pas démarré ` +
          `(binaryPath=${opts.binaryPath ?? "null"}). ` +
          "Correctifs : installer le binaire kit (ensure-kit-binaries → " +
          "electron-shell/resources/bin/meili), poser MEILI_BINARY sur un binaire valide " +
          "(image Docker : /opt/creezio/bin/meilisearch), ou — dev/tests hors-browse " +
          "UNIQUEMENT — CREEZIO_ALLOW_NO_MEILI=1.",
      );
    }
    return { meili: null, engine: "sql-fallback" };
  }

  process.env.MEILI_HOST = meili.host;
  process.env.MEILI_MASTER_KEY = meili.masterKey;

  if (opts.index === false) return { meili, engine: "meili" };

  if (opts.skipIfCoherent) {
    try {
      if (!opts.coherencePaths) {
        throw new Error("coherencePaths requis pour skipIfCoherent");
      }
      configureMeiliCoherencePaths(opts.coherencePaths);
      configureMeiliBrandFeed(opts.feed);
      const decision = await decideMeiliReady(meili, opts.dbPath, {
        strictCounts: true,
      });
      if (decision.ready) {
        log(
          `fingerprint à jour (${decision.reason}) — indexation sautée, ` +
            `compteurs ${JSON.stringify(decision.meili)}`,
        );
        // Settings cheap : lève le plafond Meili 1000 sans recréer l'index.
        await ensureMeiliPaginationSettings({
          meiliHost: meili.host,
          masterKey: meili.masterKey,
          indexUids: (opts.feed.indexes ?? []).map((i) => i.uid),
          log,
        });
        return { meili, engine: "meili", indexSkipped: true };
      }
      log(`réindexation requise: ${decision.reason}`);
    } catch (err) {
      // La sonde est une optimisation : indécidable → comportement historique.
      log(
        `cohérence indécidable (${err instanceof Error ? err.message : err}) — indexation complète`,
      );
    }
  }

  const runOnce = async (): Promise<Record<string, number> | null> => {
    try {
      const result = await runFeedIndexation({
        feed: opts.feed,
        dbPath: opts.dbPath,
        meiliHost: meili.host,
        masterKey: meili.masterKey,
        log,
      });
      return result.indexed;
    } catch (err) {
      log(
        `indexation échouée — browse catalogue en erreur (meili_unavailable) ` +
          `jusqu'à réindexation (${err instanceof Error ? err.message : err})`,
      );
      return null;
    }
  };

  if (opts.backgroundIndex) {
    return { meili, engine: "meili", indexation: runOnce() };
  }
  const indexed = await runOnce();
  return { meili, engine: "meili", indexed: indexed ?? undefined };
}
