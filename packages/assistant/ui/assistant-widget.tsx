// @ts-nocheck — desktop API loosely typed; marques fournissent Window.*Desktop
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  ClipboardCheck,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  differenceInCalendarDays,
  formatDistanceToNow,
  isToday,
  isYesterday,
} from "date-fns";
import { fr } from "date-fns/locale";
import { Badge } from "./primitives/badge";
import { Button } from "./primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu";
import { Input } from "./primitives/input";
import { ScrollArea } from "./primitives/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./primitives/select";
import { cn } from "./primitives/cn";
import type { AssistantSource } from "../dist/brand/sources-shim.js";
import { AssistantMessageContent } from "./assistant-message-content";
import { AssistantTracePanel } from "./assistant-trace-panel";
import {
  AssistantToolSteps,
  type AssistantToolStep,
} from "./assistant-tool-steps";
import {
  ASSISTANT_PANEL_WIDTH_PX,
  useAssistantUi,
} from "./assistant-provider";
import { useVoiceInput } from "./use-voice-input";
import { assistantIdentity } from "../dist/brand/registry.js";
import {
  isExternalActiveSurface,
  resolveActiveSurface,
  type ActiveSurface,
  type SupplierTabSummary,
} from "../dist/runtime/active-surface.js";
import type { AssistantMode } from "../dist/runtime/modes.js";
import { useTabWorkspaceOptional } from "./tab-workspace-shim";
import {
  emitDataChanged,
  inferResourceFromToolName,
} from "@creezio/shell-ui";

type Source = AssistantSource;
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  pending?: boolean;
  steps?: AssistantToolStep[];
  thinking?: string;
};
type Conversation = {
  id: string;
  title: string;
  model: string;
  mode?: AssistantMode;
  created_at: string;
  updated_at: string;
};

/** Suggestions génériques — marques peuvent surcharger via props plus tard. */
const SUGGESTIONS_CHAT = [
  "Que puis-je faire avec l'assistant ?",
  "Où suis-je dans l'application ?",
  "Liste les tables disponibles",
  "Résume les données clés du CRM",
];

const SUGGESTIONS_WORK = [
  "Crée une tâche de suivi pour demain matin",
  "Explore le schéma et prépare un rapport",
  "Lance une mission longue via Hermes Work",
];


function modeStorageKey(): string {
  try { return assistantIdentity().modeStorageKey; } catch { return "creezio-assistant-preferred-mode"; }
}
function productNameLabel(): string {
  try { return assistantIdentity().productName; } catch { return "Creezio"; }
}
function getDesktopApi(): any {
  if (typeof window === "undefined") return undefined;
  try {
    const name = assistantIdentity().desktopApiGlobal;
    const w = window as any;
    // Identity marque d'abord ; fallback plateforme générique uniquement.
    return w[name] ?? w.creezioDesktop;
  } catch {
    const w = window as any;
    return w.creezioDesktop;
  }
}

const MODE_STORAGE_KEY = modeStorageKey();
const HERMES_MODEL_FALLBACK_ID = "openai-api::gpt-5.3-codex";
const REASONING_LABELS: Record<string, string> = {
  none: "Aucun",
  minimal: "Minimal",
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
  xhigh: "Très élevé",
  max: "Maximum",
};

type ModelOptionUi = {
  id: string;
  label: string;
  tier?: string;
  provider?: string;
  model?: string;
};

/** Projet plugin en attente de validation humaine (carte Work). */
type PluginApprovalUi = {
  productId: string;
  name: string;
  revisionId: string;
  version: number;
  problem: string;
  scope: string;
  acceptanceCriteria: string;
};

/** Question structurée d'un round de cadrage (carte formulaire Work). */
type PluginClarificationQuestionUi = {
  id: string;
  label: string;
  type: "choice" | "multi" | "text";
  options?: string[];
  allowOther?: boolean;
};

type PluginClarificationUi = {
  productId: string;
  name: string;
  clarificationId: string;
  round: number;
  questions: PluginClarificationQuestionUi[];
};

/** Module livré en attente de QA humaine (carte « testez et validez »). */
type PluginQaUi = {
  productId: string;
  name: string;
  pluginId: string | null;
};

/** Brouillon de réponse par question (valeur simple, multi et champ Autre). */
type ClarificationDraft = Record<
  string,
  { value?: string; values?: string[]; other?: string }
>;

const FALLBACK_MODELS: ModelOptionUi[] = [
  { id: "o4-mini", label: "o4-mini · Reasoning", tier: "reasoning" },
  { id: "o3-mini", label: "o3-mini · Reasoning", tier: "reasoning" },
  { id: "o3", label: "o3 · Reasoning", tier: "reasoning" },
  { id: "gpt-4o", label: "gpt-4o · Standard", tier: "standard" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini · Rapide", tier: "fast" },
];

const FALLBACK_HERMES_MODELS: ModelOptionUi[] = [
  {
    id: HERMES_MODEL_FALLBACK_ID,
    label: "GPT 5.3 Codex",
    provider: "openai-api",
    model: "gpt-5.3-codex",
  },
];

type ConversationGroup = { label: string; items: Conversation[] };

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function groupConversations(list: Conversation[]): ConversationGroup[] {
  const buckets: Record<string, Conversation[]> = {
    "Aujourd'hui": [],
    Hier: [],
    "7 derniers jours": [],
    "Plus ancien": [],
  };
  for (const c of list) {
    const d = new Date(c.updated_at);
    if (Number.isNaN(d.getTime())) {
      buckets["Plus ancien"].push(c);
      continue;
    }
    if (isToday(d)) buckets["Aujourd'hui"].push(c);
    else if (isYesterday(d)) buckets.Hier.push(c);
    else if (differenceInCalendarDays(new Date(), d) < 7) {
      buckets["7 derniers jours"].push(c);
    } else {
      buckets["Plus ancien"].push(c);
    }
  }
  return (Object.entries(buckets) as [string, Conversation[]][])
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

type SseHandlers = {
  onToken: (t: string) => void;
  onSources: (s: Source[]) => void;
  onMeta: (conversationId: string) => void;
  onToolStart?: (step: AssistantToolStep) => void;
  onToolResult?: (step: Partial<AssistantToolStep> & { id: string }) => void;
  onThinking?: (text: string) => void;
  onCancelled?: () => void;
  onUiAction?: (action: {
    actionId: string;
    type: string;
    params: Record<string, unknown>;
  }) => void;
};

async function readSse(
  res: Response,
  handlers: SseHandlers,
): Promise<{
  content: string;
  sources: Source[];
  conversationId?: string;
  cancelled?: boolean;
}> {
  const reader = res.body?.getReader();
  if (!reader) {
    const data = (await res.json()) as {
      content?: string;
      sources?: Source[];
      error?: string;
      conversationId?: string;
      cancelled?: boolean;
    };
    if (data.error) throw new Error(data.error);
    return {
      content: data.content || "",
      sources: data.sources || [],
      conversationId: data.conversationId,
      cancelled: data.cancelled,
    };
  }
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let sources: Source[] = [];
  let conversationId: string | undefined;
  let cancelled = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() || "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      try {
        const data = JSON.parse(dataLine) as {
          text?: string;
          content?: string;
          sources?: Source[];
          conversationId?: string;
          id?: string;
          toolName?: string;
          argsPreview?: string;
          summary?: string;
          ok?: boolean;
          durationMs?: number;
          round?: number;
          error?: string;
          actionId?: string;
          type?: string;
          params?: Record<string, unknown>;
        };
        if (event === "ui_action" && data.actionId && data.type) {
          handlers.onUiAction?.({
            actionId: data.actionId,
            type: data.type,
            params: data.params || {},
          });
        }
        if (event === "meta" && data.conversationId) {
          conversationId = data.conversationId;
          handlers.onMeta(data.conversationId);
        }
        if (event === "thinking" && data.text) {
          handlers.onThinking?.(data.text);
        }
        if (event === "tool_start" && data.id && data.toolName) {
          handlers.onToolStart?.({
            id: data.id,
            toolName: data.toolName,
            status: "running",
            argsPreview: data.argsPreview,
            round: data.round,
          });
        }
        if (event === "tool_result" && data.id) {
          handlers.onToolResult?.({
            id: data.id,
            toolName: data.toolName,
            status: data.ok === false ? "error" : "done",
            summary: data.summary,
            durationMs: data.durationMs,
            round: data.round,
          });
        }
        if (event === "token" && data.text) {
          content += data.text;
          handlers.onToken(data.text);
        }
        if (event === "sources" && data.sources) {
          sources = data.sources;
          handlers.onSources(sources);
        }
        if (event === "cancelled") {
          cancelled = true;
          handlers.onCancelled?.();
        }
        if (event === "error" && data.error) {
          throw new Error(data.error);
        }
        if (event === "done") {
          content = data.content || content;
          sources = data.sources || sources;
          if (data.conversationId) {
            conversationId = data.conversationId;
            handlers.onMeta(data.conversationId);
          }
        }
      } catch (e) {
        // Relancer uniquement les erreurs métier (event error) ; ignorer parse JSON.
        if (e instanceof Error && event === "error") throw e;
      }
    }
  }
  return { content, sources, conversationId, cancelled };
}

