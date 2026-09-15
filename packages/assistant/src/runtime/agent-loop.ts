/**
 * Boucle agent LLM générique (OpenAI tool-calling, non-streaming).
 *
 * Utilisée par le runner des collaborateurs IA (`ai-task-agent.ts`).
 * Contrairement au chat (assistant-chat.ts, SSE + streaming), cette boucle
 * est synchrone côté serveur : messages → tool_calls → résultats → …
 * jusqu'à un outil terminal (`finish_task`) ou un plafond (steps, durée,
 * tokens).
 */

import { supportsTemperature } from "./models.js";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export type AgentToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AgentTool = {
  definition: AgentToolDefinition;
  /** Exécute l'outil ; le résultat est renvoyé au LLM (JSON). */
  execute: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Outil terminal : la boucle s'arrête après son exécution. */
  terminal?: boolean;
};

/** Partie de message multimodal (format OpenAI chat completions). */
export type AgentContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type AgentMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | AgentContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

function textOf(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n");
}

export type AgentStepEvent =
  | { kind: "assistant"; content: string }
  | { kind: "tool_call"; name: string; args: Record<string, unknown> }
  | { kind: "tool_result"; name: string; result: Record<string, unknown> };

export type AgentModelCaller = (opts: {
  model: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  signal?: AbortSignal;
}) => Promise<{
  message: AgentMessage;
  usageTokens?: number;
}>;

/** Appel OpenAI réel (BYOK owner — OPENAI_API_KEY). */
export const callOpenAiModel: AgentModelCaller = async (opts) => {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) throw new Error("OPENAI_API_KEY manquante (BYOK requis)");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: "auto",
    stream: false,
  };
  if (supportsTemperature(opts.model)) body.temperature = 0.1;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55_000);
  const onParentAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onParentAbort, { once: true });
  }
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (res.status === 400 && /image_url|image input|vision|multimodal/i.test(detail)) {
        throw new Error(
          `Le modèle « ${opts.model} » ne supporte pas la vision (images) — ` +
            `configurer TF2_AI_MODEL sur un modèle vision (ex. gpt-4o) ou éviter web_screenshot`,
        );
      }
      throw new Error(`OpenAI HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: AgentMessage }[];
      usage?: { total_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("Réponse OpenAI sans message");
    return {
      message: { ...message, content: message.content || "" },
      usageTokens: data.usage?.total_tokens,
    };
  } finally {
    clearTimeout(t);
    if (opts.signal) opts.signal.removeEventListener("abort", onParentAbort);
  }
};

export type AgentLoopOptions = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  tools: AgentTool[];
  maxSteps: number;
  timeoutMs: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Journalisation de chaque étape (agent_session_logs côté runner). */
  onStep?: (ev: AgentStepEvent) => void;
  /** Injectable pour les tests (stub LLM). */
  callModel?: AgentModelCaller;
};

export type AgentLoopResult = {
  status: "finished" | "max_steps" | "timeout" | "budget" | "error" | "aborted";
  /** Args du dernier outil terminal exécuté (finish_task). */
  terminal?: Record<string, unknown>;
  steps: number;
  usageTokens: number;
  error?: string;
};

/**
 * Déroule la boucle tool-calling jusqu'à un outil terminal ou un plafond.
 * Ne lève jamais : toute erreur devient `status: "error"`.
 */
export async function runAgentLoop(
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const call = opts.callModel || callOpenAiModel;
  const toolByName = new Map(opts.tools.map((t) => [t.definition.function.name, t]));
  const definitions = opts.tools.map((t) => t.definition);
  const messages: AgentMessage[] = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userPrompt },
  ];
  const deadline = Date.now() + opts.timeoutMs;
  const maxTokens = opts.maxTokens ?? 200_000;
  let steps = 0;
  let usageTokens = 0;

  while (steps < opts.maxSteps) {
    if (opts.signal?.aborted) return { status: "aborted", steps, usageTokens };
    if (Date.now() > deadline) return { status: "timeout", steps, usageTokens };
    if (usageTokens > maxTokens) return { status: "budget", steps, usageTokens };

    steps += 1;
    let message: AgentMessage;
    try {
      const res = await call({
        model: opts.model,
        messages,
        tools: definitions,
        signal: opts.signal,
      });
      message = res.message;
      usageTokens += res.usageTokens || 0;
    } catch (e) {
      return {
        status: "error",
        steps,
        usageTokens,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    messages.push(message);
    const assistantText = textOf(message.content || "").trim();
    if (assistantText) {
      opts.onStep?.({ kind: "assistant", content: assistantText });
    }

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) {
      // Pas d'appel d'outil : relancer une fois vers finish_task, sinon stop.
      messages.push({
        role: "user",
        content:
          "Termine avec l'outil finish_task(success, summary) — ne réponds pas en texte libre.",
      });
      continue;
    }

    // Capture d'écran (vision) : jointe comme message user multimodal APRÈS
    // les réponses tool (contrainte OpenAI : chaque tool_call_id doit être
    // répondu avant tout autre message). Une seule capture conservée.
    let pendingImage: { name: string; url: string } | null = null;

    for (const tc of toolCalls) {
      const name = tc.function?.name || "";
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>;
      } catch {
        /* args illisibles → outil appelé sans args */
      }
      opts.onStep?.({ kind: "tool_call", name, args });

      const tool = toolByName.get(name);
      let result: Record<string, unknown>;
      if (!tool) {
        result = { ok: false, error: `Outil inconnu: ${name}` };
      } else {
        try {
          result = await tool.execute(args);
        } catch (e) {
          result = {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      // Image en base64 dans le résultat : extraite AVANT logs et payload
      // tool (jamais de base64 dans agent_session_logs ni dans le JSON tool).
      const rawImage = result.imageBase64;
      if (typeof rawImage === "string" && rawImage.length > 50) {
        const format =
          typeof result.format === "string" && result.format ? result.format : "jpeg";
        const { imageBase64: _omitted, ...rest } = result;
        result = {
          ...rest,
          image_attached: true,
          image_bytes: Math.round((rawImage.length * 3) / 4),
        };
        pendingImage = { name, url: `data:image/${format};base64,${rawImage}` };
      }

      opts.onStep?.({ kind: "tool_result", name, result });
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name,
        content: JSON.stringify(result).slice(0, 12_000),
      });

      if (tool?.terminal) {
        return { status: "finished", terminal: args, steps, usageTokens };
      }
    }

    if (pendingImage) {
      // Seule la dernière capture est gardée dans le contexte : les images
      // des tours précédents sont remplacées par un marqueur texte.
      for (const m of messages) {
        if (Array.isArray(m.content)) {
          m.content = m.content.map((p) =>
            p.type === "image_url"
              ? { type: "text" as const, text: "[capture précédente retirée]" }
              : p,
          );
        }
      }
      messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `Capture d'écran jointe (résultat de ${pendingImage.name}).`,
          },
          { type: "image_url", image_url: { url: pendingImage.url } },
        ],
      });
    }
  }

  return { status: "max_steps", steps, usageTokens };
}
