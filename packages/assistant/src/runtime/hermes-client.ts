/**
 * Client Hermes Gateway (API OpenAI-compat sur le host).
 * Work mode : délégation agentique — skills via configureAssistantBrand({ hermes }).
 */

import { assistantHermes } from "../brand/registry.js";

export type HermesChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type HermesCompletionResult = {
  content: string;
  model: string;
  failed: boolean;
  error?: string;
  sessionId: string;
};

function hermesBaseUrl(): string {
  // Desktop local : Electron injecte HERMES_API_URL → 127.0.0.1:<port>.
  // Docker CRM (VPS) : défaut bridge host ; override via HERMES_API_URL.
  const desktopDefault =
    process.env.DESKTOP_LOCAL === "1"
      ? "http://127.0.0.1:18642"
      : "http://172.21.0.1:8642";
  return (
    process.env.HERMES_API_URL ||
    process.env.HERMES_GATEWAY_URL ||
    desktopDefault
  ).replace(/\/$/, "");
}

function hermesApiKey(): string {
  return (process.env.HERMES_API_SERVER_KEY || process.env.API_SERVER_KEY || "").trim();
}

export function hermesConfigured(): boolean {
  return Boolean(hermesApiKey());
}

/**
 * Endpoint alternatif (D3, agent personnel) : quand fourni, remplace le
 * Hermes entreprise (env) pour la session Work de l'utilisateur.
 */
export type HermesEndpoint = { baseUrl: string; apiKey: string };

export async function wakeHermes(
  signal?: AbortSignal,
  endpoint?: HermesEndpoint | null,
): Promise<{
  ok: boolean;
  detail: string;
}> {
  const base = endpoint ? endpoint.baseUrl.replace(/\/$/, "") : hermesBaseUrl();
  const key = endpoint ? endpoint.apiKey : hermesApiKey();
  try {
    const res = await fetch(`${base}/health`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal,
    });
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      return { ok: true, detail: body.status || "ok" };
    }
    return { ok: false, detail: `health HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : "Hermes injoignable",
    };
  }
}

/**
 * Chat Completions synchrone (Hermes agent loop côté serveur).
 * Session = conversation CRM (continuité multi-tours).
 */
export async function hermesChatCompletion(opts: {
  sessionId: string;
  /** users.id CRM — contexte par utilisateur côté Hermes (D2). */
  userId?: string | null;
  messages: HermesChatMessage[];
  signal?: AbortSignal;
  /** Précharger skills via mention dans le system (Hermes les découvre aussi). */
  skillsHint?: string[];
  /**
   * Alias OpenAI-compat (défaut hermes-agent). Le LLM réel est celui
   * configuré via WebUI `/api/model/set` (ensureHermesWorkModel).
   */
  model?: string;
  /** Agent personnel (D3) : endpoint dédié au lieu du Hermes entreprise. */
  endpoint?: HermesEndpoint | null;
}): Promise<HermesCompletionResult> {
  const base = opts.endpoint
    ? opts.endpoint.baseUrl.replace(/\/$/, "")
    : hermesBaseUrl();
  const key = opts.endpoint ? opts.endpoint.apiKey : hermesApiKey();
  if (!key) {
    throw new Error(
      "HERMES_API_SERVER_KEY manquante — impossible de déléguer le mode Work à Hermes",
    );
  }

  const wake = await wakeHermes(opts.signal, opts.endpoint);
  if (!wake.ok) {
    throw new Error(
      opts.endpoint
        ? `Agent personnel injoignable (${wake.detail}). Vérifiez l'URL et la clé dans Configuration → Assistant.`
        : `Hermes API down (${wake.detail}). Sur le VPS : bash scripts/wake-hermes.sh`,
    );
  }

  // skillsHint === [] : pas d'injection (agent personnel).
  const skills =
    opts.skillsHint ?? assistantHermes().defaultSkills ?? [];

  const messages: HermesChatMessage[] = [...opts.messages];
  // Rappel skills en tête si pas déjà un system
  if (skills.length && !messages.some((m) => m.role === "system")) {
    messages.unshift({
      role: "system",
      content: `Skills à charger : ${skills.join(", ")}.`,
    });
  } else if (skills.length) {
    messages[0] = {
      ...messages[0],
      content: `${messages[0].content}\n\nSkills obligatoires : ${skills.join(", ")}.`,
    };
  }

  const requestModel =
    (opts.model || "").trim() ||
    process.env.HERMES_MODEL ||
    "hermes-agent";

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Hermes-Session-Id": opts.sessionId,
      // Contexte par utilisateur (D2) — ignoré par les Hermes qui ne le
      // gèrent pas encore, consommable par les skills/middleware.
      ...(opts.userId ? { "X-Hermes-User-Id": opts.userId } : {}),
    },
    body: JSON.stringify({
      model: requestModel,
      messages,
      stream: false,
    }),
    signal: opts.signal,
  });

  const raw = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    model?: string;
    error?: { message?: string } | string;
    hermes?: { failed?: boolean; error?: string };
  };

  if (!res.ok) {
    const err =
      typeof raw.error === "string"
        ? raw.error
        : raw.error?.message || `Hermes HTTP ${res.status}`;
    throw new Error(err);
  }

  const content = raw.choices?.[0]?.message?.content?.trim() || "";
  const failed = Boolean(raw.hermes?.failed) || raw.choices?.[0]?.finish_reason === "error";
  const error = raw.hermes?.error || (failed ? content || "erreur Hermes" : undefined);

  return {
    content: failed && error ? `⚠️ Work Hermes : ${error}` : content || "(réponse vide)",
    model: raw.model || requestModel,
    failed,
    error,
    sessionId: opts.sessionId,
  };
}

