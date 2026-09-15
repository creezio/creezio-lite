/**
 * Client Anthropic Messages API + tool_use (fallback quand OpenAI est en quota).
 */

import { getToolDefinitions } from "../brand/prompts-shim.js";

export type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
    };

export type AnthropicToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export function anthropicKey(): string {
  return (process.env.ANTHROPIC_API_KEY || "").trim();
}

export function anthropicModel(): string {
  return (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim();
}

export function anthropicTools() {
  return getToolDefinitions().map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export async function callAnthropic(opts: {
  system: string;
  messages: AnthropicMessage[];
  toolChoice?:
    | { type: "auto" }
    | { type: "any" }
    | { type: "tool"; name: string };
  model?: string;
}): Promise<{
  ok: boolean;
  status: number;
  text: string;
  toolUses: AnthropicToolUse[];
  error?: string;
  detail?: string;
}> {
  const key = anthropicKey();
  if (!key) {
    return {
      ok: false,
      status: 503,
      text: "",
      toolUses: [],
      error: "ANTHROPIC_API_KEY manquante",
    };
  }

  const model = opts.model || anthropicModel();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: opts.system,
        tools: anthropicTools(),
        tool_choice: opts.toolChoice || { type: "auto" },
        messages: opts.messages,
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });

    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        text: "",
        toolUses: [],
        error: `Anthropic ${res.status}`,
        detail: raw.slice(0, 400),
      };
    }

    let data: {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
    };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return {
        ok: false,
        status: 502,
        text: "",
        toolUses: [],
        error: "Réponse Anthropic invalide",
        detail: raw.slice(0, 200),
      };
    }

    const blocks = data.content || [];
    const text = blocks
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const toolUses = blocks
      .filter(
        (b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } =>
          b.type === "tool_use",
      )
      .map((b) => ({ id: b.id, name: b.name, input: b.input || {} }));

    return { ok: true, status: 200, text, toolUses };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur Anthropic";
    const isAbort = message.toLowerCase().includes("abort");
    return {
      ok: false,
      status: isAbort ? 504 : 502,
      text: "",
      toolUses: [],
      error: isAbort ? "Timeout Anthropic / réseau" : message,
    };
  } finally {
    clearTimeout(t);
  }
}

/** Convertit l'historique OpenAI-like {role,content} en messages Anthropic. */
export function toAnthropicUserHistory(
  incoming: { role: "user" | "assistant"; content: string }[],
): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of incoming) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else {
      // Anthropic exige alternance user/assistant — fusionner assistants consécutifs
      const last = out[out.length - 1];
      if (last?.role === "assistant" && typeof last.content === "string") {
        last.content = `${last.content}\n${m.content}`;
      } else {
        out.push({ role: "assistant", content: m.content });
      }
    }
  }
  // Doit commencer par user
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
