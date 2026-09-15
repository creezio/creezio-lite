import crypto from "node:crypto";
import type {
  AssistantConversation,
  AssistantMessage,
  AssistantStore,
} from "./types.js";

function now(): string {
  return new Date().toISOString();
}

export function createMemoryAssistantStore(): AssistantStore {
  const conversations = new Map<string, AssistantConversation>();
  const messages = new Map<string, AssistantMessage[]>();

  return {
    createConversation(input) {
      const ts = now();
      const c: AssistantConversation = {
        id: input?.id || crypto.randomUUID(),
        title: (input?.title || "Nouvelle conversation").trim(),
        model: input?.model || "",
        mode: input?.mode || "chat",
        userId: input?.userId ?? null,
        createdAt: ts,
        updatedAt: ts,
      };
      conversations.set(c.id, c);
      messages.set(c.id, []);
      return c;
    },
    listConversations(userId) {
      let list = [...conversations.values()];
      if (userId) {
        list = list.filter((c) => !c.userId || c.userId === userId);
      }
      return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    getConversation(id) {
      return conversations.get(id);
    },
    appendMessage(conversationId, input) {
      const c = conversations.get(conversationId);
      if (!c) throw new Error("conversation_not_found");
      const msg: AssistantMessage = {
        id: input.id || crypto.randomUUID(),
        conversationId,
        role: input.role,
        content: input.content,
        sourcesJson: input.sourcesJson ?? null,
        createdAt: now(),
      };
      const list = messages.get(conversationId) || [];
      list.push(msg);
      messages.set(conversationId, list);
      conversations.set(conversationId, { ...c, updatedAt: msg.createdAt });
      return msg;
    },
    listMessages(conversationId) {
      return [...(messages.get(conversationId) || [])];
    },
  };
}
