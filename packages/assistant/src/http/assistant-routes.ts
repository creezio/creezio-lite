/**
 * Surface HTTP assistant (mount Hono).
 * Port gold kit `crm/src/server/routes/assistant.ts` → kit (D-P16 / P5).
 *
 * Auth / desktop-presence / Product Hub / usage restent injectables marque.
 * Prérequis : `configureAssistantBrand(...)` au boot host.
 */
import { Hono, type Context } from "hono";
import {
  adoptOrphanConversations,
  canAccessConversation,
  createConversation,
  deleteConversation,
  getAgentProfile,
  getConversation,
  setAgentProfile,
  listConversations,
  listMessages,
  parseSources,
  titleFromMessage,
  updateConversationModel,
} from "../runtime/chat-db.js";
import { parseAssistantMode } from "../runtime/modes.js";
import {
  encodeHermesModelId,
  getHermesReasoningStatus,
  hermesModelsConfigured,
  listHermesModelOptions,
  parseHermesModelId,
  setHermesMainModel,
  setHermesReasoningEffort,
} from "../runtime/hermes-models.js";
import {
  defaultModel,
  modelOptions,
  modelOptionsDetailed,
} from "../runtime/models.js";
import {
  getConversationTrace,
  summarizeToolCall,
} from "../runtime/tool-trace.js";
import {
  resolveUiAction,
  subscribeSupplierActions,
  type UiActionRequest,
} from "../runtime/ui-actions.js";
import { transcribeAudio } from "../runtime/whisper.js";
import { handleAssistantChat } from "../runtime/assistant-chat.js";
import { assistantHermes } from "../brand/registry.js";

export type AssistantSession = {
  sub?: string;
  role?: string;
  email?: string;
};

export type AssistantDesktopPresence = {
  registerDesktopBridge: (opts: {
    userId: string;
    deviceId?: string;
    deviceLabel?: string | null;
    subscriptionId: string;
  }) => void;
  unregisterDesktopBridge: (
    userId: string,
    deviceId: string,
    subscriptionId?: string,
  ) => void;
  touchDesktopBridge?: (userId: string, deviceId: string) => void;
};

export type AssistantPluginProduct = {
  id: string;
  name: string;
  conversation_id: string;
  archived_at?: string | null;
  lifecycle_state?: string;
  plugin_id?: string;
};

export type AssistantPluginProductHub = {
  listPluginProducts: () => AssistantPluginProduct[];
  pluginProductDetails: (id: string) => {
    clarifications?: Array<Record<string, unknown>>;
    prdRevisions?: Array<Record<string, unknown>>;
  } | null;
};

export type AssistantRoutesFeatures = {
  /** Profil agent Work (company/personal). Défaut: true si getSession. */
  agentProfile?: boolean;
  /** Contrôles Hermes (models / reasoning / model). Défaut: true. */
  hermesControls?: boolean;
  /** ACL conversations + adopt orphans owner. Défaut: true si getSession. */
  conversationAcl?: boolean;
  /** Cartes Product Hub (approvals/QA). Défaut: true (200 [] sans hub). */
  pluginApprovals?: boolean;
};

export type AssistantRoutesDeps = {
  getSession?: (
    c: Context,
  ) => Promise<AssistantSession | null> | AssistantSession | null;
  /**
   * Préfixe conversation Hermes pour plugin-approvals
   * (`${prefix}-${conversationId}`). Défaut: `assistantHermes().sessionIdPrefix`.
   */
  conversationIdPrefix?: string;
  desktopPresence?: AssistantDesktopPresence;
  /**
   * Auth du flux SSE desktop-actions :
   * - `query` (défaut) : `?user_id=` (bridge Electron TF/CV)
   * - `session` : `session.sub` (feature-off)
   */
  desktopStreamAuth?: "query" | "session";
  /** Méta device pour le bridge (headers marque, query, …). */
  resolveDeviceMeta?: (c: Context) => {
    deviceId: string;
    deviceLabel?: string | null;
  };
  pluginProductHub?: AssistantPluginProductHub;
  /** Hook optionnel avant `handleAssistantChat` (usage analytics marque). */
  onChat?: (c: Context) => void | Promise<void>;
  features?: AssistantRoutesFeatures;
};

