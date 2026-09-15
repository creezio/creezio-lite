/**
 * Client Hermes Kanban (WebUI) — CRUD + board pour sync CRM.
 * Tenant / skills via configureAssistantBrand({ hermes }).
 *
 * Auth :
 * - Desktop embarqué (loopback) : pas de password → auth WebUI off → pas de cookie.
 * - Si `HERMES_WEBUI_PASSWORD` est défini : login → cookie session (mémoire process).
 */

import { assistantHermes } from "../brand/registry.js";

export type HermesKanbanStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

export type HermesKanbanTask = {
  id: string;
  title: string;
  body?: string | null;
  status: HermesKanbanStatus | string;
  priority?: number;
  tenant?: string | null;
  assignee?: string | null;
  result?: string | null;
  idempotency_key?: string | null;
  created_at?: number | null;
  completed_at?: number | null;
  skills?: string[] | null;
};

function kanbanTenant(): string {
  return assistantHermes().kanbanTenant || "creezio-crm";
}
function defaultTaskSkills(): string[] {
  return assistantHermes().kanbanTaskSkills ?? [];
}
function defaultCronSkills(): string[] {
  return assistantHermes().kanbanCronSkills ?? [];
}
function createdBy(): string {
  return assistantHermes().kanbanCreatedBy || "creezio-crm";
}

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

export function hermesKanbanConfigured(): boolean {
  // Password optionnel (loopback auth off). Signal « branché » :
  // - clé API gateway injectée par Electron quand Hermes tourne / remote, OU
  // - password WebUI (déploiements authés hors desktop).
  // Les stubs de ports (getHermesNextEnv sans process) ne suffisent pas.
  if ((process.env.HERMES_API_SERVER_KEY || "").trim()) return true;
  return Boolean(webuiPassword());
}

function parseSetCookie(res: Response): string | null {
  // Node fetch : getSetCookie() si dispo
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
    // Auth WebUI désactivée (cas desktop embarqué) — pas de cookie requis.
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

async function kanbanFetch(
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
    return kanbanFetch(path, init, true);
  }
  return res;
}

export async function hermesKanbanCreateTask(opts: {
  title: string;
  body?: string;
  status?: HermesKanbanStatus;
  priority?: number;
  idempotencyKey?: string;
  skills?: string[];
  signal?: AbortSignal;
}): Promise<HermesKanbanTask> {
  const res = await kanbanFetch("/api/kanban/tasks", {
    method: "POST",
    signal: opts.signal,
    body: JSON.stringify({
      title: opts.title,
      body: opts.body || "",
      status: opts.status || "ready",
      priority: opts.priority ?? 0,
      tenant: kanbanTenant(),
      triage: false,
      created_by: createdBy(),
      idempotency_key: opts.idempotencyKey,
      skills: opts.skills?.length ? opts.skills : defaultTaskSkills(),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    task?: HermesKanbanTask;
    error?: string;
  };
  if (!res.ok || !data.task) {
    throw new Error(data.error || `Hermes kanban create HTTP ${res.status}`);
  }
  return data.task;
}

export type HermesKanbanTaskDetail = {
  task: HermesKanbanTask & {
    last_failure_error?: string | null;
    session_id?: string | null;
    created_by?: string | null;
    started_at?: number | null;
    completed_at?: number | null;
    age_seconds?: {
      created_age_seconds?: number | null;
      started_age_seconds?: number | null;
      time_to_complete_seconds?: number | null;
    } | null;
    progress?: unknown;
  };
  comments: {
    id?: number | string;
    body?: string;
    author?: string;
    created_at?: number;
  }[];
  events: {
    id?: number;
    kind?: string;
    payload?: Record<string, unknown>;
    created_at?: number;
    run_id?: string | null;
  }[];
  runs: {
    id?: string;
    status?: string;
    started_at?: number | null;
    finished_at?: number | null;
    summary?: string | null;
    error?: string | null;
  }[];
  links?: { parents?: unknown[]; children?: unknown[] };
};

export async function hermesKanbanGetTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<HermesKanbanTaskDetail> {
  const res = await kanbanFetch(
    `/api/kanban/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET", signal },
  );
  const data = (await res.json().catch(() => ({}))) as HermesKanbanTaskDetail & {
    error?: string;
  };
  if (!res.ok || !data.task) {
    throw new Error(data.error || `Hermes kanban get HTTP ${res.status}`);
  }
  return {
    task: data.task,
    comments: data.comments || [],
    events: data.events || [],
    runs: data.runs || [],
    links: data.links,
  };
}

export async function hermesKanbanPatchTask(
  taskId: string,
  patch: {
    status?: HermesKanbanStatus;
    title?: string;
    body?: string;
    result?: string;
    priority?: number;
  },
  signal?: AbortSignal,
): Promise<HermesKanbanTask> {
  const res = await kanbanFetch(`/api/kanban/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    signal,
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as {
    task?: HermesKanbanTask;
    error?: string;
  };
  if (!res.ok || !data.task) {
    // fallback POST …/patch
    const res2 = await kanbanFetch(
      `/api/kanban/tasks/${encodeURIComponent(taskId)}/patch`,
      {
        method: "POST",
        signal,
        body: JSON.stringify(patch),
      },
    );
    const data2 = (await res2.json().catch(() => ({}))) as {
      task?: HermesKanbanTask;
      error?: string;
    };
    if (!res2.ok || !data2.task) {
      throw new Error(
        data2.error || data.error || `Hermes kanban patch HTTP ${res.status}`,
      );
    }
    return data2.task;
  }
  return data.task;
}

export async function hermesKanbanListTasks(signal?: AbortSignal): Promise<HermesKanbanTask[]> {
  const res = await kanbanFetch(
    `/api/kanban/board?tenant=${encodeURIComponent(kanbanTenant())}&include_archived=0`,
    { method: "GET", signal },
  );
  const data = (await res.json().catch(() => ({}))) as {
    columns?: { name?: string; tasks?: HermesKanbanTask[] }[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Hermes kanban board HTTP ${res.status}`);
  }
  const out: HermesKanbanTask[] = [];
  for (const col of data.columns || []) {
    for (const t of col.tasks || []) {
      out.push({ ...t, status: t.status || col.name || "todo" });
    }
  }
  return out;
}

export async function hermesKanbanDispatch(signal?: AbortSignal): Promise<unknown> {
  const res = await kanbanFetch("/api/kanban/dispatch?max=3", {
    method: "POST",
    signal,
  });
  return res.json().catch(() => ({}));
}

/** Crée un job cron Hermes (récurrence). */
export async function hermesCronCreate(opts: {
  schedule: string;
  prompt: string;
  name?: string;
  signal?: AbortSignal;
}): Promise<{ id?: string; raw: string }> {
  // WebUI cron API
  const res = await kanbanFetch("/api/crons/create", {
    method: "POST",
    signal: opts.signal,
    body: JSON.stringify({
      schedule: opts.schedule,
      prompt: opts.prompt,
      name: opts.name || opts.prompt.slice(0, 60),
      skills: defaultCronSkills(),
      deliver: "local",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Hermes cron create HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    const data = JSON.parse(text) as { id?: string; job?: { id?: string } };
    return { id: data.id || data.job?.id, raw: text };
  } catch {
    return { raw: text };
  }
}

export const HERMES_KANBAN_TENANT = kanbanTenant;
export { kanbanTenant as getHermesKanbanTenant };
