/**
 * @creezio/landing — moteur du module natif hybride « landing page ».
 *
 * Patron : docs/adr/ADR-module-natif-hybride.md.
 * - Tout le contenu (sections, textes, réfs médias, réglages) vit en DB
 *   brand (`landing_*`), seedé par des défauts marque — rien de hardcodé.
 * - Mount api-kernel `/api/v1/modules/landing/*` : lecture publique
 *   (`GET public`, `GET media…` via route Next) + CRUD d'édition (admin OS).
 * - Upload média : JSON base64 (l'adaptateur HTTP kernel ne parse pas le
 *   multipart) → fichier `{data}/uploads/landing/{id}.{ext}` ; le service
 *   binaire passe par une route Next thin (`createLandingMediaGET`).
 *
 * Zéro domaine marque ici (ADR-no-brand-domain-in-native-packages) : la
 * marque nomme/écrit son contenu via le seed + l'admin.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApiMount, ApiRequest } from "@creezio/api-kernel";
import type { SqliteMigration } from "@creezio/platform-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Kinds préfabriqués fournis par `@creezio/landing/ui` (surchargeables). */
export const LANDING_PREFAB_KINDS = [
  "hero",
  "features",
  "pricing",
  "cta",
  "footer",
] as const;
export type LandingPrefabKind = (typeof LANDING_PREFAB_KINDS)[number];

