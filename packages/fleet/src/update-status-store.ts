/**
 * Persistance du suivi update-status (T8 — dette « Suivi update en mémoire »).
 *
 * Le host-agent (et le plan local du server-admin) tenait la Map
 * containerName → UpdateEntry uniquement en mémoire : un restart du process
 * pendant un update laissait l'admin poller `update-status` dans le vide
 * (l'update Docker, lui, va au bout ou reste appliqué). Ce store journalise
 * chaque transition sur disque et recharge l'état au boot.
 *
 * Format : UN fichier JSON compact par process (journal, pas un fichier par
 * update) dans le répertoire d'état EXISTANT :
 *   - agent hôte    : {dirname(CREEZIO_AGENT_STATE_FILE)}/host-agent-updates.json
 *   - admin (local) : {adminRoot}/docker-data/server-admin-updates.json
 *   { "version": 1, "updates": { "<containerName>": UpdateEntry } }
 *
 * Écriture atomique tmp+rename (writeJson de server-lib). Rechargement :
 *   - entrées terminées (done/error) conservées jusqu'au TTL
 *     (DEFAULT_UPDATE_STATUS_TTL_MS = 24 h après finishedAt) ;
 *   - entrée "running" = update interrompu par le restart → flag additif
 *     `agentRestarted: true` puis résolution best-effort via le registre :
 *     si l'image enregistrée de l'instance (servers.json, posée par
 *     updateServer en fin d'update OK) correspond à l'image de l'update,
 *     l'update est allé au bout → status "done" ; sinon l'issue réelle est
 *     inconnue → status "error" + result.error explicite (dernière étape
 *     persistée incluse). Le poll admin retrouve donc TOUJOURS un statut
 *     terminal au lieu d'un trou, et le mutex « update déjà en cours » ne
 *     reste jamais coincé sur une entrée fantôme.
 *
 * Protocole flotte v1 intact : `agentRestarted` / `lastStep` sont des champs
 * ADDITIFS de UpdateEntry, aucun champ ni statut existant ne change.
 */

import path from "node:path";
import { readJson, writeJson } from "./server-lib.js";
import type { UpdateEntry } from "./types.js";

/** Rétention des entrées terminées : 24 h après finishedAt. */
export const DEFAULT_UPDATE_STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/** Noms de fichiers canoniques (répertoires d'état existants). */
export const HOST_AGENT_UPDATES_BASENAME = "host-agent-updates.json";
export const SERVER_ADMIN_UPDATES_BASENAME = "server-admin-updates.json";

interface PersistedUpdatesFile {
  version: 1;
  updates: Record<string, UpdateEntry>;
}

/**
 * Contrat minimal du suivi d'updates — satisfait par Map ET par le store
 * persistant (les consommateurs comme runAgentUpdateCycle n'exigent que ça).
 */
export interface UpdateStatusTracker {
  get(containerName: string): UpdateEntry | undefined;
  set(containerName: string, entry: UpdateEntry): unknown;
}

export interface UpdateStatusStore extends UpdateStatusTracker {
  set(containerName: string, entry: UpdateEntry): UpdateStatusStore;
  /** Re-persiste l'état courant (après mutation in-place d'une entrée). */
  save(): void;
  /** Purge les entrées terminées plus vieilles que le TTL. Retourne le nombre purgé. */
  purgeExpired(): number;
  entries(): Array<[string, UpdateEntry]>;
  readonly file: string;
}

export interface UpdateStatusStoreOptions {
  /** Fichier JSON de persistance (répertoire d'état existant du process). */
  file: string;
  /** Rétention des entrées terminées (défaut 24 h). */
  ttlMs?: number;
  /** Horloge injectable (tests TTL). */
  now?: () => number;
  /**
   * Image ENREGISTRÉE de l'instance (servers.json) — résolution post-restart
   * d'un update interrompu. null/undefined = instance inconnue.
   */
  resolveInstanceImage?: (containerName: string) => string | null | undefined;
}

function isFinished(entry: UpdateEntry): boolean {
  return entry.status === "done" || entry.status === "error";
}

/**
 * Charge (et résout) l'état persisté puis retourne le store. Chaque `set`
 * ré-écrit le fichier (atomique) après purge TTL.
 */
export function createUpdateStatusStore(
  opts: UpdateStatusStoreOptions,
): UpdateStatusStore {
  const file = path.resolve(opts.file);
  const ttlMs = opts.ttlMs ?? DEFAULT_UPDATE_STATUS_TTL_MS;
  const now = opts.now ?? Date.now;
  const map = new Map<string, UpdateEntry>();

  const purgeExpired = (): number => {
    let purged = 0;
    for (const [name, entry] of map) {
      if (!isFinished(entry)) continue;
      const finishedMs = Date.parse(entry.finishedAt || entry.startedAt || "");
      if (Number.isFinite(finishedMs) && now() - finishedMs > ttlMs) {
        map.delete(name);
        purged++;
      }
    }
    return purged;
  };

  const persist = (): void => {
    const updates: Record<string, UpdateEntry> = {};
    for (const [name, entry] of map) updates[name] = entry;
    writeJson(file, { version: 1, updates } satisfies PersistedUpdatesFile);
  };

  // ------------------------------------------------------------- reload boot
  const persisted = readJson<PersistedUpdatesFile | null>(file, null);
  const raw =
    persisted && persisted.version === 1 && persisted.updates
      ? persisted.updates
      : {};
  let mutated = false;
  for (const [containerName, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object" || !entry.status) continue;
    if (entry.status === "running") {
      // Update interrompu par un restart du process pendant son exécution.
      entry.agentRestarted = true;
      entry.finishedAt = entry.finishedAt || new Date(now()).toISOString();
      const registeredImage = opts.resolveInstanceImage?.(containerName);
      if (registeredImage && registeredImage === entry.image) {
        // updateServer pose inst.image dans servers.json UNIQUEMENT en fin
        // d'update OK : l'update est allé au bout malgré le restart.
        entry.status = "done";
      } else {
        entry.status = "error";
        entry.result = {
          ok: false,
          error:
            "process redémarré pendant l'update — issue réelle inconnue" +
            (entry.lastStep
              ? ` (dernière étape persistée : ${entry.lastStep})`
              : ""),
        };
      }
      mutated = true;
    }
    map.set(containerName, entry);
  }
  if (purgeExpired() > 0) mutated = true;
  if (mutated) persist();

  const store: UpdateStatusStore = {
    file,
    get: (containerName) => map.get(containerName),
    set: (containerName, entry) => {
      map.set(containerName, entry);
      purgeExpired();
      persist();
      return store;
    },
    save: () => {
      purgeExpired();
      persist();
    },
    purgeExpired: () => {
      const purged = purgeExpired();
      if (purged > 0) persist();
      return purged;
    },
    entries: () => [...map.entries()],
  };
  return store;
}
