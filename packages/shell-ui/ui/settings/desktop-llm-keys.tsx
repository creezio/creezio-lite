"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * BYOK (Bring Your Own Key) — app desktop uniquement.
 *
 * Mode local mono-client : BYOK strict. Sans clé OpenAI utilisateur
 * l'assistant est désactivé. Aucune clé éditeur n'est packagée ni injectée.
 * Après enregistrement : Next + Hermes sont redémarrés pour injecter OPENAI/ANTHROPIC.
 * Rendu null hors app desktop (getShellDesktopApi() absent).
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { ServerLlmKeysCard } from "./server-mode-cards";

type Provider = "openai" | "anthropic";

type LlmStatus = {
  openai: boolean;
  anthropic: boolean;
  serverOpenAi: boolean;
  serverAnthropic: boolean;
  assistantReady: boolean;
  restarting: boolean;
};

const LABELS: Record<Provider, { name: string; placeholder: string; required: boolean }> = {
  openai: { name: "OpenAI", placeholder: "sk-…", required: true },
  anthropic: { name: "Anthropic (optionnel)", placeholder: "sk-ant-…", required: false },
};

function statusLabel(stored: boolean, active: boolean): string {
  if (stored && active) return "active";
  if (stored && !active) return "enregistrée — activation…";
  return "non configuré";
}

export function DesktopLlmKeys() {
  const [desktop, setDesktop] = useState(false);
  const [status, setStatus] = useState<LlmStatus>({
    openai: false,
    anthropic: false,
    serverOpenAi: false,
    serverAnthropic: false,
    assistantReady: false,
    restarting: false,
  });
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ openai: "", anthropic: "" });
  const [saving, setSaving] = useState<Provider | null>(null);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api) return;
    setDesktop(true);
    void api.getLlmKeyStatus().then(setStatus);
    const unsub = api.onLlmStatusChanged?.(setStatus);
    return () => unsub?.();
  }, []);

  // Web (serveur headless) : GET/PUT /api/v1/platform/llm-keys (owner).
  if (!desktop) return <ServerLlmKeysCard />;

  async function save(provider: Provider) {
    const api = getShellDesktopApi();
    if (!api) return;
    const key = drafts[provider].trim();
    setSaving(provider);
    try {
      const result = await api.setLlmKey(provider, key || null);
      setStatus(result.status);
      setDrafts((d) => ({ ...d, [provider]: "" }));
      if (!result.ok) {
        toast.error(
          result.error ||
            `Clé ${LABELS[provider].name} enregistrée, mais le serveur n'a pas pu redémarrer.`,
        );
        return;
      }
      if (provider === "openai") {
        toast.success(
          key
            ? result.status.assistantReady
              ? "Clé OpenAI active — l'assistant est prêt."
              : "Clé OpenAI enregistrée."
            : "Clé OpenAI supprimée — assistant désactivé.",
        );
      } else {
        toast.success(
          key
            ? "Clé Anthropic active (fallback quota OpenAI)."
            : "Clé Anthropic supprimée.",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur d'enregistrement de la clé");
    } finally {
      setSaving(null);
      try {
        setStatus(await api.getLlmKeyStatus());
      } catch {
        /* ignore */
      }
    }
  }

  const bannerClass = status.restarting
    ? "rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
    : status.assistantReady
      ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
      : "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900";

  const bannerText = status.restarting
    ? "Assistant : activation en cours (redémarrage du serveur local)…"
    : status.assistantReady
      ? "Assistant : prêt (clé OpenAI active côté serveur)"
      : status.openai && !status.serverOpenAi
        ? "Assistant : clé OpenAI enregistrée mais pas encore active — relancez l'enregistrement ou redémarrez Creezio."
        : "Assistant : désactivé — clé OpenAI requise (BYOK)";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Clés IA (Bring Your Own Key)
        </CardTitle>
        <CardDescription>
          Une clé OpenAI est obligatoire pour l&apos;assistant et Hermes. Anthropic est optionnel
          (secours si quota OpenAI). Les clés sont chiffrées sur cet ordinateur et ne sont jamais
          envoyées ailleurs que chez le fournisseur du modèle. Après enregistrement, l&apos;app
          redémarre le serveur local et Hermes pour propager les clés.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={bannerClass}>{bannerText}</p>
        {(Object.keys(LABELS) as Provider[]).map((provider) => {
          const stored = status[provider];
          const active = provider === "openai" ? status.serverOpenAi : status.serverAnthropic;
          const busy = saving === provider || status.restarting;
          return (
            <div key={provider} className="flex items-center gap-2">
              <span className="w-44 shrink-0 text-sm">
                {LABELS[provider].name}
                {LABELS[provider].required ? (
                  <span className="ml-1 text-xs text-amber-700">requis</span>
                ) : null}
                <span
                  className={
                    stored && active
                      ? "ml-1 text-xs text-emerald-600"
                      : "ml-1 text-xs text-muted-foreground"
                  }
                >
                  ({statusLabel(stored, active)})
                </span>
              </span>
              <Input
                type="password"
                value={drafts[provider]}
                onChange={(e) => setDrafts((d) => ({ ...d, [provider]: e.target.value }))}
                placeholder={stored ? "•••••• (remplacer)" : LABELS[provider].placeholder}
                className="flex-1"
                disabled={busy}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void save(provider)}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : drafts[provider].trim() ? (
                  "Enregistrer"
                ) : stored ? (
                  "Supprimer"
                ) : (
                  "Enregistrer"
                )}
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
