// @ts-nocheck — WebContents events Electron (shim kit volontairement mince)
/**
 * Télémétrie des WebContents (UI CRM + onglets fournisseurs).
 *
 * Couvre les plantages "invisibles" côté rendu que les handlers process-level
 * (uncaughtException…) ne voient pas : crash du process de rendu, preload qui
 * ne charge pas, page qui échoue à charger, page qui ne répond plus, erreurs
 * console. Chaque anomalie est loggée localement ET envoyée au collecteur
 * (débouncée pour ne pas spammer).
 */

import type { WebContents } from "electron"; // type-only
import { log, logError } from "@creezio/host-runtime";
import { reportCrash, reportCrashDebounced } from "@creezio/host-runtime";

/** Codes did-fail-load ignorés : -3 = ERR_ABORTED (navigation annulée, normal). */
const IGNORED_LOAD_ERRORS = new Set([-3]);

/** Anti double-instrumentation (filet app-level + instrumentation dédiée). */
const instrumented = new WeakSet<WebContents>();

/**
 * Branche tous les hooks de télémétrie sur un webContents (idempotent).
 * `label` identifie la vue dans les rapports (ex. "crm", "tab-a1b2/f42").
 */
export function instrumentWebContents(wc: WebContents, label: string): void {
  if (instrumented.has(wc)) return;
  instrumented.add(wc);
  wc.on("render-process-gone", (_e, details) => {
    reportCrash("renderer-gone", {
      view: label,
      reason: details.reason,
      exitCode: details.exitCode,
      url: safeUrl(wc),
    });
  });

  wc.on("preload-error", (_e, preloadPath, error) => {
    // Un preload qui ne charge pas = pas d'API desktop dans la page → bugs
    // en cascade. C'est exactement le genre de cause qu'on veut voir arriver.
    reportCrash("web-event", {
      view: label,
      event: "preload-error",
      preloadPath,
      message: error?.message,
      stack: error?.stack,
    });
  });

  wc.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || IGNORED_LOAD_ERRORS.has(errorCode)) return;
    log("web", `[${label}] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
    reportCrashDebounced("web-event", `fail-load:${label}:${errorCode}`, {
      view: label,
      event: "did-fail-load",
      errorCode,
      errorDescription,
      url: validatedURL,
    });
  });

  wc.on("unresponsive", () => {
    reportCrashDebounced("web-event", `unresponsive:${label}`, {
      view: label,
      event: "unresponsive",
      url: safeUrl(wc),
    });
  });
  wc.on("responsive", () => {
    log("web", `[${label}] responsive à nouveau`);
  });

  // Erreurs console de la page (console.error + exceptions non catchées,
  // remontées par Chromium au niveau "error").
  wc.on("console-message", (event) => {
    const details = event as unknown as {
      level: "info" | "warning" | "error" | "debug";
      message: string;
      lineNumber: number;
      sourceId: string;
    };
    if (details.level !== "error") return;
    // 6000 chars : assez pour un message React + componentStack complet
    // (l'Error Boundary racine logge les deux dans la même entrée).
    const line = `${details.message}`.slice(0, 6000);
    log("web", `[${label}] console.error: ${line} (${details.sourceId}:${details.lineNumber})`);
    // Clé de débounce par signature du message : un bug qui boucle ne génère
    // qu'un rapport / 5 min, mais tout reste dans le log local (joint au rapport).
    reportCrashDebounced("renderer-error", `console:${label}:${line.slice(0, 120)}`, {
      view: label,
      source: "console",
      message: line,
      file: details.sourceId,
      line: details.lineNumber,
      url: safeUrl(wc),
    });
  });
}

function safeUrl(wc: WebContents): string {
  try {
    return wc.isDestroyed() ? "(destroyed)" : wc.getURL();
  } catch (e) {
    logError("web", e);
    return "(?)";
  }
}
