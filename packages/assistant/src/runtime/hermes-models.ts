/**
 * Modèles Hermes via WebUI (`/api/model/options` + `/api/model/set`).
 * Pas de liste en dur — source = providers authentifiés Hermes.
 */

export const HERMES_PREFERRED_MODEL = "gpt-5.3-codex";

export type HermesModelOption = {
  /** Clé UI / conversation : `provider::model` */
  id: string;
  provider: string;
  model: string;
  label: string;
};

export type HermesReasoningStatus = {
  effort: string;
  options: string[];
  supported: boolean;
  dynamic: boolean;
};

/** Valeurs du contrat Hermes `/reasoning`, utilisées seulement si l'API REST
 * de l'ancienne WebUI embarquée n'expose pas encore `/api/reasoning`. */
export const HERMES_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type HermesProviderRow = {
  id?: string;
  slug?: string;
  name?: string;
  label?: string;
  models?: unknown;
  model_labels?: Record<string, string>;
  capabilities?: Record<string, { reasoning?: boolean; fast?: boolean }>;
};

let cookieHeader: string | null = null;
let cookieAt = 0;
const COOKIE_TTL_MS = 30 * 60 * 1000;

function webuiBase(): string {
  const desktopDefault =
    process.env.DESKTOP_LOCAL === "1"
      ? "http://127.0.0.1:18797"
      : "http://172.21.0.1:8797";
  return (
    process.env.HERMES_WEBUI_URL ||
    process.env.HERMES_KANBAN_URL ||
    desktopDefault
  ).replace(/\/$/, "");
}

function webuiPassword(): string {
  return (process.env.HERMES_WEBUI_PASSWORD || "").trim();
}

export function hermesModelsConfigured(): boolean {
  if ((process.env.HERMES_API_SERVER_KEY || "").trim()) return true;
  return Boolean(webuiPassword());
}

function parseSetCookie(res: Response): string | null {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  const list =
    typeof anyHeaders.getSetCookie === "function"
      ? anyHeaders.getSetCookie()
      : [];
  if (list.length) {
    return list.map((c) => c.split(";")[0]).join("; ");
  }
  const single = res.headers.get("set-cookie");
  if (!single) return null;
  return single.split(",").map((p) => p.split(";")[0].trim()).join("; ");
}

async function login(signal?: AbortSignal): Promise<string> {
  const password = webuiPassword();
  if (!password) {
    cookieHeader = "";
    cookieAt = Date.now();
    return "";
  }
  const res = await fetch(`${webuiBase()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`Hermes WebUI login HTTP ${res.status}`);
  }
  const cookie = parseSetCookie(res);
  if (!cookie) throw new Error("Hermes WebUI : cookie de session absent");
  cookieHeader = cookie;
  cookieAt = Date.now();
  return cookie;
}

async function authCookie(signal?: AbortSignal): Promise<string> {
  if (cookieHeader !== null && Date.now() - cookieAt < COOKIE_TTL_MS) {
    return cookieHeader;
  }
  return login(signal);
}

async function webuiFetch(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
  retried = false,
): Promise<Response> {
  const cookie = await authCookie(init.signal);
  const headers = new Headers(init.headers || {});
  if (cookie) headers.set("Cookie", cookie);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${webuiBase()}${path}`, { ...init, headers });
  if ((res.status === 401 || res.status === 403) && !retried && webuiPassword()) {
    cookieHeader = null;
    await login(init.signal);
    return webuiFetch(path, init, true);
  }
  return res;
}

export function encodeHermesModelId(provider: string, model: string): string {
  return `${provider}::${model}`;
}

export function parseHermesModelId(raw: string | null | undefined): {
  provider: string;
  model: string;
} | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const sep = s.indexOf("::");
  if (sep > 0) {
    return {
      provider: s.slice(0, sep).trim(),
      model: s.slice(sep + 2).trim(),
    };
  }
  // Compat : id nu (conversation / env) → modèle seul, provider à résoudre.
  return { provider: "", model: s };
}

function providerSlug(row: HermesProviderRow): string {
  return String(row.slug || row.id || "").trim();
}

