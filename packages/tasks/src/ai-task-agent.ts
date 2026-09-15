/**
 * Agent LLM d'un collaborateur IA — exécute une tâche du kanban dans SON
 * workspace Electron (partition dédiée, fake-cursor visible via « Voir
 * comme IA »), avec les ACL de SON persona (jamais celles de l'owner).
 *
 * Outils : navigation CRM, inspection/action UI (UiDriver), onglets web,
 * délégation Hermes (sous-tâche), HITL, fin de tâche explicite (D4 :
 * `done` seulement sur finish_task(success=true)).
 */

import {
  callOpenAiModel,
  runAgentLoop,
  type AgentLoopResult,
  type AgentModelCaller,
  type AgentStepEvent,
  type AgentTool,
} from "@creezio/assistant";
import { defaultModel } from "@creezio/assistant";
import { dispatchSupplierAction } from "@creezio/assistant";
import {
  requireTasksBrand,
  tasksEnv,
  tasksEnvNumber,
  type TasksUser,
} from "./brand/config.js";
import { createTask, type Task } from "./kanban-service.js";

type PublicUser = TasksUser;

function navigateAiWorkspace(opts: {
  aiUserId: string;
  hostUserId: string;
  href: string;
}) {
  return requireTasksBrand().workspace.navigate(opts);
}
function openTabInAiWorkspace(opts: {
  aiUserId: string;
  hostUserId: string;
  params: Record<string, unknown>;
}) {
  return requireTasksBrand().workspace.openTab(opts);
}
function listTabsInAiWorkspace(opts: {
  aiUserId: string;
  hostUserId: string;
}) {
  return requireTasksBrand().workspace.listTabs(opts);
}
function webActionInAiWorkspace(opts: {
  aiUserId: string;
  hostUserId: string;
  webType: string;
  params?: Record<string, unknown>;
  tabId?: string;
}) {
  return requireTasksBrand().workspace.webAction(opts);
}
function hasPermission(
  permissions: readonly string[] | undefined,
  required: string | null,
) {
  return requireTasksBrand().navigation.hasPermission(permissions, required);
}
function permissionForPath(pathname: string) {
  return requireTasksBrand().navigation.permissionForPath(pathname);
}
function resolveOpenTabRequest(input: {
  url?: string;
  site_id?: number;
  /** @deprecated → site_id */
  fournisseur_id?: number;
  title?: string;
}) {
  return requireTasksBrand().externalTabs.resolve(input);
}
function toSupplierOpenTabParams(resolved: {
  url: string;
  title: string;
  siteId?: number;
  /** @deprecated → siteId */
  fournisseurId?: number;
  source?: string;
  ok?: true;
}) {
  const { ok: _ok, ...rest } = resolved;
  void _ok;
  return requireTasksBrand().externalTabs.toWorkspaceParams(rest);
}

/** Stub LLM injectable par les tests (sinon OpenAI BYOK). */
let modelCallerOverride: AgentModelCaller | null = null;
export function setAiTaskModelCaller(fn: AgentModelCaller | null): void {
  modelCallerOverride = fn;
}

/** Un modèle est disponible (BYOK OpenAI ou stub de test). */
export function hasAiAgentModel(): boolean {
  if (modelCallerOverride) return true;
  return Boolean((process.env.OPENAI_API_KEY || "").trim());
}

export function aiTaskModel(): string {
  return tasksEnv("MODEL") || defaultModel();
}

export function aiTaskMaxSteps(): number {
  const raw = tasksEnvNumber("MAX_STEPS", 20);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60) : 20;
}

export function aiTaskTimeoutMs(): number {
  const raw = tasksEnvNumber("RUN_TIMEOUT_MS", 10 * 60 * 1000);
  return Number.isFinite(raw) && raw > 10_000 ? raw : 10 * 60 * 1000;
}

export function aiTaskMaxTokens(): number {
  const raw = tasksEnvNumber("MAX_TOKENS", 150_000);
  return Number.isFinite(raw) && raw > 1000 ? raw : 150_000;
}

/**
 * Allowlist optionnelle des hôtes web accessibles à l'agent
 * (${requireTasksBrand().envPrefix}_WEB_ALLOWED_HOSTS, CSV, sous-domaines inclus). Vide = tout https.
 */
