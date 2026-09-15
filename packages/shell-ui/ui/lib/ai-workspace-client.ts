"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";
/**
 * Ouverture du workspace visuel d'un collaborateur IA (« Voir comme IA »).
 * Client uniquement — nécessite le bridge desktop (app Electron).
 */
export function aiWorkspaceAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(getShellDesktopApi()?.showAiWorkspace)
  );
}

export async function openAiWorkspaceView(
  userId: string,
  label?: string,
): Promise<{ ok: boolean; error?: string }> {
  const desktop =
    typeof window !== "undefined" ? getShellDesktopApi() : undefined;
  if (!desktop?.showAiWorkspace) {
    return { ok: false, error: "Disponible uniquement dans l'app desktop" };
  }
  const session = await fetch("/api/v1/auth/ai-workspace-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const data = (await session.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };
  if (!session.ok || !data.token) {
    return { ok: false, error: data.error || "Session workspace refusée" };
  }
  const ensured = await desktop.ensureAiWorkspace?.({
    userId,
    token: data.token,
    label,
  });
  if (!ensured?.ok) {
    return { ok: false, error: "Workspace IA indisponible" };
  }
  await desktop.showAiWorkspace(userId);
  return { ok: true };
}
