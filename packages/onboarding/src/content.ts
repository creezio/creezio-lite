/**
 * Contenu onboarding hybride (ADR-module-natif-hybride).
 *
 * Le kit fournit le moteur générique : la marque déclare ses défauts
 * (étapes, interstitiels, mascotte) dans UN fichier explicite
 * (`server/src/electron/brand-<module>-content.ts`), les overrides vivent
 * en `brand.db` (table `onboarding_content`), et le runtime sert toujours
 * `merge(défauts marque, override DB)`. Les réponses utilisateur du
 * parcours atterrissent dans `onboarding_preferences` via le même mount.
 *
 * Zéro texte métier ici (ADR-no-brand-domain-in-native-packages) —
 * imports type-only pour ne pas créer de cycle runtime.
 */

import type { ApiMount } from "@creezio/api-kernel";
import type { SqliteMigration } from "@creezio/platform-core";

/* ------------------------------------------------------------------ types */

/** Contenu éditable d'une étape (labels stepper + interstitiel + textes libres). */
export type OnboardingStepContent = {
  /** Id stable de l'étape (jamais renommer : clé de merge défauts/override). */
  id: string;
  /** Libellé affiché dans le stepper. */
  label: string;
  /** Titre de l'écran de transition avant l'étape. */
  interstitialTitle?: string;
  /** Sous-titre de l'écran de transition. */
  interstitialTagline?: string;
  /** Textes libres propres à l'étape (question, helper, hint…). */
  texts?: Record<string, string>;
};

/** Mascotte / compagnon : URLs d'image par pose. */
export type OnboardingMascot = {
  /** pose → URL image (ex. `{ pointing: "/tempo/tempo-pointing.png" }`). */
  poses?: Record<string, string>;
  /** Préfixe optionnel si les poses sont des chemins relatifs. */
  baseUrl?: string;
};

/** Contenu complet du parcours (défauts marque OU override DB partiel). */
export type OnboardingContent = {
  steps: OnboardingStepContent[];
  mascot?: OnboardingMascot;
  /** Textes globaux du parcours (hors étapes). */
  texts?: Record<string, string>;
};

/**
 * Override partiel stocké en DB : mêmes shapes que `OnboardingContent`,
 * mais chaque step peut n'apporter qu'un sous-ensemble de champs.
 */
export type OnboardingContentOverride = {
  steps?: Array<Partial<OnboardingStepContent> & { id: string }>;
  mascot?: OnboardingMascot;
  texts?: Record<string, string>;
};

/**
 * Contribution onboarding d'un `BrandModuleDef` (F3.4 / T5).
 * Collectée par `createBrandModuleRegistry` puis composée ici
 * (`composeOnboardingFromModules`) — mêmes shapes que le contenu hybride DB.
 */
export type BrandModuleOnboarding = {
  steps: OnboardingStepContent[];
  texts?: Record<string, string>;
  mascot?: OnboardingMascot;
};

export type BrandModuleOnboardingContribution = {
  moduleId: string;
  onboarding: BrandModuleOnboarding;
};

/**
 * Compose les contributions `BrandModuleDef.onboarding` en un
 * `OnboardingContent` (étapes dédupliquées par `id` : premier gagne).
 */
export function composeOnboardingFromModules(
  contributions: readonly BrandModuleOnboardingContribution[],
): OnboardingContent {
  const steps: OnboardingStepContent[] = [];
  const seen = new Set<string>();
  const texts: Record<string, string> = {};
  let mascot: OnboardingMascot | undefined;

  for (const c of contributions) {
    const o = c.onboarding;
    if (!o) continue;
    for (const step of o.steps ?? []) {
      if (!step?.id || seen.has(step.id)) continue;
      seen.add(step.id);
      steps.push({
        id: step.id,
        label: step.label,
        ...(step.interstitialTitle
          ? { interstitialTitle: step.interstitialTitle }
          : {}),
        ...(step.interstitialTagline
          ? { interstitialTagline: step.interstitialTagline }
          : {}),
        ...(step.texts ? { texts: { ...step.texts } } : {}),
      });
    }
    if (o.texts) Object.assign(texts, o.texts);
    if (o.mascot) {
      mascot = {
        ...(mascot ?? {}),
        ...(o.mascot.baseUrl ? { baseUrl: o.mascot.baseUrl } : {}),
        poses: { ...mascot?.poses, ...o.mascot.poses },
      };
    }
  }

  return {
    steps,
    ...(Object.keys(texts).length ? { texts } : {}),
    ...(mascot ? { mascot } : {}),
  };
}