export function AssistantWidget() {
  const {
    open,
    setOpen,
    activeConversationId,
    setActiveConversationId,
    hydrated,
  } = useAssistantUi();
  const pathname = usePathname() || "/";
  const workspace = useTabWorkspaceOptional();
  const surfaceRef = useRef<{
    activeSurface: ActiveSurface;
    supplierTabs: SupplierTabSummary[];
  }>({
    activeSurface: { kind: "crm", href: "/", title: "CRM" },
    supplierTabs: [],
  });

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatModelOptions, setChatModelOptions] =
    useState<ModelOptionUi[]>(FALLBACK_MODELS);
  const [hermesModelOptions, setHermesModelOptions] = useState<ModelOptionUi[]>(
    FALLBACK_HERMES_MODELS,
  );
  const [chatDefaultModel, setChatDefaultModel] = useState("o4-mini");
  const [hermesDefaultModel, setHermesDefaultModel] = useState(
    HERMES_MODEL_FALLBACK_ID,
  );
  const [reasoningOptions, setReasoningOptions] = useState<string[]>([]);
  const [activeReasoning, setActiveReasoning] = useState("medium");
  const [reasoningSupported, setReasoningSupported] = useState(false);
  const [activeModel, setActiveModel] = useState("o4-mini");
  const [preferredMode, setPreferredMode] = useState<AssistantMode>("chat");
  const [traceRefreshKey, setTraceRefreshKey] = useState(0);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [llmGate, setLlmGate] = useState<{
    ready: boolean;
    byokRequired: boolean;
    loading: boolean;
  }>({ ready: true, byokRequired: false, loading: true });
  const [pluginApprovals, setPluginApprovals] = useState<PluginApprovalUi[]>([]);
  const [approvingProjectId, setApprovingProjectId] = useState<string | null>(null);
  const [pluginClarifications, setPluginClarifications] = useState<
    PluginClarificationUi[]
  >([]);
  const [clarificationDrafts, setClarificationDrafts] = useState<
    Record<string, ClarificationDraft>
  >({});
  const [submittingClarificationId, setSubmittingClarificationId] = useState<
    string | null
  >(null);
  const [pluginQa, setPluginQa] = useState<PluginQaUi[]>([]);
  const [qaIssueDrafts, setQaIssueDrafts] = useState<Record<string, string>>({});
  const [qaIssueOpen, setQaIssueOpen] = useState<Record<string, boolean>>({});
  const [qaBusyId, setQaBusyId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef(activeConversationId);
  const activeModelRef = useRef(activeModel);
  const preferredModeRef = useRef<AssistantMode>(preferredMode);
  const deletingConversationIdsRef = useRef(new Set<string>());
  const abortRef = useRef<AbortController | null>(null);
  const sendRef = useRef<(text: string) => Promise<void>>(async () => {});
  // Desktop BYOK et serveur headless : sans LLM prêt, bloquer l'envoi
  // (évite un optimistic update suivi d'un 503/401 puis wipe du fil).
  const chatBlocked = !llmGate.loading && !llmGate.ready;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(MODE_STORAGE_KEY);
      if (raw === "chat" || raw === "work") setPreferredMode(raw);
    } catch {
      /* ignore */
    }
  }, []);

  // BYOK : statut réel du process serveur (pas seulement la clé stockée en UI).
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/v1/assistant/llm-status");
        if (!res.ok) return;
        const data = (await res.json()) as {
          assistantReady?: boolean;
          byokRequired?: boolean;
        };
        if (cancelled) return;
        setLlmGate({
          ready: Boolean(data.assistantReady),
          byokRequired: Boolean(data.byokRequired),
          loading: false,
        });
      } catch {
        if (!cancelled) setLlmGate((g) => ({ ...g, loading: false }));
      }
    };
    void refresh();
    const api = getDesktopApi();
    const unsub = api?.onLlmStatusChanged?.((s: { assistantReady?: boolean; reason?: string; restarting?: boolean }) => {
      setLlmGate({
        ready: Boolean(s.assistantReady),
        byokRequired: true,
        loading: Boolean(s.restarting),
      });
      if (!s.restarting) void refresh();
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    preferredModeRef.current = preferredMode;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, preferredMode);
    } catch {
      /* ignore */
    }
  }, [preferredMode]);

  useEffect(() => {
    activeIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeModelRef.current = activeModel;
  }, [activeModel]);

  // Desktop : FAB natif (WebContentsView topmost) — sync mode + ouverture.
  useEffect(() => {
    if (!hydrated) return;
    const api = getDesktopApi();
    if (!api?.setAssistantChrome) return;
    void api.setAssistantChrome(open ? "hidden" : "fab");
  }, [hydrated, open]);

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.onAssistantOpenRequest) return;
    return api.onAssistantOpenRequest(() => setOpen(true));
  }, [setOpen]);

  // Enrichit activeSurface avec URL/titre Electron (listTabs) avant chaque envoi.
  useEffect(() => {
    const base =
      workspace?.activeSurface ??
      resolveActiveSurface({
        activeTab: workspace?.activeTab ?? null,
        href: workspace?.activeTab?.href || pathname,
        title: workspace?.activeTab?.title || document.title || pathname,
      });
    surfaceRef.current = { activeSurface: base, supplierTabs: [] };
    let cancelled = false;
    const api = getDesktopApi();
    if (!api?.listTabs) return;
    void api.listTabs().then((list: any[]) => {
      if (cancelled) return;
      const supplierTabs: SupplierTabSummary[] = list.map((t: any) => ({
        tabId: t.tabId,
        fournisseurId: t.fournisseurId,
        url: t.url,
        title: t.title,
        active: t.active,
      }));
      const desktop =
        isExternalActiveSurface(base)
          ? list.find(
              (t: any) =>
                t.tabId === base.tabId ||
                (base.fournisseurId > 0 &&
                  t.fournisseurId === base.fournisseurId) ||
                t.active,
            )
          : list.find((t: any) => t.active);
      const activeSurface = resolveActiveSurface({
        activeTab: workspace?.activeTab ?? null,
        href: workspace?.activeTab?.href || pathname,
        title: workspace?.activeTab?.title || document.title || pathname,
        desktopTab: desktop
          ? {
              tabId: desktop.tabId,
              url: desktop.url,
              title: desktop.title,
              fournisseurId: desktop.fournisseurId,
            }
          : null,
      });
      surfaceRef.current = { activeSurface, supplierTabs };
    });
    return () => {
      cancelled = true;
    };
  }, [workspace?.activeTab, workspace?.activeSurface, pathname, open]);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  );

  /** Mode affiché : celui de la conv ouverte, sinon préférence pour la prochaine. */
  const displayMode: AssistantMode = activeConversation?.mode || preferredMode;
  const suggestions =
    displayMode === "work" ? SUGGESTIONS_WORK : SUGGESTIONS_CHAT;
  const modelOptions =
    displayMode === "work" ? hermesModelOptions : chatModelOptions;
  const defaultModel =
    displayMode === "work" ? hermesDefaultModel : chatDefaultModel;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, busy]);

  const refreshConversations = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/v1/assistant/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations?: Conversation[] };
      setConversations(data.conversations || []);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadConversation = useCallback(
    async (id: string | null) => {
      const fallbackModel =
        preferredModeRef.current === "work"
          ? hermesDefaultModel
          : chatDefaultModel;
      if (!id) {
        setMessages([]);
        setActiveModel(fallbackModel);
        return;
      }
      setLoadingThread(true);
      try {
        const res = await fetch(`/api/v1/assistant/conversations/${id}`);
        if (res.status === 404) {
          setActiveConversationId(null);
          setMessages([]);
          setActiveModel(fallbackModel);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          conversation?: Conversation;
          messages?: {
            id: string;
            role: "user" | "assistant";
            content: string;
            sources?: Source[];
          }[];
        };
        if (data.conversation?.model) {
          setActiveModel(data.conversation.model);
        }
        if (data.conversation?.mode === "chat" || data.conversation?.mode === "work") {
          setPreferredMode(data.conversation.mode);
        }
        setMessages(
          (data.messages || []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sources: m.sources || [],
          })),
        );
      } finally {
        setLoadingThread(false);
      }
    },
    [setActiveConversationId, chatDefaultModel, hermesDefaultModel],
  );

  useEffect(() => {
    if (!hydrated || !open) return;
    void (async () => {
      try {
        const res = await fetch("/api/v1/assistant/models");
        if (!res.ok) return;
        const data = (await res.json()) as {
          models?: string[];
          default?: string;
          options?: ModelOptionUi[];
        };
        if (data.options?.length) {
          setChatModelOptions(data.options);
        } else if (data.models?.length) {
          setChatModelOptions(data.models.map((id) => ({ id, label: id })));
        }
        if (data.default) {
          setChatDefaultModel(data.default);
          if (!activeIdRef.current && preferredModeRef.current === "chat") {
            setActiveModel(data.default);
          }
        }
      } catch {
        /* keep fallbacks */
      }
    })();
    void refreshConversations();
  }, [hydrated, open, refreshConversations]);

  // Work : modèles dynamiques Hermes (WebUI), jamais de liste en dur côté serveur.
  useEffect(() => {
    if (!hydrated || !open) return;
    if (preferredMode !== "work") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/assistant/hermes-models");
        if (!res.ok) return;
        const data = (await res.json()) as {
          default?: string;
          options?: ModelOptionUi[];
        };
        if (cancelled) return;
        if (data.options?.length) {
          setHermesModelOptions(data.options);
        }
        if (data.default) {
          setHermesDefaultModel(data.default);
          if (!activeIdRef.current) setActiveModel(data.default);
        }
      } catch {
        /* keep fallbacks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, open, preferredMode]);

  // Work : capacités et valeur reasoning viennent de Hermes `/api/reasoning`.
  useEffect(() => {
    if (!hydrated || !open || displayMode !== "work") return;
    let cancelled = false;
    const [provider, model] = activeModel.includes("::")
      ? activeModel.split("::", 2)
      : ["", activeModel];
    void (async () => {
      try {
        const query = new URLSearchParams();
        if (provider) query.set("provider", provider);
        if (model) query.set("model", model);
        const suffix = query.size ? `?${query.toString()}` : "";
        const res = await fetch(
          `/api/v1/assistant/hermes-reasoning${suffix}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          effort?: string;
          options?: string[];
          supported?: boolean;
        };
        if (cancelled) return;
        const options = (data.options || []).filter(Boolean);
        setReasoningOptions(options);
        setReasoningSupported(Boolean(data.supported) && options.length > 0);
        if (data.effort) setActiveReasoning(data.effort);
      } catch {
        /* Hermes UI reste la source de secours */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, open, displayMode, activeModel]);

  useEffect(() => {
    if (!hydrated || !open || busy) return;
    // Nouvelle conversation (id null) : ne pas appeler loadConversation(null)
    // ici. Ce chemin faisait setMessages([]) au moment où busy passe à false
    // après un envoi en échec (401/503 sans conversationId), effaçant le
    // message utilisateur et l'erreur explicite. Les clears volontaires
    // (createNew / removeConversation / loadConversation 404) restent explicites.
    if (!activeConversationId) return;
    void loadConversation(activeConversationId);
  }, [hydrated, open, activeConversationId, loadConversation, busy]);

  // Work : interactions plugins en attente (validation PRD, cadrage, QA)
  // remontées par l'état DB — cartes dans le fil du chat.
  useEffect(() => {
    if (!hydrated || !open || displayMode !== "work" || !activeConversationId) {
      setPluginApprovals([]);
      setPluginClarifications([]);
      setPluginQa([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/v1/assistant/plugin-approvals?conversationId=${encodeURIComponent(activeConversationId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          approvals?: PluginApprovalUi[];
          clarifications?: PluginClarificationUi[];
          qa?: PluginQaUi[];
        };
        if (cancelled) return;
        setPluginApprovals(data.approvals || []);
        setPluginClarifications(data.clarifications || []);
        setPluginQa(data.qa || []);
      } catch {
        /* silencieux — la carte réapparaîtra au prochain poll */
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 7000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [hydrated, open, displayMode, activeConversationId, busy]);

  const approveProject = useCallback(
    async (approval: PluginApprovalUi) => {
      if (approvingProjectId) return;
      setApprovingProjectId(approval.productId);
      try {
        const res = await fetch(
          `/api/v1/plugin-products/${encodeURIComponent(approval.productId)}/prd/${encodeURIComponent(approval.revisionId)}/approve`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setVoiceHint(data?.error || "Validation impossible — réessayez.");
          return;
        }
        setPluginApprovals((prev) =>
          prev.filter((item) => item.productId !== approval.productId),
        );
        // Reprise automatique : Hermes récupère le feu vert et enchaîne.
        await sendRef.current(
          `J'ai validé le projet « ${approval.name} ». Continue la réalisation.`,
        );
      } finally {
        setApprovingProjectId(null);
      }
    },
    [approvingProjectId],
  );

  /** Formate la réponse finale d'une question (choix, multi, texte, Autre). */
  const clarificationAnswerValue = useCallback(
    (
      question: PluginClarificationQuestionUi,
      draft: ClarificationDraft[string] | undefined,
    ): string | string[] | null => {
      const other = (draft?.other || "").trim();
      if (question.type === "multi") {
        const values = [...(draft?.values || [])];
        if (other) values.push(`Autre : ${other}`);
        return values.length ? values : null;
      }
      if (question.type === "choice") {
        if (draft?.value === "__other__") return other ? `Autre : ${other}` : null;
        return draft?.value || null;
      }
      const text = (draft?.value || "").trim();
      return text || null;
    },
    [],
  );

  const submitClarification = useCallback(
    async (clarification: PluginClarificationUi) => {
      if (submittingClarificationId) return;
      const draft = clarificationDrafts[clarification.clarificationId] || {};
      const answers: Record<string, string | string[]> = {};
      for (const question of clarification.questions) {
        const value = clarificationAnswerValue(question, draft[question.id]);
        if (value === null) {
          setVoiceHint(`Répondez à « ${question.label} » avant d'envoyer.`);
          return;
        }
        answers[question.id] = value;
      }
      setSubmittingClarificationId(clarification.clarificationId);
      try {
        const res = await fetch(
          `/api/v1/plugin-products/${encodeURIComponent(clarification.productId)}/clarifications/${encodeURIComponent(clarification.clarificationId)}/answers`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answers }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setVoiceHint(data?.error || "Envoi des réponses impossible — réessayez.");
          return;
        }
        setPluginClarifications((prev) =>
          prev.filter((item) => item.clarificationId !== clarification.clarificationId),
        );
        const lines = clarification.questions.map((question) => {
          const value = answers[question.id];
          const rendered = Array.isArray(value) ? value.join(", ") : String(value);
          return `- ${question.label} → ${rendered}`;
        });
        // Hermes reprend l'interview avec les réponses structurées.
        await sendRef.current(
          `Réponses au cadrage pour « ${clarification.name} » :\n${lines.join("\n")}`,
        );
      } finally {
        setSubmittingClarificationId(null);
      }
    },
    [clarificationAnswerValue, clarificationDrafts, submittingClarificationId],
  );

  const qaValidate = useCallback(
    async (item: PluginQaUi) => {
      if (qaBusyId) return;
      setQaBusyId(item.productId);
      try {
        const res = await fetch(
          `/api/v1/plugin-products/${encodeURIComponent(item.productId)}/human-qa`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved: true }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setVoiceHint(data?.error || "Validation impossible — réessayez.");
          return;
        }
        setPluginQa((prev) => prev.filter((row) => row.productId !== item.productId));
        await sendRef.current(
          `J'ai testé et validé le module « ${item.name} ». Tu peux clôturer le projet.`,
        );
      } finally {
        setQaBusyId(null);
      }
    },
    [qaBusyId],
  );

  const qaReportIssue = useCallback(
    async (item: PluginQaUi) => {
      if (qaBusyId) return;
      const issue = (qaIssueDrafts[item.productId] || "").trim();
      if (!issue) {
        setVoiceHint("Décrivez le problème rencontré avant d'envoyer.");
        return;
      }
      setQaBusyId(item.productId);
      try {
        const res = await fetch(
          `/api/v1/plugin-products/${encodeURIComponent(item.productId)}/human-qa`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approved: false }),
          },
        );
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setVoiceHint(data?.error || "Signalement impossible — réessayez.");
          return;
        }
        setPluginQa((prev) => prev.filter((row) => row.productId !== item.productId));
        // Retour en exécution côté serveur ; Hermes reçoit le souci décrit.
        await sendRef.current(
          `J'ai testé le module « ${item.name} » et il y a un problème : ${issue}\nCorrige puis livre une nouvelle version à tester.`,
        );
      } finally {
        setQaBusyId(null);
      }
    },
    [qaBusyId, qaIssueDrafts],
  );

  const activeTitle = useMemo(() => {
    if (!activeConversationId) return "Nouvelle conversation";
    return (
      conversations.find((c) => c.id === activeConversationId)?.title ||
      "Conversation"
    );
  }, [activeConversationId, conversations]);

  const grouped = useMemo(
    () => groupConversations(conversations),
    [conversations],
  );

  async function createNew(modeOverride?: AssistantMode) {
    const mode = modeOverride || preferredModeRef.current;
    const modeDefault =
      mode === "work" ? hermesDefaultModel : chatDefaultModel;
    const modelForCreate =
      mode === preferredModeRef.current
        ? activeModelRef.current || modeDefault
        : modeDefault;
    const res = await fetch("/api/v1/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelForCreate,
        mode,
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { conversation?: Conversation };
    if (!data.conversation) return;
    setPreferredMode(data.conversation.mode || mode);
    setActiveConversationId(data.conversation.id);
    setActiveModel(data.conversation.model || modeDefault);
    setMessages([]);
    await refreshConversations();
    setMenuOpen(false);
  }

  /** Pill Chat|Work : ne flip pas une conv existante — crée une nouvelle du mode choisi. */
  async function selectMode(next: AssistantMode) {
    if (busy) return;
    setPreferredMode(next);
    const current = conversations.find((c) => c.id === activeConversationId);
    if (current && current.mode && current.mode !== next) {
      await createNew(next);
      return;
    }
    if (!activeConversationId) {
      // Préférence seule : la prochaine création / premier message prendra ce mode
      setActiveModel(next === "work" ? hermesDefaultModel : chatDefaultModel);
      return;
    }
    if (current && !current.mode) {
      // Anciennes conv sans colonne mode → traitées chat ; on crée Work à part
      if (next === "work") await createNew("work");
    }
  }

  async function removeConversation(id: string) {
    if (deletingConversationIdsRef.current.has(id)) return;
    deletingConversationIdsRef.current.add(id);
    try {
      const res = await fetch(`/api/v1/assistant/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
        setActiveModel(defaultModel);
      }
      await refreshConversations();
    } finally {
      deletingConversationIdsRef.current.delete(id);
    }
  }

  async function changeModel(next: string) {
    setActiveModel(next);
    if (displayMode === "work") {
      try {
        await fetch("/api/v1/assistant/hermes-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: next }),
        });
      } catch {
        /* le prochain tour Work ré-appliquera via ensureHermesWorkModel */
      }
    }
    const id = activeIdRef.current;
    if (!id) return;
    const res = await fetch(`/api/v1/assistant/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: next }),
    });
    if (res.ok) {
      void refreshConversations();
    }
  }

  async function changeReasoning(next: string) {
    const previous = activeReasoning;
    setActiveReasoning(next);
    const [provider, model] = activeModel.includes("::")
      ? activeModel.split("::", 2)
      : ["", activeModel];
    try {
      const res = await fetch("/api/v1/assistant/hermes-reasoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effort: next, provider, model }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        effort?: string;
        options?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `Erreur HTTP ${res.status}`);
      if (data.effort) setActiveReasoning(data.effort);
      if (data.options?.length) setReasoningOptions(data.options);
    } catch (e) {
      setActiveReasoning(previous);
      setVoiceHint(
        e instanceof Error
          ? `Reasoning Hermes : ${e.message}`
          : "Impossible de modifier le reasoning Hermes",
      );
    }
  }

  function stopGeneration() {
    abortRef.current?.abort();
  }

  const voice = useVoiceInput({
    disabled: busy,
    onTranscript: async (text) => {
      setInput(text);
      setVoiceHint(null);
      await sendRef.current(text);
    },
    onError: (message) => {
      setVoiceHint(message);
    },
  });

  useEffect(() => {
    if (voice.state === "recording") {
      setVoiceHint("Écoute… recliquez pour envoyer");
    } else if (voice.state === "transcribing") {
      setVoiceHint("Transcription Whisper…");
    } else if (voice.state === "idle" && !voice.error) {
      setVoiceHint(null);
    }
  }, [voice.error, voice.state]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (chatBlocked) {
      setVoiceHint(
        "Assistant désactivé — configurez une clé OpenAI dans Configuration → Clés IA.",
      );
      return;
    }
    setBusy(true);
    setInput("");
    setVoiceHint(null);
    const userMsg: Msg = { id: uid(), role: "user", content: q };
    const assistantId = uid();
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        pending: true,
        sources: [],
        steps: [],
        thinking: "",
      },
    ]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const history = [...messages, userMsg]
        .filter((m) => !m.pending)
        .map((m) => ({ role: m.role, content: m.content }));

      // Rafraîchir listTabs juste avant l'envoi (URL/titre à jour).
      const api = getDesktopApi();
      if (api?.listTabs) {
        try {
          const list = await api.listTabs();
          const base =
            workspace?.activeSurface ??
            resolveActiveSurface({
              activeTab: workspace?.activeTab ?? null,
              href: workspace?.activeTab?.href || pathname,
              title: workspace?.activeTab?.title || document.title || pathname,
            });
          const supplierTabs: SupplierTabSummary[] = list.map((t) => ({
            tabId: t.tabId,
            fournisseurId: t.fournisseurId,
            url: t.url,
            title: t.title,
            active: t.active,
          }));
          const desktop =
            isExternalActiveSurface(base)
              ? list.find(
                  (t) =>
                    t.tabId === base.tabId ||
                    (base.fournisseurId > 0 &&
                      t.fournisseurId === base.fournisseurId) ||
                    t.active,
                )
              : list.find((t) => t.active);
          surfaceRef.current = {
            activeSurface: resolveActiveSurface({
              activeTab: workspace?.activeTab ?? null,
              href: workspace?.activeTab?.href || pathname,
              title: workspace?.activeTab?.title || document.title || pathname,
              desktopTab: desktop
                ? {
                    tabId: desktop.tabId,
                    url: desktop.url,
                    title: desktop.title,
                    fournisseurId: desktop.fournisseurId,
                  }
                : null,
            }),
            supplierTabs,
          };
        } catch {
          /* garder le snapshot précédent */
        }
      }
      const { activeSurface, supplierTabs } = surfaceRef.current;
      const res = await fetch("/api/v1/assistant/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          stream: true,
          conversationId: activeIdRef.current,
          model: activeModelRef.current,
          mode: preferredModeRef.current,
          activeSurface,
          supplierTabs,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) {
          throw new Error(
            err.error === "Non authentifié"
              ? "Session expirée ou absente — reconnectez-vous"
              : err.error || "Non authentifié",
          );
        }
        throw new Error(err.error || `Erreur HTTP ${res.status}`);
      }

      const applyConversationId = (id: string) => {
        if (id && id !== activeIdRef.current) {
          setActiveConversationId(id);
        }
      };

      const patchAssistant = (patch: Partial<Msg>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
        );
      };

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/event-stream")) {
        const { content, sources, conversationId, cancelled } = await readSse(res, {
          onToken: (tok) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + tok, pending: true }
                  : m,
              ),
            );
          },
          onSources: (nextSources) => {
            patchAssistant({ sources: nextSources });
          },
          onMeta: applyConversationId,
          onThinking: (text) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      thinking: m.thinking ? `${m.thinking}\n${text}` : text,
                    }
                  : m,
              ),
            );
          },
          onToolStart: (step) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, steps: [...(m.steps || []), step] }
                  : m,
              ),
            );
          },
          onToolResult: (step) => {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const steps = (m.steps || []).map((s) =>
                  s.id === step.id
                    ? {
                        ...s,
                        ...step,
                        status: step.status || s.status,
                      }
                    : s,
                );
                return { ...m, steps };
              }),
            );
            // Mutation MCP/chat → bus UI natif (SoT : inferResourceFromToolName).
            if (step.status !== "error" && step.toolName) {
              const resource = inferResourceFromToolName(String(step.toolName));
              if (resource) {
                emitDataChanged({ resource, source: "assistant" });
              }
            }
          },
          onCancelled: () => {
            patchAssistant({
              content: "(Génération interrompue)",
              pending: false,
            });
          },
          onUiAction: (action) => {
            window.dispatchEvent(
              new CustomEvent("creezio-assistant-ui-action", { detail: action }),
            );
          },
        });
        if (conversationId) applyConversationId(conversationId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: cancelled
                    ? m.content || "(Génération interrompue)"
                    : content || m.content,
                  sources: sources.length ? sources : m.sources,
                  pending: false,
                }
              : m,
          ),
        );
      } else {
        const data = (await res.json()) as {
          content?: string;
          sources?: Source[];
          error?: string;
          conversationId?: string;
          cancelled?: boolean;
        };
        if (data.error) throw new Error(data.error);
        if (data.conversationId) applyConversationId(data.conversationId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: data.content || "Réponse vide.",
                  sources: data.sources || [],
                  pending: false,
                }
              : m,
          ),
        );
      }
      void refreshConversations();
      setTraceRefreshKey((k) => k + 1);
    } catch (e) {
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && e.name === "AbortError");
      const msg = e instanceof Error ? e.message : "Erreur inconnue";
      const sessionLost =
        !aborted &&
        /non authentifié|session expirée|session invalide/i.test(msg);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: aborted
                  ? m.content || "(Génération interrompue)"
                  : `Impossible de répondre : ${msg}`,
                pending: false,
              }
            : m,
        ),
      );
      setTraceRefreshKey((k) => k + 1);
      if (sessionLost && typeof window !== "undefined") {
        const next = `${window.location.pathname}${window.location.search || ""}`;
        const url = new URL("/login", window.location.origin);
        if (next && next !== "/login") url.searchParams.set("next", next);
        window.setTimeout(() => {
          window.location.assign(url.toString());
        }, 1200);
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  sendRef.current = send;

  if (!hydrated) return null;

  if (!open) {
    // Electron : FAB dessiné dans AssistantChromeOverlay (au-dessus des sites).
    // Navigateur : FAB React fixed overlay classique.
    if (getDesktopApi()?.setAssistantChrome) {
      return null;
    }
    return (
      <button
        type="button"
        data-creezio-assistant-ui
                onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full",
          "bg-sky-600 text-white shadow-lg shadow-sky-900/25",
          "transition hover:bg-sky-700 hover:shadow-xl focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2",
        )}
        aria-label="Ouvrir l'assistant"
      >
        <span className="relative inline-flex">
          <MessageCircle className="h-6 w-6" />
          <Sparkles className="absolute -right-1.5 -top-1.5 h-3.5 w-3.5 text-amber-200" />
        </span>
      </button>
    );
  }

  return (
    <>
      {/* Mobile : fond sombre (overlay plein écran) */}
      <button
        type="button"
        data-creezio-assistant-ui
                className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
        aria-label="Fermer l'assistant"
        onClick={() => setOpen(false)}
      />

      <aside
        data-creezio-assistant-ui
                className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-[100dvh] flex-col border-l border-slate-200 bg-white shadow-xl shadow-slate-900/10",
          "w-full md:w-[var(--assistant-panel-width)]",
        )}
        style={
          {
            "--assistant-panel-width": `${ASSISTANT_PANEL_WIDTH_PX}px`,
          } as React.CSSProperties
        }
        role="complementary"
        aria-label={`Assistant ${productNameLabel()}`}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 px-2 py-2">
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
                aria-label="Conversations"
              >
                <Bot className="h-4 w-4 shrink-0 text-sky-700" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                  {activeTitle}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-[min(100vw-2rem,340px)] max-h-[min(70vh,480px)] overflow-y-auto"
            >
              <DropdownMenuItem
                className="gap-2 font-medium"
                disabled={busy}
                onSelect={(e) => {
                  e.preventDefault();
                  void createNew();
                }}
              >
                <Plus className="h-4 w-4" />
                Nouvelle conversation
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {loadingList && conversations.length === 0 ? (
                <div className="px-2 py-3 text-xs text-slate-500">Chargement…</div>
              ) : null}
              {!loadingList && conversations.length === 0 ? (
                <div className="px-2 py-3 text-xs text-slate-500">
                  Aucune conversation pour l’instant.
                </div>
              ) : null}
              {grouped.map((group) => (
                <div key={group.label}>
                  <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    {group.label}
                  </DropdownMenuLabel>
                  {group.items.map((c) => {
                    const active = c.id === activeConversationId;
                    return (
                      <DropdownMenuItem
                        key={c.id}
                        className="group flex items-start gap-2 py-2"
                        disabled={busy}
                        onSelect={(e) => {
                          // La sélection Radix est gérée explicitement par le clic
                          // de ligne, afin qu'une poubelle imbriquée ne puisse jamais
                          // sélectionner la conversation qu'elle vient de supprimer.
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          if (deletingConversationIdsRef.current.has(c.id)) {
                            return;
                          }
                          const target = e.target;
                          if (
                            target instanceof Element &&
                            target.closest("[data-conversation-delete]")
                          ) {
                            return;
                          }
                          setActiveConversationId(c.id);
                          setMenuOpen(false);
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {active ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                            ) : (
                              <span className="inline-block w-3.5 shrink-0" />
                            )}
                            <p className="truncate text-sm font-medium text-slate-800">
                              {c.title}
                            </p>
                          </div>
                          <p className="mt-0.5 pl-5 truncate text-[11px] text-slate-400">
                            {c.mode === "work" ? "Work · " : "Chat · "}
                            {c.model ? `${c.model} · ` : ""}
                            {formatDistanceToNow(new Date(c.updated_at), {
                              addSuffix: true,
                              locale: fr,
                            })}
                          </p>
                        </div>
                        <button
                          type="button"
                          data-conversation-delete
                          className="mt-0.5 rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Supprimer la conversation ${c.title}`}
                          title="Supprimer"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void removeConversation(c.id);
                          }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.detail === 0) {
                              void removeConversation(c.id);
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            title="Nouvelle conversation"
            disabled={busy}
            onClick={() => void createNew()}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            title="Fermer"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-b border-slate-100 px-3 py-2">
          <div
            className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
            role="group"
            aria-label="Mode assistant"
          >
            {(
              [
                { id: "chat" as const, label: "Chat", hint: "Guide & réponses" },
                { id: "work" as const, label: "Work", hint: "Hermes · tâches" },
              ] as const
            ).map((opt) => {
              const active = displayMode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={busy}
                  title={opt.hint}
                  onClick={() => void selectMode(opt.id)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
                    active
                      ? opt.id === "work"
                        ? "bg-amber-600 text-white shadow-sm"
                        : "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500">
              {displayMode === "work" ? "Hermes" : "Modèle"}
            </span>
            <Select
              value={
                modelOptions.some((m) => m.id === activeModel)
                  ? activeModel
                  : defaultModel
              }
              onValueChange={(v) => void changeModel(v)}
              disabled={busy}
            >
              <SelectTrigger
                className={cn(
                  "h-8 flex-1 px-2 text-[11px] shadow-none",
                  displayMode === "work"
                    ? "border-amber-200 bg-amber-50/80"
                    : "border-slate-200 bg-slate-50/80",
                )}
                aria-label={displayMode === "work" ? "Modèle Hermes" : "Modèle"}
              >
                <SelectValue placeholder="Modèle" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.label || m.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {displayMode === "work" && reasoningSupported ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Brain className="h-3.5 w-3.5" />
                Reasoning
              </span>
              <Select
                value={
                  reasoningOptions.includes(activeReasoning)
                    ? activeReasoning
                    : reasoningOptions[0]
                }
                onValueChange={(value) => void changeReasoning(value)}
                disabled={busy}
              >
                <SelectTrigger
                  className="h-8 flex-1 border-amber-200 bg-amber-50/80 px-2 text-[11px] shadow-none"
                  aria-label="Niveau de reasoning Hermes"
                >
                  <SelectValue placeholder="Reasoning" />
                </SelectTrigger>
                <SelectContent>
                  {reasoningOptions.map((effort) => (
                    <SelectItem key={effort} value={effort} className="text-xs">
                      {REASONING_LABELS[effort] || effort}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="flex-1 px-3">
            <div className="space-y-2.5 py-3">
              {loadingThread ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Chargement du fil…
                </div>
              ) : null}

              {!loadingThread && messages.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-600">
                    {displayMode === "work"
                      ? "Hermes en direct : il exécute vos missions (API, SQL, automations, délégation des clics). Suivi sur /taches."
                      : "Posez vos questions ou confiez une mission : Hermes la prend en charge (kanban /taches + « Voir comme IA »)."}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={chatBlocked || busy}
                        onClick={() => void send(s)}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-left text-[11px] text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "rounded-xl px-2.5 py-2 text-xs",
                    m.role === "user"
                      ? "ml-6 bg-slate-900 text-white"
                      : "mr-2 border border-slate-100 bg-slate-50 text-slate-800",
                  )}
                >
                  {m.role === "assistant" ? (
                    <>
                      <AssistantToolSteps steps={m.steps} thinking={m.thinking} />
                      {m.content || !m.pending ? (
                        <AssistantMessageContent
                          content={m.content || ""}
                          sources={m.sources}
                          onNavigate={
                            workspace?.navigate
                              ? (href) => workspace.navigate(href)
                              : undefined
                          }
                        />
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          {m.steps && m.steps.length > 0
                            ? "Analyse en cours…"
                            : "Recherche…"}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {m.content}
                    </div>
                  )}
                  {m.pending && !m.content && !(m.steps && m.steps.length) ? (
                    <Loader2 className="mt-1 h-3 w-3 animate-spin text-slate-400" />
                  ) : null}
                  {m.sources && m.sources.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1 border-t border-slate-200/70 pt-1.5">
                      {m.sources.slice(0, 20).map((s) => (
                        <Link key={`${s.url}-${s.title}`} href={s.url}>
                          <Badge
                            variant="info"
                            className="max-w-[160px] truncate text-[10px] hover:underline"
                          >
                            {s.title}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {displayMode === "work" && !busy && pluginApprovals.length > 0
                ? pluginApprovals.map((approval) => (
                    <div
                      key={approval.productId}
                      className="mr-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                        <ClipboardCheck className="h-3.5 w-3.5" />
                        Projet prêt : {approval.name}
                      </div>
                      {approval.problem ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-amber-800">
                          {approval.problem}
                        </p>
                      ) : null}
                      {approval.scope ? (
                        <p className="mt-1 line-clamp-3 text-[11px] text-amber-700">
                          {approval.scope}
                        </p>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 bg-amber-600 px-2.5 text-[11px] text-white hover:bg-amber-700"
                          disabled={approvingProjectId === approval.productId}
                          onClick={() => void approveProject(approval)}
                        >
                          {approvingProjectId === approval.productId ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="mr-1 h-3 w-3" />
                          )}
                          Valider le projet
                        </Button>
                        <Link
                          href={`/admin/plugins/${approval.productId}`}
                          className="text-[11px] text-amber-700 underline-offset-2 hover:underline"
                        >
                          Voir le détail
                        </Link>
                      </div>
                    </div>
                  ))
                : null}
              {/* Cadrage : rounds de questions structurées déposés par Hermes. */}
              {displayMode === "work" && !busy && pluginClarifications.length > 0
                ? pluginClarifications.map((clarification) => {
                    const draft =
                      clarificationDrafts[clarification.clarificationId] || {};
                    const setDraft = (
                      questionId: string,
                      patch: Partial<ClarificationDraft[string]>,
                    ) =>
                      setClarificationDrafts((prev) => ({
                        ...prev,
                        [clarification.clarificationId]: {
                          ...prev[clarification.clarificationId],
                          [questionId]: {
                            ...prev[clarification.clarificationId]?.[questionId],
                            ...patch,
                          },
                        },
                      }));
                    const submitting =
                      submittingClarificationId === clarification.clarificationId;
                    return (
                      <div
                        key={clarification.clarificationId}
                        className="mr-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-900">
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          Questions de cadrage : {clarification.name}
                        </div>
                        <div className="mt-2 space-y-3">
                          {clarification.questions.map((question) => {
                            const qDraft = draft[question.id];
                            return (
                              <div key={question.id}>
                                <p className="text-[11px] font-medium text-sky-900">
                                  {question.label}
                                </p>
                                {question.type === "text" ? (
                                  <textarea
                                    className="mt-1 min-h-14 w-full rounded-md border border-sky-200 bg-white p-2 text-[11px] text-slate-800"
                                    placeholder="Votre réponse…"
                                    value={qDraft?.value || ""}
                                    disabled={submitting}
                                    onChange={(e) =>
                                      setDraft(question.id, { value: e.target.value })
                                    }
                                  />
                                ) : (
                                  <div className="mt-1 space-y-1">
                                    {(question.options || []).map((option) => {
                                      const checked =
                                        question.type === "multi"
                                          ? (qDraft?.values || []).includes(option)
                                          : qDraft?.value === option;
                                      return (
                                        <label
                                          key={option}
                                          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-700"
                                        >
                                          <input
                                            type={
                                              question.type === "multi"
                                                ? "checkbox"
                                                : "radio"
                                            }
                                            name={`${clarification.clarificationId}-${question.id}`}
                                            checked={checked}
                                            disabled={submitting}
                                            onChange={() => {
                                              if (question.type === "multi") {
                                                const values = qDraft?.values || [];
                                                setDraft(question.id, {
                                                  values: checked
                                                    ? values.filter((v) => v !== option)
                                                    : [...values, option],
                                                });
                                              } else {
                                                setDraft(question.id, { value: option });
                                              }
                                            }}
                                          />
                                          {option}
                                        </label>
                                      );
                                    })}
                                    {question.allowOther ? (
                                      <div className="flex items-center gap-1.5">
                                        {question.type === "choice" ? (
                                          <input
                                            type="radio"
                                            name={`${clarification.clarificationId}-${question.id}`}
                                            checked={qDraft?.value === "__other__"}
                                            disabled={submitting}
                                            onChange={() =>
                                              setDraft(question.id, { value: "__other__" })
                                            }
                                          />
                                        ) : null}
                                        <Input
                                          className="h-7 flex-1 border-sky-200 bg-white text-[11px]"
                                          placeholder="Autre…"
                                          value={qDraft?.other || ""}
                                          disabled={submitting}
                                          onChange={(e) =>
                                            setDraft(question.id, {
                                              other: e.target.value,
                                              ...(question.type === "choice" &&
                                              e.target.value.trim()
                                                ? { value: "__other__" }
                                                : {}),
                                            })
                                          }
                                        />
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <Button
                          size="sm"
                          className="mt-2.5 h-7 bg-sky-600 px-2.5 text-[11px] text-white hover:bg-sky-700"
                          disabled={submitting}
                          onClick={() => void submitClarification(clarification)}
                        >
                          {submitting ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="mr-1 h-3 w-3" />
                          )}
                          Envoyer les réponses
                        </Button>
                      </div>
                    );
                  })
                : null}
              {/* QA humaine : module livré — l'utilisateur teste puis valide. */}
              {displayMode === "work" && !busy && pluginQa.length > 0
                ? pluginQa.map((item) => {
                    const busyQa = qaBusyId === item.productId;
                    const issueOpen = Boolean(qaIssueOpen[item.productId]);
                    return (
                      <div
                        key={item.productId}
                        className="mr-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900">
                          <ClipboardCheck className="h-3.5 w-3.5" />
                          Votre module est prêt : {item.name}
                        </div>
                        <p className="mt-1 text-[11px] text-emerald-800">
                          Testez-le dans l&apos;application, puis validez ou signalez un
                          problème.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 bg-emerald-600 px-2.5 text-[11px] text-white hover:bg-emerald-700"
                            disabled={busyQa}
                            onClick={() => void qaValidate(item)}
                          >
                            {busyQa ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-3 w-3" />
                            )}
                            Valider
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-emerald-300 px-2.5 text-[11px] text-emerald-900 hover:bg-emerald-100"
                            disabled={busyQa}
                            onClick={() =>
                              setQaIssueOpen((prev) => ({
                                ...prev,
                                [item.productId]: !prev[item.productId],
                              }))
                            }
                          >
                            Signaler un problème
                          </Button>
                          <Link
                            href={`/admin/plugins/${item.productId}`}
                            className="text-[11px] text-emerald-700 underline-offset-2 hover:underline"
                          >
                            Voir le détail
                          </Link>
                        </div>
                        {issueOpen ? (
                          <div className="mt-2 space-y-1.5">
                            <textarea
                              className="min-h-14 w-full rounded-md border border-emerald-200 bg-white p-2 text-[11px] text-slate-800"
                              placeholder="Décrivez ce qui ne va pas (ce que vous attendiez, ce qui se passe)…"
                              value={qaIssueDrafts[item.productId] || ""}
                              disabled={busyQa}
                              onChange={(e) =>
                                setQaIssueDrafts((prev) => ({
                                  ...prev,
                                  [item.productId]: e.target.value,
                                }))
                              }
                            />
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2.5 text-[11px]"
                              disabled={busyQa || !(qaIssueDrafts[item.productId] || "").trim()}
                              onClick={() => void qaReportIssue(item)}
                            >
                              {busyQa ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="mr-1 h-3 w-3" />
                              )}
                              Envoyer le signalement
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <AssistantTracePanel
            conversationId={activeConversationId}
            refreshKey={traceRefreshKey}
          />

          <div className="shrink-0 border-t border-slate-100 p-2.5">
            {chatBlocked ? (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-950">
                <p className="font-medium">Assistant bloqué — clé LLM manquante</p>
                <p className="mt-0.5 text-amber-900/90">
                  {llmGate.byokRequired ? (
                    <>
                      Configurez votre clé dans{" "}
                      <Link href="/configuration" className="underline underline-offset-2">
                        Configuration → Clés IA
                      </Link>
                      . Sans clé locale (BYOK), aucun appel LLM n&apos;est possible.
                    </>
                  ) : (
                    <>
                      Aucune clé LLM côté serveur (
                      <code className="text-[10px]">OPENAI_API_KEY</code> /{" "}
                      <code className="text-[10px]">ANTHROPIC_API_KEY</code>
                      ). Le message ne peut pas être envoyé tant que l&apos;assistant
                      n&apos;est pas prêt.
                    </>
                  )}
                </p>
              </div>
            ) : null}
            {voiceHint ? (
              <p
                className={cn(
                  "mb-1.5 px-0.5 text-[11px]",
                  voice.state === "error" || voice.error
                    ? "text-rose-600"
                    : voice.recording
                      ? "font-medium text-rose-600"
                      : "text-slate-500",
                )}
              >
                {voiceHint}
              </p>
            ) : null}
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (chatBlocked || busy || voice.recording || voice.transcribing) return;
                void send(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  chatBlocked
                    ? "Clé OpenAI requise…"
                    : voice.recording
                      ? "Parlez… recliquez le micro pour envoyer"
                      : "Ex. combien de produits chez Agidra…"
                }
                disabled={chatBlocked || busy || voice.recording || voice.transcribing}
                className="h-9 flex-1 text-xs"
              />
              {voice.supported ? (
                <Button
                  type="button"
                  size="icon"
                  variant={voice.recording ? "destructive" : "outline"}
                  className={cn(
                    "h-9 w-9 shrink-0",
                    voice.recording && "animate-pulse",
                  )}
                  title={
                    voice.recording
                      ? "Arrêter et envoyer"
                      : voice.transcribing
                        ? "Transcription…"
                        : "Parler (Whisper)"
                  }
                  aria-label={
                    voice.recording ? "Arrêter l'enregistrement" : "Parler"
                  }
                  aria-pressed={voice.recording}
                  disabled={chatBlocked || busy || voice.transcribing}
                  onClick={() => voice.toggle()}
                >
                  {voice.transcribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : voice.recording ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              {busy ? (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="h-9 w-9"
                  title="Arrêter la génération"
                  aria-label="Arrêter"
                  onClick={() => stopGeneration()}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="icon"
                  className="h-9 w-9"
                  disabled={
                    chatBlocked ||
                    !input.trim() ||
                    voice.recording ||
                    voice.transcribing
                  }
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
