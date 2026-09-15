import { assistantIdentity, getAssistantBrandConfig } from "./registry.js";

export function isDesktopOnline(userId: string): boolean {
  const fn = getAssistantBrandConfig()?.desktopPresence?.isDesktopOnline;
  if (fn) return fn(userId);
  return false;
}

export function desktopOfflineError(userId: string): Record<string, unknown> {
  const fn = getAssistantBrandConfig()?.desktopPresence?.desktopOfflineError;
  if (fn) return fn(userId);
  return {
    ok: false,
    code: "desktop_offline",
    error: `Desktop ${assistantIdentity().productName} hors ligne pour l'utilisateur ${userId}`,
    user_id: userId,
  };
}
