/**
 * Routes Hono Product Hub `/plugin-products` — SoT kit.
 * Auth outer (session/API key) reste côté marque au montage.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  actorIsPluginAdmin,
  decidePluginAccess,
  filterVisiblePluginIds as kitFilterVisiblePluginIds,
  type PluginAclActor,
} from "../acl.js";
import {
  containsReplacementChar,
  missingPrdSections,
} from "../prd.js";
import {
  PLUGIN_LIFECYCLE_STATES,
  PLUGIN_TASK_STATUSES,
} from "../lifecycle.js";
import type { ProductHubHost } from "../host-api.js";
import type { SqliteProductHubStore } from "../store/sqlite-store.js";
import type { SqliteDatabase, SqliteStatement } from "../store/sqlite-driver.js";
import type { PluginN8nProvisioning } from "../n8n-provisioning.js";

export type PluginProductsSession = { sub: string };

export type PluginProductsReadonlyDb = {
  prepare(sql: string): SqliteStatement;
  pragma?: (pragma: string) => unknown;
  close: () => void;
};

export type HermesCreateTaskInput = {
  title: string;
  body: string;
  status: string;
  priority: number;
  idempotencyKey: string;
  skills: string[];
  signal: AbortSignal;
};

export type PluginProductsRouteDeps = {
  host: ProductHubHost;
  /** Store SQLite Product Hub (linkRuntime / archive / ACL / prepare). */
  store: () => SqliteProductHubStore;
  /** Acteur ACL kit (session / clé API). */
  getActor: (c: Context) => Promise<PluginAclActor> | PluginAclActor;
  /** Session utilisateur (null = clé API / anonyme). */
  getSession: (
    c: Context,
  ) => Promise<PluginProductsSession | null> | PluginProductsSession | null;
  /** Répertoire plugins runtime. */
  pluginsDir: () => string;
  /** Racine documents Product Hub. */
  documentsDir: () => string;
  /** Contexte Hermes optionnel (copie docs contextEnabled). */
  hermesContextDir?: () => string | null;
  /** Hint URL API dans messages d'erreur (ex. `$CRM_API_URL`). */
  apiUrlEnvHint?: string;
  /** Module n8n provisioning (createPluginN8nProvisioning). */
  n8n: Pick<
    PluginN8nProvisioning,
    | "pluginN8nTag"
    | "provisionPluginN8nIdentity"
    | "getPluginN8nSnapshot"
    | "createPluginN8nWorkflow"
  >;
  /** Sync tâche → Hermes (injectable ; pas d'import marque). */
  hermesCreateTask?: (
    input: HermesCreateTaskInput,
  ) => Promise<{ id: string }>;
  hermesSkills?: string[];
  /** Ouvre la DB plugin en lecture seule (better-sqlite3 côté marque). */
  openReadonlyPluginDb?: (dbPath: string) => PluginProductsReadonlyDb;
  /** Org propriétaire défaut pour auto-grant créateur. */
  defaultOwnerOrgId?: string;
};

const ENCODING_HINT =
  "Payload corrompu (caractères U+FFFD — encodage cassé, souvent cp1252 dans le terminal). " +
  "Écrire le JSON dans un fichier encodé UTF-8 puis l'envoyer avec " +
  "curl --data-binary @fichier.json (jamais -d '{…}' inline avec des accents).";

const PrdSectionsSchema = z.object({
  data_inputs: z
    .array(
      z.object({
        data: z.string().min(1).max(500),
        sourceEndpoint: z.string().min(1).max(500),
      }),
    )
    .default([]),
  data_outputs: z
    .array(
      z.object({
        data: z.string().min(1).max(500),
        destination: z.string().min(1).max(500),
      }),
    )
    .default([]),
  db_schema: z
    .array(
      z.object({
        table: z.string().min(1).max(120),
        columns: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              type: z.string().max(60).optional(),
              description: z.string().max(500).optional(),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
  user_stories: z.array(z.string().min(1).max(1000)).default([]),
  screens: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        kind: z.enum(["single", "tab"]),
        description: z.string().min(1).max(2000),
      }),
    )
    .default([]),
  wireframes: z
    .array(
      z.object({
        screen: z.string().min(1).max(200),
        ascii: z.string().min(1).max(20000),
      }),
    )
    .default([]),
});

const ClarificationQuestionsSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(80),
      label: z.string().min(1).max(1000),
      type: z.enum(["choice", "multi", "text"]),
      options: z.array(z.string().min(1).max(300)).max(20).optional(),
      allowOther: z.boolean().optional(),
    }),
  )
  .min(1)
  .max(12);

function canSee(
  store: SqliteProductHubStore,
  pluginId: string,
  actor: PluginAclActor,
): boolean {
  return decidePluginAccess(store.getAclPolicy(pluginId), actor, "see").allow;
}

function autoGrantCreator(
  store: SqliteProductHubStore,
  productId: string,
  actor: PluginAclActor,
  defaultOwnerOrgId?: string,
): void {
  if (actorIsPluginAdmin(actor)) return;
  const creatorId = actor.userId || null;
  if (!creatorId) return;
  const previous = store.getAcl(productId);
  const userIds = Array.from(new Set([...previous.userIds, creatorId]));
  store.upsertAcl({
    pluginId: productId,
    userIds,
    orgIds: previous.orgIds,
    ownerOrgId: previous.ownerOrgId ?? defaultOwnerOrgId ?? null,
    ...(previous.capabilities?.length
      ? { capabilities: previous.capabilities }
      : {}),
  });
}

/**
 * Factory Hono — monter avec `api.route("/plugin-products", routes)`.
 */