/**
 * Stream SSE OpenAI-compat → callback token.
 * Si le stream échoue, fallback synchrone.
 */
export async function hermesChatCompletionStream(opts: {
  sessionId: string;
  /** users.id CRM — contexte par utilisateur côté Hermes (D2). */
  userId?: string | null;
  messages: HermesChatMessage[];
  signal?: AbortSignal;
  skillsHint?: string[];
  model?: string;
  /** Agent personnel (D3) : endpoint dédié au lieu du Hermes entreprise. */
  endpoint?: HermesEndpoint | null;
  onToken: (text: string) => void;
}): Promise<HermesCompletionResult> {
  const base = opts.endpoint
    ? opts.endpoint.baseUrl.replace(/\/$/, "")
    : hermesBaseUrl();
  const key = opts.endpoint ? opts.endpoint.apiKey : hermesApiKey();
  if (!key) {
    throw new Error("HERMES_API_SERVER_KEY manquante");
  }

  const wake = await wakeHermes(opts.signal, opts.endpoint);
  if (!wake.ok) {
    throw new Error(
      opts.endpoint
        ? `Agent personnel injoignable (${wake.detail}). Vérifiez l'URL et la clé dans Configuration → Assistant.`
        : `Hermes API down (${wake.detail}). Sur le VPS : bash scripts/wake-hermes.sh`,
    );
  }

  const skills =
    opts.skillsHint ?? assistantHermes().defaultSkills ?? [];

  const messages: HermesChatMessage[] = [...opts.messages];
  if (skills.length && !messages.some((m) => m.role === "system")) {
    messages.unshift({
      role: "system",
      content: `Skills à charger : ${skills.join(", ")}.`,
    });
  } else if (skills.length) {
    messages[0] = {
      ...messages[0],
      content: `${messages[0].content}\n\nSkills obligatoires : ${skills.join(", ")}.`,
    };
  }

  const requestModel =
    (opts.model || "").trim() ||
    process.env.HERMES_MODEL ||
    "hermes-agent";

  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Hermes-Session-Id": opts.sessionId,
        ...(opts.userId ? { "X-Hermes-User-Id": opts.userId } : {}),
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: requestModel,
        messages,
        stream: true,
      }),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      // fallback sync
      return hermesChatCompletion({
        sessionId: opts.sessionId,
        userId: opts.userId,
        messages: opts.messages,
        signal: opts.signal,
        skillsHint: skills,
        endpoint: opts.endpoint,
        model: requestModel,
      });
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let content = "";
    let model = requestModel;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const chunk = JSON.parse(payload) as {
            model?: string;
            choices?: {
              delta?: { content?: string };
              message?: { content?: string };
            }[];
          };
          if (chunk.model) model = chunk.model;
          const tok =
            chunk.choices?.[0]?.delta?.content ||
            chunk.choices?.[0]?.message?.content ||
            "";
          if (tok) {
            content += tok;
            opts.onToken(tok);
          }
        } catch {
          /* ignore malformed SSE line */
        }
      }
    }

    if (!content.trim()) {
      return hermesChatCompletion({
        sessionId: opts.sessionId,
        messages: opts.messages,
        signal: opts.signal,
        skillsHint: skills,
        model: requestModel,
      });
    }

    return {
      content,
      model,
      failed: false,
      sessionId: opts.sessionId,
    };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return hermesChatCompletion({
      sessionId: opts.sessionId,
      messages: opts.messages,
      signal: opts.signal,
      skillsHint: skills,
      model: requestModel,
    });
  }
}
