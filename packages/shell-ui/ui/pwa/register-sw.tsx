"use client";

import { useEffect } from "react";

/**
 * Enregistrement client du SW custom (`public/sw.js`).
 * Pas de next-pwa : compatible Next 14 App Router + standalone Docker.
 * Au boot : purge les vieux caches HTML (creezio-shell-v*) qui causaient
 * des « Application error » après redeploy.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Dev local : ne pas polluer le HMR
    if (process.env.NODE_ENV !== "production") return;

    let cancelled = false;

    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("creezio-shell-") && k !== "creezio-shell-v2")
            .map((k) => caches.delete(k)),
        );
      } catch {
        /* ignore */
      }
      if (cancelled) return;

      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          if (cancelled) return;
          reg.update().catch(() => {});
        })
        .catch(() => {
          /* silencieux : PWA optionnelle */
        });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
