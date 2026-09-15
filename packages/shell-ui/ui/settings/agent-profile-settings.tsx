"use client";

/**
 * Profil d'agent Work (D3) — par utilisateur.
 * `company` : Hermes embarqué de l'app Serveur (skills creezio-*).
 * `personal` : le Hermes personnel de l'utilisateur (URL + clé API),
 * utilisé à la place du moteur entreprise pour SES sessions Work.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, KeyRound } from "lucide-react";
import { Button } from "../primitives/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../primitives/card";
import { Input } from "../primitives/input";
import { Label } from "../primitives/label";
import { aidProps } from "../lib/aid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../primitives/select";

type AgentProfile = {
  kind: "company" | "personal";
  apiUrl: string | null;
  hasKey: boolean;
  incomplete?: boolean;
};

export function AgentProfileSettings() {
  const [loaded, setLoaded] = useState(false);
  const [kind, setKind] = useState<"company" | "personal">("company");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/assistant/agent-profile")
      .then((r) => (r.ok ? (r.json() as Promise<AgentProfile>) : null))
      .then((p) => {
        if (!alive || !p) return;
        setKind(p.kind);
        setApiUrl(p.apiUrl || "");
        setHasKey(p.hasKey);
      })
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/assistant/agent-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          apiUrl,
          // Champ vide = conserver la clé déjà enregistrée.
          ...(apiKey ? { apiKey } : {}),
        }),
      });
      const data = (await res.json()) as AgentProfile & { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Enregistrement impossible");
        return;
      }
      setHasKey(data.hasKey);
      setApiKey("");
      if (data.incomplete) {
        toast.warning(
          "Profil enregistré mais incomplet : sans URL et clé, l'agent de l'entreprise reste utilisé.",
        );
      } else {
        toast.success(
          data.kind === "personal"
            ? "Mode Work → votre agent personnel"
            : "Mode Work → agent de l'entreprise",
        );
      }
    } catch {
      toast.error("Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  return (
    <Card {...aidProps("agent-profile-settings")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4" />
          Agent (mode Work)
        </CardTitle>
        <CardDescription>
          Choisissez quel agent exécute vos missions Work : celui de
          l&apos;entreprise (accès CRM, n8n, modules) ou votre agent Hermes
          personnel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Agent utilisé</Label>
          <Select
            value={kind}
            onValueChange={(v) => setKind(v === "personal" ? "personal" : "company")}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="company">
                Agent de l&apos;entreprise (recommandé)
              </SelectItem>
              <SelectItem value="personal">Mon agent personnel</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === "personal" && (!apiUrl.trim() || (!hasKey && !apiKey)) ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Profil incomplet : renseignez l&apos;URL et la clé API, sinon vos
              missions Work continueront d&apos;utiliser l&apos;agent de
              l&apos;entreprise.
            </span>
          </div>
        ) : null}

        {kind === "personal" ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="space-y-2">
              <Label htmlFor="agent-personal-url">URL de l&apos;API Hermes</Label>
              <Input
                id="agent-personal-url"
                placeholder="https://mon-hermes.exemple.com"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-personal-key" className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                Clé API
              </Label>
              <Input
                id="agent-personal-key"
                type="password"
                placeholder={hasKey ? "•••••••• (enregistrée — laisser vide pour conserver)" : "hermes-…"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Votre agent personnel n&apos;a pas accès aux données Creezio
              (CRM, n8n, modules) : pour ces missions, repassez sur l&apos;agent
              de l&apos;entreprise.
            </p>
          </div>
        ) : null}

        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </CardContent>
    </Card>
  );
}