export function createPluginProductsRoutes(
  deps: PluginProductsRouteDeps,
): Hono {
  const {
    host,
    store: requireStore,
    getActor,
    getSession,
    pluginsDir,
    documentsDir,
    n8n,
  } = deps;
  const apiHint = deps.apiUrlEnvHint ?? "$API_URL";
  const hermesSkills = deps.hermesSkills ?? ["plugins"];
  const app = new Hono();

  function hubDb(): Pick<SqliteDatabase, "prepare"> {
    return requireStore();
  }

  function documentsRoot(productId: string): string {
    const dir = path.join(documentsDir(), productId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function pluginDataPath(productId: string): string {
    const product = host.getPluginProduct(productId);
    const pluginId = product?.plugin_id || "";
    if (!/^[a-z][a-z0-9-]{1,62}$/.test(pluginId)) {
      throw new Error("Runtime plugin non lié");
    }
    const root = String(pluginsDir() || "").trim();
    if (!root) throw new Error("pluginsDir non configuré");
    const resolvedRoot = path.resolve(root);
    const databasePath = path.resolve(
      resolvedRoot,
      pluginId,
      "data",
      "plugin.sqlite",
    );
    if (
      !databasePath.startsWith(`${resolvedRoot}${path.sep}`) ||
      !fs.existsSync(databasePath)
    ) {
      throw new Error("Base plugin introuvable");
    }
    return databasePath;
  }

  // IMPORTANT : /visible AVANT les gardes /:id
  app.get("/visible", async (c) => {
    const actor = await getActor(c);
    if (actorIsPluginAdmin(actor)) return c.json({ plugin_ids: null });
    const products = host.listPluginProducts();
    const policies = requireStore().listAclPolicies();
    return c.json({
      plugin_ids: kitFilterVisiblePluginIds(
        products.map((p) => p.id),
        policies,
        actor,
      ),
    });
  });

  app.use("/:id", async (c, next) => {
    const id = c.req.param("id");
    if (id && !canSee(requireStore(), id, await getActor(c))) {
      return c.json({ error: "Produit plugin introuvable" }, 404);
    }
    await next();
  });
  app.use("/:id/*", async (c, next) => {
    const id = c.req.param("id");
    if (id && !canSee(requireStore(), id, await getActor(c))) {
      return c.json({ error: "Produit plugin introuvable" }, 404);
    }
    await next();
  });

  app.get("/", async (c) => {
    const actor = await getActor(c);
    const products = host.listPluginProducts();
    const policies = requireStore().listAclPolicies();
    const visible = new Set(
      kitFilterVisiblePluginIds(
        products.map((p) => p.id),
        policies,
        actor,
      ),
    );
    return c.json({ products: products.filter((p) => visible.has(p.id)) });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(160),
        description: z.string().max(8000).optional(),
        conversationId: z.string().min(3).max(200).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Demande invalide", details: parsed.error.issues },
        400,
      );
    }
    try {
      const created = host.createPluginRequest(parsed.data);
      try {
        autoGrantCreator(
          requireStore(),
          created.product.id,
          await getActor(c),
          deps.defaultOwnerOrgId,
        );
      } catch (e) {
        console.warn("[plugin-acl] auto-grant créateur impossible:", e);
      }
      let n8nProvisioning:
        | { ok: true; mode: string; tag: string; tagId: string }
        | { ok: false; mode: "tag-registry"; tag: string; error: string };
      try {
        const identity = await n8n.provisionPluginN8nIdentity(
          created.product.id,
        );
        n8nProvisioning = { ok: true, ...identity };
      } catch (error) {
        n8nProvisioning = {
          ok: false,
          mode: "tag-registry",
          tag: n8n.pluginN8nTag(created.product.id),
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return c.json({ ...created, n8nProvisioning }, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  app.get("/:id", (c) => {
    const details = host.pluginProductDetails(c.req.param("id"));
    return details
      ? c.json(details)
      : c.json({ error: "Produit plugin introuvable" }, 404);
  });

  app.post("/:id/transition", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ state: z.enum(PLUGIN_LIFECYCLE_STATES) })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "État invalide" }, 400);
    const productId = c.req.param("id");
    const product = host.getPluginProduct(productId);
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    if (
      parsed.data.state === "automated_testing" &&
      product.lifecycle_state === "executing" &&
      host.countDonePluginTasks(productId) === 0
    ) {
      return c.json(
        {
          error:
            "Aucune tâche terminée — la phase de tests exige au moins une tâche « done »",
          hint:
            "Marquer le travail réellement livré avant de tester : " +
            `PATCH ${apiHint}/api/v1/plugin-products/${productId}/tasks/<taskId> ` +
            '-d \'{"status":"done"}\'. Les tâches viennent des user stories du PRD validé ' +
            `(GET …/plugin-products/${productId} → tasks).`,
        },
        409,
      );
    }
    if (
      parsed.data.state === "awaiting_human_qa" &&
      product.lifecycle_state === "automated_testing" &&
      !host.hasPassedPluginTestRun(productId)
    ) {
      return c.json(
        {
          error:
            "Aucun test automatique réussi — la QA humaine exige au moins un run « passed »",
          hint:
            "Exécuter les tests du plugin puis historiser le résultat : " +
            `POST ${apiHint}/api/v1/plugin-products/${productId}/test-runs ` +
            '-d \'{"ok":true,"exitCode":0,"stdout":"…","stderr":""}\'. ' +
            "Un run ok=true en automated_testing transitionne automatiquement vers awaiting_human_qa.",
        },
        409,
      );
    }
    try {
      return c.json({
        product: host.transitionPluginProduct(productId, parsed.data.state),
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });

  app.post("/:id/prd", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        problem: z.string().min(1).max(10000),
        users: z.string().max(10000).default(""),
        scope: z.string().min(1).max(20000),
        outOfScope: z.string().max(10000).optional(),
        acceptanceCriteria: z.string().min(1).max(20000),
        sections: PrdSectionsSchema.optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "PRD invalide", details: parsed.error.issues },
        400,
      );
    }
    if (containsReplacementChar(parsed.data)) {
      return c.json(
        { error: "PRD corrompu (U+FFFD détecté)", hint: ENCODING_HINT },
        400,
      );
    }
    const productId = c.req.param("id");
    const product = host.getPluginProduct(productId);
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    const missing = missingPrdSections(parsed.data.sections || {});
    if (missing.length) {
      if (
        product.lifecycle_state === "impact_analysis" ||
        product.lifecycle_state === "prd_draft"
      ) {
        host.transitionPluginProduct(productId, "clarification_required");
      }
      return c.json(
        {
          error: `PRD incomplet — sections manquantes : ${missing.join(", ")}`,
          missingSections: missing,
          hint:
            "Compléter l'interview avant de déposer le PRD : poser un round de questions via " +
            `POST ${apiHint}/api/v1/plugin-products/${productId}/clarifications ` +
            "(questions choice/multi/text), attendre les réponses de l'utilisateur, puis redéposer " +
            "le PRD avec TOUTES les sections (data_inputs, data_outputs, db_schema, user_stories, " +
            "screens, wireframes) remplies.",
        },
        409,
      );
    }
    try {
      const revision = host.savePluginPrd({ productId, ...parsed.data });
      const current = host.getPluginProduct(productId);
      if (
        current?.lifecycle_state === "impact_analysis" ||
        current?.lifecycle_state === "clarification_required"
      ) {
        host.transitionPluginProduct(productId, "prd_draft");
        host.transitionPluginProduct(productId, "awaiting_prd_approval");
      } else if (current?.lifecycle_state === "prd_draft") {
        host.transitionPluginProduct(productId, "awaiting_prd_approval");
      }
      return c.json(
        { revision, product: host.getPluginProduct(productId) },
        201,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });

  app.post("/:id/clarifications", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ questions: ClarificationQuestionsSchema })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Questions invalides", details: parsed.error.issues },
        400,
      );
    }
    if (containsReplacementChar(parsed.data)) {
      return c.json(
        { error: "Questions corrompues (U+FFFD détecté)", hint: ENCODING_HINT },
        400,
      );
    }
    try {
      const clarification = host.createPluginClarification({
        productId: c.req.param("id"),
        questions: parsed.data.questions,
      });
      return c.json(
        {
          clarification,
          product: host.getPluginProduct(c.req.param("id")),
          hint:
            "Round déposé — les réponses arrivent via la carte de cadrage du chat. " +
            "Attendre le message « Réponses au cadrage » avant de poursuivre.",
        },
        201,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  app.post("/:id/clarifications/:clarificationId/answers", async (c) => {
    const session = await getSession(c);
    if (!session) {
      return c.json(
        {
          error:
            "Réponses au cadrage : session utilisateur requise (pas de clé API)",
        },
        403,
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        answers: z.record(
          z.string().min(1).max(80),
          z.union([
            z.string().max(4000),
            z.array(z.string().max(1000)).max(30),
          ]),
        ),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Réponses invalides", details: parsed.error.issues },
        400,
      );
    }
    try {
      const clarification = host.answerPluginClarification({
        productId: c.req.param("id"),
        clarificationId: c.req.param("clarificationId"),
        answers: parsed.data.answers,
      });
      return c.json({ clarification });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });

  app.post("/:id/prd/:revisionId/approve", async (c) => {
    const session = await getSession(c);
    if (!session) return c.json({ error: "Non authentifié" }, 401);
    try {
      const revision = host.validatePluginPrd({
        productId: c.req.param("id"),
        revisionId: c.req.param("revisionId"),
        userId: session.sub,
      });
      return c.json({
        ok: true,
        revision,
        product: host.getPluginProduct(c.req.param("id")),
        grantRequest: {
          productId: c.req.param("id"),
          prdRevisionId: c.req.param("revisionId"),
          ttlSeconds: 600,
        },
        hint: "Le desktop peut maintenant émettre un execution_grant court.",
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });

  app.post("/:id/tasks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        title: z.string().min(1).max(300),
        body: z.string().max(8000).optional(),
        status: z.enum(PLUGIN_TASK_STATUSES).optional(),
        priority: z.number().int().min(-100).max(100).optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Tâche invalide" }, 400);
    try {
      return c.json(
        {
          task: host.createPluginTask({
            productId: c.req.param("id"),
            ...parsed.data,
          }),
        },
        201,
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        400,
      );
    }
  });

  app.patch("/:id/tasks/:taskId", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        status: z.enum(PLUGIN_TASK_STATUSES).optional(),
        blocked: z.boolean().optional(),
        blockedReason: z.string().max(2000).nullable().optional(),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Mise à jour invalide" }, 400);
    try {
      return c.json({
        task: host.updatePluginTask(
          c.req.param("id"),
          c.req.param("taskId"),
          parsed.data,
        ),
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        409,
      );
    }
  });

  app.post("/:id/tasks/:taskId/sync-hermes", async (c) => {
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    const details = host.pluginProductDetails(product.id);
    const task = (
      details?.tasks as Array<Record<string, unknown>> | undefined
    )?.find((row) => row.id === c.req.param("taskId"));
    if (!task) return c.json({ error: "Tâche introuvable" }, 404);
    if (task.status !== "ready") {
      return c.json(
        { error: "Seules les tâches « Prêt » sont synchronisables" },
        409,
      );
    }
    if (task.hermes_task_id) {
      return c.json({ ok: true, task, alreadySynced: true });
    }
    if (!deps.hermesCreateTask) {
      return c.json(
        { error: "Hermes sync non configuré", retryable: false },
        501,
      );
    }
    try {
      const hermes = await deps.hermesCreateTask({
        title: `[${product.name}] ${String(task.title)}`,
        body: `${String(task.body || "")}\n\nProduct Hub: ${product.id}`,
        status: "ready",
        priority: Number(task.priority || 0),
        idempotencyKey: `plugin-task:${task.id}`,
        skills: hermesSkills,
        signal: AbortSignal.timeout(5000),
      });
      const updated = host.updatePluginTask(product.id, String(task.id), {
        hermesTaskId: hermes.id,
      });
      return c.json({ ok: true, task: updated, hermes });
    } catch (error) {
      const runId = crypto.randomUUID();
      hubDb()
        .prepare(
          `INSERT INTO plugin_gate_runs
         (id, plugin_product_id, gate, status, details_json, finished_at)
         VALUES (?, ?, 'hermes_sync', 'failed', ?, datetime('now'))`,
        )
        .run(
          runId,
          product.id,
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return c.json(
        {
          error: "Hermes indisponible, tâche conservée dans le Product Hub",
          retryable: true,
        },
        503,
      );
    }
  });

  app.patch("/:id/runtime-link", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ pluginId: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/) })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "pluginId invalide" }, 400);
    requireStore().linkRuntime(c.req.param("id"), parsed.data.pluginId);
    return c.json({ product: host.getPluginProduct(c.req.param("id")) });
  });

  app.post("/:id/documents", async (c) => {
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    const body = await c.req.parseBody({ all: true }).catch(() => null);
    const upload = body?.file;
    if (!(upload instanceof File)) {
      return c.json({ error: "Fichier multipart requis" }, 400);
    }
    if (upload.size > 20 * 1024 * 1024) {
      return c.json({ error: "Fichier limité à 20 Mo" }, 413);
    }
    const filename =
      upload.name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 180) ||
      "document";
    const documentId = crypto.randomUUID();
    const bytes = Buffer.from(await upload.arrayBuffer());
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const storagePath = path.join(
      documentsRoot(product.id),
      `${documentId}-${filename}`,
    );
    fs.writeFileSync(storagePath, bytes, { mode: 0o600 });
    const contextEnabled = String(body?.contextEnabled || "") === "true";
    hubDb()
      .prepare(
        `INSERT INTO plugin_documents
       (id, plugin_product_id, filename, media_type, storage_path, sha256, size_bytes, context_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        documentId,
        product.id,
        filename,
        upload.type || "application/octet-stream",
        storagePath,
        sha256,
        bytes.length,
        contextEnabled ? 1 : 0,
      );
    const hermesDir = deps.hermesContextDir?.() || null;
    if (contextEnabled && hermesDir) {
      const contextDir = path.join(hermesDir, "plugins", product.id);
      fs.mkdirSync(contextDir, { recursive: true });
      fs.copyFileSync(
        storagePath,
        path.join(contextDir, `${documentId}-${filename}`),
      );
    }
    return c.json(
      {
        document: hubDb()
          .prepare(`SELECT * FROM plugin_documents WHERE id=?`)
          .get(documentId),
      },
      201,
    );
  });

  app.get("/:id/documents/:documentId/content", (c) => {
    const document = hubDb()
      .prepare(
        `SELECT * FROM plugin_documents WHERE id=? AND plugin_product_id=?`,
      )
      .get(c.req.param("documentId"), c.req.param("id")) as
      | { storage_path: string; media_type: string; filename: string }
      | undefined;
    if (!document || !fs.existsSync(document.storage_path)) {
      return c.json({ error: "Document introuvable" }, 404);
    }
    c.header("Content-Type", document.media_type);
    c.header(
      "Content-Disposition",
      `inline; filename="${document.filename.replaceAll('"', "")}"`,
    );
    return c.body(fs.readFileSync(document.storage_path));
  });

  app.delete("/:id/documents/:documentId", (c) => {
    const document = hubDb()
      .prepare(
        `SELECT storage_path FROM plugin_documents WHERE id=? AND plugin_product_id=?`,
      )
      .get(c.req.param("documentId"), c.req.param("id")) as
      | { storage_path: string }
      | undefined;
    if (!document) return c.json({ error: "Document introuvable" }, 404);
    fs.rmSync(document.storage_path, { force: true });
    hubDb()
      .prepare(`DELETE FROM plugin_documents WHERE id=?`)
      .run(c.req.param("documentId"));
    return c.json({ ok: true });
  });

  app.post("/:id/test-runs", async (c) => {
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        ok: z.boolean(),
        gitSha: z.string().max(80).nullable().optional(),
        exitCode: z.number().int().nullable(),
        stdout: z.string().max(256000),
        stderr: z.string().max(256000),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Résultat de test invalide" }, 400);
    }
    const runId = crypto.randomUUID();
    hubDb()
      .prepare(
        `INSERT INTO plugin_test_runs
       (id, plugin_product_id, status, git_sha, exit_code, stdout, stderr, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        runId,
        product.id,
        parsed.data.ok ? "passed" : "failed",
        parsed.data.gitSha || null,
        parsed.data.exitCode,
        parsed.data.stdout,
        parsed.data.stderr,
      );
    if (parsed.data.ok && product.lifecycle_state === "automated_testing") {
      host.transitionPluginProduct(product.id, "awaiting_human_qa");
    }
    return c.json(
      {
        run: hubDb()
          .prepare(`SELECT * FROM plugin_test_runs WHERE id=?`)
          .get(runId),
      },
      201,
    );
  });

  app.post("/:id/human-qa", async (c) => {
    const session = await getSession(c);
    if (!session) {
      return c.json(
        { error: "QA humaine : session utilisateur requise (pas de clé API)" },
        403,
      );
    }
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    if (product.lifecycle_state !== "awaiting_human_qa") {
      return c.json({ error: "Le produit n’attend pas une QA humaine" }, 409);
    }
    const body = await c.req.json().catch(() => ({}));
    const approved = Boolean((body as { approved?: boolean }).approved);
    if (!approved) {
      return c.json({
        product: host.transitionPluginProduct(product.id, "executing"),
        approved: false,
      });
    }
    const released = host.transitionPluginProduct(product.id, "released");
    const delivered = hubDb()
      .prepare(
        `SELECT title FROM plugin_tasks WHERE plugin_product_id=? AND status='done'
       ORDER BY updated_at`,
      )
      .all(product.id) as Array<{ title: string }>;
    const version = String(
      (body as { version?: string }).version ||
        new Date().toISOString().slice(0, 10),
    );
    hubDb()
      .prepare(
        `INSERT INTO plugin_changelog_entries
       (id, plugin_product_id, version, title, body, git_sha)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        product.id,
        version,
        `Release ${version}`,
        delivered.length
          ? delivered.map((task) => `- ${task.title}`).join("\n")
          : "- Livraison validée",
        (body as { gitSha?: string }).gitSha || null,
      );
    return c.json({ product: released, approved: true });
  });

  app.get("/:id/data/tables", (c) => {
    try {
      if (!deps.openReadonlyPluginDb) {
        return c.json({ error: "Lecture data plugin non configurée" }, 501);
      }
      const db = deps.openReadonlyPluginDb(pluginDataPath(c.req.param("id")));
      db.pragma?.("query_only=ON");
      const tables = db
        .prepare(
          `SELECT name, sql FROM sqlite_master
         WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all();
      db.close();
      return c.json({ tables });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        404,
      );
    }
  });

  app.get("/:id/data/tables/:table", (c) => {
    try {
      if (!deps.openReadonlyPluginDb) {
        return c.json({ error: "Lecture data plugin non configurée" }, 501);
      }
      const table = c.req.param("table");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error("Table invalide");
      }
      const db = deps.openReadonlyPluginDb(pluginDataPath(c.req.param("id")));
      db.pragma?.("query_only=ON");
      const exists = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      if (!exists) {
        db.close();
        throw new Error("Table introuvable");
      }
      const rows = db.prepare(`SELECT * FROM "${table}" LIMIT 100`).all();
      const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
      db.close();
      return c.json({ table, columns, rows, readonly: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        404,
      );
    }
  });

  app.get("/:id/n8n", async (c) => {
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    try {
      return c.json(await n8n.getPluginN8nSnapshot(product.id));
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : String(error),
          tag: n8n.pluginN8nTag(product.id),
          connection: {
            connected: false,
            mode: "tag-registry",
            modeLabel: `Tag dédié + registre`,
          },
        },
        503,
      );
    }
  });

  app.post("/:id/n8n/workflows", async (c) => {
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({
        name: z.string().min(1).max(200),
        nodes: z.array(z.record(z.string(), z.unknown())).default([]),
        connections: z.record(z.string(), z.unknown()).default({}),
        settings: z.record(z.string(), z.unknown()).default({}),
      })
      .safeParse(body);
    if (!parsed.success) return c.json({ error: "Workflow invalide" }, 400);
    try {
      const created = await n8n.createPluginN8nWorkflow({
        pluginProductId: product.id,
        ...parsed.data,
      });
      return c.json(created, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        502,
      );
    }
  });

  app.post("/:id/archive", async (c) => {
    const session = await getSession(c);
    if (!session) {
      return c.json(
        { error: "Archivage : session utilisateur requise (pas de clé API)" },
        403,
      );
    }
    const product = host.getPluginProduct(c.req.param("id"));
    if (!product) return c.json({ error: "Produit plugin introuvable" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ mode: z.enum(["product", "runtime", "purge"]) })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Mode d’archivage invalide" }, 400);
    }
    if (parsed.data.mode === "runtime") {
      return c.json({
        ok: true,
        mode: "runtime",
        desktopActionRequired: true,
        pluginId: product.plugin_id,
        hint: "Le desktop désinstalle le runtime ; le produit, PRD et documents sont conservés.",
      });
    }
    if (parsed.data.mode === "product") {
      requireStore().archiveProduct(product.id);
      return c.json({
        ok: true,
        mode: "product",
        product: host.getPluginProduct(product.id),
      });
    }

    const documents = hubDb()
      .prepare(
        `SELECT storage_path FROM plugin_documents WHERE plugin_product_id=?`,
      )
      .all(product.id) as Array<{ storage_path: string }>;
    for (const document of documents) {
      fs.rmSync(document.storage_path, { force: true });
    }
    if (
      product.plugin_id &&
      /^[a-z][a-z0-9-]{1,62}$/.test(product.plugin_id)
    ) {
      const root = String(pluginsDir() || "").trim();
      if (root) {
        const runtime = path.resolve(root, product.plugin_id);
        if (runtime.startsWith(`${path.resolve(root)}${path.sep}`)) {
          fs.rmSync(runtime, { recursive: true, force: true });
        }
      }
    }
    requireStore().deleteProduct(product.id);
    return c.json({
      ok: true,
      mode: "purge",
      warning:
        "Registre, PRD, docs, tests et DB supprimés. Les workflows n8n enregistrés doivent être supprimés via l’API n8n selon leur politique de rétention.",
    });
  });

  return app;
}
