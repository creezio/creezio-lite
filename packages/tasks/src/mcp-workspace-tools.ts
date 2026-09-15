/**
 * H4 « Hermes cerveau unique » — verbes navigateur exposés directement à
 * Hermes via MCP : wrappers FINS de l'espace IA (mêmes payloads que
 * `buildAiTaskTools`, même bridge `dispatchSupplierAction` derrière les
 * adapters `workspace.*` de la marque).
 *
 * Sécurité :
 * - `ai_user_id` OBLIGATOIRE — l'action s'exécute dans le workspace du
 *   collaborateur IA (partition/screencast/ACL existants), jamais « nu » ;
 * - gate acteur owner/service (même décision que mcp-host-tools : la clé
 *   service Hermes est mappée owner par la façade) ;
 * - allowlist `*_WEB_ALLOWED_HOSTS` : garde runner ici (message clair) + H0
 *   au niveau host (défense en profondeur, `web_host_not_allowed`).
 *
 * HITL asynchrone : `platform.ask_human` crée une tâche kanban + un run HITL
 * détaché (`openDetachedHitlRun`, infra `task_runs.hitl_prompt` réutilisée —
 * voir justification dans task-runs.ts) ; `platform.get_human_answer` poll
 * par id et clôt le run à la lecture de la réponse. Le canal de réponse
 * humain reste l'UI existante (kanban / answer_ai_question).
 */
import { z } from "zod";
import { requireTasksBrand } from "./brand/config.js";
import { aiWebHostAllowed } from "./ai-task-agent.js";
import { resolveHostTargetUserId } from "./ai-task-runner.js";
import { createTask, getTask, updateTask } from "./kanban-service.js";
import {
  finishTaskRun,
  getTaskRun,
  openDetachedHitlRun,
} from "./task-runs.js";
import {
  actorIsOwner,
  type AiTaskHostMcpRegisterFn,
} from "./mcp-host-tools.js";

export const CREEZIO_AI_WORKSPACE_MCP_TOOL_NAMES = [
  "workspace.open_tab",
  "workspace.list_tabs",
  "workspace.web_list_targets",
  "workspace.web_click",
  "workspace.web_type",
  "workspace.web_scroll",
  "workspace.web_read",
  "workspace.web_screenshot",
  "platform.ask_human",
  "platform.get_human_answer",
] as const;

export type CreezioAiWorkspaceMcpToolName =
  (typeof CREEZIO_AI_WORKSPACE_MCP_TOOL_NAMES)[number];

export type CreateAiWorkspaceMcpToolsOptions = {
  /** Enregistrement (même contrat que createAiTaskHostMcpTools). */
  registerTool: AiTaskHostMcpRegisterFn;
  /** `userId` de l'acteur du call MCP (Bearer / API key). */
  getActorUserId: () => string | null | undefined;
};

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }],
  };
}

function errorResult(message: string, code?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(code ? { error: message, code } : { error: message }),
      },
    ],
    isError: true,
  };
}

type Gate =
  | { ok: true; actorId: string; aiUserId: string; hostUserId: string }
  | { ok: false; error: ReturnType<typeof errorResult> };

/** Gate commun : acteur owner/service + collaborateur IA actif + hôte cible. */
function gateWorkspaceCall(
  getActorUserId: () => string | null | undefined,
  input: { ai_user_id?: unknown },
): Gate {
  const actorId = getActorUserId();
  if (!actorIsOwner(actorId)) {
    return {
      ok: false,
      error: errorResult("Réservé au compte principal (owner ou clé service)"),
    };
  }
  const aiUserId = typeof input.ai_user_id === "string" ? input.ai_user_id.trim() : "";
  if (!aiUserId) {
    return { ok: false, error: errorResult("ai_user_id requis") };
  }
  const { users } = requireTasksBrand();
  const ai = users.getById(aiUserId);
  if (!ai || ai.kind !== "ai" || !ai.active) {
    return {
      ok: false,
      error: errorResult(
        `Collaborateur IA « ${aiUserId} » introuvable ou inactif (voir list_ai_collaborators)`,
      ),
    };
  }
  const hostUserId = resolveHostTargetUserId();
  if (!hostUserId) {
    return {
      ok: false,
      error: errorResult("Aucun hôte workspace disponible (desktop hors ligne ?)"),
    };
  }
  return { ok: true, actorId: String(actorId), aiUserId, hostUserId };
}

const AI_USER_SCHEMA = z
  .string()
  .min(1)
  .describe("Collaborateur IA cible (id — voir list_ai_collaborators)");

async function webAction(opts: {
  aiUserId: string;
  hostUserId: string;
  webType: string;
  params?: Record<string, unknown>;
  tabId?: string | undefined;
}): Promise<Record<string, unknown>> {
  const { workspace } = requireTasksBrand();
  return workspace.webAction({
    aiUserId: opts.aiUserId,
    hostUserId: opts.hostUserId,
    webType: opts.webType,
    params: opts.params || {},
    ...(opts.tabId ? { tabId: opts.tabId } : {}),
  });
}