function providerLabel(row: HermesProviderRow): string {
  return String(row.name || row.label || row.slug || row.id || "provider").trim();
}

function listModelIds(row: HermesProviderRow): string[] {
  const raw = row.models;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as { id?: string; model?: string };
      const id = String(o.id || o.model || "").trim();
      if (id) out.push(id);
    }
  }
  return out;
}

function modelDisplayLabel(
  row: HermesProviderRow,
  modelId: string,
  pLabel: string,
): string {
  const fromMap = row.model_labels?.[modelId];
  if (fromMap && String(fromMap).trim()) return String(fromMap).trim();
  // Ids style @openai-api:gpt-5.3-codex → libellé court
  const bare = modelId.includes(":")
    ? modelId.slice(modelId.lastIndexOf(":") + 1)
    : modelId;
  return `${bare} · ${pLabel}`;
}

/** Normalise un id modèle (retire préfixe @provider: si présent). */
export function bareHermesModelName(model: string): string {
  const m = (model || "").trim();
  if (m.startsWith("@") && m.includes(":")) {
    return m.slice(m.indexOf(":") + 1);
  }
  return m;
}

/** Normalise payload agent (`/api/model/options`) ou WebUI standalone (`/api/models`). */
export function normalizeHermesModelsPayload(raw: unknown): {
  providers: HermesProviderRow[];
  model: string;
  provider: string;
} {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // Agent WebUI / desktop embed
  if (Array.isArray(d.providers)) {
    return {
      providers: d.providers as HermesProviderRow[],
      model: String(d.model || "").trim(),
      provider: String(d.provider || "").trim(),
    };
  }

  // hermes-webui standalone : { groups: [{ provider_id, models: [{id,label}] }], ... }
  const groups = Array.isArray(d.groups) ? d.groups : [];
  const providers: HermesProviderRow[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const row = g as Record<string, unknown>;
    const slug = String(row.provider_id || row.slug || row.id || "").trim();
    if (!slug) continue;
    const modelsRaw = [
      ...(Array.isArray(row.models) ? row.models : []),
      ...(Array.isArray(row.extra_models) ? row.extra_models : []),
    ];
    const models: string[] = [];
    const model_labels: Record<string, string> = {};
    for (const item of modelsRaw) {
      if (typeof item === "string" && item.trim()) {
        models.push(item.trim());
        continue;
      }
      if (item && typeof item === "object") {
        const o = item as { id?: string; model?: string; label?: string };
        const id = String(o.id || o.model || "").trim();
        if (!id) continue;
        models.push(id);
        if (o.label && String(o.label).trim()) {
          model_labels[id] = String(o.label).trim();
        }
      }
    }
    providers.push({
      slug,
      id: slug,
      name: String(row.provider || row.name || slug),
      models,
      model_labels,
    });
  }

  return {
    providers,
    model: String(d.default_model || d.model || "").trim(),
    provider: String(d.active_provider || d.provider || "").trim(),
  };
}

