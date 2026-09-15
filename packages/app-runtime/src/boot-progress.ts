/**
 * Boot progress headless — le « splash » des serveurs Docker.
 *
 * Réutilise le modèle SplashViewModel du desktop (@creezio/electron-shell
 * splash-ui — pur data, zéro Electron) et l'expose :
 *   - en JSON via `GET /api/v1/os/boot-status` (early-listen + serveur final)
 *   - en JSONL sur stdout (une ligne par transition — `docker logs`)
 *   - dans le journal ops (`/data/ops/*.jsonl`) via @creezio/observability
 */
import {
  activateSplashStep,
  completeSplashStep,
  createLocalSplashSteps,
  createSplashModel,
  updateSplashStep,
  type SplashStepId,
  type SplashStepStatus,
  type SplashViewModel,
} from "@creezio/electron-shell";
import {
  initOpsJournal,
  persistBootSummary,
  track,
  trackDecision,
} from "@creezio/observability";

/**
 * Id d'étape de boot — union ouverte : les ids du splash desktop
 * (SplashStepId) + tout id custom enregistré via `register()` (ex. future
 * étape « browser » d'un sidecar navigateur IA). L'API HTTP/admin traite la
 * liste d'étapes comme ouverte — jamais d'enum fermée côté consommateurs.
 */
export type BootStepId = SplashStepId | (string & {});

export type BootProgressReporter = {
  model: () => SplashViewModel;
  /**
   * Déclare une étape optionnelle dynamique (ex. sidecar) si absente —
   * ajoutée en pending à la fin du modèle (poids défaut du splash).
   */
  register: (id: BootStepId, label: string, detail?: string) => void;
  /** Active une étape (status running). */
  go: (
    id: BootStepId,
    opts?: { detail?: string; percent?: number | null; parallel?: boolean },
  ) => void;
  /** Patch détail/percent/status d'une étape. */
  patch: (
    id: BootStepId,
    patch: {
      detail?: string;
      percent?: number | null;
      status?: SplashStepStatus;
    },
  ) => void;
  /** Étape terminée. */
  done: (id: BootStepId, detail?: string) => void;
  /** Étape en erreur (boot continue best-effort). */
  error: (id: BootStepId, detail: string) => void;
  /** Étape non applicable. */
  skip: (id: BootStepId, detail?: string) => void;
  /** Boot terminé — fige le modèle à 100 % + résumé ops. */
  complete: (detail?: string) => void;
};

function nowMs(model: SplashViewModel): number {
  return Date.now() - model.bootStartedAt;
}

/**
 * Crée le reporter de boot serveur.
 * `initOps` (défaut true) initialise le journal ops dans `{dataDir}/ops/`.
 */
export function createBootProgressReporter(opts: {
  brandId: string;
  dataDir?: string;
  appVersion?: string;
  headline?: string;
  warmNative?: boolean;
  /** Override Hermes (défaut = warmNative). n8n et Hermes sont indépendants. */
  warmHermes?: boolean;
  /** Override n8n (défaut = warmNative). */
  warmN8n?: boolean;
  needIndex?: boolean;
  needTunnel?: boolean;
  catalogLabel?: string;
  initOps?: boolean;
  log?: (line: string) => void;
}): BootProgressReporter {
  const logLine =
    opts.log ||
    ((line: string) => {
      console.log(line);
    });

  if (opts.initOps !== false && opts.dataDir) {
    initOpsJournal(opts.dataDir, opts.appVersion || "0.0.0");
    track({
      level: "event",
      kind: "server.boot.start",
      ctx: { brandId: opts.brandId },
    });
  }

  const steps = createLocalSplashSteps({
    needIndex: opts.needIndex !== false,
    needNode: false,
    needHermes: opts.warmHermes ?? Boolean(opts.warmNative),
    needN8n: opts.warmN8n ?? Boolean(opts.warmNative),
    needTunnel: Boolean(opts.needTunnel),
    catalogLabel: opts.catalogLabel,
  });
  let model = createSplashModel(
    steps,
    opts.headline || `Démarrage du serveur ${opts.brandId}…`,
  );
  model = { ...model, footer: "Serveur Docker — boot headless Creezio" };

  const emit = (
    id: BootStepId,
    status: SplashStepStatus,
    detail?: string,
    percent?: number | null,
  ) => {
    // Une ligne JSONL par transition — lisible via `docker logs`.
    logLine(
      JSON.stringify({
        creezio: "boot-step",
        step: id,
        status,
        ...(detail ? { detail } : {}),
        ...(typeof percent === "number" ? { percent } : {}),
        overallPercent: Math.round(model.overallPercent),
        elapsedMs: nowMs(model),
      }),
    );
    if (status === "done" || status === "error" || status === "skip") {
      trackDecision(`server.boot.${id}`, status, {
        ...(detail ? { reason: detail.slice(0, 200) } : {}),
        durationMs: nowMs(model),
      });
    }
  };

  // computeOverallPercent (splash-ui) tolère les ids hors enum (poids 5).
  const asSplashId = (id: BootStepId) => id as SplashStepId;

  return {
    model: () => model,
    register: (id, label, detail = "En attente") => {
      if (model.steps.some((s) => s.id === id)) return;
      model = {
        ...model,
        steps: [
          ...model.steps,
          {
            id: asSplashId(id),
            label,
            status: "pending",
            detail,
            percent: null,
            startedAt: null,
            endedAt: null,
          },
        ],
      };
    },
    go: (id, o) => {
      model = activateSplashStep(model, asSplashId(id), {
        detail: o?.detail ?? "…",
        percent: o?.percent ?? null,
        parallel: o?.parallel,
      });
      emit(id, "running", o?.detail, o?.percent ?? null);
    },
    patch: (id, patch) => {
      model = updateSplashStep(model, asSplashId(id), patch);
      if (patch.status && patch.status !== "running") {
        emit(id, patch.status, patch.detail, patch.percent ?? null);
      }
    },
    done: (id, detail = "Terminé") => {
      model = completeSplashStep(model, asSplashId(id), detail);
      emit(id, "done", detail);
    },
    error: (id, detail) => {
      model = updateSplashStep(model, asSplashId(id), {
        status: "error",
        detail,
        percent: 100,
      });
      emit(id, "error", detail);
    },
    skip: (id, detail = "Non applicable") => {
      model = updateSplashStep(model, asSplashId(id), { status: "skip", detail });
      emit(id, "skip", detail);
    },
    complete: (detail = "Serveur prêt") => {
      model = {
        ...model,
        headline: detail,
        overallPercent: 100,
      };
      logLine(
        JSON.stringify({
          creezio: "boot-complete",
          detail,
          elapsedMs: nowMs(model),
        }),
      );
      trackDecision("server.boot.complete", "ok", {
        durationMs: nowMs(model),
      });
      persistBootSummary();
    },
  };
}
