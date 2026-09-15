/**
 * Clarifications structurées — interview itérative Product Hub.
 */

export type PluginClarificationQuestion = {
  id: string;
  label: string;
  type: "choice" | "multi" | "text";
  options?: string[];
  allowOther?: boolean;
};

export type PluginClarificationStatus = "open" | "answered";

export type PluginClarificationRound = {
  id: string;
  pluginProductId: string;
  round: number;
  questions: PluginClarificationQuestion[];
  answers?: Record<string, string | string[]>;
  status: PluginClarificationStatus;
  createdAt: string;
  answeredAt?: string | null;
};

export function assertClarificationQuestions(
  questions: PluginClarificationQuestion[],
): void {
  if (!questions.length) throw new Error("Au moins une question requise");
  for (const q of questions) {
    if (!q.id?.trim() || !q.label?.trim()) {
      throw new Error("Chaque question doit avoir id et label");
    }
    if (!["choice", "multi", "text"].includes(q.type)) {
      throw new Error(`Type de question invalide: ${q.type}`);
    }
  }
}
