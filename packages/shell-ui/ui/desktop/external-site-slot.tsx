"use client";

/**
 * Slot content-area pour un onglet site externe.
 *
 * Le DOM reste vide : le vrai contenu est une WebContentsView Electron posee
 * exactement sur ce rectangle (sidebar + tab bar + assistant restent hors
 * bounds). Un ResizeObserver reporte {x,y,width,height} au main process.
 *
 * Pendant un chargement intentionnel (premier open / nouvelle URL utilisateur),
 * la vue native est masquee et ce slot affiche un spinner. Les navigations SPA
 * internes mettent a jour l'URL workspace sans rappeler openTab.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { getShellDesktopApi, isSameTabDocument } from "@creezio/shell-ui";
import { usePaneActive } from "../workspace/keep-alive";
import { useTabWorkspace } from "../workspace/tab-workspace-context";
import type { DesktopContentRect, DesktopTabLoadState } from "../desktop-types";

function readRect(el: HTMLElement): DesktopContentRect {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
}

export type ExternalSiteSlotPhase = "idle" | "loading" | "ready" | "error";

/** @deprecated Use ExternalSiteSlotPhase. */
export type SupplierSlotPhase = ExternalSiteSlotPhase;

/** Pure : derive l'UI du slot depuis les events IPC load-state. */
export function reduceExternalSiteLoadState(
  current: ExternalSiteSlotPhase,
  ev: Pick<DesktopTabLoadState, "state">,
): ExternalSiteSlotPhase {
  if (ev.state === "loading") return "loading";
  if (ev.state === "ready") return "ready";
  if (ev.state === "error") return "error";
  return current;
}

/** @deprecated Use reduceExternalSiteLoadState. */
export const reduceSupplierLoadState = reduceExternalSiteLoadState;

