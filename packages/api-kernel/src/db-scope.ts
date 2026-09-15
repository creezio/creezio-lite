/**
 * Accès DB scopé par couche (H2.2) — deny-by-default cross-layer write.
 *
 * Un mount module (brand) ou plugin ne reçoit qu'un handle sur sa couche.
 * Platform → couche core. Toute tentative d'écriture core depuis brand/plugin
 * → CrossLayerWriteDeniedError.
 */

import type {
  SqliteHandle,
  SqliteLayerKind,
  SqliteLayerRef,
  SqliteRuntime,
  SqliteStatement,
} from "@creezio/platform-core";

export class CrossLayerWriteDeniedError extends Error {
  readonly code = "cross_layer_write_denied" as const;
  readonly from: SqliteLayerKind;
  readonly to: SqliteLayerKind;

  constructor(from: SqliteLayerKind, to: SqliteLayerKind, detail?: string) {
    super(
      detail ||
        `Écriture interdite de ${from} → ${to} (deny-by-default H2)`,
    );
    this.name = "CrossLayerWriteDeniedError";
    this.from = from;
    this.to = to;
  }
}

export type DbAccessMode = "read" | "write";

export type ScopedDbAccess = {
  /** Couche du mount courant. */
  readonly layer: SqliteLayerKind;
  readonly pluginId?: string;
  /** Chemin du fichier DB de la couche courante. */
  readonly path: string;
  /** Exécute du SQL sur la couche courante uniquement. */
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  /**
   * Accès explicite à une autre couche.
   * - write hors couche courante (sauf core→*) : toujours refusé pour brand/plugin
   * - brand/plugin → core write : toujours refusé
   * - brand/plugin → core read : refusé par défaut (pas de fuite)
   * - core → brand/plugin read|write : autorisé (admin kit)
   */
  access(target: SqliteLayerRef, mode: DbAccessMode): SqliteHandle;
};

function layerKind(ref: SqliteLayerRef): SqliteLayerKind {
  return ref.kind;
}

function sameLayer(a: SqliteLayerRef, b: SqliteLayerRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "plugin" && b.kind === "plugin") {
    return a.pluginId === b.pluginId;
  }
  return true;
}

function resolveHandle(
  runtime: SqliteRuntime,
  ref: SqliteLayerRef,
): SqliteHandle {
  if (ref.kind === "core") return runtime.getCore();
  if (ref.kind === "brand") return runtime.getBrand();
  return runtime.getPlugin(ref.pluginId);
}

/**
 * Construit un ScopedDbAccess pour un mount donné.
 */
export function createScopedDbAccess(
  runtime: SqliteRuntime,
  own: SqliteLayerRef,
): ScopedDbAccess {
  const ownHandle = resolveHandle(runtime, own);
  const ownKind = layerKind(own);

  return {
    layer: ownKind,
    pluginId: own.kind === "plugin" ? own.pluginId : undefined,
    path: ownHandle.path,

    exec(sql) {
      ownHandle.exec(sql);
    },

    prepare(sql) {
      return ownHandle.prepare(sql);
    },

    access(target, mode) {
      if (sameLayer(own, target)) {
        return resolveHandle(runtime, target);
      }

      // brand / plugin ne peuvent jamais écrire (ni lire) core / autre couche
      if (ownKind === "brand" || ownKind === "plugin") {
        throw new CrossLayerWriteDeniedError(
          ownKind,
          layerKind(target),
          mode === "write"
            ? `write ${ownKind} → ${layerKind(target)} interdit`
            : `read ${ownKind} → ${layerKind(target)} interdit (isolation H2)`,
        );
      }

      // core peut accéder brand/plugin (admin)
      if (ownKind === "core") {
        return resolveHandle(runtime, target);
      }

      throw new CrossLayerWriteDeniedError(ownKind, layerKind(target));
    },
  };
}

/** Layer ref pour un mount platform (core), module (brand) ou plugin. */
export function mountLayerRef(
  space: "platform" | "module" | "plugin",
  mountId: string,
): SqliteLayerRef {
  if (space === "platform") return { kind: "core" };
  if (space === "module") return { kind: "brand" };
  return { kind: "plugin", pluginId: mountId };
}