export function flattenHermesModelOptions(payload: {
  providers?: HermesProviderRow[];
  model?: string;
  provider?: string;
}): {
  options: HermesModelOption[];
  current: HermesModelOption | null;
  defaultId: string;
} {
  const options: HermesModelOption[] = [];
  const seen = new Set<string>();

  for (const row of payload.providers || []) {
    const provider = providerSlug(row);
    if (!provider) continue;
    const pLabel = providerLabel(row);
    for (const rawModel of listModelIds(row)) {
      // Filtrer embeddings / audio purement non-chat si évident
      const lower = rawModel.toLowerCase();
      if (
        lower.includes("embedding") ||
        lower.includes("whisper") ||
        lower.includes("tts-") ||
        lower.includes("realtime") ||
        lower.includes("transcribe")
      ) {
        continue;
      }
      // Normalise `@openai-api:gpt-5.3-codex` → `gpt-5.3-codex` pour /api/model/set
      const model = bareHermesModelName(rawModel);
      if (!model) continue;
      const id = encodeHermesModelId(provider, model);
      if (seen.has(id)) continue;
      seen.add(id);
      options.push({
        id,
        provider,
        model,
        label: modelDisplayLabel(row, rawModel, pLabel),
      });
    }
  }

  const currentProvider = String(payload.provider || "").trim();
  const currentModel = String(payload.model || "").trim();
  let current: HermesModelOption | null = null;
  if (currentProvider && currentModel) {
    const id = encodeHermesModelId(currentProvider, currentModel);
    current = options.find((o) => o.id === id) || {
      id,
      provider: currentProvider,
      model: currentModel,
      label: `${bareHermesModelName(currentModel)} · ${currentProvider}`,
    };
    if (!options.some((o) => o.id === id)) options.unshift(current);
  }

  const preferred =
    options.find(
      (o) =>
        bareHermesModelName(o.model).toLowerCase() === HERMES_PREFERRED_MODEL &&
        (o.provider === "openai-api" ||
          o.provider === "openai-codex" ||
          o.provider === "custom"),
    ) ||
    options.find(
      (o) => bareHermesModelName(o.model).toLowerCase() === HERMES_PREFERRED_MODEL,
    ) ||
    current ||
    options[0] ||
    null;

  return {
    options,
    current,
    defaultId: preferred?.id || encodeHermesModelId("openai-api", HERMES_PREFERRED_MODEL),
  };
}

export async function listHermesModelOptions(signal?: AbortSignal): Promise<{
  options: HermesModelOption[];
  current: HermesModelOption | null;
  defaultId: string;
  provider: string;
  model: string;
}> {
  if (!hermesModelsConfigured()) {
    throw new Error("Hermes WebUI / API non configurée");
  }
  // Desktop embed (agent) : /api/model/options — VPS hermes-webui : /api/models
  let res = await webuiFetch("/api/model/options", { method: "GET", signal });
  if (res.status === 404) {
    res = await webuiFetch("/api/models", { method: "GET", signal });
  }
  if (!res.ok) {
    throw new Error(`Hermes model options HTTP ${res.status}`);
  }
  const raw = await res.json();
  const normalized = normalizeHermesModelsPayload(raw);
  const flat = flattenHermesModelOptions(normalized);
  return {
    ...flat,
    provider: normalized.provider,
    model: normalized.model,
  };
}