function aiWebAllowedHosts(): string[] | null {
  const raw = tasksEnv("WEB_ALLOWED_HOSTS");
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/^\*\./, ""))
    .filter(Boolean);
  return hosts.length ? hosts : null;
}

export function aiWebHostAllowed(url: string): { ok: boolean; error?: string } {
  const allowed = aiWebAllowedHosts();
  if (!allowed) return { ok: true };
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { ok: false, error: "URL invalide" };
  }
  const match = allowed.some((h) => host === h || host.endsWith(`.${h}`));
  return match
    ? { ok: true }
    : {
        ok: false,
        error: `Hôte « ${host} » hors de l'allowlist ${requireTasksBrand().envPrefix}_WEB_ALLOWED_HOSTS — demande à l'humain si nécessaire`,
      };
}

export type AskHumanFn = (
  question: string,
) => Promise<{ outcome: "resumed" | "cancelled" | "timeout"; response?: string }>;

export type AiTaskAgentContext = {
  task: Task;
  assignee: PublicUser;
  hostUserId: string;
  runId: string;
  askHuman: AskHumanFn;
  onStep?: (ev: AgentStepEvent) => void;
  signal?: AbortSignal;
};

function buildSystemPrompt(ctx: AiTaskAgentContext): string {
  const perms = ctx.assignee.permissions || [];
  const brand = requireTasksBrand();
  return `Tu es « ${ctx.assignee.username} », collaborateur IA de ${brand.productName} (${brand.productDomain}).
Tu travailles dans TON espace de travail dédié (l'utilisateur peut t'observer via « Voir comme IA »).

## Ta mission
Exécute la tâche du kanban qui t'est assignée, puis termine par \`finish_task\`.

## Règles
- Tu as les permissions d'un collaborateur : ${perms.length ? perms.join(", ") : "(aucune)"}. Les navigations hors permission sont refusées — n'insiste pas, note la limite.
- Travaille par petites étapes : \`navigate\` vers la page utile, \`list_targets\` pour voir la page, \`click\` / \`type_text\` pour agir, re-\`list_targets\` pour vérifier l'effet.
- SITES WEB EXTERNES (fournisseurs, banques, outils SaaS) : \`open_tab\` pour ouvrir l'URL, puis les outils \`web_*\` (web_list_targets, web_click, web_type, web_scroll, web_read, web_screenshot). Les outils sans préfixe web_ ne pilotent QUE les pages CRM.
- Les onglets web utilisent TA session à toi (partition isolée). Si une page te demande de te connecter, présente un captcha, une 2FA, ou si une action est risquée/irréversible (paiement, envoi, suppression) : \`ask_human\` — ne tente JAMAIS de contourner.
- \`web_screenshot\` est utile quand \`web_list_targets\`/\`web_read\` ne suffisent pas (mise en page complexe, vérification visuelle). Utilise-le avec parcimonie.
- Pour une mission longue, un scraping web lourd ou une automation backend : délègue à l'agent central via \`delegate_to_hermes\` (crée une sous-tâche liée) et mentionne-le dans ton résumé.
- Si tu as besoin d'une décision ou validation humaine : \`ask_human\` (le run est mis en pause).
- OBLIGATOIRE : termine TOUJOURS par \`finish_task(success, summary)\`. success=true seulement si la mission est réellement accomplie ; sinon success=false avec le motif précis. Jamais de succès de complaisance.
- Réponds en français.

## Contexte
- Kanban des tâches : ${brand.taskHref}
- Titre de ta tâche : ${ctx.task.title}`;
}

