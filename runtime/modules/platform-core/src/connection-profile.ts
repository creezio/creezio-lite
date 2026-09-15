/**
 * Profils de connexion desktop : serveur local embarqué vs API distante.
 * Logique pure (pas d'import Electron) — port de electron/connection-profile.ts.
 */

import http from "node:http";
import https from "node:https";

export type ConnectionMode = "local" | "remote";
export type LocalBindHost = "127.0.0.1" | "0.0.0.0";

export type ConnectionProfile = {
  mode: ConnectionMode;
  remoteUrl?: string | null;
  localBind?: LocalBindHost;
  chosen?: boolean;
};

export type ConnectionProfilePublic = {
  mode: ConnectionMode;
  remoteUrl: string | null;
  localBind: LocalBindHost;
  chosen: boolean;
  activeBaseUrl: string | null;
  serverPort: number | null;
};

export function defaultLocalProfile(): ConnectionProfile {
  return {
    mode: "local",
    localBind: "127.0.0.1",
    chosen: false,
  };
}

export function unsetConnectionProfile(): ConnectionProfile {
  return {
    mode: "local",
    localBind: "127.0.0.1",
    chosen: false,
  };
}

export function normalizeRemoteUrl(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) throw new Error("URL serveur requise");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error("URL invalide");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("URL doit commencer par http:// ou https://");
  }
  if (!u.hostname) throw new Error("Hôte manquant dans l'URL");
  return u.origin;
}

export function normalizeLocalBind(raw: unknown): LocalBindHost {
  return raw === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
}

export function sanitizeConnectionProfile(
  raw: Partial<ConnectionProfile> | null | undefined,
): ConnectionProfile {
  if (!raw || typeof raw !== "object") return defaultLocalProfile();
  const mode: ConnectionMode = raw.mode === "remote" ? "remote" : "local";
  const localBind = normalizeLocalBind(raw.localBind);
  let remoteUrl: string | null | undefined;
  if (typeof raw.remoteUrl === "string" && raw.remoteUrl.trim()) {
    try {
      remoteUrl = normalizeRemoteUrl(raw.remoteUrl);
    } catch {
      remoteUrl = raw.remoteUrl.trim().replace(/\/+$/, "");
    }
  } else if (raw.remoteUrl === null) {
    remoteUrl = null;
  }
  const chosen = raw.chosen === true;
  return { mode, localBind, remoteUrl, chosen };
}

export function resolveBootProfile(
  stored: ConnectionProfile | null | undefined,
): { profile: ConnectionProfile; showPicker: boolean } {
  if (!stored) {
    return { profile: defaultLocalProfile(), showPicker: true };
  }
  const profile = sanitizeConnectionProfile(stored);
  return { profile, showPicker: true };
}

/**
 * Profil de secours selon le kind d'app (serveur → local, client → remote).
 * Jamais `undefined` — toujours un objet avec `.mode`.
 */
export function defaultProfileForAppKind(
  appKind: string | null | undefined,
): ConnectionProfile {
  const kind = String(appKind || "")
    .trim()
    .toLowerCase();
  if (kind === "client") {
    return {
      mode: "remote",
      remoteUrl: null,
      localBind: "127.0.0.1",
      chosen: false,
    };
  }
  return defaultLocalProfile();
}

/**
 * Normalise le retour de `resolveBootProfile` (ou stubs marque) :
 * - `{ profile, showPicker }` canonique
 * - profil nu `{ mode, … }` (anciens stubs OS)
 * - `null` / `undefined` / non-objet → défaut selon `appKind`
 *
 * Garantit `profile.mode` toujours défini (plus de crash « reading 'mode' »).
 */
export function unwrapBootProfileResult(
  resolved: unknown,
  appKind?: string | null,
): { profile: ConnectionProfile; showPicker: boolean } {
  const fallback = defaultProfileForAppKind(appKind);
  if (!resolved || typeof resolved !== "object") {
    return { profile: fallback, showPicker: true };
  }
  const obj = resolved as Record<string, unknown>;
  if ("profile" in obj) {
    const inner = obj.profile;
    const profile =
      inner && typeof inner === "object"
        ? sanitizeConnectionProfile(inner as Partial<ConnectionProfile>)
        : fallback;
    return {
      profile: profile?.mode ? profile : fallback,
      showPicker: "showPicker" in obj ? Boolean(obj.showPicker) : true,
    };
  }
  const bare = sanitizeConnectionProfile(obj as Partial<ConnectionProfile>);
  return {
    profile: bare?.mode ? bare : fallback,
    showPicker: true,
  };
}

export function assertProfileReady(
  profile: ConnectionProfile,
): ConnectionProfile {
  const p = sanitizeConnectionProfile(profile);
  if (p.mode === "remote") {
    if (!p.remoteUrl) throw new Error("URL du serveur distant requise");
    p.remoteUrl = normalizeRemoteUrl(p.remoteUrl);
  }
  return p;
}

function httpGetStatus(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; error?: string }> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      resolve({ status: 0, error: "URL invalide" });
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ status: res.statusCode || 0 });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ status: 0, error: "Délai dépassé" });
    });
    req.on("error", (e) =>
      resolve({ status: 0, error: e instanceof Error ? e.message : String(e) }),
    );
  });
}

/**
 * Health check serveur CRM : GET /health → 200 ou 503 = joignable.
 */
export async function testRemoteHealth(
  rawUrl: string,
  timeoutMs = 8000,
): Promise<{ ok: boolean; status: number; baseUrl?: string; error?: string }> {
  let baseUrl: string;
  try {
    baseUrl = normalizeRemoteUrl(rawUrl);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const { status, error } = await httpGetStatus(
    `${baseUrl}/health`,
    timeoutMs,
  );
  if (status === 200 || status === 503) {
    return { ok: true, status, baseUrl };
  }
  return {
    ok: false,
    status,
    baseUrl,
    error:
      error ||
      (status
        ? `Réponse HTTP ${status} (attendu 200 ou 503 sur /health)`
        : "Serveur injoignable"),
  };
}
