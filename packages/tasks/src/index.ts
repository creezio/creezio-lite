/**
 * @creezio/tasks — tâches plateforme (kanban human/ai/hermes + runs + AI).
 * Distinct de PluginTaskRecord (@creezio/product-hub).
 */

/* --- Store plateforme mince (core.db / api-kernel) --- */
export type {
  PlatformTask,
  PlatformTaskStatus,
  PlatformTasksStore,
} from "./types.js";
export { PLATFORM_TASKS_CORE_SQL } from "./types.js";
export { createMemoryTasksStore } from "./memory-store.js";
export type {
  CreateSqliteTasksStoreOptions,
  SqliteTasksStore,
} from "./sqlite-store.js";
export { createSqliteTasksStore } from "./sqlite-store.js";
export type { OpenSqliteDatabase } from "./sqlite-driver.js";
export { openNodeSqliteDatabase } from "./sqlite-driver.js";
export { createTasksApiMount } from "./api-mount.js";
export { upsertKitPlatformTask } from "./env-bridge.js";

/* --- Brand config --- */
export type {
  ResolvedExternalTab,
  ScreencastFrame,
  TasksAuthAdapter,
  TasksBrandConfig,
  TasksDbAdapter,
  TasksExternalTabsAdapter,
  TasksNavAdapter,
  TasksPresenceAdapter,
  TasksScreencastAdapter,
  TasksSession,
  TasksSqliteDb,
  TasksUser,
  TasksUserKind,
  TasksUsersAdapter,
  TasksWorkspaceAdapter,
} from "./brand/config.js";
export {
  configureTasksBrand,
  getTasksBrandConfig,
  requireTasksBrand,
  resetTasksBrandForTests,
  tasksEnv,
  tasksEnvNumber,
} from "./brand/config.js";

/* --- Kanban service --- */
export type {
  CreateTaskInput,
  ExecutorKind,
  Task,
  TaskRow,
  TaskSource,
  TaskStatus,
  UpdateTaskInput,
} from "./kanban-service.js";
export {
  createTask,
  deleteTask,
  EXECUTOR_KINDS,
  getTask,
  getTaskByHermesId,
  getTaskByIdempotency,
  getTaskDetail,
  hermesToTaskStatus,
  KANBAN_COLUMNS,
  listRecurringAiTasks,
  listSubtasks,
  listTasks,
  setTaskNextRun,
  syncHermesTasks,
  TASK_STATUSES,
  tasksByColumn,
  tasksReady,
  tasksRecurrenceReady,
  taskToHermesStatus,
  updateTask,
  updateTaskLocal,
} from "./kanban-service.js";

/* --- Task runs --- */
export type {
  AgentLogEvent,
  AgentLogLevel,
  AgentSessionLog,
  RunStatus,
  TaskRunRow,
} from "./task-runs.js";
export {
  appendAgentLog,
  bumpRunStepCount,
  cancelTaskRun,
  claimNextQueuedRun,
  clearHitlResponse,
  countRunningRuns,
  countRunsCreatedToday,
  enqueueTaskRun,
  finishTaskRun,
  getActiveRunForAssignee,
  getRunningRun,
  getTaskRun,
  isHitlPaused,
  listAgentLogs,
  listRunningRuns,
  listTaskRunsForTask,
  maxConcurrentAiRuns,
  openDetachedHitlRun,
  purgeAgentLogsOlderThan,
  resumeHitlRun,
  RUN_STATUSES,
  setHitlPrompt,
  subscribeAgentLogs,
  subscribeTaskRuns,
  sumUsageTokensToday,
  taskRunsHitlReady,
  taskRunsReady,
  taskRunsTokensReady,
} from "./task-runs.js";

/* --- AI agent / runner --- */
export type {
  AiTaskAgentContext,
  AiTaskAgentOutcome,
  AskHumanFn,
} from "./ai-task-agent.js";
export {
  aiTaskMaxSteps,
  aiTaskMaxTokens,
  aiTaskModel,
  aiTaskTimeoutMs,
  aiWebHostAllowed,
  buildAiTaskTools,
  hasAiAgentModel,
  runAiTaskAgent,
  setAiTaskModelCaller,
} from "./ai-task-agent.js";
export {
  aiRunnerEnabled,
  checkAiRunQuotas,
  ensureAiRunnerLoop,
  enqueueAiRunForTask,
  getAiActivityForUser,
  hostBridgeReady,
  parseRecurringSchedule,
  processAiTaskQueue,
  processRecurringAiTasks,
  recoverInterruptedRuns,
  resolveHostTargetUserId,
  retryFailedRun,
  stopAiRunnerLoop,
} from "./ai-task-runner.js";

/* --- HTTP + assistant --- */
export { createTasksHonoRoutes } from "./hono-routes.js";
export { createAssistantTasksAdapter } from "./assistant-adapter.js";

/* --- MCP host-only AI tasks (D-P18) --- */
export type {
  AiTaskHostMcpRegisterFn,
  AiTaskHostMcpToolConfig,
  AiTaskToolParseResult,
  CreateAiTaskHostMcpToolsOptions,
  CreezioAiTaskHostMcpToolName,
} from "./mcp-host-tools.js";
export {
  CREEZIO_AI_TASK_HOST_MCP_TOOL_NAMES,
  CREEZIO_LIST_TASKS_MCP_TOOL_NAME,
  aiTaskToolJsonSchema,
  createAiTaskHostMcpTools,
  parseAiTaskToolInput,
} from "./mcp-host-tools.js";

/* --- MCP workspace + HITL async (H4 Hermes cerveau unique) --- */
export type {
  CreateAiWorkspaceMcpToolsOptions,
  CreezioAiWorkspaceMcpToolName,
} from "./mcp-workspace-tools.js";
export {
  CREEZIO_AI_WORKSPACE_MCP_TOOL_NAMES,
  createAiWorkspaceMcpTools,
} from "./mcp-workspace-tools.js";