/* ------------------------------------------------------------- migrations */

export const ONBOARDING_CONTENT_SCHEMA_SQL = `-- Contenu onboarding hybride + preferences (@creezio/onboarding)

CREATE TABLE IF NOT EXISTS onboarding_content (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS onboarding_preferences (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_key, key)
);
`;

/** Migrations brand.db du module (à composer dans `brand-migrations.ts` marque). */
export function onboardingContentMigrations(): SqliteMigration[] {
  return [
    { id: "onboarding_001_content_prefs", sql: ONBOARDING_CONTENT_SCHEMA_SQL },
  ];
}

/* ------------------------------------------------------------------ merge */

/**
 * Merge pur défauts marque + override DB partiel.
 *
 * - étape par `id` : les champs présents dans l'override priment, les
 *   `texts` d'étape sont fusionnés clé par clé ;
 * - une étape override inconnue des défauts est ajoutée en fin (si label) ;
 * - `mascot.poses` et `texts` globaux fusionnés clé par clé.
 */
export function mergeOnboardingContent(
  defaults: OnboardingContent,
  override?: OnboardingContentOverride | null,
): OnboardingContent {
  if (!override || typeof override !== "object") {
    return {
      steps: defaults.steps.map((s) => ({ ...s })),
      ...(defaults.mascot ? { mascot: { ...defaults.mascot, poses: { ...defaults.mascot.poses } } } : {}),
      ...(defaults.texts ? { texts: { ...defaults.texts } } : {}),
    };
  }

  const overrideSteps = Array.isArray(override.steps) ? override.steps : [];
  const byId = new Map<string, Partial<OnboardingStepContent> & { id: string }>();
  for (const s of overrideSteps) {
    if (s && typeof s.id === "string" && s.id) byId.set(s.id, s);
  }

  const steps: OnboardingStepContent[] = defaults.steps.map((base) => {
    const o = byId.get(base.id);
    if (!o) return { ...base };
    byId.delete(base.id);
    return {
      ...base,
      ...(typeof o.label === "string" ? { label: o.label } : {}),
      ...(typeof o.interstitialTitle === "string"
        ? { interstitialTitle: o.interstitialTitle }
        : {}),
      ...(typeof o.interstitialTagline === "string"
        ? { interstitialTagline: o.interstitialTagline }
        : {}),
      ...(base.texts || o.texts
        ? { texts: { ...base.texts, ...o.texts } }
        : {}),
    };
  });
  // Étapes ajoutées par l'override (inconnues des défauts).
  for (const o of byId.values()) {
    if (typeof o.label === "string" && o.label) {
      steps.push({
        id: o.id,
        label: o.label,
        ...(typeof o.interstitialTitle === "string"
          ? { interstitialTitle: o.interstitialTitle }
          : {}),
        ...(typeof o.interstitialTagline === "string"
          ? { interstitialTagline: o.interstitialTagline }
          : {}),
        ...(o.texts ? { texts: { ...o.texts } } : {}),
      });
    }
  }

  const mascotPoses = {
    ...defaults.mascot?.poses,
    ...override.mascot?.poses,
  };
  const mascotBaseUrl = override.mascot?.baseUrl ?? defaults.mascot?.baseUrl;
  const hasMascot =
    Object.keys(mascotPoses).length > 0 || mascotBaseUrl !== undefined;

  const texts = { ...defaults.texts, ...override.texts };

  return {
    steps,
    ...(hasMascot
      ? {
          mascot: {
            poses: mascotPoses,
            ...(mascotBaseUrl !== undefined ? { baseUrl: mascotBaseUrl } : {}),
          },
        }
      : {}),
    ...(Object.keys(texts).length ? { texts } : {}),
  };
}

/* ------------------------------------------------------------------ mount */

const CONTENT_KEY = "content";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

type ContentDbRow = { value_json?: string } | undefined;

export type OnboardingContentMountOptions = {
  /**
   * Défauts marque (fichier explicite `brand-onboarding-content.ts`)
   * **ou** résultat de `collectOnboardingContent()` / `composeOnboardingFromModules`.
   */
  defaults: OnboardingContent;
};