export type LandingSection = {
  id: string;
  /** Kind de rendu — préfabriqué kit ou kind custom marque (registry UI). */
  kind: string;
  position: number;
  enabled: boolean;
  /** Contenu libre du kind (textes, urls d'images `/lp-media/...`, listes). */
  content: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type LandingSettings = {
  /** Titre onglet / SEO. */
  title?: string;
  /** Nom affiché de la marque. */
  brandName?: string;
  tagline?: string;
  /** Couleur d'accent (hex). */
  accent?: string;
  /** Fond global (hex). */
  background?: string;
  /** Favicon / logo (url `/lp-media/...`). */
  logoUrl?: string;
  [k: string]: unknown;
};

export type LandingSeedSection = {
  kind: string;
  content: Record<string, unknown>;
  enabled?: boolean;
};

export type LandingSeed = {
  settings: LandingSettings;
  sections: LandingSeedSection[];
};

export type LandingMediaRow = {
  id: string;
  /** Nom de fichier stocké (`{id}.{ext}`) — sert d'URL `/lp-media/{file}`. */
  file: string;
  original_name: string;
  mime: string;
  size: number;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Seed par défaut (générique — la marque passe son brandName/tagline)
// ---------------------------------------------------------------------------

export function defaultLandingSeed(opts?: {
  brandName?: string;
  tagline?: string;
  accent?: string;
}): LandingSeed {
  const brandName = opts?.brandName || "Mon produit";
  const tagline =
    opts?.tagline || "La plateforme qui simplifie votre quotidien.";
  return {
    settings: {
      title: brandName,
      brandName,
      tagline,
      accent: opts?.accent || "#f0701d",
      background: "#14182f",
    },
    sections: [
      {
        kind: "hero",
        content: {
          title: brandName,
          subtitle: tagline,
          ctaLabel: "Demander une démo",
          ctaHref: "#contact",
          imageUrl: "",
        },
      },
      {
        kind: "features",
        content: {
          title: "Fonctionnalités",
          items: [
            {
              title: "Simple",
              text: "Prise en main immédiate, sans formation.",
            },
            {
              title: "Complet",
              text: "Tout votre métier au même endroit.",
            },
            {
              title: "Accompagné",
              text: "Un assistant IA qui travaille pour vous.",
            },
          ],
        },
      },
      {
        kind: "pricing",
        content: {
          title: "Tarifs",
          plans: [
            {
              name: "Essentiel",
              price: "49 € / mois",
              features: ["1 établissement", "Support e-mail"],
            },
            {
              name: "Pro",
              price: "99 € / mois",
              features: ["Multi-établissements", "Support prioritaire"],
            },
          ],
        },
      },
      {
        kind: "cta",
        content: {
          title: "Prêt à démarrer ?",
          text: "Contactez-nous pour une démonstration personnalisée.",
          ctaLabel: "Nous contacter",
          ctaHref: "#contact",
        },
      },
      {
        kind: "footer",
        content: {
          text: `© ${brandName}`,
          links: [],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Migrations (couche brand)
// ---------------------------------------------------------------------------

const LANDING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS landing_sections (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  content_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS landing_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS landing_media (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
`;

function sqlQuote(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

/** SQL de seed idempotent (INSERT OR IGNORE, ids stables par index). */
export function buildLandingSeedSql(seed: LandingSeed): string {
  const now = new Date().toISOString();
  const stmts: string[] = [];
  stmts.push(
    `INSERT OR IGNORE INTO landing_settings (key, value_json, updated_at) VALUES ('settings', ${sqlQuote(
      JSON.stringify(seed.settings),
    )}, ${sqlQuote(now)});`,
  );
  seed.sections.forEach((s, i) => {
    stmts.push(
      `INSERT OR IGNORE INTO landing_sections (id, kind, position, enabled, content_json, created_at, updated_at) VALUES (${sqlQuote(
        `seed-${i + 1}-${s.kind}`,
      )}, ${sqlQuote(s.kind)}, ${(i + 1) * 10}, ${s.enabled === false ? 0 : 1}, ${sqlQuote(
        JSON.stringify(s.content),
      )}, ${sqlQuote(now)}, ${sqlQuote(now)});`,
    );
  });
  return stmts.join("\n");
}

/**
 * Migrations du module — à composer dans `brand-migrations.ts` de l'app.
 * `seed` = défauts marque (défaut : `defaultLandingSeed()`), appliqué une
 * seule fois (migration) puis éditable via l'admin.
 */
export function landingMigrations(seed?: LandingSeed): SqliteMigration[] {
  return [
    { id: "landing_001_schema", sql: LANDING_SCHEMA_SQL },
    {
      id: "landing_002_seed_default",
      sql: buildLandingSeedSql(seed ?? defaultLandingSeed()),
    },
  ];
}

// ---------------------------------------------------------------------------
// Médias — répertoire + service binaire (route Next thin)
// ---------------------------------------------------------------------------

const MEDIA_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
};

export function resolveLandingMediaDir(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env.CREEZIO_LANDING_MEDIA_DIR;
  if (env) return env;
  const dataDir = process.env.METIER_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "uploads", "landing");
}

function safeMediaFileName(raw: string): string | null {
  const name = path.basename(String(raw || ""));
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name)) return null;
  if (name.includes("..")) return null;
  return name;
}

/**
 * Handler GET compatible route App Router Next (`app/lp-media/[file]/route.ts`) :
 *
 *   import { createLandingMediaGET } from "@creezio/landing";
 *   export const GET = createLandingMediaGET();
 *
 * Aucune DB requise : le nom de fichier stocké est auto-descriptif
 * (`{id}.{ext}`), sanitizé contre la traversée de chemin.
 */
export function createLandingMediaGET(opts?: { mediaDir?: string }) {
  return async (
    _req: unknown,
    ctx: { params: { file: string } | Promise<{ file: string }> },
  ): Promise<Response> => {
    const params = await Promise.resolve(ctx.params);
    const file = safeMediaFileName(params?.file || "");
    if (!file) return new Response("bad request", { status: 400 });
    const dir = resolveLandingMediaDir(opts?.mediaDir);
    const abs = path.join(dir, file);
    if (!abs.startsWith(path.resolve(dir))) {
      return new Response("bad request", { status: 400 });
    }
    let buf: Buffer;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      return new Response("not found", { status: 404 });
    }
    const ext = file.split(".").pop()?.toLowerCase() || "";
    const mime = MEDIA_EXT_MIME[ext] || "application/octet-stream";
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "content-type": mime,
        "cache-control": "public, max-age=60",
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Mount api-kernel — /api/v1/modules/landing/*
// ---------------------------------------------------------------------------

const DEFAULT_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

function now(): string {
  return new Date().toISOString();
}

function parseContent(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowToSection(r: Record<string, unknown>): LandingSection {
  return {
    id: String(r.id),
    kind: String(r.kind),
    position: Number(r.position) || 0,
    enabled: Boolean(Number(r.enabled)),
    content: parseContent(r.content_json),
    created_at: String(r.created_at || ""),
    updated_at: String(r.updated_at || ""),
  };
}

function qstr(req: ApiRequest, key: string): string {
  const v = req.query?.[key];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return v == null ? "" : String(v);
}

export type CreateLandingMountOptions = {
  /** Répertoire des médias (défaut : `{METIER_DATA_DIR}/uploads/landing`). */
  mediaDir?: string;
  /** Taille max upload base64 décodé (défaut 8 Mo). */
  maxUploadBytes?: number;
  /**
   * Permission requise pour l'ÉDITION (settings, sections, media, kinds) —
   * gardée par `authorizeModuleAccess` (owner bypass). `GET public` reste
   * toujours sans permission (page publique, allowlist bordure). Opt-in :
   * sans cette option, comportement historique inchangé (garde session de
   * bordure seule) — les apps admin passent `nav.landing`.
   */
  permission?: string;
};

/**
 * Mount du module landing — enregistrer côté app :
 *
 *   api.registerModuleApi("landing", createLandingMount());
 *   // app admin (permission par module) :
 *   api.registerModuleApi("landing", createLandingMount({ permission: "nav.landing" }));
 *
 * Lecture publique : `GET public` (la page rendue est publique).
 * Édition : posture ADR-admin-app-os (app admin derrière auth OS /
 * isolation réseau) — + permission opt-in par module (apps admin).
 */
export function createLandingMount(
  opts?: CreateLandingMountOptions,
): ApiMount {
  const maxUpload = opts?.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const perm = opts?.permission;
  const editOp = (op: {
    id: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    description: string;
  }) => ({ ...op, ...(perm ? { permission: perm } : {}) });
  return {
    dbLayer: "brand",
    // `GET public` volontairement SANS permission (rendu lp.{zone} anonyme,
    // allowlist bordure) — l'édition est gardée op par op si `permission`.
    accessJustification:
      "GET public = page publique anonyme (allowlist bordure) — édition gardée op par op via l'option permission (apps admin)",
    operations: [
      { id: "public", method: "GET", path: "/public", description: "Contenu landing public" },
      editOp({ id: "get-settings", method: "GET", path: "/settings", description: "Lire les settings landing" }),
      editOp({ id: "put-settings", method: "PUT", path: "/settings", description: "Mettre à jour les settings" }),
      editOp({ id: "list-sections", method: "GET", path: "/sections", description: "Lister les sections" }),
      editOp({ id: "create-section", method: "POST", path: "/sections", description: "Créer une section" }),
      editOp({ id: "reorder-sections", method: "POST", path: "/sections/reorder", description: "Réordonner les sections" }),
      editOp({ id: "get-section", method: "GET", path: "/sections/:id", description: "Lire une section" }),
      editOp({ id: "update-section", method: "PATCH", path: "/sections/:id", description: "Mettre à jour une section" }),
      editOp({ id: "delete-section", method: "DELETE", path: "/sections/:id", description: "Supprimer une section" }),
      editOp({ id: "list-media", method: "GET", path: "/media", description: "Lister les médias" }),
      editOp({ id: "upload-media", method: "POST", path: "/media", description: "Uploader un média" }),
      editOp({ id: "delete-media", method: "DELETE", path: "/media/:id", description: "Supprimer un média" }),
      editOp({ id: "kinds", method: "GET", path: "/kinds", description: "Kinds de sections préfabriqués" }),
    ],
    handle: async ({ req, subPath, db }) => {
      if (!db) return { status: 503, body: { ok: false, error: "db_unavailable" } };
      const method = req.method.toUpperCase();
      const parts = subPath.split("/").filter(Boolean);
      const body = (req.body || {}) as Record<string, unknown>;

      // ---- lecture publique : settings + sections activées ordonnées ----
      if (parts[0] === "public" && method === "GET") {
        const settingsRow = db
          .prepare(`SELECT value_json FROM landing_settings WHERE key = 'settings'`)
          .get() as { value_json?: string } | undefined;
        const sections = (
          db
            .prepare(
              `SELECT * FROM landing_sections WHERE enabled = 1 ORDER BY position ASC, created_at ASC`,
            )
            .all() as Array<Record<string, unknown>>
        ).map(rowToSection);
        return {
          status: 200,
          body: {
            ok: true,
            settings: parseContent(settingsRow?.value_json) as LandingSettings,
            sections,
          },
        };
      }

      // ---- settings ----
      if (parts[0] === "settings") {
        if (method === "GET") {
          const row = db
            .prepare(`SELECT value_json FROM landing_settings WHERE key = 'settings'`)
            .get() as { value_json?: string } | undefined;
          return {
            status: 200,
            body: { ok: true, settings: parseContent(row?.value_json) },
          };
        }
        if (method === "PUT") {
          const row = db
            .prepare(`SELECT value_json FROM landing_settings WHERE key = 'settings'`)
            .get() as { value_json?: string } | undefined;
          const next = { ...parseContent(row?.value_json), ...body };
          db.prepare(
            `INSERT INTO landing_settings (key, value_json, updated_at) VALUES ('settings', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ).run(JSON.stringify(next), now());
          return { status: 200, body: { ok: true, settings: next } };
        }
      }

      // ---- sections ----
      if (parts[0] === "sections") {
        if (parts.length === 1 && method === "GET") {
          const rows = (
            db
              .prepare(
                `SELECT * FROM landing_sections ORDER BY position ASC, created_at ASC`,
              )
              .all() as Array<Record<string, unknown>>
          ).map(rowToSection);
          return { status: 200, body: { ok: true, sections: rows } };
        }
        if (parts.length === 1 && method === "POST") {
          const kind = String(body.kind || "").trim();
          if (!kind) return { status: 400, body: { ok: false, error: "kind_required" } };
          const id = String(body.id || randomUUID());
          const maxPos = (
            db
              .prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM landing_sections`)
              .get() as { m: number }
          ).m;
          db.prepare(
            `INSERT INTO landing_sections (id, kind, position, enabled, content_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            kind,
            Number(body.position ?? maxPos + 10),
            body.enabled === false ? 0 : 1,
            JSON.stringify(body.content && typeof body.content === "object" ? body.content : {}),
            now(),
            now(),
          );
          const row = db
            .prepare(`SELECT * FROM landing_sections WHERE id = ?`)
            .get(id) as Record<string, unknown>;
          return { status: 201, body: { ok: true, section: rowToSection(row) } };
        }
        if (parts.length === 2 && parts[1] === "reorder" && method === "POST") {
          const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : [];
          if (!ids.length) return { status: 400, body: { ok: false, error: "ids_required" } };
          ids.forEach((id, i) => {
            db.prepare(
              `UPDATE landing_sections SET position = ?, updated_at = ? WHERE id = ?`,
            ).run((i + 1) * 10, now(), id);
          });
          return { status: 200, body: { ok: true } };
        }
        if (parts.length === 2) {
          const id = parts[1]!;
          const existing = db
            .prepare(`SELECT * FROM landing_sections WHERE id = ?`)
            .get(id) as Record<string, unknown> | undefined;
          if (method === "GET") {
            if (!existing) return { status: 404, body: { ok: false, error: "not_found" } };
            return { status: 200, body: { ok: true, section: rowToSection(existing) } };
          }
          if (method === "PUT" || method === "PATCH") {
            if (!existing) return { status: 404, body: { ok: false, error: "not_found" } };
            const cur = rowToSection(existing);
            const nextContent =
              body.content && typeof body.content === "object"
                ? (body.content as Record<string, unknown>)
                : cur.content;
            db.prepare(
              `UPDATE landing_sections SET kind = ?, position = ?, enabled = ?, content_json = ?, updated_at = ? WHERE id = ?`,
            ).run(
              String(body.kind ?? cur.kind),
              Number(body.position ?? cur.position),
              (body.enabled === undefined ? cur.enabled : Boolean(body.enabled)) ? 1 : 0,
              JSON.stringify(nextContent),
              now(),
              id,
            );
            const row = db
              .prepare(`SELECT * FROM landing_sections WHERE id = ?`)
              .get(id) as Record<string, unknown>;
            return { status: 200, body: { ok: true, section: rowToSection(row) } };
          }
          if (method === "DELETE") {
            if (!existing) return { status: 404, body: { ok: false, error: "not_found" } };
            db.prepare(`DELETE FROM landing_sections WHERE id = ?`).run(id);
            return { status: 200, body: { ok: true } };
          }
        }
      }

      // ---- médias (upload JSON base64, service binaire via route Next) ----
      if (parts[0] === "media") {
        if (parts.length === 1 && method === "GET") {
          const rows = db
            .prepare(`SELECT * FROM landing_media ORDER BY created_at DESC`)
            .all() as LandingMediaRow[];
          return {
            status: 200,
            body: {
              ok: true,
              items: rows.map((r) => ({ ...r, url: `/lp-media/${r.file}` })),
            },
          };
        }
        if (parts.length === 1 && method === "POST") {
          const originalName = String(body.filename || "image.png");
          const ext = (originalName.split(".").pop() || "").toLowerCase();
          if (!MEDIA_EXT_MIME[ext]) {
            return {
              status: 400,
              body: {
                ok: false,
                error: "unsupported_media_type",
                allowed: Object.keys(MEDIA_EXT_MIME),
              },
            };
          }
          const b64 = String(body.dataBase64 || "").replace(
            /^data:[^;]+;base64,/,
            "",
          );
          if (!b64) return { status: 400, body: { ok: false, error: "data_required" } };
          let buf: Buffer;
          try {
            buf = Buffer.from(b64, "base64");
          } catch {
            return { status: 400, body: { ok: false, error: "invalid_base64" } };
          }
          if (!buf.length || buf.length > maxUpload) {
            return {
              status: 400,
              body: { ok: false, error: "size_out_of_bounds", maxBytes: maxUpload },
            };
          }
          const id = randomUUID();
          const file = `${id}.${ext}`;
          const dir = resolveLandingMediaDir(opts?.mediaDir);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, file), buf);
          db.prepare(
            `INSERT INTO landing_media (id, file, original_name, mime, size, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(id, file, originalName, MEDIA_EXT_MIME[ext]!, buf.length, now());
          return {
            status: 201,
            body: { ok: true, id, file, url: `/lp-media/${file}`, size: buf.length },
          };
        }
        if (parts.length === 2 && method === "DELETE") {
          const id = parts[1]!;
          const row = db
            .prepare(`SELECT * FROM landing_media WHERE id = ?`)
            .get(id) as LandingMediaRow | undefined;
          if (!row) return { status: 404, body: { ok: false, error: "not_found" } };
          db.prepare(`DELETE FROM landing_media WHERE id = ?`).run(id);
          try {
            fs.unlinkSync(path.join(resolveLandingMediaDir(opts?.mediaDir), row.file));
          } catch {
            /* best-effort */
          }
          return { status: 200, body: { ok: true } };
        }
      }

      // ---- kinds préfabriqués (pour le sélecteur d'ajout côté admin) ----
      if (parts[0] === "kinds" && method === "GET") {
        void qstr(req, "");
        return { status: 200, body: { ok: true, kinds: [...LANDING_PREFAB_KINDS] } };
      }

      return { status: 404, body: { ok: false, error: "not_found", subPath } };
    },
  };
}