const optStr = (v: unknown): string | undefined =>
  v != null && String(v) ? String(v) : undefined;

/**
 * Enregistre les tools MCP workspace + HITL async (SoT kit).
 * Retourne les noms enregistrés.
 */
export function createAiWorkspaceMcpTools(
  options: CreateAiWorkspaceMcpToolsOptions,
): readonly string[] {
  const { registerTool, getActorUserId } = options;
  const registered: string[] = [];
  const register: AiTaskHostMcpRegisterFn = (name, config, handler) => {
    registerTool(name, config, handler);
    registered.push(name);
  };

  register(
    "workspace.open_tab",
    {
      title: "Ouvrir un onglet web dans l'espace d'un collaborateur IA",
      description:
        "Ouvre une URL http(s) dans un onglet du workspace du collaborateur IA (allowlist *_WEB_ALLOWED_HOSTS appliquée). Retourne tabId.",
      inputSchema: {
        ai_user_id: AI_USER_SCHEMA,
        url: z.string().min(1).describe("URL http(s) à ouvrir"),
        title: z.string().max(200).optional(),
      },
    },
    async (input) => {
      const gate = gateWorkspaceCall(getActorUserId, input);
      if (!gate.ok) return gate.error;
      const url = String(input.url || "");
      const allowed = aiWebHostAllowed(url);
      if (!allowed.ok) {
        return errorResult(allowed.error || "hôte refusé", "host_not_allowed");
      }
      const brand = requireTasksBrand();
      const resolved = brand.externalTabs.resolve({
        url,
        ...(input.title ? { title: String(input.title) } : {}),
      }) as { ok?: boolean; error?: string } & Record<string, unknown>;
      if (!resolved.ok) {
        return errorResult(String(resolved.error || "URL refusée"));
      }
      const { ok: _ok, ...rest } = resolved;
      void _ok;
      // Workspace ensure paresseux : l'ouverture d'onglet est le point
      // d'entrée naturel d'une session directe Hermes.
      await brand.workspace
        .ensureOnHost({ aiUserId: gate.aiUserId, hostUserId: gate.hostUserId })
        .catch(() => ({}));
      const res = await brand.workspace.openTab({
        aiUserId: gate.aiUserId,
        hostUserId: gate.hostUserId,
        params: brand.externalTabs.toWorkspaceParams(rest as never),
      });
      return res && (res as { ok?: boolean }).ok === false
        ? errorResult(
            String((res as { error?: string }).error || "open_tab refusé"),
            optStr((res as { code?: string }).code) || "open_tab_failed",
          )
        : jsonResult(res);
    },
  );

  register(
    "workspace.list_tabs",
    {
      title: "Lister les onglets du workspace IA",
      description: "Liste les onglets web ouverts dans l'espace du collaborateur IA.",
      inputSchema: { ai_user_id: AI_USER_SCHEMA },
    },
    async (input) => {
      const gate = gateWorkspaceCall(getActorUserId, input);
      if (!gate.ok) return gate.error;
      const res = await requireTasksBrand().workspace.listTabs({
        aiUserId: gate.aiUserId,
        hostUserId: gate.hostUserId,
      });
      return jsonResult(res);
    },
  );

  const webVerb = (
    name: CreezioAiWorkspaceMcpToolName,
    webType: string,
    config: {
      title: string;
      description: string;
      extraSchema?: Record<string, z.ZodType>;
      toParams: (input: Record<string, unknown>) => Record<string, unknown>;
    },
  ) => {
    register(
      name,
      {
        title: config.title,
        description: config.description,
        inputSchema: {
          ai_user_id: AI_USER_SCHEMA,
          ...(config.extraSchema || {}),
          tab_id: z.string().optional().describe("Onglet ciblé (défaut : actif)"),
        },
      },
      async (input) => {
        const gate = gateWorkspaceCall(getActorUserId, input);
        if (!gate.ok) return gate.error;
        const res = await webAction({
          aiUserId: gate.aiUserId,
          hostUserId: gate.hostUserId,
          webType,
          params: config.toParams(input),
          tabId: optStr(input.tab_id),
        });
        return res && (res as { ok?: boolean }).ok === false
          ? errorResult(
              String((res as { error?: string }).error || `${webType} refusé`),
              optStr((res as { code?: string }).code) || undefined,
            )
          : jsonResult(res);
      },
    );
  };

  webVerb("workspace.web_list_targets", "external_list_targets", {
    title: "Inventaire des éléments actionnables (onglet web)",
    description:
      "Inventaire des éléments actionnables de l'onglet web (refs s1-1, s1-2… pour web_click/web_type). À rappeler après chaque action.",
    extraSchema: {
      q: z.string().optional().describe("Filtre optionnel sur les libellés"),
    },
    toParams: (input) => ({ q: optStr(input.q) }),
  });

  webVerb("workspace.web_click", "external_click", {
    title: "Cliquer un élément (onglet web)",
    description:
      "Clique un élément de l'onglet web (clic trusted CDP). ref de web_list_targets prioritaire, sinon libellé visible.",
    extraSchema: {
      ref: z.string().optional().describe("Ref (ex. s1-12)"),
      label: z.string().optional().describe("Libellé visible si ref inconnue"),
    },
    toParams: (input) => ({ ref: optStr(input.ref), label: optStr(input.label) }),
  });

  webVerb("workspace.web_type", "external_type", {
    title: "Taper du texte (onglet web)",
    description:
      "Tape du texte dans un champ de l'onglet web (clic + frappe trusted, champ vidé avant).",
    extraSchema: {
      ref: z.string().optional(),
      label: z.string().optional(),
      text: z.string().min(1),
      submit: z.boolean().optional().describe("Entrée après la frappe"),
    },
    toParams: (input) => ({
      ref: optStr(input.ref),
      label: optStr(input.label),
      text: String(input.text || ""),
      submit: input.submit === true,
    }),
  });

  webVerb("workspace.web_scroll", "external_scroll", {
    title: "Faire défiler (onglet web)",
    description: "Fait défiler l'onglet web actif (révéler des éléments).",
    extraSchema: { direction: z.enum(["up", "down"]) },
    toParams: (input) => ({
      direction: input.direction === "up" ? "up" : "down",
    }),
  });

  webVerb("workspace.web_read", "external_read", {
    title: "Lire le texte visible (onglet web)",
    description:
      "Lit le texte visible de l'onglet web (option q : blocs autour des lignes qui matchent).",
    extraSchema: {
      q: z.string().optional().describe("Filtre contextuel optionnel"),
      max_chars: z.coerce.number().int().min(200).max(20000).optional(),
    },
    toParams: (input) => ({
      q: optStr(input.q),
      maxChars: typeof input.max_chars === "number" ? input.max_chars : undefined,
    }),
  });

  webVerb("workspace.web_screenshot", "external_screenshot", {
    title: "Capture d'écran (onglet web)",
    description:
      "Capture d'écran de l'onglet web actif (image base64 — vision). Quand web_list_targets/web_read ne suffisent pas.",
    toParams: () => ({}),
  });

  register(
    "platform.ask_human",
    {
      title: "Poser une question à l'humain (asynchrone)",
      description:
        "Crée une question human-in-the-loop visible sur le kanban /taches (« en attente humain »). Retourne run_id — poll platform.get_human_answer(run_id). L'humain répond via l'UI existante (answer_ai_question / kanban).",
      inputSchema: {
        ai_user_id: AI_USER_SCHEMA,
        question: z.string().min(1).max(2000),
        title: z.string().max(200).optional(),
      },
    },
    async (input) => {
      const gate = gateWorkspaceCall(getActorUserId, input);
      if (!gate.ok) return gate.error;
      const question = String(input.question || "").trim();
      if (!question) return errorResult("question requise");
      try {
        const { task } = await createTask({
          title:
            optStr(input.title) || `Question : ${question.slice(0, 80)}`,
          body: question,
          executorKind: "ai",
          assigneeUserId: gate.aiUserId,
          createdBy: gate.actorId,
          source: "assistant",
        });
        await updateTask(task.id, { status: "in_progress" });
        const run = openDetachedHitlRun({
          taskId: task.id,
          assigneeUserId: gate.aiUserId,
          prompt: question,
        });
        if (!run) {
          return errorResult(
            "schéma task_runs HITL requis (migrations plateforme)",
          );
        }
        return jsonResult({
          ok: true,
          run_id: run.id,
          task_id: task.id,
          hint: "Poll platform.get_human_answer(run_id) toutes les 30-60 s.",
        });
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  );

  register(
    "platform.get_human_answer",
    {
      title: "Relever la réponse humaine (asynchrone)",
      description:
        "Poll la réponse d'une question platform.ask_human par run_id. answered=true clôt la question (run succeeded, tâche done).",
      inputSchema: { run_id: z.string().min(1) },
    },
    async (input) => {
      const actorId = getActorUserId();
      if (!actorIsOwner(actorId)) {
        return errorResult("Réservé au compte principal (owner ou clé service)");
      }
      const run = getTaskRun(String(input.run_id || ""));
      if (!run) return errorResult(`run ${input.run_id} introuvable`);
      if (run.status === "running" && run.hitl_response) {
        const response = run.hitl_response;
        finishTaskRun(run.id, { status: "succeeded" });
        try {
          const task = getTask(run.task_id);
          if (task && task.status !== "done") {
            await updateTask(task.id, { status: "done", result: response });
          }
        } catch {
          /* clôture tâche best-effort — la réponse est déjà relevée */
        }
        return jsonResult({ answered: true, response, run_id: run.id });
      }
      if (run.status === "running" && run.hitl_prompt) {
        return jsonResult({
          answered: false,
          pending: true,
          run_id: run.id,
          question: run.hitl_prompt,
        });
      }
      return jsonResult({
        answered: false,
        pending: false,
        run_id: run.id,
        status: run.status,
        hint: "Question close sans réponse relevable (run terminé/annulé).",
      });
    },
  );

  return registered;
}
