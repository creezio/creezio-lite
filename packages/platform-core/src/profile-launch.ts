/**
 * Profils de lancement multi-instances — logique PURE.
 * Port brand-agnostic de electron/profile.ts (kit).
 */

import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import {
  profileArgPrefix,
  profileDirArgPrefix,
} from "@creezio/brand-config";
import { normalizeRemoteUrl } from "./connection-profile.js";

export type ProfileMode = "server" | "ai" | "join";

export type ProfileLaunch = {
  mode: ProfileMode;
  aiUserId?: string;
  serverUrl?: string;
  profileDir?: string;
};

export function sanitizeProfileSegment(raw: string): string {
  const s = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return (s || "profil").slice(0, 64);
}

/**
 * Deep-link `{protocol}://join/<cible>` → base URL normalisée, ou null.
 */
export function parseJoinDeepLink(
  rawUrl: string,
  protocol: string,
): string | null {
  const proto = String(protocol || "")
    .trim()
    .toLowerCase()
    .replace(/:$/, "");
  if (!proto) return null;
  const re = new RegExp(`^${proto}:\\/\\/join\\/(.+)$`, "i");
  const m = re.exec(String(rawUrl || "").trim());
  if (!m?.[1]) return null;
  let target = m[1].replace(/\/+$/, "");
  try {
    target = decodeURIComponent(target);
  } catch {
    /* garder la forme brute */
  }
  if (!target) return null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
      return normalizeRemoteUrl(target);
    }
    const hostPart = target.split("/")[0] ?? "";
    const hasPort = /:\d+$/.test(hostPart);
    const bareHost = hostPart.replace(/:\d+$/, "");
    const isLanHost =
      bareHost === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(bareHost);
    const scheme = hasPort || isLanHost ? "http" : "https";
    return normalizeRemoteUrl(`${scheme}://${hostPart}`);
  } catch {
    return null;
  }
}

/**
 * Analyse argv. Fail-safe : valeur invalide → mode "server".
 */
export function parseProfileArgv(
  argv: string[],
  manifest: AppManifest,
): ProfileLaunch {
  const argPrefix = profileArgPrefix(manifest);
  const dirPrefix = profileDirArgPrefix(manifest);
  const args = Array.isArray(argv) ? argv.map((a) => String(a || "")) : [];
  let profileDir: string | undefined;
  for (const a of args) {
    if (a.startsWith(dirPrefix)) {
      const dir = a.slice(dirPrefix.length).trim();
      if (dir) profileDir = dir;
    }
  }

  for (const a of args) {
    const deepLink = parseJoinDeepLink(a, manifest.deepLinkProtocol);
    if (deepLink) return { mode: "join", serverUrl: deepLink, profileDir };

    if (!a.startsWith(argPrefix)) continue;
    const value = a.slice(argPrefix.length).trim();
    if (value === "server" || value === "")
      return { mode: "server", profileDir };
    if (value.startsWith("ai:")) {
      const aiUserId = value.slice(3).trim();
      if (aiUserId) return { mode: "ai", aiUserId, profileDir };
      return { mode: "server", profileDir };
    }
    if (value.startsWith("join:")) {
      const rawTarget = value.slice(5).trim();
      try {
        const serverUrl = normalizeRemoteUrl(rawTarget);
        return { mode: "join", serverUrl, profileDir };
      } catch {
        return { mode: "server", profileDir };
      }
    }
    return { mode: "server", profileDir };
  }
  return { mode: "server", profileDir };
}

export function profileDirSegment(launch: ProfileLaunch): string | null {
  if (launch.mode === "ai" && launch.aiUserId) {
    return `ai-${sanitizeProfileSegment(launch.aiUserId)}`;
  }
  if (launch.mode === "join" && launch.serverUrl) {
    try {
      const u = new URL(launch.serverUrl);
      const hostPort = u.port ? `${u.hostname}-${u.port}` : u.hostname;
      return `join-${sanitizeProfileSegment(hostPort)}`;
    } catch {
      return `join-${sanitizeProfileSegment(launch.serverUrl)}`;
    }
  }
  return null;
}

export function profileUserDataDir(
  baseUserData: string,
  launch: ProfileLaunch,
): string | null {
  if (launch.profileDir) return launch.profileDir;
  const segment = profileDirSegment(launch);
  if (!segment) return null;
  return path.join(baseUserData, "profiles", segment);
}

export function profileArgFor(
  launch: ProfileLaunch,
  manifest: AppManifest,
): string | null {
  const prefix = profileArgPrefix(manifest);
  if (launch.mode === "ai" && launch.aiUserId) {
    return `${prefix}ai:${launch.aiUserId}`;
  }
  if (launch.mode === "join" && launch.serverUrl) {
    return `${prefix}join:${launch.serverUrl}`;
  }
  return null;
}
