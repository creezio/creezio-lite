/**
 * Pont HTTP first-run pour le mode serveur Docker / navigateur.
 * Remplace le preload Electron (`getShellDesktopApi`) quand absent :
 * GET/POST `/api/v1/os/setup` (app-runtime listen-brand-os-http).
 */

import { SLUG_RE } from "./setup-types";

export type SetupStatus = {
  setupComplete?: boolean;
  username?: string | null;
  tunnelSlug?: string;
  hasTunnel?: boolean;
  hasOpenai?: boolean;
};

export type SetupDesktopApiSubset = {
  getSetupStatus: () => Promise<SetupStatus>;
  generateRecoveryKey: () => Promise<{ recoveryKey: string }>;
  checkTunnelSlug: (
    slug: string,
  ) => Promise<{ available: boolean; reason?: string }>;
  completeSetup: (payload: {
    username: string;
    password: string;
    openaiKey: string;
    slug: string;
    recoveryKey: string;
    stayLoggedIn: boolean;
  }) => Promise<{ ok: boolean; error?: string; hostname?: string }>;
  setAssistantChrome?: (mode: "hidden" | "visible" | string) => void;
  rechooseConnection?: () => void;
};

function generateRecoveryKeyBrowser(): string {
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join("-");
}

async function readJson(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = data.error;
    throw new Error(
      typeof err === "string" && err ? err : `HTTP ${res.status}`,
    );
  }
  return data;
}

/** True si le serveur expose le first-run HTTP (Docker / harness). */
export async function probeHttpSetupAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/os/setup", { credentials: "same-origin" });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Stub desktop API same-origin pour SetupWizard hors Electron.
 * Tunnel : validation locale du slug ; surface locale best-effort après POST setup.
 */
export function createHttpSetupDesktopApi(): SetupDesktopApiSubset {
  return {
    setAssistantChrome() {
      /* no-op navigateur */
    },
    async getSetupStatus() {
      const s = await readJson("GET", "/api/v1/os/setup");
      return {
        setupComplete: Boolean(s.setupComplete),
        username: (s.username as string | null | undefined) ?? null,
        hasOpenai: Boolean(s.hasOpenai),
      };
    },
    async generateRecoveryKey() {
      return { recoveryKey: generateRecoveryKeyBrowser() };
    },
    async checkTunnelSlug(slug: string) {
      const s = String(slug || "")
        .trim()
        .toLowerCase();
      if (!SLUG_RE.test(s)) {
        return {
          available: false,
          reason: "Slug invalide (a-z, 0-9, tirets, 2–48 car.)",
        };
      }
      // Pas d'endpoint HTTP check-slug : format OK = disponible côté Docker.
      return { available: true };
    },
    async completeSetup(payload) {
      try {
        await readJson("POST", "/api/v1/os/setup", {
          username: payload.username,
          password: payload.password,
          openaiKey: payload.openaiKey,
          recoveryKey: payload.recoveryKey,
          stayLoggedIn: payload.stayLoggedIn,
        });
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "Échec de la configuration",
        };
      }
      const slug = String(payload.slug || "")
        .trim()
        .toLowerCase();
      if (slug) {
        try {
          await readJson("POST", "/api/v1/os/tunnel/local", { slug });
        } catch {
          /* non bloquant — tunnel configurable ensuite via /settings */
        }
      }
      const hostname =
        typeof window !== "undefined" ? window.location.host : "localhost";
      return { ok: true, hostname };
    },
  };
}
