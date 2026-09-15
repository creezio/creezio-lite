/**
 * Handlers create_task / list_tasks (O4r) — SoT kit + adapter marque.
 */
import { assistantTasks } from "../brand/registry.js";
import {
  PLATFORM_TASK_TOOL_ALIASES,
  PLATFORM_TASK_TOOL_DEFINITIONS,
} from "./platform-tool-definitions.js";
import type { AssistantToolDefinition } from "../brand/types.js";

function resolveTaskAction(
  name: string,
): "create" | "list" | null {
  const tasks = assistantTasks();
  if (!tasks) return null;
  if (name === "create_task" || name === "create_todo") return "create";
  if (name === "list_tasks" || name === "list_todos") return "list";
  const createAliases = tasks.aliases?.create || [];
  const listAliases = tasks.aliases?.list || [];
  if (createAliases.includes(name)) return "create";
  if (listAliases.includes(name)) return "list";
  if (name in PLATFORM_TASK_TOOL_ALIASES) {
    const canon =
      PLATFORM_TASK_TOOL_ALIASES[
        name as keyof typeof PLATFORM_TASK_TOOL_ALIASES
      ];
    return canon === "create_task" ? "create" : "list";
  }
  return null;
}

export function taskToolDefinitions(): AssistantToolDefinition[] {
  if (!assistantTasks()) return [];
  const tasks = assistantTasks()!;
  const defs = [...PLATFORM_TASK_TOOL_DEFINITIONS];
  // feature-off : exposer aussi create_todo / list_todos comme noms LLM
  const wantTodo =
    (tasks.aliases?.create || []).includes("create_todo") ||
    (tasks.aliases?.list || []).includes("list_todos") ||
    true; // toujours exposer aliases todo pour compat prompts Fidu
  if (wantTodo) {
    for (const [alias, canon] of Object.entries(PLATFORM_TASK_TOOL_ALIASES)) {
      const base = defs.find((d) => d.function.name === canon);
      if (!base) continue;
      if (defs.some((d) => d.function.name === alias)) continue;
      defs.push({
        type: "function",
        function: {
          name: alias,
          description: `${base.function.description} (alias ${canon})`,
          parameters: base.function.parameters,
        },
      });
    }
  }
  return defs;
}

export async function executeTaskTool(
  name: string,
  args: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const action = resolveTaskAction(name);
  if (!action) return null;
  const tasks = assistantTasks();
  if (!tasks) return null;
  if (action === "create") return tasks.create(args, ctx);
  return tasks.list(args, ctx);
}
