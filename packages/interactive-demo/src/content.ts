/**
 * Contenu démo interactive hybride (ADR-module-natif-hybride).
 *
 * Le kit fournit le moteur générique : la marque déclare ses scénarios par
 * défaut dans UN fichier explicite
 * (`server/src/electron/brand-interactive-demo-content.ts`), les overrides
 * vivent en `brand.db` (table `interactive_demo_content`, une ligne par
 * scénario), et le runtime sert toujours `merge(défauts marque, overrides
 * DB)`. Le « déjà vu » par utilisateur atterrit dans
 * `interactive_demo_preferences` via le même mount.
 *
 * Zéro texte métier ici (ADR-no-brand-domain-in-native-packages) —
 * imports type-only pour ne pas créer de cycle runtime.
 */

import type { ApiMount } from "@creezio/api-kernel";
import type { SqliteMigration } from "@creezio/platform-core";
import type { DemoScenario, DemoScenarioOverride } from "./types.js";
import { validateDemoScenario } from "./types.js";

/* ------------------------------------------------------------- migrations */

export const INTERACTIVE_DEMO_SCHEMA_SQL = `-- Scénarios démo interactive hybride + preferences (@creezio/interactive-demo)

CREATE TABLE IF NOT EXISTS interactive_demo_content (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactive_demo_preferences (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_key, key)
);
`;

/** Migrations brand.db du module (à composer dans `brand-migrations.ts` marque). */
export function interactiveDemoMigrations(): SqliteMigration[] {
  return [
    {
      id: "interactive_demo_001_content_prefs",
      sql: INTERACTIVE_DEMO_SCHEMA_SQL,
    },
  ];
}

/* ------------------------------------------------------------------ merge */

function cloneScenario(s: DemoScenario): DemoScenario {
  return {
    ...s,
    ...(Array.isArray(s.roles) ? { roles: [...s.roles] } : {}),
    steps: s.steps.map((st) => ({ ...st })),
  };
}

/**
 * Merge pur défauts marque + overrides DB.
 *
 * - scénario par `id` : champs présents dans l'override priment ;
 * - `steps` d'un override REMPLACE le tableau des défauts (édition
 *   explicite — pas de merge étape par étape) ;
 * - `enabled: false` désactive un scénario par défaut sans le supprimer ;
 * - un override inconnu des défauts portant `title` + `steps` valides est
 *   ajouté en fin (scénario créé par l'admin).
 */
export function mergeDemoScenarios(
  defaults: DemoScenario[],
  overrides?: DemoScenarioOverride[] | null,
): DemoScenario[] {
  const base = defaults.map(cloneScenario);
  if (!Array.isArray(overrides) || overrides.length === 0) return base;

  const byId = new Map<string, DemoScenarioOverride>();
  for (const o of overrides) {
    if (o && typeof o.id === "string" && o.id) byId.set(o.id, o);
  }

  const merged = base.map((s) => {
    const o = byId.get(s.id);
    if (!o) return s;
    byId.delete(s.id);
    return {
      ...s,
      ...(typeof o.title === "string" && o.title ? { title: o.title } : {}),
      ...(typeof o.description === "string" ? { description: o.description } : {}),
      ...(typeof o.enabled === "boolean" ? { enabled: o.enabled } : {}),
      ...(typeof o.autoStart === "boolean" ? { autoStart: o.autoStart } : {}),
      ...(Array.isArray(o.roles) ? { roles: [...o.roles] } : {}),
      ...(Array.isArray(o.steps) && o.steps.length > 0
        ? { steps: o.steps.map((st) => ({ ...st })) }
        : {}),
    };
  });

  // Scénarios ajoutés par override (inconnus des défauts) : exigés complets.
  for (const o of byId.values()) {
    const candidate = { enabled: true, ...o } as DemoScenario;
    if (validateDemoScenario(candidate).length === 0) {
      merged.push(cloneScenario(candidate));
    }
  }
  return merged;
}