function parseJsonField(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function agentProfilePayload(userId: string) {
  const p = getAgentProfile(userId);
  const kind = p?.kind ?? ("company" as const);
  const apiUrl = p?.api_url ?? null;
  const hasKey = Boolean(p?.api_key);
  return {
    kind,
    apiUrl,
    hasKey,
    /** personal sans URL/clé exploitable → le Work retombe sur l'entreprise. */
    incomplete: kind === "personal" && (!apiUrl || !hasKey),
  };
}

/**
 * Factory routes HTTP assistant.
 * Montage marque typique : `api.route("/assistant", createAssistantRoutes({…}))`.
 */
export function createAssistantRoutes(deps: AssistantRoutesDeps = {}): Hono {
  const app = new Hono();
  const hasSession = typeof deps.getSession === "function";
  const features: Required<AssistantRoutesFeatures> = {
    agentProfile: deps.features?.agentProfile ?? hasSession,
    hermesControls: deps.features?.hermesControls ?? true,
    conversationAcl: deps.features?.conversationAcl ?? hasSession,
    pluginApprovals: deps.features?.pluginApprovals ?? true,
  };
  const desktopStreamAuth = deps.desktopStreamAuth ?? "query";

  async function chatUser(
    c: Context,
  ): Promise<{ userId: string; role: string } | null> {
    if (!deps.getSession) return null;
    const session = await deps.getSession(c);
    if (!session?.sub) return null;
    return { userId: session.sub, role: session.role || "user" };
  }

  /** 404 volontaire (pas 403) : ne pas révéler l'existence d'un chat d'autrui. */
  function conversationForUser(
    id: string,
    user: { userId: string; role: string },
  ) {
    const conv = getConversation(id);
    if (!conv || !canAccessConversation(conv, user.userId, user.role)) {
      return undefined;
    }
    return conv;
  }

  function conversationIdPrefix(): string {
    return (
      deps.conversationIdPrefix ||
      assistantHermes().sessionIdPrefix ||
      "creezio"
    );
  }

  /* Chat streaming (SSE). */
  app.post("/chat", async (c) => {
    if (deps.onChat) {
      try {
        await deps.onChat(c);
      } catch {
        /* ignore */
      }
    }
    // Session résolue par requête (cookie/Bearer Hono) : ne dépend pas d'un
    // configureAssistantBrand({ auth }) sans contexte (harness Docker/desktop).
    if (deps.getSession) {
      const session = await deps.getSession(c);
      return handleAssistantChat(c.req.raw, {
        session: session?.sub
          ? {
              sub: session.sub,
              email: session.email || session.sub,
              role: session.role || "user",
            }
          : null,
      });
    }
    return handleAssistantChat(c.req.raw);
  });

  if (features.agentProfile) {
    app.get("/agent-profile", async (c) => {
      const user = await chatUser(c);
      if (!user) return c.json({ error: "Non authentifié" }, 401);
      return c.json(agentProfilePayload(user.userId));
    });

    app.put("/agent-profile", async (c) => {
      const user = await chatUser(c);
      if (!user) return c.json({ error: "Non authentifié" }, 401);
      const body = (await c.req.json().catch(() => null)) as {
        kind?: unknown;
        apiUrl?: unknown;
        apiKey?: unknown;
      } | null;
      const kind = body?.kind === "personal" ? "personal" : "company";
      const apiUrl =
        body?.apiUrl === undefined
          ? undefined
          : String(body.apiUrl || "").trim();
      const apiKey =
        body?.apiKey === undefined ? undefined : String(body.apiKey || "");
      if (kind === "personal" && apiUrl !== undefined && apiUrl) {
        if (!/^https?:\/\//i.test(apiUrl)) {
          return c.json(
            { error: "URL de l'agent personnel invalide (http(s) attendu)" },
            400,
          );
        }
      }
      setAgentProfile(user.userId, { kind, apiUrl, apiKey });
      return c.json(agentProfilePayload(user.userId));
    });
  }

  if (features.pluginApprovals) {
    const hub = deps.pluginProductHub;
    app.get("/plugin-approvals", async (c) => {
      if (!hub) {
        return c.json({ approvals: [], clarifications: [], qa: [] });
      }
      const conversationId = String(c.req.query("conversationId") || "").trim();
      if (!conversationId) {
        return c.json({ approvals: [], clarifications: [], qa: [] });
      }
      const prefix = conversationIdPrefix();
      const hermesConversationId = conversationId.startsWith(`${prefix}-`)
        ? conversationId
        : `${prefix}-${conversationId}`;
      try {
        const approvals: Array<Record<string, unknown>> = [];
        const clarifications: Array<Record<string, unknown>> = [];
        const qa: Array<Record<string, unknown>> = [];
        for (const product of hub.listPluginProducts()) {
          if (product.conversation_id !== hermesConversationId) continue;
          if (product.archived_at) continue;
          const details = hub.pluginProductDetails(product.id);
          const openRounds = (
            (details?.clarifications || []) as Array<Record<string, unknown>>
          ).filter((round) => round.status === "open");
          for (const round of openRounds) {
            let questions: unknown = [];
            try {
              questions = JSON.parse(String(round.questions_json || "[]"));
            } catch {
              questions = [];
            }
            clarifications.push({
              productId: product.id,
              name: product.name,
              clarificationId: String(round.id),
              round: Number(round.round || 1),
              questions,
            });
          }
          if (product.lifecycle_state === "awaiting_human_qa") {
            qa.push({
              productId: product.id,
              name: product.name,
              pluginId: product.plugin_id,
            });
          }
          if (product.lifecycle_state !== "awaiting_prd_approval") continue;
          const revisions = (details?.prdRevisions || []) as Array<
            Record<string, unknown>
          >;
          const latest = revisions[0];
          if (!latest || latest.validated_at) continue;
          approvals.push({
            productId: product.id,
            name: product.name,
            revisionId: String(latest.id),
            version: Number(latest.version || 1),
            problem: String(latest.problem || ""),
            scope: String(latest.scope || ""),
            acceptanceCriteria: String(latest.acceptance_criteria || ""),
          });
        }
        return c.json({ approvals, clarifications, qa });
      } catch {
        return c.json({ approvals: [], clarifications: [], qa: [] });
      }
    });
  }

  /* Résultat d'une action UI exécutée par le navigateur (souris virtuelle). */
  app.post("/ui-actions/:id/result", async (c) => {
    const id = c.req.param("id");
    let result: Record<string, unknown> = {};
    try {
      result = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "JSON invalide" }, 400);
    }
    const accepted = resolveUiAction(id, result);
    return c.json({ ok: accepted });
  });

  /**
   * Flux SSE des actions desktop / sites externes.
   * Path canonique : `/desktop-actions/stream`.
   * Alias wire historique TF : `/supplier-actions/stream` (clients Electron).
   */
  const desktopActionsStream = async (c: Context) => {
    let userId = "";
    if (desktopStreamAuth === "session") {
      const session = deps.getSession ? await deps.getSession(c) : null;
      userId = session?.sub || "auth-disabled";
    } else {
      userId = c.req.query("user_id") || "";
    }

    const deviceMeta = deps.resolveDeviceMeta?.(c) ?? {
      deviceId: c.req.query("device_id") || "host",
      deviceLabel: null,
    };
    const deviceId = deviceMeta.deviceId || "host";
    const deviceLabel = deviceMeta.deviceLabel ?? null;

    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            /* flux fermé */
          }
        };
        if (desktopStreamAuth === "query" && !userId) {
          send("error", { error: "user_id requis" });
          controller.close();
          return;
        }
        const subscription = subscribeSupplierActions(
          (req: UiActionRequest) => {
            // Event wire historique consommé par electron-shell bridge-client.
            send("supplier_action", req);
          },
          { userId, deviceId },
        );
        deps.desktopPresence?.registerDesktopBridge({
          userId,
          deviceId: subscription.meta.deviceId,
          deviceLabel,
          subscriptionId: subscription.meta.subscriptionId,
        });
        send("connected", {
          at: new Date().toISOString(),
          user_id: userId,
          device_id: subscription.meta.deviceId,
        });
        unsubscribe = () => {
          subscription.unsubscribe();
          deps.desktopPresence?.unregisterDesktopBridge(
            userId,
            subscription.meta.deviceId,
            subscription.meta.subscriptionId,
          );
        };
        keepalive = setInterval(() => {
          try {
            deps.desktopPresence?.touchDesktopBridge?.(
              userId,
              subscription.meta.deviceId,
            );
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            /* flux fermé */
          }
        }, 25000);
      },
      cancel() {
        unsubscribe?.();
        if (keepalive) clearInterval(keepalive);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  };

  app.get("/desktop-actions/stream", desktopActionsStream);
  /* Alias wire TF — ne pas supprimer tant que les bridges Electron consomment ce path. */
  app.get("/supplier-actions/stream", desktopActionsStream);

  /* Micro → Whisper (multipart: file). */
  app.post("/transcribe", async (c) => {
    try {
      const body = await c.req.parseBody({ all: false });
      const raw = body.file ?? body.audio;
      if (!(raw instanceof File)) {
        return c.json({ error: "Fichier audio requis (champ file)" }, 400);
      }
      const { text, model } = await transcribeAudio(raw, {
        filename: raw.name || "recording.webm",
        language: "fr",
      });
      return c.json({ text, model });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Transcription impossible";
      const status = message.includes("OPENAI_API_KEY")
        ? 503
        : message.includes("vide") || message.includes("volumineux")
          ? 400
          : 502;
      return c.json({ error: message }, status);
    }
  });

  app.get("/models", (c) =>
    c.json({
      default: defaultModel(),
      models: modelOptions(),
      options: modelOptionsDetailed(),
    }),
  );

  if (features.hermesControls) {
    app.get("/hermes-models", async (c) => {
      if (!hermesModelsConfigured()) {
        return c.json({ error: "Hermes non configuré" }, 503);
      }
      try {
        const listed = await listHermesModelOptions(c.req.raw.signal);
        return c.json({
          default: listed.defaultId,
          current: listed.current,
          provider: listed.provider,
          model: listed.model,
          options: listed.options.map((o) => ({
            id: o.id,
            label: o.label,
            provider: o.provider,
            model: o.model,
          })),
          models: listed.options.map((o) => o.id),
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Hermes models indisponibles";
        return c.json({ error: message }, 503);
      }
    });

    app.get("/hermes-reasoning", async (c) => {
      if (!hermesModelsConfigured()) {
        return c.json({ error: "Hermes non configuré" }, 503);
      }
      try {
        const status = await getHermesReasoningStatus({
          provider: c.req.query("provider"),
          model: c.req.query("model"),
          signal: c.req.raw.signal,
        });
        return c.json(status);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Reasoning Hermes indisponible";
        return c.json({ error: message }, 503);
      }
    });

    app.post("/hermes-reasoning", async (c) => {
      if (!hermesModelsConfigured()) {
        return c.json({ error: "Hermes non configuré" }, 503);
      }
      let body: { effort?: string; provider?: string; model?: string } = {};
      try {
        body = (await c.req.json()) as typeof body;
      } catch {
        return c.json({ error: "JSON invalide" }, 400);
      }
      if (!body.effort?.trim()) {
        return c.json({ error: "effort requis" }, 400);
      }
      try {
        const status = await setHermesReasoningEffort({
          effort: body.effort,
          provider: body.provider,
          model: body.model,
          signal: c.req.raw.signal,
        });
        return c.json(status);
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Reasoning Hermes indisponible";
        return c.json({ error: message }, 503);
      }
    });

    app.post("/hermes-model", async (c) => {
      if (!hermesModelsConfigured()) {
        return c.json({ error: "Hermes non configuré" }, 503);
      }
      let body: { id?: string; provider?: string; model?: string } = {};
      try {
        body = (await c.req.json()) as typeof body;
      } catch {
        return c.json({ error: "JSON invalide" }, 400);
      }
      const parsed = parseHermesModelId(body.id);
      const provider = (body.provider || parsed?.provider || "").trim();
      const model = (body.model || parsed?.model || "").trim();
      if (!provider || !model) {
        return c.json(
          { error: "provider et model requis (ou id provider::model)" },
          400,
        );
      }
      try {
        const result = await setHermesMainModel({
          provider,
          model,
          signal: c.req.raw.signal,
        });
        return c.json({
          ok: result.ok,
          id: encodeHermesModelId(result.provider, result.model),
          provider: result.provider,
          model: result.model,
        });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : "Échec set modèle Hermes";
        return c.json({ error: message }, 503);
      }
    });
  }

  /** Statut des clés réellement présentes dans l'env du process serveur (BYOK). */
  app.get("/llm-status", (c) => {
    const desktopLocal = (process.env.DESKTOP_LOCAL || "").trim() === "1";
    const openai = Boolean((process.env.OPENAI_API_KEY || "").trim());
    const anthropic = Boolean((process.env.ANTHROPIC_API_KEY || "").trim());
    const assistantReady = desktopLocal ? openai : openai || anthropic;
    return c.json({
      desktopLocal,
      openai,
      anthropic,
      assistantReady,
      byokRequired: desktopLocal,
      openaiRequired: desktopLocal,
    });
  });

  app.get("/conversations", async (c) => {
    if (!features.conversationAcl) {
      return c.json({ conversations: listConversations(100) });
    }
    const user = await chatUser(c);
    if (!user) return c.json({ conversations: [] });
    if (user.role === "owner") adoptOrphanConversations(user.userId);
    return c.json({ conversations: listConversations(100, user.userId) });
  });

  app.post("/conversations", async (c) => {
    const user = features.conversationAcl ? await chatUser(c) : null;
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: string;
      model?: string;
      mode?: string;
    };
    const conversation = createConversation({
      title: body.title?.trim() ? titleFromMessage(body.title) : undefined,
      model: body.model?.trim() || undefined,
      mode: parseAssistantMode(body.mode, "chat"),
      userId: user?.userId ?? null,
    });
    return c.json({ conversation }, 201);
  });

  app.get("/conversations/:id", async (c) => {
    const id = c.req.param("id");
    let conversation;
    if (features.conversationAcl) {
      const user = await chatUser(c);
      conversation = user ? conversationForUser(id, user) : undefined;
    } else {
      conversation = getConversation(id);
    }
    if (!conversation) {
      return c.json({ error: "Conversation introuvable" }, 404);
    }
    const messages = listMessages(id).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      sources: parseSources(m.sources_json),
      createdAt: m.created_at,
    }));
    return c.json({ conversation, messages });
  });

  app.patch("/conversations/:id", async (c) => {
    const id = c.req.param("id");
    let body: { model?: string } = {};
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "JSON invalide" }, 400);
    }
    const model = String(body.model || "").trim();
    if (!model) return c.json({ error: "model requis" }, 400);
    if (features.conversationAcl) {
      const user = await chatUser(c);
      if (!user || !conversationForUser(id, user)) {
        return c.json({ error: "Conversation introuvable" }, 404);
      }
    }
    const conversation = updateConversationModel(id, model);
    if (!conversation) {
      return c.json({ error: "Conversation introuvable" }, 404);
    }
    return c.json({ conversation });
  });

  app.delete("/conversations/:id", async (c) => {
    const id = c.req.param("id");
    if (features.conversationAcl) {
      const user = await chatUser(c);
      if (!user || !conversationForUser(id, user)) {
        return c.json({ error: "Conversation introuvable" }, 404);
      }
    }
    if (!deleteConversation(id)) {
      return c.json({ error: "Conversation introuvable" }, 404);
    }
    return c.json({ ok: true as const });
  });

  app.get("/conversations/:id/trace", async (c) => {
    const id = c.req.param("id");
    let conversation;
    if (features.conversationAcl) {
      const user = await chatUser(c);
      conversation = user ? conversationForUser(id, user) : undefined;
    } else {
      conversation = getConversation(id);
    }
    if (!conversation) {
      return c.json({ error: "Conversation introuvable" }, 404);
    }
    const { runs, toolCalls, llmRounds } = getConversationTrace(id);
    return c.json({
      conversation,
      runs: runs.map((r) => ({
        id: r.id,
        provider: r.provider,
        model: r.model,
        status: r.status,
        error: r.error,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        durationMs: r.duration_ms,
        rounds: r.rounds,
        userMessagePreview: r.user_message_preview,
        meta: parseJsonField(r.meta_json),
      })),
      llmRounds: llmRounds.map((r) => ({
        id: r.id,
        runId: r.run_id,
        round: r.round,
        provider: r.provider,
        model: r.model,
        httpStatus: r.http_status,
        finishReason: r.finish_reason,
        toolCallCount: r.tool_call_count,
        requestChars: r.request_chars,
        responsePreview: r.response_preview,
        error: r.error,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      })),
      toolCalls: toolCalls.map((t) => {
        const arguments_ = parseJsonField(t.arguments_json);
        const result = parseJsonField(t.result_json);
        return {
          id: t.id,
          runId: t.run_id,
          round: t.round,
          toolName: t.tool_name,
          arguments: arguments_,
          result,
          resultOk: Boolean(t.result_ok),
          mode: t.mode,
          error: t.error,
          durationMs: t.duration_ms,
          sources: parseJsonField(t.sources_json),
          createdAt: t.created_at,
          summary: summarizeToolCall(t.tool_name, arguments_, result),
        };
      }),
    });
  });

  return app;
}
