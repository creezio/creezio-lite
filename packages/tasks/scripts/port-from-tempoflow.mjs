/**
 * One-shot port TempoFlow gold → @creezio/tasks (platform-generic).
 * Run from packages/tasks: node scripts/port-from-tempoflow.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(__dirname, "..");
const SRC = path.join(PKG, "src");
const TF = path.resolve(PKG, "../../../tempoflow2/crm/src");

function readTf(rel) {
  return fs.readFileSync(path.join(TF, rel), "utf8");
}

function writeSrc(rel, content) {
  const dest = path.join(SRC, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log("wrote", rel, content.split("\n").length, "lines");
}

const BRAND_CONFIG = `/**
 * Configuration marque pour le runtime tasks plateforme.
 * Les marques appellent \`configureTasksBrand\` au boot (server / instrumentation).
 */
import type { Context } from "hono";

export type TasksUserKind = "human" | "ai";

export type TasksUser = {
  id: string;
  username: string;
  role: "owner" | "collaborator";
  kind: TasksUserKind;
  active: boolean;
  permissions: string[];
};

export type TasksSession = {
  sub: string;
  email: string;
  role: "owner" | "collaborator";
  permissions?: string[];
  actorSub?: string;
  actorRole?: "owner";
};

export type TasksSqliteStatement = {
  run: (...args: unknown[]) => { changes: number };
  get: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown[];
};

export type TasksSqliteDb = {
  prepare: (sql: string) => TasksSqliteStatement;
};

export type TasksDbAdapter = {
  getWriteDb: () => TasksSqliteDb;
  queryAll: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => T[];
  queryOne: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => T | null | undefined;
  tableExists: (name: string) => boolean;
};

export type TasksUsersAdapter = {
  getById: (id: string) => TasksUser | null;
  list: () => TasksUser[];
  getOwner: () => TasksUser | null;
  ready: () => boolean;
};

export type TasksPresenceAdapter = {
  isDesktopOnline: (userId: string) => boolean;
  listOnlineBridges: () => Array<{
    userId: string;
    deviceId: string;
    deviceLabel?: string | null;
    bridgeConnected: boolean;
    online: boolean;
  }>;
};

export type TasksWorkspaceAdapter = {
  ensureOnHost: (opts: {
    aiUserId: string;
    hostUserId: string;
  }) => Promise<unknown>;
  navigate: (opts: {
    aiUserId: string;
    hostUserId: string;
    path: string;
  }) => Promise<Record<string, unknown>>;
  openTab: (opts: {
    aiUserId: string;
    hostUserId: string;
    url: string;
    title?: string;
    params?: Record<string, unknown>;
  }) => Promise<Record<string, unknown>>;
  listTabs: (opts: {
    aiUserId: string;
    hostUserId: string;
  }) => Promise<Record<string, unknown>>;
  webAction: (opts: {
    aiUserId: string;
    hostUserId: string;
    webType: string;
    params: Record<string, unknown>;
    tabId?: string;
  }) => Promise<Record<string, unknown>>;
  startScreencast: (
    aiUserId: string,
    hostUserId: string,
  ) => Promise<unknown>;
  stopScreencast: (
    aiUserId: string,
    hostUserId: string,
  ) => Promise<unknown>;
};

export type TasksNavAdapter = {
  permissionForPath: (pathname: string) => string | null;
  hasPermission: (
    permissions: readonly string[] | undefined,
    required: string | null,
  ) => boolean;
};

export type ResolvedExternalTab = {
  url: string;
  title?: string;
  params?: Record<string, unknown>;
};

export type TasksExternalTabsAdapter = {
  resolve: (input: {
    url?: string;
    fournisseurId?: string | number;
    title?: string;
  }) =>
    | { ok: true; value: ResolvedExternalTab }
    | { ok: false; error: string; code?: string };
  toWorkspaceParams: (resolved: ResolvedExternalTab) => Record<string, unknown>;
};

