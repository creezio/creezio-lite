"use client";

/**
 * Affiche les enfants uniquement en mode serveur local (hôte).
 * En client distant, tunnel / BYOK / reindex / factory-reset sont gérés par
 * l'app Serveur : on affiche un encart explicatif (ou rien) à la place.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ServerCog } from "lucide-react";
import { getShellUiBrand } from "@creezio/shell-ui";
import { getDesktopHostInfo } from "../lib/desktop-host";

/** Encart standard « géré par l'app Serveur » (fallback par défaut). */
export function HostManagedNotice({
  label = "cette section",
}: {
  label?: string;
}) {
  const productName = getShellUiBrand().productName;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      <ServerCog className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
      <div>
        <p className="font-medium text-slate-700">
          Géré par l&apos;app {productName} Server
        </p>
        <p className="mt-1">
          Vous êtes connecté à un serveur distant : {label} se configure sur le
          poste qui héberge le serveur, pas depuis ce client.
        </p>
      </div>
    </div>
  );
}

export function HostOnlySettings({
  children,
  fallback,
}: {
  children: ReactNode;
  /** Affiché à la place des enfants sur un client distant (défaut : encart). */
  fallback?: ReactNode;
}) {
  // null = résolution en cours : ne rien rendre (pas de flash des contrôles
  // host-only avant le masquage, cause de rejets IPC au montage).
  const [host, setHost] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void getDesktopHostInfo().then((info) => {
      if (alive) setHost(info.isHost);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (host === null) return null;
  if (!host) return <>{fallback ?? <HostManagedNotice />}</>;
  return <>{children}</>;
}
