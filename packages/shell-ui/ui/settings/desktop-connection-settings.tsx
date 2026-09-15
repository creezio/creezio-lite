"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Profil de connexion desktop : héberger un serveur local vs rejoindre un serveur.
 * Changer de profil relance l'application Electron.
 *
 * Bind LAN (0.0.0.0) : option avancée hôte uniquement — pas au boot.
 * Accès distant produit = tunnel Cloudflare (config serveur / onboarding).
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Network, Server } from "lucide-react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { ServerInstanceCard } from "./server-mode-cards";

type ConnProfile = {
  mode: "local" | "remote";
  remoteUrl: string | null;
  localBind: "127.0.0.1" | "0.0.0.0";
  chosen: boolean;
  activeBaseUrl: string | null;
  serverPort: number | null;
};

export function DesktopConnectionSettings() {
  const [desktop, setDesktop] = useState(false);
  const [profile, setProfile] = useState<ConnProfile | null>(null);
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [bindLan, setBindLan] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getConnectionProfile) return;
    const p = await api.getConnectionProfile();
    setProfile(p);
    setMode(p.mode);
    setRemoteUrl(p.remoteUrl || "");
    setBindLan(p.localBind === "0.0.0.0");
  }, []);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getConnectionProfile) return;
    setDesktop(true);
    void refresh();
  }, [refresh]);

  // Web (serveur headless) : pas de profil Héberger/Rejoindre — carte serveur.
  if (!desktop) return <ServerInstanceCard />;

  async function onTest() {
    const api = getShellDesktopApi();
    if (!api?.testConnection) return;
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await api.testConnection(remoteUrl);
      if (r.ok) {
        setTestMsg(`OK — ${r.baseUrl || remoteUrl}`);
        if (r.baseUrl) setRemoteUrl(r.baseUrl);
        toast.success("Serveur joignable");
      } else {
        setTestMsg(r.error || "Échec");
        toast.error(r.error || "Serveur injoignable");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      setTestMsg(msg);
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  async function onApply() {
    const api = getShellDesktopApi();
    if (!api?.applyConnection) return;
    setSaving(true);
    try {
      const r = await api.applyConnection({
        mode,
        remoteUrl: mode === "remote" ? remoteUrl : undefined,
        localBind: mode === "local" ? (bindLan ? "0.0.0.0" : "127.0.0.1") : "127.0.0.1",
        chosen: true,
      });
      if (!r.ok) {
        toast.error(r.error || "Impossible d'appliquer");
        return;
      }
      toast.success("Profil enregistré — redémarrage…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setSaving(false);
    }
  }

  const isRemoteSession = profile?.mode === "remote";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4" />
          Connexion serveur
        </CardTitle>
        <CardDescription>
          Héberger le serveur sur ce PC (tunnel d&apos;accès distant inclus dans la config
          serveur), ou rejoindre un serveur du cabinet via son URL. Un changement relance
          l&apos;application.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {profile?.activeBaseUrl && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground">
            Session actuelle :{" "}
            <span className="font-medium text-foreground">{profile.activeBaseUrl}</span>
            {profile.mode === "local" && profile.serverPort != null && (
              <> (port {profile.serverPort})</>
            )}
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("local")}
            className={`rounded-lg border p-3 text-left transition-colors ${
              mode === "local"
                ? "border-sky-500 bg-sky-500/5"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <Server className="h-4 w-4" />
              Héberger (serveur local)
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Ce poste démarre la base et l&apos;API. L&apos;accès distant passe par le tunnel
              configuré avec le serveur (carte Tunnel ci-dessous).
            </p>
          </button>
          <button
            type="button"
            onClick={() => setMode("remote")}
            className={`rounded-lg border p-3 text-left transition-colors ${
              mode === "remote"
                ? "border-sky-500 bg-sky-500/5"
                : "border-border hover:bg-muted/40"
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <Network className="h-4 w-4" />
              Rejoindre un serveur
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Client léger : pas de serveur local — URL tunnel{" "}
              <code className="text-[11px]">https://….creez.io</code> (ou LAN si
              activé côté hôte).
            </p>
          </button>
        </div>

        {mode === "local" && (
          <details className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              Configuration avancée (hôte)
            </summary>
            <label className="mt-3 flex items-start gap-2 leading-snug">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={bindLan}
                onChange={(e) => setBindLan(e.target.checked)}
              />
              <span>
                Écouter aussi sur le réseau local (<code className="text-[11px]">0.0.0.0</code>)
                pour un accès HTTP LAN en plus du tunnel. Autoriser le port TCP dans le
                pare-feu Windows (profil Réseau privé). Les clients utilisent{" "}
                <code className="text-[11px]">http://&lt;IP-LAN&gt;:&lt;port&gt;</code>.
                Par défaut produit : accès distant = tunnel uniquement (pas de choix au
                démarrage).
              </span>
            </label>
          </details>
        )}

        {mode === "remote" && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground" htmlFor="remote-url">
              URL du serveur (tunnel ou LAN)
            </label>
            <Input
              id="remote-url"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://cabinet.creez.io ou http://192.168.1.10:18790"
              spellCheck={false}
              autoComplete="off"
            />
            {testMsg && (
              <p className="text-xs text-muted-foreground">{testMsg}</p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testing || !remoteUrl.trim()}
              onClick={() => void onTest()}
            >
              {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Tester la connexion
            </Button>
          </div>
        )}

        {isRemoteSession && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Mode distant : tunnel, clés IA serveur, réindexation Meili et remise à zéro
            usine concernent uniquement le PC hôte.
          </p>
        )}

        <Button type="button" disabled={saving} onClick={() => void onApply()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Enregistrer et redémarrer
        </Button>
      </CardContent>
    </Card>
  );
}

/** Masque les réglages réservés à l'hôte local quand on est en client distant. */
export function useIsRemoteDesktopClient(): boolean {
  const [remote, setRemote] = useState(false);
  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getConnectionProfile) return;
    void api.getConnectionProfile().then((p: { mode: string }) => setRemote(p.mode === "remote"));
  }, []);
  return remote;
}