/* ------------------------------------------------------------------ mount */

const CONTENT_PREFIX = "scenario:";

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

type Db = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown;
  };
};

/** Lit tous les overrides DB (lignes illisibles ignorées — jamais de throw). */
function readOverrides(db: Db): DemoScenarioOverride[] {
  try {
    const rows = db
      .prepare(
        `SELECT key, value_json FROM interactive_demo_content
         WHERE key LIKE ? ORDER BY key`,
      )
      .all(`${CONTENT_PREFIX}%`) as Array<{ key: string; value_json: string }>;
    const out: DemoScenarioOverride[] = [];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.value_json) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const id = r.key.slice(CONTENT_PREFIX.length);
          out.push({ ...(parsed as DemoScenarioOverride), id });
        }
      } catch {
        /* ligne illisible ignorée */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export type DemoPersistence = {
  overrides(): Promise<DemoScenarioOverride[]>;
  putOverride(id: string, value: DemoScenarioOverride): Promise<void>;
  removeOverride(id: string): Promise<void>;
  preferences(user: string): Promise<Record<string, unknown>>;
  putPreferences(user: string, answers: Record<string, unknown>): Promise<number>;
};

export type InteractiveDemoMountOptions = {
  persistence?: DemoPersistence;
  /** Défauts marque (fichier explicite `brand-interactive-demo-content.ts`). */
  defaults: DemoScenario[];
};

/**
 * Mount api-kernel `/api/v1/modules/interactive-demo/*` (dbLayer brand) :
 *
 * - `GET    scenarios`             → `{ ok, scenarios: merge(défauts, overrides), overrides: [ids] }`
 * - `GET    scenarios/:id`         → `{ ok, scenario }` (mergé) ou 404
 * - `PUT    scenarios/:id`         → stocke l'override (steps = remplacement), répond le scénario mergé
 * - `DELETE scenarios/:id`         → supprime l'override (retour aux défauts)
 * - `GET    preferences?user=<k>`  → `{ ok, user, answers }` (clés `seen:<scenarioId>`…)
 * - `PUT    preferences`           → `{ user, answers }` upsert par clé
 *
 * db absent → 503 `db_unavailable` ; body invalide → 400 (jamais de throw).
 */
export function createInteractiveDemoMount(
  opts: InteractiveDemoMountOptions,
): ApiMount {
  const defaults = opts.defaults;
  return {
    dbLayer: "brand",
    operations: [
      {
        id: "list-scenarios",
        method: "GET",
        path: "/scenarios",
        description: "Lister les scénarios de démo interactive",
      },
      {
        id: "get-scenario",
        method: "GET",
        path: "/scenarios/:id",
        description: "Lire un scénario de démo",
      },
      {
        id: "put-scenario",
        method: "PUT",
        path: "/scenarios/:id",
        description: "Écrire un override de scénario",
      },
      {
        id: "delete-scenario",
        method: "DELETE",
        path: "/scenarios/:id",
        description: "Supprimer un override de scénario",
      },
      {
        id: "get-preferences",
        method: "GET",
        path: "/preferences",
        description: "Lire les préférences démo d'un utilisateur",
      },
      {
        id: "put-preferences",
        method: "PUT",
        path: "/preferences",
        description: "Enregistrer les préférences démo",
      },
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db && !opts.persistence) {
        return { status: 503, body: { ok: false, error: "db_unavailable" } };
      }
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);
      const head = parts[0] || "";

      if (head === "scenarios" && parts.length === 1) {
        if (method === "GET") {
          const overrides = await (opts.persistence ? opts.persistence.overrides() : readOverrides(db as Db));
          return {
            status: 200,
            body: {
              ok: true,
              scenarios: mergeDemoScenarios(defaults, overrides),
              overrides: overrides.map((o) => o.id),
            },
          };
        }
        return { status: 405, body: { ok: false, error: "method_not_allowed" } };
      }

      if (head === "scenarios" && parts.length === 2) {
        const id = decodeURIComponent(parts[1]!);
        if (method === "GET") {
          const merged = mergeDemoScenarios(defaults, await (opts.persistence ? opts.persistence.overrides() : readOverrides(db as Db)));
          const scenario = merged.find((s) => s.id === id);
          if (!scenario) {
            return { status: 404, body: { ok: false, error: "not_found" } };
          }
          return { status: 200, body: { ok: true, scenario } };
        }
        if (method === "PUT") {
          const body = req.body;
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            return { status: 400, body: { ok: false, error: "invalid_body" } };
          }
          const override = { ...(body as DemoScenarioOverride), id };
          // Un scénario inconnu des défauts doit être complet et valide.
          const isKnown = defaults.some((s) => s.id === id);
          if (!isKnown) {
            const errors = validateDemoScenario({ enabled: true, ...override });
            if (errors.length > 0) {
              return {
                status: 400,
                body: { ok: false, error: "scenario_invalide", details: errors },
              };
            }
          } else if (Array.isArray(override.steps) || override.roles !== undefined) {
            const defaultScenario = defaults.find((s) => s.id === id)!;
            const errors = validateDemoScenario({
              ...defaultScenario,
              ...override,
            });
            if (errors.length > 0) {
              return {
                status: 400,
                body: { ok: false, error: "scenario_invalide", details: errors },
              };
            }
          }
          if (opts.persistence) await opts.persistence.putOverride(id, override);
          else (db as Db)
            .prepare(
              `INSERT INTO interactive_demo_content (key, value_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 value_json = excluded.value_json,
                 updated_at = excluded.updated_at`,
            )
            .run(`${CONTENT_PREFIX}${id}`, JSON.stringify(override), nowIso());
          const merged = mergeDemoScenarios(defaults, await (opts.persistence ? opts.persistence.overrides() : readOverrides(db as Db)));
          return {
            status: 200,
            body: {
              ok: true,
              scenario: merged.find((s) => s.id === id) ?? null,
              hasOverride: true,
            },
          };
        }
        if (method === "DELETE") {
          if (opts.persistence) await opts.persistence.removeOverride(id);
          else (db as Db)
            .prepare(`DELETE FROM interactive_demo_content WHERE key = ?`)
            .run(`${CONTENT_PREFIX}${id}`);
          const merged = mergeDemoScenarios(defaults, await (opts.persistence ? opts.persistence.overrides() : readOverrides(db as Db)));
          return {
            status: 200,
            body: {
              ok: true,
              scenario: merged.find((s) => s.id === id) ?? null,
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
          if (opts.persistence) return {status:200, body:{ok:true,user,answers:await opts.persistence.preferences(user)}};
          const rows = (db as Db)
            .prepare(
              `SELECT key, value_json FROM interactive_demo_preferences
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
          const body = (req.body || {}) as { user?: unknown; answers?: unknown };
          const user = String(body.user ?? "").trim();
          const answers = body.answers;
          if (!user || !answers || typeof answers !== "object" || Array.isArray(answers)) {
            return { status: 400, body: { ok: false, error: "invalid_body" } };
          }
          if (opts.persistence) return {status:200, body:{ok:true,user,saved:await opts.persistence.putPreferences(user, answers as Record<string, unknown>)}};
          const ts = nowIso();
          let saved = 0;
          for (const [key, value] of Object.entries(
            answers as Record<string, unknown>,
          )) {
            if (value === undefined) continue;
            (db as Db)
              .prepare(
                `INSERT INTO interactive_demo_preferences (id, user_key, key, value_json, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(user_key, key) DO UPDATE SET
                   value_json = excluded.value_json,
                   updated_at = excluded.updated_at`,
              )
              .run(newId(), user, key, JSON.stringify(value), ts);
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
