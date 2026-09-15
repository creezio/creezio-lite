/**
 * Routes Hono fabrique conversationnelle — intention → PRD → scaffold.
 * Port demobrand `createPluginFactoryApiMount` → Hono pour marques TF/CV.
 *
 * Montage typique :
 *   api.route("/plugin-factory", createPluginFactoryRoutes({ factory, getActor }))
 */

import { Hono, type Context } from "hono";
import {
  actorIsPluginAdmin,
  type PluginAclActor,
} from "../acl.js";
import type { ConversationalPluginFactory } from "../factory/index.js";

export type PluginFactoryRouteDeps = {
  factory: ConversationalPluginFactory;
  /** Acteur ACL (owner / service key pour materialize). */
  getActor: (c: Context) => Promise<PluginAclActor> | PluginAclActor;
  /** Si false, materialize refuse (feature flag marque). Défaut true. */
  enabled?: boolean | (() => boolean);
};

/**
 * Surface HTTP minimale de la fabrique plugins.
 *
 * Endpoints :
 * - GET  /sessions
 * - POST /intention
 * - POST /clarify
 * - POST /approve
 * - POST /materialize
 * - POST /iterate
 * - GET  /sessions/:id
 */
export function createPluginFactoryRoutes(
  deps: PluginFactoryRouteDeps,
): Hono {
  const app = new Hono();
  const { factory, getActor } = deps;

  function isEnabled(): boolean {
    if (deps.enabled === undefined) return true;
    return typeof deps.enabled === "function" ? deps.enabled() : deps.enabled;
  }

  app.use("*", async (c, next) => {
    if (!isEnabled()) {
      return c.json(
        {
          ok: false,
          error: "plugin_factory_disabled",
          hint: "Activer features.plugins / PRODUCT_HUB_FACTORY=1 côté marque.",
        },
        404,
      );
    }
    await next();
  });

  app.get("/sessions", (c) =>
    c.json({ ok: true, sessions: factory.listSessions() }),
  );

  app.get("/", (c) => c.json({ ok: true, sessions: factory.listSessions() }));

  app.post("/intention", async (c) => {
    const actor = await getActor(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    try {
      const session = await factory.submitIntention({
        text: String(body.text || body.intention || ""),
        name: body.name ? String(body.name) : undefined,
        pluginId: body.pluginId ? String(body.pluginId) : undefined,
        conversationId: body.conversationId
          ? String(body.conversationId)
          : undefined,
        forceClarification: Boolean(body.forceClarification),
      });
      return c.json({ ok: true, session, actor: { userId: actor.userId } }, 201);
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : "error" },
        400,
      );
    }
  });

  app.post("/clarify", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    try {
      const session = await factory.answerClarifications({
        productId: String(body.productId || ""),
        clarificationId: String(body.clarificationId || ""),
        answers: (body.answers || {}) as Record<string, string | string[]>,
      });
      return c.json({ ok: true, session });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : "error" },
        400,
      );
    }
  });

  app.post("/approve", async (c) => {
    const actor = await getActor(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    try {
      const session = factory.approvePrd({
        productId: String(body.productId || ""),
        userId: String(body.userId || actor.userId || "factory-user"),
        revisionId: body.revisionId ? String(body.revisionId) : undefined,
      });
      return c.json({ ok: true, session });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : "error" },
        400,
      );
    }
  });

  app.post("/materialize", async (c) => {
    const actor = await getActor(c);
    if (!actorIsPluginAdmin(actor)) {
      return c.json({ ok: false, error: "acl_install_denied" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const result = await factory.materialize({
      productId: String(body.productId || ""),
      actor,
      pluginId: body.pluginId ? String(body.pluginId) : undefined,
    });
    if (!result.ok) {
      return c.json(
        { ok: false, error: result.error, session: result.session },
        400,
      );
    }
    return c.json(
      {
        ok: true,
        pluginId: result.pluginId,
        dir: result.dir,
        dbOpened: result.dbOpened,
        filesWritten: result.filesWritten,
        session: result.session,
      },
      201,
    );
  });

  app.post("/iterate", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    try {
      const session = await factory.iterate({
        pluginId: String(body.pluginId || ""),
        text: String(body.text || body.intention || ""),
        conversationId: body.conversationId
          ? String(body.conversationId)
          : undefined,
      });
      return c.json({ ok: true, session }, 201);
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : "error" },
        400,
      );
    }
  });

  app.get("/sessions/:id", (c) => {
    const session = factory.getSession(c.req.param("id"));
    if (!session) return c.json({ ok: false, error: "not_found" }, 404);
    return c.json({ ok: true, session });
  });

  return app;
}