export async function setHermesMainModel(opts: {
  provider: string;
  model: string;
  signal?: AbortSignal;
  confirmExpensive?: boolean;
}): Promise<{ ok: boolean; provider: string; model: string; detail?: string }> {
  if (!hermesModelsConfigured()) {
    throw new Error("Hermes WebUI / API non configurée");
  }
  const provider = opts.provider.trim();
  const model = opts.model.trim();
  if (!provider || !model) {
    throw new Error("provider et model requis");
  }

  const res = await webuiFetch("/api/model/set", {
    method: "POST",
    signal: opts.signal,
    body: JSON.stringify({
      scope: "main",
      provider,
      model,
      confirm_expensive_model: Boolean(opts.confirmExpensive),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    confirm_required?: boolean;
    confirm_message?: string;
    provider?: string;
    model?: string;
    detail?: string;
  };

  if (res.ok && body.confirm_required) {
    // Relance avec confirmation (picker Work : on accepte).
    return setHermesMainModel({ ...opts, confirmExpensive: true });
  }

  if (!res.ok) {
    throw new Error(
      body.detail || body.confirm_message || `Hermes model set HTTP ${res.status}`,
    );
  }

  return {
    ok: body.ok !== false,
    provider: String(body.provider || provider),
    model: String(body.model || model),
    detail: body.confirm_message,
  };
}

function normalizeReasoningStatus(raw: unknown): HermesReasoningStatus {
  const body =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const supported = Array.isArray(body.supported_efforts)
    ? body.supported_efforts
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  const options = Array.from(new Set(["none", ...supported]));
  return {
    effort: String(body.reasoning_effort || "").trim().toLowerCase() || "medium",
    options,
    supported: body.supports_reasoning_effort !== false && supported.length > 0,
    dynamic: true,
  };
}

export async function getHermesReasoningStatus(opts: {
  provider?: string;
  model?: string;
  signal?: AbortSignal;
} = {}): Promise<HermesReasoningStatus> {
  if (!hermesModelsConfigured()) {
    throw new Error("Hermes WebUI / API non configurée");
  }
  const query = new URLSearchParams();
  if (opts.provider?.trim()) query.set("provider", opts.provider.trim());
  if (opts.model?.trim()) query.set("model", opts.model.trim());
  const suffix = query.size ? `?${query.toString()}` : "";
  const res = await webuiFetch(`/api/reasoning${suffix}`, {
    method: "GET",
    signal: opts.signal,
  });
  if (res.status === 404) {
    const configRes = await webuiFetch("/api/config", {
      method: "GET",
      signal: opts.signal,
    });
    const configBody = configRes.ok
      ? ((await configRes.json().catch(() => ({}))) as Record<string, unknown>)
      : {};
    const config =
      configBody.config && typeof configBody.config === "object"
        ? (configBody.config as Record<string, unknown>)
        : configBody;
    const agent =
      config.agent && typeof config.agent === "object"
        ? (config.agent as Record<string, unknown>)
        : {};
    return {
      effort:
        String(agent.reasoning_effort || "").trim().toLowerCase() || "medium",
      options: [...HERMES_REASONING_EFFORTS],
      supported: true,
      dynamic: false,
    };
  }
  if (!res.ok) {
    throw new Error(`Hermes reasoning HTTP ${res.status}`);
  }
  return normalizeReasoningStatus(await res.json());
}

export async function setHermesReasoningEffort(opts: {
  effort: string;
  provider?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<HermesReasoningStatus> {
  if (!hermesModelsConfigured()) {
    throw new Error("Hermes WebUI / API non configurée");
  }
  const effort = opts.effort.trim().toLowerCase();
  if (!effort) throw new Error("reasoning effort requis");
  const res = await webuiFetch("/api/reasoning", {
    method: "POST",
    signal: opts.signal,
    body: JSON.stringify({
      effort,
      ...(opts.provider?.trim() ? { provider: opts.provider.trim() } : {}),
      ...(opts.model?.trim() ? { model: opts.model.trim() } : {}),
    }),
  });
  if (res.status === 404) {
    const fallback = await webuiFetch("/api/config", {
      method: "PUT",
      signal: opts.signal,
      body: JSON.stringify({
        config: { agent: { reasoning_effort: effort } },
      }),
    });
    if (!fallback.ok) {
      throw new Error(`Hermes reasoning config HTTP ${fallback.status}`);
    }
    return {
      effort,
      options: [...HERMES_REASONING_EFFORTS],
      supported: true,
      dynamic: false,
    };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      body && typeof body === "object"
        ? String((body as Record<string, unknown>).error || "")
        : "";
    throw new Error(detail || `Hermes reasoning set HTTP ${res.status}`);
  }
  return normalizeReasoningStatus(body);
}

/**
 * Applique le modèle demandé avant un tour Work.
 * Accepte `provider::model` ou un id nu (cherche dans la liste Hermes).
 */
export async function ensureHermesWorkModel(
  modelRef: string | null | undefined,
  signal?: AbortSignal,
): Promise<{ provider: string; model: string; id: string }> {
  const parsed = parseHermesModelId(modelRef);
  if (parsed?.provider && parsed.model) {
    await setHermesMainModel({
      provider: parsed.provider,
      model: parsed.model,
      signal,
    });
    return {
      provider: parsed.provider,
      model: parsed.model,
      id: encodeHermesModelId(parsed.provider, parsed.model),
    };
  }

  const listed = await listHermesModelOptions(signal);
  const wanted = bareHermesModelName(parsed?.model || HERMES_PREFERRED_MODEL).toLowerCase();
  const match =
    listed.options.find((o) => bareHermesModelName(o.model).toLowerCase() === wanted) ||
    listed.options.find((o) => o.id === listed.defaultId) ||
    listed.current;

  if (!match) {
    throw new Error("Aucun modèle Hermes disponible");
  }

  await setHermesMainModel({
    provider: match.provider,
    model: match.model,
    signal,
  });
  return {
    provider: match.provider,
    model: match.model,
    id: match.id,
  };
}
