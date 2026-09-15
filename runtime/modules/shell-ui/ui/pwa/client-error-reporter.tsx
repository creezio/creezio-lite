"use client";

import { useEffect } from "react";

/**
 * Remonte les exceptions client (erreurs non catchées + promesses rejetées)
 * vers /api/client-log — indispensable pour diagnostiquer les crashs mobiles
 * (« Application error: a client-side exception has occurred ») où la
 * console navigateur n'est pas accessible.
 */
export function report(kind: string, message: string, stack?: string, digest?: string) {
  try {
    const body = JSON.stringify({
      kind,
      message,
      stack,
      digest,
      url: typeof location !== "undefined" ? location.href : undefined,
    });
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/client-log", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* le reporter ne doit jamais casser l'app */
  }
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      const stack =
        e.error && typeof e.error.stack === "string" ? e.error.stack : undefined;
      report(
        "window.onerror",
        `${e.message} @ ${e.filename || "?"}:${e.lineno || 0}:${e.colno || 0}`,
        stack,
      );
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason ?? "(vide)");
      const stack = reason instanceof Error ? reason.stack : undefined;
      report("unhandledrejection", message, stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
