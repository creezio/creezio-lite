/**
 * Bind handlers IPC auth sur les canaux `@creezio/shell` IpcChannels.auth.
 * L'hôte Electron fournit `handle(channel, fn)`.
 */

import { IpcChannels } from "@creezio/shell";
import {
  generateRecoveryKey,
  normalizeRecoveryKey,
} from "@creezio/platform-core";
import type { AuthStore } from "./types.js";

export type IpcHandleFn = (
  channel: string,
  listener: (...args: unknown[]) => unknown | Promise<unknown>,
) => void;

export type AuthIpcBindings = {
  channels: typeof IpcChannels.auth;
  /** Token session courant (main process memory). */
  getCurrentToken: () => string | null;
  setCurrentToken: (token: string | null) => void;
};

/**
 * Enregistre les handlers génériques (account / logout / stay / recovery key).
 * googleLogin / recoverPassword restent optionnels (marque / OAuth).
 */
export function bindAuthIpcHandlers(
  handle: IpcHandleFn,
  store: AuthStore,
  bindings?: Partial<AuthIpcBindings>,
): AuthIpcBindings {
  let token: string | null = null;
  const getCurrentToken = bindings?.getCurrentToken || (() => token);
  const setCurrentToken =
    bindings?.setCurrentToken ||
    ((t: string | null) => {
      token = t;
    });

  handle(IpcChannels.auth.account, async () => {
    const t = getCurrentToken();
    if (!t) return { ok: false, account: null };
    const account = await store.getAccount(t);
    return { ok: Boolean(account), account };
  });

  handle(IpcChannels.auth.logout, async () => {
    const t = getCurrentToken();
    if (t) await store.logout(t);
    setCurrentToken(null);
    return { ok: true };
  });

  handle(IpcChannels.auth.setStayLoggedIn, async (...args: unknown[]) => {
    const value = Boolean(args[0]);
    const t = getCurrentToken();
    if (!t) return { ok: false };
    const ok = await store.setStayLoggedIn(t, value);
    return { ok };
  });

  handle(IpcChannels.auth.changePassword, async (...args: unknown[]) => {
    const payload = (args[0] || {}) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const t = getCurrentToken();
    if (!t) return { ok: false, error: "unauthorized" };
    try {
      await store.changePassword({
        token: t,
        currentPassword: String(payload.currentPassword || ""),
        newPassword: String(payload.newPassword || ""),
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "error" };
    }
  });

  handle(IpcChannels.auth.generateRecoveryKey, async () => {
    const key = generateRecoveryKey();
    return { ok: true, recoveryKey: key, normalized: normalizeRecoveryKey(key) };
  });

  // Stubs documentés — OAuth / recover restent branchables par la marque.
  handle(IpcChannels.auth.googleLogin, async () => ({
    ok: false,
    error: "not_implemented_in_kit",
  }));
  handle(IpcChannels.auth.recoverPassword, async () => ({
    ok: false,
    error: "not_implemented_in_kit",
  }));

  return {
    channels: IpcChannels.auth,
    getCurrentToken,
    setCurrentToken,
  };
}

/** Helper login côté main (hors IPC google). */
export async function authLoginWithStore(
  store: AuthStore,
  input: { email: string; password: string; stayLoggedIn?: boolean },
  setToken: (t: string | null) => void,
) {
  const session = await store.login(input);
  setToken(session.token);
  return session;
}
