/**
 * Démarre le plan UI Next standalone si présent (sortie `next build`).
 * Sinon la façade charge la SPA `resources/renderer`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findFreePort } from "@creezio/platform-core";
import { log } from "@creezio/host-runtime";

export type BrandUiPlaneHandle = {
  kind: "next" | "spa";
  baseUrl: string | null;
  child: ChildProcess | null;
  close: () => Promise<void>;
};

/** Attend la sortie du process (résout true) ou le délai (résout false). */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Arrêt fiable du plane Next : SIGTERM puis escalade SIGKILL.
 * Le server.js standalone Next peut ignorer SIGTERM (connexions ouvertes) —
 * sans escalade, un restart du plane (ex. propagation env Hermes) laisse
 * l'ancien process orphelin.
 */
async function stopUiPlaneChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForExit(child, 5_000)) return;
  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

/** Candidats entrée Next standalone (build `next build` output standalone). */
function uiPlaneEntryCandidates(appRoot: string): string[] {
  const candidates = [
    path.join(appRoot, "resources", "server", "server.js"),
    path.join(appRoot, "ui/.next/standalone/server.js"),
    path.join(appRoot, "build/server/server.js"),
    path.join(appRoot, ".next/standalone/server.js"),
  ];
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath;
  if (typeof resourcesPath === "string" && resourcesPath) {
    candidates.unshift(path.join(resourcesPath, "server", "server.js"));
  }
  return candidates;
}

/** True si un build UI Next standalone est présent (CRM navigateur possible). */
export function hasBrandUiPlane(appRoot: string): boolean {
  return uiPlaneEntryCandidates(appRoot).some((p) => fs.existsSync(p));
}

export async function startBrandUiPlane(opts: {
  appRoot: string;
  metierBaseUrl: string;
  preferredPort?: number;
}): Promise<BrandUiPlaneHandle> {
  // Packagé Electron : resourcesPath/server (appRoot peut être asar).
  const entry = uiPlaneEntryCandidates(opts.appRoot).find((p) =>
    fs.existsSync(p),
  );
  if (!entry) {
    log("ui", "Next standalone absent — SPA renderer");
    return {
      kind: "spa",
      baseUrl: null,
      child: null,
      close: async () => undefined,
    };
  }

  const port =
    opts.preferredPort && opts.preferredPort > 0
      ? opts.preferredPort
      : await findFreePort();
  const standaloneRoot = path.dirname(entry);
  // Next standalone attend .next/static à côté du server.js.
  // Toujours resync (BUILD_ID / chunks) — un dossier stale provoque HTTP 400
  // sur `/_next/static/*` et une erreur client hydratation.
  // Packagé : static déjà dans resources/server/.next/static (afterPack).
  const staticCandidates = [
    path.join(opts.appRoot, "ui/.next/static"),
    path.join(opts.appRoot, ".next/static"),
  ];
  const staticSrc = staticCandidates.find((p) => fs.existsSync(p));
  const staticDst = path.join(standaloneRoot, ".next/static");
  if (staticSrc && !fs.existsSync(staticDst)) {
    fs.mkdirSync(path.dirname(staticDst), { recursive: true });
    fs.cpSync(staticSrc, staticDst, { recursive: true });
    for (const buildIdSrc of [
      path.join(opts.appRoot, "ui/.next/BUILD_ID"),
      path.join(opts.appRoot, ".next/BUILD_ID"),
    ]) {
      if (fs.existsSync(buildIdSrc)) {
        fs.copyFileSync(
          buildIdSrc,
          path.join(standaloneRoot, ".next/BUILD_ID"),
        );
        break;
      }
    }
  } else if (staticSrc && fs.existsSync(staticDst)) {
    // Dev : resync pour éviter chunks stale.
    fs.rmSync(staticDst, { recursive: true, force: true });
    fs.cpSync(staticSrc, staticDst, { recursive: true });
  }
  const publicCandidates = [
    path.join(opts.appRoot, "ui/public"),
    path.join(opts.appRoot, "public"),
  ];
  const publicSrc = publicCandidates.find((p) => fs.existsSync(p));
  const publicDst = path.join(standaloneRoot, "public");
  if (publicSrc && !fs.existsSync(publicDst)) {
    fs.cpSync(publicSrc, publicDst, { recursive: true });
  }

  const child = spawn(process.execPath, [entry], {
    cwd: standaloneRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      METIER_BASE_URL: opts.metierBaseUrl,
      APP_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (b) => log("next", String(b).trim()));
  child.stderr?.on("data", (b) => log("next", String(b).trim()));

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(baseUrl);
      if (res.ok || res.status === 404) {
        log("ui", `Next plane ready ${baseUrl}`);
        return {
          kind: "next",
          baseUrl,
          child,
          close: () => stopUiPlaneChild(child),
        };
      }
    } catch {
      /* warming */
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  log("ui", "Next plane timeout — fallback SPA");
  void stopUiPlaneChild(child);
  return {
    kind: "spa",
    baseUrl: null,
    child: null,
    close: async () => undefined,
  };
}
