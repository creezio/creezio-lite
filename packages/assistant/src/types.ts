export type AssistantRole = "user" | "assistant" | "system";

export type AssistantMessage = {
  id: string;
  conversationId: string;
  role: AssistantRole;
  content: string;
  createdAt: string;
  /** C1 — JSON stringifié des sources (optionnel). */
  sourcesJson?: string | null;
};

export type AssistantConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** C1 — modèle LLM (optionnel, défaut ""). */
  model?: string;
  /** C1 — mode assistant (chat, work, …). */
  mode?: string;
  /** C1 — propriétaire (users.id marque). */
  userId?: string | null;
};

export type CreateConversationInput = {
  title?: string;
  id?: string;
  model?: string;
  mode?: string;
  userId?: string | null;
};

export type AppendMessageInput = {
  role: AssistantRole;
  content: string;
  id?: string;
  sourcesJson?: string | null;
};

export type AssistantStore = {
  createConversation(input?: CreateConversationInput): AssistantConversation;
  listConversations(userId?: string | null): AssistantConversation[];
  getConversation(id: string): AssistantConversation | undefined;
  appendMessage(
    conversationId: string,
    input: AppendMessageInput,
  ): AssistantMessage;
  listMessages(conversationId: string): AssistantMessage[];
};

/** Surfaces IPC documentées (implémentation host = electron-shell / marque). */
export const ASSISTANT_IPC_SURFACE = {
  setChrome: "assistant:set-chrome",
  openRequest: "assistant:open-request",
  llmKeyStatus: "llm:key-status",
  llmSetKey: "llm:set-key",
  llmStatusChanged: "llm:status-changed",
} as const;
