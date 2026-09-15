/**
 * Split Serveur / Client — logique PURE, testable depuis Node.
 * Port brand-agnostic de electron/app-kind.ts (kit).
 */

import fs from "node:fs";
import path from "node:path";
import type { AppManifest } from "@creezio/brand-config";
import { envKey, exeForKind } from "@creezio/brand-config";
import type { ProfileLaunch } from "./profile-launch.js";
import { userDataDirForKind } from "./paths.js";

/** Kind runtime (inclut legacy tout-en-un). */
export type RuntimeAppKind = "server" | "client" | "legacy";

export const APP_KIND_FILENAME = "app-kind.json";

export type PickerVariant = "none" | "join-only" | "full";

export type BootBehavior = {
  pickerVariant: PickerVariant;
  allowLocalStack: boolean;
  forceLocalProfile: boolean;
  requireRemoteProfile: boolean;
  cockpitPath: "/server-cockpit" | "/cockpit";
  registerDeepLink: boolean;
};

/** "server" / "client" (insensible à la casse) — tout le reste → null. */
export function parseAppKind(raw: unknown): "server" | "client" | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "server") return "server";
  if (s === "client") return "client";
  return null;
}

/**
 * Résout le kind effectif. L'env (dev/tests) prime sur le fichier packagé ;
 * une valeur invalide n'est JAMAIS bloquante → legacy (fail-safe boot).
 */
export function resolveAppKind(opts: {
  env?: unknown;
  fileKind?: unknown;
}): RuntimeAppKind {
  return parseAppKind(opts.env) ?? parseAppKind(opts.fileKind) ?? "legacy";
}

/** Lit `app-kind.json` dans le premier dossier candidat où il existe. */
export function readAppKindFile(
  dirs: string[],
): "server" | "client" | null {
  for (const dir of dirs) {
    try {
      const p = path.join(dir, APP_KIND_FILENAME);
      if (!fs.existsSync(p)) continue;
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as {
        kind?: unknown;
      };
      const kind = parseAppKind(parsed?.kind);
      if (kind) return kind;
    } catch {
      /* fichier illisible → candidat suivant */
    }
  }
  return null;
}

/**
 * Calcule le userData cible pour un kind packagé.
 * legacy → null (on laisse Electron décider).
 */
export function userDataDirForAppKind(
  manifest: AppManifest,
  kind: RuntimeAppKind,
  currentUserData: string,
): string | null {
  if (kind !== "server" && kind !== "client") return null;
  const target = userDataDirForKind(manifest, kind, currentUserData);
  return path.resolve(target) === path.resolve(currentUserData)
    ? currentUserData
    : target;
}

/** AppUserModelId Windows depuis le manifest. */
export function appUserModelIdFor(
  manifest: AppManifest,
  kind: "server" | "client",
): string {
  return exeForKind(manifest, kind).appUserModelId;
}

/** Nom affiché (setName / tray) depuis le manifest. */
export function displayNameFor(
  manifest: AppManifest,
  kind: "server" | "client",
): string {
  return exeForKind(manifest, kind).productName;
}

/** Valeur env `{PREFIX}_APP_KIND`. */
export function appKindEnvValue(
  manifest: AppManifest,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env[envKey(manifest, "APP_KIND")] || "").trim();
}

/**
 * Comportement de boot selon le kind + le profil de lancement argv.
 */
export function bootBehaviorFor(
  kind: RuntimeAppKind,
  launch: Pick<ProfileLaunch, "mode" | "serverUrl">,
): BootBehavior {
  if (kind === "server") {
    return {
      pickerVariant: "none",
      allowLocalStack: true,
      forceLocalProfile: true,
      requireRemoteProfile: false,
      cockpitPath: "/server-cockpit",
      registerDeepLink: false,
    };
  }
  const directJoin = launch.mode === "join" && Boolean(launch.serverUrl);
  if (kind === "client") {
    return {
      pickerVariant: directJoin ? "none" : "join-only",
      allowLocalStack: false,
      forceLocalProfile: false,
      requireRemoteProfile: true,
      cockpitPath: "/cockpit",
      registerDeepLink: true,
    };
  }
  return {
    pickerVariant: directJoin ? "none" : "full",
    allowLocalStack: true,
    forceLocalProfile: false,
    requireRemoteProfile: false,
    cockpitPath: "/cockpit",
    registerDeepLink: true,
  };
}

/**
 * Garde-fou navigation de l'app Serveur : la fenêtre cockpit ne doit jamais
 * afficher l'UI CRM métier.
 */
export function isAllowedServerCockpitPath(pathname: string): boolean {
  const p = String(pathname || "/");
  const allowedPrefixes = [
    "/server-cockpit",
    "/login",
    "/setup",
    "/onboarding",
    "/health",
    "/api",
    "/_next",
    "/img",
    "/icons",
    "/favicon",
    "/sw.js",
    "/manifest.webmanifest",
  ];
  if (p === "/") return false;
  return allowedPrefixes.some((a) => {
    if (p === a) return true;
    if (a === "/favicon") return p.startsWith("/favicon");
    return p.startsWith(`${a}/`) || p.startsWith(`${a}?`);
  });
}

/** Contenu JSON pour `write-app-kind` au packaging. */
export function appKindFilePayload(kind: "server" | "client"): {
  kind: "server" | "client";
} {
  return { kind };
}