export type TasksScreencastAdapter = {
  viewerCount: (aiUserId: string) => number;
  subscribe: (
    aiUserId: string,
    listener: (frame: { jpegBase64: string; ts?: number }) => void,
  ) => () => void;
};

export type TasksAuthAdapter = {
  getSessionFromContext: (c: Context) => Promise<TasksSession | null>;
  sessionActorIsOwner: (session: TasksSession | null) => boolean;
  sessionIsImpersonating: (session: TasksSession | null) => boolean;
};

export type TasksBrandConfig = {
  /** Nom produit (prompt agent, labels Hermes). */
  productName: string;
  /** Description courte domaine métier pour le prompt agent. */
  productDomain: string;
  /** Label footer Hermes, ex. "TempoFlow CRM". */
  hermesSourceLabel: string;
  /** Skill Hermes à charger, ex. "tempoflow2-crm". */
  hermesSkill: string;
  /** Préfixe env AI, ex. "TF2_AI" → TF2_AI_MODEL, etc. */
  envPrefix: string;
  /** Préfixe idempotency clés CRM, ex. "crm". */
  idempotencyPrefix: string;
  /** Préfixe idempotency assistant, ex. "asst". */
  assistantIdempotencyPrefix: string;
  /** Chemin UI kanban, défaut "/taches". */
  taskHref: string;
  /** Exemples de routes dans le prompt agent. */
  examplePaths: string[];

  db: TasksDbAdapter;
  users: TasksUsersAdapter;
  presence: TasksPresenceAdapter;
  workspace: TasksWorkspaceAdapter;
  navigation: TasksNavAdapter;
  externalTabs: TasksExternalTabsAdapter;
  screencast: TasksScreencastAdapter;
  auth: TasksAuthAdapter;
};

let brandConfig: TasksBrandConfig | null = null;

export function configureTasksBrand(config: TasksBrandConfig): void {
  brandConfig = config;
}

export function getTasksBrandConfig(): TasksBrandConfig | null {
  return brandConfig;
}

export function requireTasksBrand(): TasksBrandConfig {
  if (!brandConfig) {
    throw new Error(
      "@creezio/tasks: configureTasksBrand() requis avant d'utiliser le runtime kanban",
    );
  }
  return brandConfig;
}

export function resetTasksBrandForTests(): void {
  brandConfig = null;
}

