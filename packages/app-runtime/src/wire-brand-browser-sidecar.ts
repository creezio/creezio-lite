/**
 * Sidecar navigateur IA côté serveur (variant Docker `--browser`).
 *
 * - Démarre un `AiSessionHost` (@creezio/browser-host) : un Chromium
 *   persistant par collaborateur IA sous `{dataDir}/browser/<aiUserId>` ;
 * - démarre Xvfb si aucun DISPLAY (headful requis par certains sites,
 *   fallback headless=new sinon) ;
 * - enregistre des EXÉCUTEURS IN-PROCESS par userId IA auprès de
 *   dispatchSupplierAction (@creezio/assistant) : les actions ciblant une IA
 *   serveur sont exécutées localement (pas de bridge SSE), résultat via
 *   resolveUiAction — routage B3.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  AiSessionHost,
  findChromiumBinary,
  type SupplierActionRequestLike,
} from "@creezio/browser-host";
import {
  resolveUiAction,
  subscribeSupplierActions,
} from "@creezio/assistant";
import { createSessionToken } from "@creezio/auth";
import type { BrandPlatformStore } from "./brand-platform-store.js";

/** Identité host synthétique du sidecar (presence « online sans desktop »). */
export const SERVER_BROWSER_HOST_ID = "server-browser";

export type BrandBrowserSidecarHandle = {
  host: AiSessionHost;
  serverHostUserId: string;
  chromiumBinary: string;
  display: string | null;
  /** (Ré)enregistre les exécuteurs in-process des IA actives. */
  syncAiExecutors: () => void;
  close: () => Promise<void>;
};

export function browserSidecarRequested(): boolean {
  return process.env.CREEZIO_BROWSER_SIDECAR === "1";
}

/** Xvfb :99 si aucun DISPLAY (containers) — best-effort, sinon headless. */
async function ensureDisplay(
  onLog: (line: string) => void,
): Promise<{ display: string | null; child: ChildProcess | null }> {
  const existing = String(process.env.DISPLAY || "").trim();
  if (existing) return { display: existing, child: null };
  const xvfbBin = ["/usr/bin/Xvfb", "/usr/local/bin/Xvfb"].find((p) =>
    fs.existsSync(p),
  );
  if (!xvfbBin) {
    onLog("Xvfb introuvable — Chromium en mode headless=new");
    return { display: null, child: null };
  }
  const display = ":99";
  const child = spawn(xvfbBin, [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], {
    stdio: "ignore",
  });
  // Laisse le serveur X se poser (Xvfb est prêt en < 1 s en pratique).
  await new Promise((r) => setTimeout(r, 800));
  if (child.exitCode !== null) {
    onLog(`Xvfb terminé prématurément (code ${child.exitCode}) — headless`);
    return { display: null, child: null };
  }
  onLog(`Xvfb démarré sur ${display}`);
  return { display, child };
}

export async function startBrandBrowserSidecar(opts: {
  dataDir: string;
  sessionCookieName: string;
  baseUrl: () => string;
  store: BrandPlatformStore;
  taskHref?: string;
  onLog?: (line: string) => void;
}): Promise<BrandBrowserSidecarHandle> {
  const log =
    opts.onLog || ((line: string) => console.log(`[browser-sidecar] ${line}`));

  const chromiumBinary = findChromiumBinary();
  if (!chromiumBinary) {
    throw new Error(
      "Chromium introuvable — image Docker variant browser requise (ou CREEZIO_CHROMIUM_BIN)",
    );
  }

  const { display, child: xvfb } = await ensureDisplay(log);
  const browserDataRoot =
    process.env.CREEZIO_BROWSER_DATA_DIR ||
    path.join(opts.dataDir, "browser");
  fs.mkdirSync(browserDataRoot, { recursive: true });

  const mintSessionToken = async (aiUserId: string): Promise<string> => {
    const user = opts.store.getUserById(aiUserId);
    if (!user || user.kind !== "ai" || !user.active) {
      throw new Error(`Collaborateur IA introuvable ou inactif: ${aiUserId}`);
    }
    const owner = opts.store.getOwner();
    return createSessionToken({
      user: {
        id: user.id,
        username: user.username,
        role: "collaborator",
        permissions: user.permissions,
      },
      actor: owner
        ? {
            id: owner.id,
            username: owner.username,
            role: "owner",
            permissions: [...owner.permissions],
          }
        : null,
    });
  };

  // Proxy sortant optionnel (--proxy-server Chromium). Limitation assumée :
  // proxy datacenter ≠ anonymat (plages IP détectées par beaucoup de sites) —
  // voir packages/browser-host/README.md § Modèle de menace.
  const proxyServer = String(process.env.CREEZIO_BROWSER_PROXY || "").trim();
  if (proxyServer) log(`proxy sortant Chromium: ${proxyServer.replace(/\/\/[^@/]*@/, "//***@")}`);

  const host = new AiSessionHost({
    browserDataRoot,
    sessionCookieName: opts.sessionCookieName,
    crmBaseUrl: opts.baseUrl,
    mintSessionToken,
    ...(opts.taskHref ? { taskHref: opts.taskHref } : {}),
    chromiumBinary,
    ...(display ? { display, headless: false } : { headless: true }),
    ...(proxyServer ? { proxyServer } : {}),
    onLog: log,
  });

  /* Exécuteurs in-process : un abonné dispatchSupplierAction par IA active. */
  const executors = new Map<string, () => void>();

  function registerExecutor(aiUserId: string): void {
    if (executors.has(aiUserId)) return;
    const subscription = subscribeSupplierActions(
      (req) => {
        void host
          .executeSupplierRequest(req as SupplierActionRequestLike, aiUserId)
          .then((result) => resolveUiAction(req.actionId, result))
          .catch(() => resolveUiAction(req.actionId, { ok: false, error: "exécuteur sidecar en erreur" }));
      },
      { userId: aiUserId, deviceId: "server-browser" },
    );
    executors.set(aiUserId, subscription.unsubscribe);
    log(`exécuteur in-process enregistré pour ${aiUserId}`);
  }

  function syncAiExecutors(): void {
    const active = new Set(
      opts.store
        .listUsers()
        .filter((u) => u.kind === "ai" && u.active)
        .map((u) => u.id),
    );
    for (const aiUserId of active) registerExecutor(aiUserId);
    for (const [aiUserId, unsubscribe] of executors) {
      if (!active.has(aiUserId)) {
        unsubscribe();
        executors.delete(aiUserId);
      }
    }
  }

  syncAiExecutors();
  log(
    `sidecar prêt (chromium=${chromiumBinary}, display=${display || "headless"}, data=${browserDataRoot})`,
  );

  return {
    host,
    serverHostUserId: SERVER_BROWSER_HOST_ID,
    chromiumBinary,
    display,
    syncAiExecutors,
    close: async () => {
      for (const unsubscribe of executors.values()) unsubscribe();
      executors.clear();
      await host.closeAll();
      if (xvfb) {
        try {
          xvfb.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    },
  };
}
