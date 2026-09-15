/**
 * Session desktop légère (first-run / login / connexion) — OS kit.
 *
 * Pour les apps `--from-prd` : pas de store/IPC custom dans la marque.
 * Utilise `createLocalConfigStoreSync` + handlers IPC stables.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import type { ConnectionProfile } from "@creezio/platform-core";
import {
  createLocalConfigStoreSync,
  type LocalConfigStore,
} from "@creezio/host-runtime";

export type DesktopSessionInfo = {
  brandId: string;
  productName: string;
  appKind: string;
  metierPort?: number;
};

export type DesktopSessionStatus = {
  setupComplete: boolean;
  hasSession: boolean;
  user: string | null;
  connection: ConnectionProfile;
};

export type DesktopSessionApi = {
  store: LocalConfigStore;
  sessionFile: string;
  isSetupComplete: () => boolean;
  getSetupStatus: () => DesktopSessionStatus;
  completeSetup: (
    user: string,
    password: string,
  ) => { ok: true; user: string; sessionToken: string } | { ok: false; error: string };
  login: (
    user: string,
    password: string,
  ) => { ok: true; user: string; sessionToken: string } | { ok: false; error: string };
  logout: () => { ok: true };
  getSession: () =>
    | { authenticated: true; user: string; sessionToken: string }
    | { authenticated: false };
  getConnectionProfile: () => ConnectionProfile;
  chooseConnection: (profile: ConnectionProfile) => ConnectionProfile;
};

type IpcMainLike = {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>,
  ) => void;
};

function readSessionToken(sessionFile: string): string | null {
  try {
    if (!fs.existsSync(sessionFile)) return null;
    const raw = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as {
      sessionToken?: string;
    };
    return raw.sessionToken || null;
  } catch {
    return null;
  }
}

function writeSessionToken(sessionFile: string, token: string | null): void {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  if (!token) {
    if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    return;
  }
  fs.writeFileSync(
    sessionFile,
    JSON.stringify({ sessionToken: token }, null, 2),
  );
}

/**
 * Store session first-run — fichier sous userData, encryption plain
 * (tests Node + apps from-prd sans safeStorage Electron).
 */
export function createDesktopSessionStore(opts: {
  userDataDir: string;
  manifest: AppManifest;
  /** Nom fichier config (défaut local-config.json). */
  configFileName?: string;
}): DesktopSessionApi {
  const userDataDir = opts.userDataDir;
  fs.mkdirSync(userDataDir, { recursive: true });
  const configPath = path.join(
    userDataDir,
    opts.configFileName || "local-config.json",
  );
  const sessionFile = path.join(userDataDir, "desktop-session.json");
  const store = createLocalConfigStoreSync({
    configPath,
    manifest: opts.manifest,
    encryption: "plain",
  });

  store.ensureAuthSecret();
  store.ensureMcpJwtSecret();

  return {
    store,
    sessionFile,
    isSetupComplete: () => store.isSetupComplete(),
    getSetupStatus(): DesktopSessionStatus {
      const auth = store.getLocalAuth();
      return {
        setupComplete: store.isSetupComplete(),
        hasSession: Boolean(readSessionToken(sessionFile)),
        user: auth?.authUser ?? null,
        connection: store.getConnectionProfile(),
      };
    },
    completeSetup(user: string, password: string) {
      try {
        store.setLocalAuthCredentials(user, password);
        store.markSetupComplete();
        store.setStayLoggedIn(true);
        const sessionToken = randomBytes(24).toString("hex");
        writeSessionToken(sessionFile, sessionToken);
        return { ok: true as const, user: user.trim(), sessionToken };
      } catch (e) {
        return {
          ok: false as const,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    login(user: string, password: string) {
      if (!store.isSetupComplete()) {
        return { ok: false as const, error: "setup_required" };
      }
      const auth = store.getLocalAuth();
      if (!auth || auth.authUser !== user || auth.authPassword !== password) {
        return { ok: false as const, error: "invalid_credentials" };
      }
      const sessionToken = randomBytes(24).toString("hex");
      writeSessionToken(sessionFile, sessionToken);
      store.setSkipAutoLogin(false);
      return { ok: true as const, user, sessionToken };
    },
    logout() {
      writeSessionToken(sessionFile, null);
      store.setSkipAutoLogin(true);
      return { ok: true as const };
    },
    getSession() {
      const token = readSessionToken(sessionFile);
      const auth = store.getLocalAuth();
      if (!token || !auth) return { authenticated: false as const };
      return {
        authenticated: true as const,
        user: auth.authUser,
        sessionToken: token,
      };
    },
    getConnectionProfile: () => store.getConnectionProfile(),
    chooseConnection(profile: ConnectionProfile) {
      return store.setConnectionProfile(profile);
    },
  };
}

/** Enregistre les handlers IPC session (setup / auth / connexion / info). */
export function registerDesktopSessionIpc(opts: {
  ipcMain: IpcMainLike;
  session: DesktopSessionApi;
  info: DesktopSessionInfo;
}): void {
  const { ipcMain, session, info } = opts;

  ipcMain.handle("desktop:info", () => ({
    brandId: info.brandId,
    productName: info.productName,
    appKind: info.appKind,
    metierBaseUrl:
      info.metierPort != null
        ? `http://127.0.0.1:${info.metierPort}`
        : null,
    isDesktop: true,
  }));

  ipcMain.handle("setup:status", () => session.getSetupStatus());

  ipcMain.handle("setup:complete", (_e, payload: unknown) => {
    const p = (payload || {}) as {
      user?: string;
      username?: string;
      password?: string;
    };
    const user = String(p.user || p.username || "").trim();
    const password = String(p.password || "");
    if (!user || !password) {
      return { ok: false, error: "user_password_required" };
    }
    return session.completeSetup(user, password);
  });

  ipcMain.handle("auth:login", (_e, payload: unknown) => {
    const p = (payload || {}) as { user?: string; password?: string };
    if (!p.user || !p.password) {
      return { ok: false, error: "user_password_required" };
    }
    return session.login(p.user, p.password);
  });

  ipcMain.handle("auth:logout", () => session.logout());
  ipcMain.handle("auth:session", () => session.getSession());

  ipcMain.handle("connection:get", () => session.getConnectionProfile());
  ipcMain.handle("connection:choose", (_e, profile: unknown) =>
    session.chooseConnection(
      (profile || {}) as ConnectionProfile,
    ),
  );
}

/** Spawn API métier locale (`scripts/metier-api.mjs`) — sidecar from-prd. */
export function spawnBrandMetierApi(opts: {
  scriptPath: string;
  userDataDir: string;
  port: number;
  log?: (scope: string, line: string) => void;
  nodePath?: string;
}): ChildProcess {
  const dataDir = path.join(opts.userDataDir, "metier-data");
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(opts.nodePath || process.execPath, [opts.scriptPath], {
    env: {
      ...process.env,
      METIER_PORT: String(opts.port),
      METIER_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = opts.log || (() => undefined);
  child.stdout?.on("data", (buf) => log("metier", String(buf).trim()));
  child.stderr?.on("data", (buf) => log("metier-err", String(buf).trim()));
  return child;
}
