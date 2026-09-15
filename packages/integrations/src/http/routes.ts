/**
 * Routes Hono `/api/v1/platform/integrations` (montées par la surface
 * plateforme app-runtime).
 *
 * ACL (ADR-integrations-store) :
 * - listing/catalog : session (métadonnées seules, jamais de secret) ;
 * - mutations : owner non impersonné ;
 * - resolve (valeur en clair) : owner OU clé API service (`api_keys`,
 *   scopes full/crm:read) — la clé CRM que Hermes a déjà dans son env.
 */
import { Hono, type Context } from "hono";
import { parseIntegrationReference } from "../reference.js";
import { INTEGRATION_PROVIDERS } from "../providers.js";
import type { SqliteIntegrationsStore } from "../store.js";
import type { N8nIntegrationsSync } from "../n8n-sync.js";

export type IntegrationsSessionLike = {
  sub?: string;
  email?: string;
};

export type IntegrationsRoutesAdapters = {
  store: SqliteIntegrationsStore;
  /** Session cookie/Bearer JWT (null si absente/invalide). */
  getSession: (c: Context) => Promise<IntegrationsSessionLike | null>;
  /** Session owner non impersonnée (null sinon). */
  getOwnerSession: (c: Context) => Promise<IntegrationsSessionLike | null>;
  /**
   * Vérifie une clé API service (Bearer/X-API-Key) contre `api_keys`.
   * Retourne un descripteur ou null.
   */
  verifyServiceKey: (c: Context) => { id: string | number; name: string } | null;
  n8nSync?: N8nIntegrationsSync;
  onLog?: (line: string) => void;
};

export function createIntegrationsRoutes(
  adapters: IntegrationsRoutesAdapters,
): Hono {
  const { store } = adapters;
  const log = adapters.onLog || (() => {});
  const app = new Hono();

  const pushToN8n = async (id: string): Promise<void> => {
    const sync = adapters.n8nSync;
    if (!sync) return;
    const item = store.getById(id);
    if (!item) return;
    const resolved = store.resolveBySlug(item.slug);
    if (!resolved) return;
    const r = await sync.push({
      slug: item.slug,
      provider: item.provider,
      secret: resolved.secret,
      meta: resolved.meta,
      n8nCredentialId: item.n8nCredentialId,
    });
    if (r.ok) {
      store.setN8nSync(id, r.n8nCredentialId);
    } else {
      log(`sync n8n KO (${item.slug}): ${r.detail}`);
    }
  };

  app.get("/", async (c) => {
    if (!(await adapters.getSession(c))) {
      return c.json({ error: "Non authentifié" }, 401);
    }
    return c.json({
      ok: true,
      integrations: store.list(),
      n8nAvailable: adapters.n8nSync?.available() ?? false,
    });
  });

  app.get("/catalog", async (c) => {
    if (!(await adapters.getSession(c))) {
      return c.json({ error: "Non authentifié" }, 401);
    }
    return c.json({
      ok: true,
      providers: INTEGRATION_PROVIDERS.map((p) => ({
        id: p.id,
        label: p.label,
        secretPlaceholder: p.secretPlaceholder,
        n8nCredentialType: p.n8n.credentialType,
      })),
    });
  });

  app.post("/", async (c) => {
    const session = await adapters.getOwnerSession(c);
    if (!session) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      provider?: string;
      label?: string;
      secret?: string;
      slug?: string;
      meta?: Record<string, unknown>;
    };
    try {
      const item = store.create({
        provider: String(body.provider || ""),
        label: String(body.label || ""),
        secret: String(body.secret || ""),
        ...(body.slug ? { slug: String(body.slug) } : {}),
        ...(body.meta && typeof body.meta === "object"
          ? { meta: body.meta }
          : {}),
        createdBy: session.sub ?? null,
      });
      await pushToN8n(item.id);
      return c.json({ ok: true, integration: store.getById(item.id) }, 201);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }
  });

  app.patch("/:id", async (c) => {
    if (!(await adapters.getOwnerSession(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      label?: string;
      secret?: string;
      meta?: Record<string, unknown>;
    };
    try {
      const id = c.req.param("id");
      const before = store.getById(id);
      if (!before) return c.json({ error: "intégration introuvable" }, 404);
      store.update(id, {
        ...(typeof body.label === "string" ? { label: body.label } : {}),
        ...(typeof body.secret === "string" && body.secret.trim()
          ? { secret: body.secret }
          : {}),
        ...(body.meta && typeof body.meta === "object"
          ? { meta: body.meta }
          : {}),
      });
      // Le nom n8n dérive du slug (stable) — seul un nouveau secret/meta
      // nécessite un re-push.
      if (
        (typeof body.secret === "string" && body.secret.trim()) ||
        (body.meta && typeof body.meta === "object")
      ) {
        await pushToN8n(id);
      }
      return c.json({ ok: true, integration: store.getById(id) });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }
  });

  app.delete("/:id", async (c) => {
    if (!(await adapters.getOwnerSession(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    try {
      const { n8nCredentialId } = store.remove(c.req.param("id"));
      let n8nDeleted = false;
      if (n8nCredentialId && adapters.n8nSync) {
        n8nDeleted = (await adapters.n8nSync.remove(n8nCredentialId)).ok;
      }
      return c.json({ ok: true, n8nDeleted });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        400,
      );
    }
  });

  app.post("/:id/sync-n8n", async (c) => {
    if (!(await adapters.getOwnerSession(c))) {
      return c.json({ error: "Réservé au compte principal" }, 403);
    }
    const id = c.req.param("id");
    if (!store.getById(id)) {
      return c.json({ error: "intégration introuvable" }, 404);
    }
    if (!adapters.n8nSync?.available()) {
      return c.json({ error: "n8n indisponible" }, 503);
    }
    await pushToN8n(id);
    return c.json({ ok: true, integration: store.getById(id) });
  });

  app.post("/resolve", async (c) => {
    // Deux canaux : owner (UI/gestes manuels) ou clé API service
    // (Hermes / plugins à l'exécution).
    const owner = await adapters.getOwnerSession(c);
    const serviceKey = owner ? null : adapters.verifyServiceKey(c);
    if (!owner && !serviceKey) {
      return c.json(
        {
          error: "Non authentifié",
          hint: "session owner ou clé API service (Bearer)",
        },
        401,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      reference?: string;
    };
    const slug = parseIntegrationReference(String(body.reference || ""));
    if (!slug) {
      return c.json(
        { error: "reference invalide (attendu integration://<slug>)" },
        400,
      );
    }
    const resolved = store.resolveBySlug(slug);
    if (!resolved) {
      const exists = store.getBySlug(slug);
      return c.json(
        {
          error: exists
            ? "secret illisible (AUTH_SECRET changé) — re-saisir la clé"
            : `intégration inconnue: ${slug}`,
          code: exists ? "unreadable" : "not_found",
        },
        exists ? 409 : 404,
      );
    }
    log(
      `resolve ${resolved.reference} par ${
        owner ? `owner:${owner.sub || "?"}` : `service:${serviceKey!.name}`
      }`,
    );
    return c.json({ ok: true, integration: resolved });
  });

  return app;
}
