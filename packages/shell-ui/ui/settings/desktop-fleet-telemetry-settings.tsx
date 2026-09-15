"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Configuration → Support & télémétrie — consentement granulaire flotte.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Shield } from "lucide-react";
import { Button } from "../primitives/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { Label } from "../primitives/label";
import { ServerOperatorNotice } from "./server-mode-cards";

type FleetScopeId =
  | "heartbeat"
  | "crashes"
  | "ops"
  | "sessions"
  | "users"
  | "request_logs"
  | "hermes_stats"
  | "hermes_chats"
  | "assistant_chats"
  | "plugins"
  | "actions"
  | "remote_commands";

type FleetTelemetryConfig = {
  enabled: boolean;
  scopes: Record<FleetScopeId, boolean>;
  consentAt: string | null;
  consentVersion: number;
};

const SCOPE_META: Array<{
  id: FleetScopeId;
  label: string;
  detail: string;
  sensitive?: boolean;
}> = [
  {
    id: "heartbeat",
    label: "Présence & santé",
    detail: "Online, version, slug, état des services locaux",
  },
  {
    id: "crashes",
    label: "Incidents / crashes",
    detail: "Rapports de crash vers le cockpit support",
  },
  {
    id: "ops",
    label: "Boîte noire (boot & logs)",
    detail: "Décisions de boot, durées, anomalies + tail du log principal — redacté",
  },
  {
    id: "sessions",
    label: "Sessions collaborateurs",
    detail: "Qui est connecté (jamais les mots de passe)",
  },
  {
    id: "users",
    label: "Comptes locaux",
    detail: "Liste users + rôles — pas de secrets / recovery",
  },
  {
    id: "request_logs",
    label: "Logs API / MCP",
    detail: "Échantillon redacté (Authorization / BYOK masqués)",
  },
  {
    id: "hermes_stats",
    label: "Hermes — stats",
    detail: "Compteurs appels / erreurs / latence",
  },
  {
    id: "hermes_chats",
    label: "Hermes — contenu des chats",
    detail: "Messages Work / sessions Hermes",
    sensitive: true,
  },
  {
    id: "assistant_chats",
    label: "Assistant in-app — chats",
    detail: "Conversations assistant",
    sensitive: true,
  },
  {
    id: "plugins",
    label: "Plugins",
    detail: "Inventaire manifest + état",
  },
  {
    id: "actions",
    label: "Journal d’actions",
    detail: "Événements UI / commandes métier agrégés",
  },
  {
    id: "remote_commands",
    label: "Accepter le pilotage distant",
    detail: "Allowlist : update-check, restart embed, envoi diagnostics (pas de shell)",
  },
];

export function DesktopFleetTelemetrySettings() {
  const [desktop, setDesktop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<FleetTelemetryConfig | null>(null);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getFleetTelemetry) return;
    try {
      setCfg(await api.getFleetTelemetry());
    } catch {
      // Client distant : canal host-only refusé — la section est masquée
      // par HostOnlySettings, ne pas laisser un rejet non catché au montage.
    }
  }, []);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getFleetTelemetry) {
      setLoading(false);
      return;
    }
    setDesktop(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function apply(patch: {
    enabled?: boolean;
    scopes?: Partial<Record<FleetScopeId, boolean>>;
    preset?: "basic" | "off" | "keep";
  }) {
    const api = getShellDesktopApi();
    if (!api?.setFleetTelemetry) return;
    setBusy(true);
    try {
      const next = await api.setFleetTelemetry(patch);
      setCfg(next);
      toast.success("Préférences télémétrie enregistrées");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec enregistrement");
    } finally {
      setBusy(false);
    }
  }

  async function onScope(id: FleetScopeId, value: boolean) {
    const meta = SCOPE_META.find((m) => m.id === id);
    if (value && meta?.sensitive) {
      const ok = window.confirm(
        "Je comprends que le contenu des conversations sera visible par le support Creezio.",
      );
      if (!ok) return;
    }
    await apply({ scopes: { [id]: value } });
  }

  // Web (serveur headless) : consentement posé par l'opérateur de l'instance.
  if (!desktop) return <ServerOperatorNotice label="la télémétrie support" />;
  if (loading || !cfg) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4" />
          Support & télémétrie
        </CardTitle>
        <CardDescription>
          Partage optionnel avec Creezio Support. Tout est désactivé par défaut.
          Les secrets (clés IA, JWT, tokens tunnel, mots de passe) ne sont jamais
          envoyés.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <label className="flex cursor-pointer items-start justify-between gap-4 rounded-md border px-3 py-3">
          <div className="space-y-1">
            <Label className="text-sm font-medium">
              Partager des données avec Creezio Support
            </Label>
            <p className="text-xs text-muted-foreground">
              {cfg.enabled
                ? cfg.consentAt
                  ? `Actif depuis ${new Date(cfg.consentAt).toLocaleString("fr-FR")}`
                  : "Actif"
                : "Aucun envoi vers le cockpit flotte tant que c’est désactivé"}
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={cfg.enabled}
            disabled={busy}
            onChange={(e) => void apply({ enabled: e.target.checked })}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void apply({ preset: "basic" })}
          >
            Activer le support basique
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void apply({ preset: "off" })}
          >
            Tout désactiver
          </Button>
        </div>

        <div
          className={`space-y-3 ${cfg.enabled ? "" : "pointer-events-none opacity-50"}`}
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Catégories
          </p>
          {SCOPE_META.map((m) => (
            <label
              key={m.id}
              className="flex cursor-pointer items-start justify-between gap-4 border-b border-border/60 pb-3 last:border-0"
            >
              <div className="min-w-0 space-y-0.5">
                <span className="text-sm font-medium">
                  {m.label}
                  {m.sensitive ? (
                    <span className="ml-2 text-[10px] font-normal uppercase text-amber-700">
                      sensible
                    </span>
                  ) : null}
                </span>
                <p className="text-xs text-muted-foreground">{m.detail}</p>
              </div>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={cfg.scopes[m.id] === true}
                disabled={busy || !cfg.enabled}
                onChange={(e) => void onScope(m.id, e.target.checked)}
              />
            </label>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
