"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Tunnel d'accès distant via Cloudflare — app desktop (hôte) uniquement.
 *
 * Expose le serveur local en HTTPS (`{slug}.creez.io`) pour :
 * desktop « Rejoindre un serveur », navigateur, mobile / PWA.
 * PC éteint ou tunnel arrêté = URL inaccessible.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Globe, Loader2, Wifi, WifiOff } from "lucide-react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { ServerTunnelCard } from "./server-mode-cards";

type TunnelPublicUrls = {
  crm: string;
  n8n: string;
  hermes: string;
};

type TunnelStatus = {
  configured: boolean;
  online: boolean;
  slug: string | null;
  hostname: string | null;
  publicUrl: string | null;
  publicUrls?: TunnelPublicUrls | null;
  error: string | null;
  pcMustBeOn: true;
};

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])$/;

export function DesktopTunnel() {
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [slug, setSlug] = useState("");
  const [checking, setChecking] = useState(false);
  const [reserving, setReserving] = useState(false);
  const [avail, setAvail] = useState<{ available: boolean; reason?: string } | null>(null);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getTunnelStatus) return;
    setStatus(await api.getTunnelStatus());
  }, []);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getTunnelStatus) return;
    setDesktop(true);
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Web (serveur headless) : URLs publiques via /api/v1/os/tunnel/status.
  if (!desktop) return <ServerTunnelCard />;

  async function checkAvailability() {
    const api = getShellDesktopApi();
    if (!api?.checkTunnelSlug) return;
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      setAvail({ available: false, reason: "Slug invalide (a-z, 0-9, tirets, 2–48 car.)" });
      return;
    }
    setChecking(true);
    setAvail(null);
    try {
      const r = await api.checkTunnelSlug(s);
      setAvail(r);
    } catch (e) {
      setAvail({ available: false, reason: e instanceof Error ? e.message : "Erreur réseau" });
    } finally {
      setChecking(false);
    }
  }

  async function reserve() {
    const api = getShellDesktopApi();
    if (!api?.reserveTunnel) return;
    const s = slug.trim().toLowerCase();
    if (!SLUG_RE.test(s)) {
      toast.error("Slug invalide");
      return;
    }
    setReserving(true);
    try {
      const r = await api.reserveTunnel(s);
      if (!r.ok) {
        toast.error(r.error || "Réservation impossible");
        return;
      }
      toast.success(`Réservé : ${r.hostname}`);
      setSlug("");
      setAvail(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de réservation");
    } finally {
      setReserving(false);
    }
  }

  async function stopTunnel() {
    const api = getShellDesktopApi();
    if (!api?.stopTunnel) return;
    try {
      await api.stopTunnel();
      toast.message("Tunnel arrêté (URL d’accès distant inaccessible)");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function startTunnel() {
    const api = getShellDesktopApi();
    if (!api?.startTunnel) return;
    try {
      await api.startTunnel();
      toast.success("Tunnel d’accès distant démarré");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur de démarrage");
    }
  }

  async function copyPublicUrl() {
    const url = status?.publicUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copiée — à coller dans « Rejoindre un serveur » sur les autres PC");
    } catch {
      toast.error("Impossible de copier l’URL");
    }
  }

  const online = status?.online ?? false;
  const configured = status?.configured ?? false;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4" /> Tunnel d&apos;accès distant
        </CardTitle>
        <CardDescription>
          Expose ce serveur en HTTPS :{" "}
          <code className="text-xs">{"{slug}.creez.io"}</code> (CRM) et{" "}
          <code className="text-xs">{"n8n|hermes.{slug}.creez.io"}</code>{" "}
          (embeds). Même URL CRM pour « Rejoindre un serveur », navigateur et mobile /
          PWA. Ce PC doit rester allumé avec le tunnel en ligne.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p
          className={
            online
              ? "flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              : "flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          }
        >
          {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {configured
            ? online
              ? `En ligne — ${status?.publicUrl}`
              : `Hors ligne — ${status?.hostname || "tunnel configuré"} (PC éteint ou tunnel arrêté)`
            : "Aucun sous-domaine réservé"}
        </p>
        {configured && status?.publicUrl ? (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              Sur les autres postes : Configuration → Connexion serveur →{" "}
              <strong className="font-medium text-foreground">Rejoindre un serveur</strong>,
              coller l&apos;URL CRM (ou au premier lancement choisir « Rejoindre »). Les
              embeds s&apos;ouvrent automatiquement via leurs sous-domaines.
            </p>
            {status.publicUrls ? (
              <ul className="space-y-0.5 font-mono text-[11px] text-foreground/80">
                <li>CRM · {status.publicUrls.crm}</li>
                <li>n8n · {status.publicUrls.n8n}</li>
                <li>Hermes · {status.publicUrls.hermes}</li>
              </ul>
            ) : null}
          </div>
        ) : null}
        {status?.error ? (
          <p className="text-sm text-destructive">{status.error}</p>
        ) : null}

        {!configured ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                  setAvail(null);
                }}
                placeholder="mon-cabinet"
                className="flex-1"
                maxLength={48}
              />
              <span className="shrink-0 text-sm text-muted-foreground">.creez.io</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={checking || !slug} onClick={() => void checkAvailability()}>
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vérifier dispo"}
              </Button>
              <Button
                size="sm"
                disabled={reserving || !avail?.available}
                onClick={() => void reserve()}
              >
                {reserving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Réserver & activer"}
              </Button>
            </div>
            {avail ? (
              <p className={avail.available ? "text-sm text-emerald-700" : "text-sm text-amber-800"}>
                {avail.available
                  ? `Disponible : ${slug}.creez.io`
                  : avail.reason || "Indisponible"}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {online ? (
              <Button size="sm" variant="outline" onClick={() => void stopTunnel()}>
                Arrêter le tunnel
              </Button>
            ) : (
              <Button size="sm" onClick={() => void startTunnel()}>
                Démarrer le tunnel
              </Button>
            )}
            {status?.publicUrl ? (
              <>
                <Button size="sm" variant="outline" onClick={() => void copyPublicUrl()}>
                  <Copy className="mr-1.5 h-3.5 w-3.5" />
                  Copier l&apos;URL
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <a href={status.publicUrl} target="_blank" rel="noreferrer">
                    Ouvrir l&apos;URL
                  </a>
                </Button>
              </>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