/**
 * Mount api-kernel `/api/v1/modules/onboarding/*` (dbLayer brand) :
 *
 * - `GET    content`              → `{ ok, content: merge(défauts, override), hasOverride }`
 * - `PUT    content`              → stocke l'override partiel, répond le contenu mergé
 * - `DELETE content`              → supprime l'override (retour aux défauts)
 * - `GET    preferences?user=<k>` → `{ ok, user, answers }`
 * - `PUT    preferences`          → `{ user, answers }` upsert par clé
 *
 * db absent → 503 `db_unavailable` ; body invalide → 400 (jamais de throw).
 */
export function createOnboardingContentMount(
  opts: OnboardingContentMountOptions,
): ApiMount {
  const defaults = opts.defaults;
  return {
    dbLayer: "brand",
    handle: async ({ req, subPath, db }) => {
      if (!db) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);
      const head = parts[0] || "";

      if (head === CONTENT_KEY && parts.length === 1) {
        if (method === "GET") {
          const override = readOverride(db);
          return {
            status: 200,
            body: {
              ok: true,
              content: mergeOnboardingContent(defaults, override),
              hasOverride: override != null,
            },
          };
        }
        if (method === "PUT") {
          const body = req.body;
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            return { status: 400, body: { ok: false, error: "invalid_body" } };
          }
          const override = body as OnboardingContentOverride;
          db.prepare(
            `INSERT INTO onboarding_content (key, value_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = excluded.updated_at`,
          ).run(CONTENT_KEY, JSON.stringify(override), nowIso());
          return {
            status: 200,
            body: {
              ok: true,
              content: mergeOnboardingContent(defaults, override),
              hasOverride: true,
            },
          };
        }
        if (method === "DELETE") {
          db.prepare(`DELETE FROM onboarding_content WHERE key = ?`).run(
            CONTENT_KEY,
          );
          return {
            status: 200,
            body: {
              ok: true,
              content: mergeOnboardingContent(defaults, null),
              hasOverride: false,
            },
          };
        }
        return { status: 405, body: { ok: false, error: "method_not_allowed" } };
      }

      if (head === "preferences" && parts.length === 1) {
        if (method === "GET") {
          const raw = req.query?.user;
          const user = String(Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").trim();
          if (!user) {
            return { status: 400, body: { ok: false, error: "user_required" } };
          }
          const rows = db
            .prepare(
              `SELECT key, value_json FROM onboarding_preferences
               WHERE user_key = ? ORDER BY key`,
            )
            .all(user) as Array<{ key: string; value_json: string }>;
          const answers: Record<string, unknown> = {};
          for (const r of rows) {
            try {
              answers[r.key] = JSON.parse(r.value_json);
            } catch {
              answers[r.key] = r.value_json;
            }
          }
          return { status: 200, body: { ok: true, user, answers } };
        }
        if (method === "PUT") {
          const body = (req.body || {}) as {
            user?: unknown;
            answers?: unknown;
          };
          const user = String(body.user ?? "").trim();
          const answers = body.answers;
          if (!user || !answers || typeof answers !== "object" || Array.isArray(answers)) {
            return { status: 400, body: { ok: false, error: "invalid_body" } };
          }
          const ts = nowIso();
          let saved = 0;
          for (const [key, value] of Object.entries(
            answers as Record<string, unknown>,
          )) {
            if (value === undefined) continue;
            db.prepare(
              `INSERT INTO onboarding_preferences (id, user_key, key, value_json, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_key, key) DO UPDATE SET
                 value_json = excluded.value_json,
                 updated_at = excluded.updated_at`,
            ).run(newId(), user, key, JSON.stringify(value), ts);
            saved++;
          }
          return { status: 200, body: { ok: true, user, saved } };
        }
        return { status: 405, body: { ok: false, error: "method_not_allowed" } };
      }

      return { status: 404, body: { ok: false, error: "not_found" } };
    },
  };
}

/** Lit l'override DB (null si absent ou JSON illisible — jamais de throw). */
function readOverride(db: {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
}): OnboardingContentOverride | null {
  try {
    const row = db
      .prepare(`SELECT value_json FROM onboarding_content WHERE key = ?`)
      .get(CONTENT_KEY) as ContentDbRow;
    if (!row?.value_json) return null;
    const parsed = JSON.parse(row.value_json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as OnboardingContentOverride;
  } catch {
    return null;
  }
}