export function ExternalSiteSlot({
  siteId: siteIdProp,
  initialUrl,
}: {
  /** Id de partition (number ou string numérique depuis la route). */
  siteId: number | string;
  /** URL de secours si l'onglet workspace n'a pas encore de meta.externalSite.url. */
  initialUrl?: string;
}) {
  const siteIdParsed =
    typeof siteIdProp === "number" ? siteIdProp : Number(siteIdProp);
  const siteIdValid = Number.isFinite(siteIdParsed);
  const siteId = siteIdValid ? siteIdParsed : -1;
  const slotRef = useRef<HTMLDivElement>(null);
  const paneActive = usePaneActive();
  const workspace = useTabWorkspace();
  const { tabs, setTabMeta, patchExternalSiteTab } = workspace;
  const href = `/site/${siteId}`;
  const wsTab = tabs.find(
    (t: any) =>
      t.externalSite?.siteId === siteId ||
      (t.href.split("?")[0] || "") === href,
  );
  const externalMeta = wsTab?.externalSite;
  const url = externalMeta?.url || initialUrl || "";
  const electronTabId = externalMeta?.electronTabId;
  /** Document deja ouvert / synchronise depuis Electron - bloque la boucle openTab. */
  const documentUrlRef = useRef("");
  const [phase, setPhase] = useState<ExternalSiteSlotPhase>(() =>
    url ? "loading" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Ouvre / reutilise la WebContentsView (cookies partition conserves).
  // Ne pas rappeler openTab quand l'URL change uniquement via sync SPA.
  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api || !url || !/^https?:\/\//i.test(url)) {
      setPhase(url ? "error" : "idle");
      if (url) setErrorMsg("URL de site invalide.");
      return;
    }
    if (isSameTabDocument(documentUrlRef.current, url)) {
      return;
    }
    let cancelled = false;
    if (!electronTabId) {
      setPhase("loading");
    }
    setErrorMsg(null);
    void api
      .openTab(siteId, url)
      .then((res: any) => {
        if (cancelled) return;
        const finalUrl = res.url || url;
        documentUrlRef.current = finalUrl;
        patchExternalSiteTab(siteId, {
          electronTabId: res.tabId,
          url: finalUrl,
        });
        if (res.loadState) {
          setPhase((prev) =>
            reduceExternalSiteLoadState(prev, { state: res.loadState }),
          );
          if (res.loadState === "error") {
            setErrorMsg("Chargement impossible.");
          } else if (res.loadState === "ready") {
            setErrorMsg(null);
          }
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("Ouverture du site externe impossible :", e);
        setPhase("error");
        setErrorMsg(
          e instanceof Error ? e.message : "Impossible d'ouvrir le site.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, url, electronTabId, patchExternalSiteTab]);

  // IPC load-state (spinner immediat jusqu'a ready / error).
  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.onTabLoadState) return;
    return api.onTabLoadState((ev: any) => {
      const matchTab = Boolean(electronTabId && ev.tabId === electronTabId);
      const eventSiteId = ev.siteId ?? ev.fournisseurId;
      const matchSite = eventSiteId === siteId;
      // Avant patch electronTabId : matcher sur siteId stable.
      if (!matchTab && !matchSite) return;
      setPhase((prev) => reduceExternalSiteLoadState(prev, ev));
      if (ev.state === "error") {
        setErrorMsg(ev.error || "Chargement impossible.");
      } else if (ev.state === "ready") {
        setErrorMsg(null);
      }
    });
  }, [electronTabId, siteId]);

  // Bounds + activation tant que la pane est active.
  useEffect(() => {
    const api = getShellDesktopApi();
    const el = slotRef.current;
    if (!api || !el) return;
    if (!paneActive) return;

    let cancelled = false;
    let activationInFlight = false;

    const activateNative = async (rect: DesktopContentRect) => {
      if (activationInFlight) return;
      activationInFlight = true;
      try {
        if (electronTabId) {
          const activated = await api.activateTab(electronTabId, rect);
          if (!activated || activated.ok) return;
        }

        if (!api.activateSite || !url) return;
        const restored = await api.activateSite(siteId, url, rect);
        if (cancelled || !restored.ok || !restored.tabId) return;
        const finalUrl = restored.url || url;
        documentUrlRef.current = finalUrl;
        patchExternalSiteTab(siteId, {
          electronTabId: restored.tabId,
          url: finalUrl,
        });
        if (restored.loadState) {
          setPhase((prev) =>
            reduceExternalSiteLoadState(prev, { state: restored.loadState }),
          );
        }
      } catch (e) {
        console.warn(
          "Reactivation de l'onglet externe impossible :",
          e instanceof Error ? e.message : e,
        );
      } finally {
        activationInFlight = false;
      }
    };

    void activateNative(readRect(el));

    let raf = 0;
    const report = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = readRect(el);
        void api.setContentRect(rect);
        void activateNative(rect);
      });
    };

    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    const main = el.closest("main");
    if (main) ro.observe(main);
    window.addEventListener("resize", report);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [paneActive, electronTabId, siteId, url, patchExternalSiteTab]);

  // Metadata UI (titre / URL live) - sans declencher de reload.
  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api || !paneActive) return;
    return api.onTabsChanged?.((list: any[]) => {
      const t = list.find((x) => {
        const eventSiteId = x.siteId ?? x.fournisseurId;
        return x.tabId === electronTabId || eventSiteId === siteId;
      });
      if (!t) return;
      if (t.url) {
        documentUrlRef.current = t.url;
      }
      if (t.title) {
        setTabMeta(href, { title: t.title, fullscreen: true, kind: "section" });
      }
      if (t.url || t.title) {
        patchExternalSiteTab(siteId, {
          ...(t.url ? { url: t.url } : {}),
          ...(t.title ? { title: t.title } : {}),
        });
      }
    });
  }, [paneActive, electronTabId, siteId, href, setTabMeta, patchExternalSiteTab]);

  if (!siteIdValid) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Site invalide
      </div>
    );
  }

  return (
    <div
      ref={slotRef}
      data-creezio-site-slot
      data-creezio-site-id={siteId}
      data-creezio-site-phase={phase}
      className="relative h-full min-h-0 w-full bg-slate-50"
      aria-label="Site externe"
      aria-busy={phase === "loading"}
    >
      {!url && (
        <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
          Aucune URL pour cet onglet.
        </div>
      )}
      {url && phase === "loading" && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-50"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">Chargement du site...</p>
        </div>
      )}
      {url && phase === "error" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-slate-50 p-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            Impossible d&apos;ouvrir cette page
          </p>
          <p className="max-w-md break-all text-xs text-slate-500">{url}</p>
          {errorMsg ? (
            <p className="max-w-md text-xs text-slate-500">{errorMsg}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** @deprecated Use ExternalSiteSlot with siteId. */
export function SupplierSiteSlot({
  fournisseurId,
  initialUrl,
}: {
  fournisseurId: number | string;
  initialUrl?: string;
}) {
  return <ExternalSiteSlot siteId={fournisseurId} initialUrl={initialUrl} />;
}