/** Lit process.env[\`\${envPrefix}_\${suffix}\`]. */
export function tasksEnv(suffix: string, fallback = ""): string {
  const cfg = brandConfig;
  const prefix = cfg?.envPrefix || "CREEZIO_AI";
  return (process.env[\`\${prefix}_\${suffix}\`] || fallback).trim();
}

export function tasksEnvNumber(suffix: string, fallback: number): number {
  const raw = Number(tasksEnv(suffix, String(fallback)));
  return Number.isFinite(raw) ? raw : fallback;
}
`;

writeSrc("brand/config.ts", BRAND_CONFIG);

// --- kanban-service ---
{
  let s = readTf("lib/tasks.ts");
  s = s.replace(/^import "@\/lib\/assistant\/configure-brand";\n/, "");
  s = s.replace(
    `import { randomUUID } from "crypto";\nimport {\n  hermesCronCreate,\n  hermesKanbanConfigured,\n  hermesKanbanCreateTask,\n  hermesKanbanDispatch,\n  hermesKanbanGetTask,\n  hermesKanbanListTasks,\n  hermesKanbanPatchTask,\n  type HermesKanbanStatus,\n  type HermesKanbanTask,\n  type HermesKanbanTaskDetail,\n} from "@creezio/assistant";\nimport { getWriteDb, queryAll, queryOne, tableExists } from "@/lib/db";\nimport { upsertKitPlatformTask } from "@creezio/tasks";\nimport { getUserById } from "@/lib/users";\n`,
    `import { randomUUID } from "node:crypto";\nimport {\n  hermesCronCreate,\n  hermesKanbanConfigured,\n  hermesKanbanCreateTask,\n  hermesKanbanDispatch,\n  hermesKanbanGetTask,\n  hermesKanbanListTasks,\n  hermesKanbanPatchTask,\n  type HermesKanbanStatus,\n  type HermesKanbanTask,\n  type HermesKanbanTaskDetail,\n} from "@creezio/assistant";\nimport { requireTasksBrand, type TasksUser } from "./brand/config.js";\nimport { upsertKitPlatformTask } from "./env-bridge.js";\n\nfunction getWriteDb() {\n  return requireTasksBrand().db.getWriteDb();\n}\nfunction queryAll<T>(sql: string, params: unknown[] = []): T[] {\n  return requireTasksBrand().db.queryAll<T>(sql, params);\n}\nfunction queryOne<T>(sql: string, params: unknown[] = []): T | null | undefined {\n  return requireTasksBrand().db.queryOne<T>(sql, params);\n}\nfunction tableExists(name: string): boolean {\n  return requireTasksBrand().db.tableExists(name);\n}\nfunction getUserById(id: string): TasksUser | null {\n  return requireTasksBrand().users.getById(id);\n}\n`,
  );
  s = s.replace(
    `export type Task = TaskRow & {\n  assignee: ReturnType<typeof getUserById>;\n};`,
    `export type Task = TaskRow & {\n  assignee: TasksUser | null;\n};`,
  );
  s = s.replace(
    `"Source: TempoFlow CRM"`,
    `\`Source: \${requireTasksBrand().hermesSourceLabel}\``,
  );
  s = s.replace(
    `idempotencyKey: task.idempotency_key || \`crm:\${task.id}\`,`,
    `idempotencyKey: task.idempotency_key || \`\${requireTasksBrand().idempotencyPrefix}:\${task.id}\`,`,
  );
  s = s.replace(
    `\`Tâche récurrente TempoFlow CRM « \${task.title} ».\,\``,
    `\`Tâche récurrente \${requireTasksBrand().hermesSourceLabel} « \${task.title} ».\,\``,
  );
  // Fix the recurring prompt line carefully
  s = s.replace(
    /Tâche récurrente TempoFlow CRM « \$\{task\.title\} »\./g,
    "Tâche récurrente ${requireTasksBrand().hermesSourceLabel} « ${task.title} ».",
  );
  s = s.replace(
    `"Charge le skill tempoflow2-crm.",`,
    `\`Charge le skill \${requireTasksBrand().hermesSkill}.\`,`,
  );
  s = s.replace(
    `idempotency_key: input.idempotencyKey?.trim() || \`crm:\${id}\`,`,
    `idempotency_key: input.idempotencyKey?.trim() || \`\${requireTasksBrand().idempotencyPrefix}:\${id}\`,`,
  );
  s = s.replace(
    `throw new Error("Table tasks absente (migration 029 requise)");`,
    `throw new Error("Table tasks absente (schéma tasks plateforme requis)");`,
  );
  s = s.replace(
    /migration 029/gi,
    "schéma tasks plateforme",
  );
  writeSrc("kanban-service.ts", s);
}

// --- task-runs ---
{
  let s = readTf("lib/task-runs.ts");
  s = s.replace(
    `import { randomUUID } from "crypto";\nimport { getWriteDb, queryAll, queryOne, tableExists } from "@/lib/db";\n`,
    `import { randomUUID } from "node:crypto";\nimport { requireTasksBrand, tasksEnv } from "./brand/config.js";\n\nfunction getWriteDb() {\n  return requireTasksBrand().db.getWriteDb();\n}\nfunction queryAll<T>(sql: string, params: unknown[] = []): T[] {\n  return requireTasksBrand().db.queryAll<T>(sql, params);\n}\nfunction queryOne<T>(sql: string, params: unknown[] = []): T | null | undefined {\n  return requireTasksBrand().db.queryOne<T>(sql, params);\n}\nfunction tableExists(name: string): boolean {\n  return requireTasksBrand().db.tableExists(name);\n}\n`,
  );
  s = s.replace(/__tf2AgentLogListeners/g, "__creezioTasksAgentLogListeners");
  s = s.replace(/__tf2AgentRunListeners/g, "__creezioTasksAgentRunListeners");
  s = s.replace(
    `const raw = Number(process.env.TF2_AI_MAX_CONCURRENT || "2");`,
    `const raw = Number(tasksEnv("MAX_CONCURRENT", "2") || "2");`,
  );
  s = s.replace(/TF2_AI_MAX_RUNS_PER_DAY/g, "MAX_RUNS_PER_DAY (envPrefix)");
  s = s.replace(/TF2_AI_MAX_TOKENS_PER_DAY/g, "MAX_TOKENS_PER_DAY (envPrefix)");
  s = s.replace(/TF2_AI_MAX_CONCURRENT/g, "MAX_CONCURRENT (envPrefix)");
  s = s.replace(
    /Migration 018 requise/g,
    "schéma task_runs plateforme requis",
  );
  writeSrc("task-runs.ts", s);
}

// --- ai-task-agent ---
{
  let s = readTf("lib/ai-task-agent.ts");
  s = s.replace(/^import "@\/lib\/assistant\/configure-brand";\n/, "");
  s = s.replace(
    `import {\n  listTabsInAiWorkspace,\n  navigateAiWorkspace,\n  openTabInAiWorkspace,\n  webActionInAiWorkspace,\n} from "@/lib/ai-workspace";\nimport { hasPermission, permissionForPath } from "@/lib/nav-config";\nimport {\n  resolveOpenTabRequest,\n  toSupplierOpenTabParams,\n} from "@/lib/open-external-tab";\nimport { createTask, type Task } from "@/lib/tasks";\nimport type { PublicUser } from "@/lib/users";\n`,
    `import {\n  requireTasksBrand,\n  tasksEnv,\n  tasksEnvNumber,\n  type TasksUser,\n} from "./brand/config.js";\nimport { createTask, type Task } from "./kanban-service.js";\n\ntype PublicUser = TasksUser;\n\nfunction navigateAiWorkspace(opts: {\n  aiUserId: string;\n  hostUserId: string;\n  path: string;\n}) {\n  return requireTasksBrand().workspace.navigate(opts);\n}\nfunction openTabInAiWorkspace(opts: {\n  aiUserId: string;\n  hostUserId: string;\n  url: string;\n  title?: string;\n  params?: Record<string, unknown>;\n}) {\n  return requireTasksBrand().workspace.openTab(opts);\n}\nfunction listTabsInAiWorkspace(opts: {\n  aiUserId: string;\n  hostUserId: string;\n}) {\n  return requireTasksBrand().workspace.listTabs(opts);\n}\nfunction webActionInAiWorkspace(opts: {\n  aiUserId: string;\n  hostUserId: string;\n  webType: string;\n  params: Record<string, unknown>;\n  tabId?: string;\n}) {\n  return requireTasksBrand().workspace.webAction(opts);\n}\nfunction hasPermission(\n  permissions: readonly string[] | undefined,\n  required: string | null,\n) {\n  return requireTasksBrand().navigation.hasPermission(permissions, required);\n}\nfunction permissionForPath(pathname: string) {\n  return requireTasksBrand().navigation.permissionForPath(pathname);\n}\nfunction resolveOpenTabRequest(input: {\n  url?: string;\n  fournisseur_id?: string | number;\n  fournisseurId?: string | number;\n  title?: string;\n}) {\n  return requireTasksBrand().externalTabs.resolve({\n    url: input.url,\n    fournisseurId: input.fournisseurId ?? input.fournisseur_id,\n    title: input.title,\n  });\n}\nfunction toSupplierOpenTabParams(resolved: {\n  url: string;\n  title?: string;\n  params?: Record<string, unknown>;\n}) {\n  return requireTasksBrand().externalTabs.toWorkspaceParams(resolved);\n}\n`,
  );
  s = s.replace(
    `return (process.env.TF2_AI_MODEL || "").trim() || defaultModel();`,
    `return tasksEnv("MODEL") || defaultModel();`,
  );
  s = s.replace(
    `const raw = Number(process.env.TF2_AI_MAX_STEPS || "20");`,
    `const raw = tasksEnvNumber("MAX_STEPS", 20);`,
  );
  s = s.replace(
    `const raw = Number(process.env.TF2_AI_RUN_TIMEOUT_MS || String(10 * 60 * 1000));`,
    `const raw = tasksEnvNumber("RUN_TIMEOUT_MS", 10 * 60 * 1000);`,
  );
  s = s.replace(
    `const raw = Number(process.env.TF2_AI_MAX_TOKENS || "150000");`,
    `const raw = tasksEnvNumber("MAX_TOKENS", 150_000);`,
  );
  s = s.replace(
    `const raw = (process.env.TF2_AI_WEB_ALLOWED_HOSTS || "").trim();`,
    `const raw = tasksEnv("WEB_ALLOWED_HOSTS");`,
  );
  s = s.replace(
    /TF2_AI_WEB_ALLOWED_HOSTS/g,
    "${requireTasksBrand().envPrefix}_WEB_ALLOWED_HOSTS",
  );
  // Fix the template string that now has wrong quotes after replace
  s = s.replace(
    `error: \`Hôte « \${host} » hors de l'allowlist \${requireTasksBrand().envPrefix}_WEB_ALLOWED_HOSTS — demande à l'humain si nécessaire\`,`,
    `error: \`Hôte « \${host} » hors de l'allowlist \${requireTasksBrand().envPrefix}_WEB_ALLOWED_HOSTS — demande à l'humain si nécessaire\`,`,
  );
  s = s.replace(
    `return \`Tu es « \${ctx.assignee.username} », collaborateur IA de TempoFlow (CRM achats restauration).`,
    `const brand = requireTasksBrand();\n  return \`Tu es « \${ctx.assignee.username} », collaborateur IA de \${brand.productName} (\${brand.productDomain}).`,
  );
  s = s.replace(
    `- Kanban des tâches : /taches`,
    `- Kanban des tâches : \${brand.taskHref}`,
  );
  // Fix example paths if present later
  s = s.replace(
    /\/produits|\/marketplaces|\/panier/g,
    (m) => m, // leave for now; brand prompt uses examplePaths below if we inject
  );
  writeSrc("ai-task-agent.ts", s);
}

// --- ai-task-runner ---
{
  let s = readTf("lib/ai-task-runner.ts");
  s = s.replace(
    `import {\n  hasAiAgentModel,\n  runAiTaskAgent,\n} from "@/lib/ai-task-agent";\nimport { ensureAiWorkspaceOnHost } from "@/lib/ai-workspace";\nimport {\n  isDesktopOnline,\n  listOnlineBridges,\n} from "@/lib/desktop-presence";\nimport {\n  getTask,\n  listRecurringAiTasks,\n  setTaskNextRun,\n  updateTaskLocal,\n  type Task,\n} from "@/lib/tasks";\nimport {\n  appendAgentLog,\n  claimNextQueuedRun,\n  clearHitlResponse,\n  countRunsCreatedToday,\n  enqueueTaskRun,\n  finishTaskRun,\n  getActiveRunForAssignee,\n  getTaskRun,\n  isHitlPaused,\n  listRunningRuns,\n  maxConcurrentAiRuns,\n  setHitlPrompt,\n  sumUsageTokensToday,\n  type TaskRunRow,\n} from "@/lib/task-runs";\nimport { getOwner, getUserById } from "@/lib/users";\n`,
    `import {\n  hasAiAgentModel,\n  runAiTaskAgent,\n} from "./ai-task-agent.js";\nimport { requireTasksBrand, tasksEnv } from "./brand/config.js";\nimport {\n  getTask,\n  listRecurringAiTasks,\n  setTaskNextRun,\n  updateTaskLocal,\n  type Task,\n} from "./kanban-service.js";\nimport {\n  appendAgentLog,\n  claimNextQueuedRun,\n  clearHitlResponse,\n  countRunsCreatedToday,\n  enqueueTaskRun,\n  finishTaskRun,\n  getActiveRunForAssignee,\n  getTaskRun,\n  isHitlPaused,\n  listRunningRuns,\n  maxConcurrentAiRuns,\n  setHitlPrompt,\n  sumUsageTokensToday,\n  type TaskRunRow,\n} from "./task-runs.js";\n\nfunction ensureAiWorkspaceOnHost(opts: {\n  aiUserId: string;\n  hostUserId: string;\n}) {\n  return requireTasksBrand().workspace.ensureOnHost(opts);\n}\nfunction isDesktopOnline(userId: string) {\n  return requireTasksBrand().presence.isDesktopOnline(userId);\n}\nfunction listOnlineBridges() {\n  return requireTasksBrand().presence.listOnlineBridges();\n}\nfunction getOwner() {\n  return requireTasksBrand().users.getOwner();\n}\nfunction getUserById(id: string) {\n  return requireTasksBrand().users.getById(id);\n}\n`,
  );
  s = s.replace(/__tf2AiRunnerActive/g, "__creezioTasksAiRunnerActive");
  s = s.replace(/__tf2AiRunnerTimer/g, "__creezioTasksAiRunnerTimer");
  s = s.replace(/__tf2AiRecurrenceTimer/g, "__creezioTasksAiRecurrenceTimer");
  s = s.replace(/__tf2AiRunnerInflight/g, "__creezioTasksAiRunnerInflight");
  s = s.replace(
    `const v = (process.env.TF2_AI_RUNNER_ENABLED || "1").toLowerCase();`,
    `const v = (tasksEnv("RUNNER_ENABLED", "1") || "1").toLowerCase();`,
  );
  s = s.replace(
    `function envQuota(name: string): number | null {\n  const raw = Number((process.env[name] || "").trim());\n  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;\n}`,
    `function envQuota(suffix: string): number | null {\n  const raw = Number(tasksEnv(suffix));\n  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;\n}`,
  );
  s = s.replace(
    `const maxRuns = envQuota("TF2_AI_MAX_RUNS_PER_DAY");`,
    `const maxRuns = envQuota("MAX_RUNS_PER_DAY");`,
  );
  s = s.replace(
    /TF2_AI_MAX_RUNS_PER_DAY/g,
    "${requireTasksBrand().envPrefix}_MAX_RUNS_PER_DAY",
  );
  s = s.replace(
    `const maxTokens = envQuota("TF2_AI_MAX_TOKENS_PER_DAY");`,
    `const maxTokens = envQuota("MAX_TOKENS_PER_DAY");`,
  );
  s = s.replace(
    /TF2_AI_MAX_TOKENS_PER_DAY/g,
    "${requireTasksBrand().envPrefix}_MAX_TOKENS_PER_DAY",
  );
  s = s.replace(
    `const env = (process.env.TF2_AI_HITL || "").toLowerCase();`,
    `const env = tasksEnv("HITL").toLowerCase();`,
  );
  s = s.replace(/TF2_AI_HITL/g, "HITL (envPrefix)");
  s = s.replace(
    /Configuration → Clés IA/g,
    "Configuration → Clés IA",
  );
  writeSrc("ai-task-runner.ts", s);
}

console.log("core service files ported; routes/adapter handled separately");