function buildUserPrompt(ctx: AiTaskAgentContext): string {
  return [
    `Tâche : ${ctx.task.title}`,
    ctx.task.body?.trim() ? `\nBrief :\n${ctx.task.body.trim()}` : "",
    `\nPriorité : ${ctx.task.priority}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function uiAction(
  ctx: AiTaskAgentContext,
  uiType: "list_targets" | "click" | "type" | "scroll",
  uiParams: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return dispatchSupplierAction(
    "ai_workspace_ui_action",
    {
      ai_user_id: ctx.assignee.id,
      ui_type: uiType,
      ui_params: uiParams,
    },
    undefined,
    { targetUserId: ctx.hostUserId, requireTargetOnline: true },
  );
}

/**
 * Wire SoT = `external_*` (ADR no-brand-domain).
 * Alias déprécié TF `supplier_*` encore accepté côté Electron driver.
 */
type ExternalWebActionType =
  | "external_list_targets"
  | "external_click"
  | "external_type"
  | "external_scroll"
  | "external_read"
  | "external_screenshot"
  /** @deprecated → external_* */
  | "supplier_list_targets"
  | "supplier_click"
  | "supplier_type"
  | "supplier_scroll"
  | "supplier_read"
  | "supplier_screenshot";

function webAction(
  ctx: AiTaskAgentContext,
  webType: ExternalWebActionType,
  params: Record<string, unknown>,
  tabId?: string,
): Promise<Record<string, unknown>> {
  return webActionInAiWorkspace({
    aiUserId: ctx.assignee.id,
    hostUserId: ctx.hostUserId,
    webType,
    tabId,
    params,
  });
}

const optStr = (v: unknown): string | undefined =>
  v != null && String(v) ? String(v) : undefined;

export function buildAiTaskTools(ctx: AiTaskAgentContext): AgentTool[] {
  const perms = ctx.assignee.permissions || [];
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "navigate",
          description:
            "Navigue vers une page CRM dans TON espace (fake-cursor visible). Chemins relatifs : /taches, /produits, /marketplaces, /panier…",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Chemin CRM (ex. /produits)" },
            },
            required: ["path"],
          },
        },
      },
      execute: async (args) => {
        const path = String(args.path || "").trim();
        if (!path.startsWith("/")) {
          return { ok: false, error: "path CRM requis (ex. /produits)" };
        }
        const needed = permissionForPath(path);
        if (!hasPermission(perms, needed)) {
          return {
            ok: false,
            error: `Permission manquante pour ${path} (${needed}) — hors de ton périmètre`,
            code: "acl_denied",
          };
        }
        return navigateAiWorkspace({
          aiUserId: ctx.assignee.id,
          hostUserId: ctx.hostUserId,
          href: path,
        });
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "list_targets",
          description:
            "Inventaire des éléments actionnables de la page CRM courante de TON espace (refs t1, t2… pour click/type_text). À rappeler après chaque action pour voir l'état.",
          parameters: {
            type: "object",
            properties: {
              q: { type: "string", description: "Filtre optionnel sur les libellés" },
            },
            required: [],
          },
        },
      },
      execute: (args) =>
        uiAction(ctx, "list_targets", {
          q: args.q != null ? String(args.q) : undefined,
        }),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "click",
          description:
            "Clique un élément via la souris virtuelle (ref de list_targets prioritaire, sinon libellé exact).",
          parameters: {
            type: "object",
            properties: {
              ref: { type: "string", description: "Ref (ex. t12)" },
              label: { type: "string", description: "Libellé visible si ref inconnue" },
            },
            required: [],
          },
        },
      },
      execute: (args) =>
        uiAction(ctx, "click", {
          ref: args.ref != null ? String(args.ref) : undefined,
          label: args.label != null ? String(args.label) : undefined,
        }),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "type_text",
          description:
            "Tape du texte dans un champ visible (clic + frappe simulée).",
          parameters: {
            type: "object",
            properties: {
              ref: { type: "string" },
              label: { type: "string" },
              text: { type: "string" },
              submit: { type: "boolean", description: "Entrée après la frappe" },
            },
            required: ["text"],
          },
        },
      },
      execute: (args) =>
        uiAction(ctx, "type", {
          ref: args.ref != null ? String(args.ref) : undefined,
          label: args.label != null ? String(args.label) : undefined,
          text: String(args.text || ""),
          submit: args.submit === true,
        }),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "scroll",
          description: "Fait défiler la page de TON espace (révéler des éléments).",
          parameters: {
            type: "object",
            properties: {
              direction: { type: "string", enum: ["up", "down"] },
            },
            required: ["direction"],
          },
        },
      },
      execute: (args) =>
        uiAction(ctx, "scroll", {
          direction: args.direction === "up" ? "up" : "down",
        }),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "open_tab",
          description:
            "Ouvre une URL web (https) dans un onglet de TON espace (sites fournisseurs, docs).",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string" },
              title: { type: "string" },
            },
            required: ["url"],
          },
        },
      },
      execute: async (args) => {
        const url = String(args.url || "");
        const allowed = aiWebHostAllowed(url);
        if (!allowed.ok) {
          return { ok: false, error: allowed.error, code: "host_not_allowed" };
        }
        const resolved = resolveOpenTabRequest({
          url,
          title: args.title != null ? String(args.title) : undefined,
        });
        if (!resolved.ok) {
          return { ok: false, error: resolved.error || "URL refusée" };
        }
        return openTabInAiWorkspace({
          aiUserId: ctx.assignee.id,
          hostUserId: ctx.hostUserId,
          params: toSupplierOpenTabParams(resolved),
        });
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "list_tabs",
          description: "Liste les onglets ouverts dans TON espace.",
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
      execute: () =>
        listTabsInAiWorkspace({
          aiUserId: ctx.assignee.id,
          hostUserId: ctx.hostUserId,
        }),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "web_list_targets",
          description:
            "Inventaire des éléments actionnables de l'onglet WEB actif de TON espace (refs s1-1, s1-2… pour web_click/web_type). À rappeler après chaque action web.",
          parameters: {
            type: "object",
            properties: {
              q: { type: "string", description: "Filtre optionnel sur les libellés" },
              tab_id: { type: "string", description: "Onglet ciblé (défaut : actif)" },
            },
            required: [],
          },
        },
      },
      execute: (args) =>
        webAction(ctx, "external_list_targets", { q: optStr(args.q) }, optStr(args.tab_id)),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "web_click",
          description:
            "Clique un élément de l'onglet web actif (clic trusted via CDP). ref de web_list_targets prioritaire, sinon libellé visible.",
          parameters: {
            type: "object",
            properties: {
              ref: { type: "string", description: "Ref (ex. s1-12)" },
              label: { type: "string", description: "Libellé visible si ref inconnue" },
              tab_id: { type: "string" },
            },
            required: [],
          },
        },
      },
      execute: (args) =>
        webAction(
          ctx,
          "external_click",
          { ref: optStr(args.ref), label: optStr(args.label) },
          optStr(args.tab_id),
        ),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "web_type",
          description:
            "Tape du texte dans un champ de l'onglet web actif (clic + frappe trusted, champ vidé avant).",
          parameters: {
            type: "object",
            properties: {
              ref: { type: "string" },
              label: { type: "string" },
              text: { type: "string" },
              submit: { type: "boolean", description: "Entrée après la frappe" },
              tab_id: { type: "string" },
            },
            required: ["text"],
          },
        },
      },
      execute: (args) =>
        webAction(
          ctx,
          "external_type",
          {
            ref: optStr(args.ref),
            label: optStr(args.label),
            text: String(args.text || ""),
            submit: args.submit === true,
          },
          optStr(args.tab_id),
        ),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "web_scroll",
          description: "Fait défiler l'onglet web actif (révéler des éléments).",
          parameters: {
            type: "object",
            properties: {
              direction: { type: "string", enum: ["up", "down"] },
              tab_id: { type: "string" },
            },
            required: ["direction"],
          },
        },
      },
      execute: (args) =>
        webAction(
          ctx,
          "external_scroll",
          { direction: args.direction === "up" ? "up" : "down" },
          optStr(args.tab_id),
        ),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "web_read",
          description:
            "Lit le texte visible de l'onglet web actif (option q : blocs autour des lignes qui matchent).",
          parameters: {
            type: "object",
            properties: {
              q: { type: "string", description: "Filtre contextuel optionnel" },
              max_chars: { type: "number", description: "Plafond de texte (défaut 6000)" },
              tab_id: { type: "string" },
            },
            required: [],
          },
        },
      },
      execute: (args) =>
        webAction(
          ctx,
          "external_read",
          {
            q: optStr(args.q),
            maxChars: typeof args.max_chars === "number" ? args.max_chars : undefined,
          },
          optStr(args.tab_id),
        ),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "web_screenshot",
          description:
            "Capture d'écran de l'onglet web actif, jointe en image à la conversation (vision). À utiliser quand web_list_targets/web_read ne suffisent pas.",
          parameters: {
            type: "object",
            properties: {
              tab_id: { type: "string" },
            },
            required: [],
          },
        },
      },
      execute: (args) =>
        webAction(ctx, "external_screenshot", {}, optStr(args.tab_id)),
    },
    {
      definition: {
        type: "function",
        function: {
          name: "delegate_to_hermes",
          description:
            "Délègue une sous-mission à l'agent central Hermes (scraping lourd, batch, automation backend). Crée une sous-tâche liée sur /taches.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string", description: "Titre court de la sous-mission" },
              body: { type: "string", description: "Consignes détaillées pour Hermes" },
            },
            required: ["title"],
          },
        },
      },
      execute: async (args) => {
        const title = String(args.title || "").trim();
        if (!title) return { ok: false, error: "title requis" };
        const { task, hermes, warning } = await createTask({
          title,
          body: args.body != null ? String(args.body) : "",
          executorKind: "hermes",
          parentTaskId: ctx.task.id,
          createdBy: ctx.assignee.id,
          source: "assistant",
          idempotencyKey: `run:${ctx.runId}:${title.slice(0, 60)}`,
        });
        return {
          ok: true,
          subtask_id: task.id,
          status: task.status,
          hermes_task_id: hermes?.id || null,
          warning: warning || null,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "ask_human",
          description:
            "Pose une question à l'humain et met le run en pause (HITL) jusqu'à sa réponse. À utiliser avant toute action risquée ou ambiguë.",
          parameters: {
            type: "object",
            properties: {
              question: { type: "string" },
            },
            required: ["question"],
          },
        },
      },
      execute: async (args) => {
        const question = String(args.question || "").trim() || "Validation requise.";
        const res = await ctx.askHuman(question);
        if (res.outcome === "resumed") {
          return { ok: true, response: res.response || "ok" };
        }
        return {
          ok: false,
          error:
            res.outcome === "timeout"
              ? "Pas de réponse humaine (timeout HITL)"
              : "Run annulé pendant l'attente humaine",
          code: `hitl_${res.outcome}`,
        };
      },
    },
    {
      definition: {
        type: "function",
        function: {
          name: "finish_task",
          description:
            "Termine le run. success=true UNIQUEMENT si la mission est réellement accomplie ; sinon success=false + motif.",
          parameters: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              summary: { type: "string", description: "Résumé factuel du travail" },
            },
            required: ["success", "summary"],
          },
        },
      },
      terminal: true,
      execute: async (args) => ({
        ok: true,
        success: args.success === true,
        summary: String(args.summary || ""),
      }),
    },
  ];
}

export type AiTaskAgentOutcome = {
  loop: AgentLoopResult;
  success: boolean;
  summary: string;
};

/** Déroule la boucle LLM pour un run. Ne lève pas (statuts explicites). */
export async function runAiTaskAgent(
  ctx: AiTaskAgentContext,
): Promise<AiTaskAgentOutcome> {
  const loop = await runAgentLoop({
    model: aiTaskModel(),
    systemPrompt: buildSystemPrompt(ctx),
    userPrompt: buildUserPrompt(ctx),
    tools: buildAiTaskTools(ctx),
    maxSteps: aiTaskMaxSteps(),
    timeoutMs: aiTaskTimeoutMs(),
    maxTokens: aiTaskMaxTokens(),
    signal: ctx.signal,
    onStep: ctx.onStep,
    callModel: modelCallerOverride || callOpenAiModel,
  });
  const success = loop.status === "finished" && loop.terminal?.success === true;
  const summary =
    (loop.status === "finished" && typeof loop.terminal?.summary === "string"
      ? loop.terminal.summary
      : "") ||
    (loop.status === "finished"
      ? "Run terminé sans résumé"
      : `Run interrompu (${loop.status}${loop.error ? ` — ${loop.error}` : ""})`);
  return { loop, success, summary };
}
