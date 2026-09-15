"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Panneau variables d’environnement pour n8n / Hermes.
 * - Locked : visibles, non éditables (OS Creezio)
 * - Editables + custom : persistées via embed-env:set, puis redémarrage du service
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { LockedConfigField } from "./locked-config-field";

type EmbedService = "n8n" | "hermes";

type EnvVar = {
  key: string;
  label: string;
  hint?: string;
  locked: boolean;
  value: string;
  kind?: "string" | "boolean" | "number";
  custom?: boolean;
};

export function DesktopEmbedEnvPanel(props: { service: EmbedService }) {
  const [desktop, setDesktop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locked, setLocked] = useState<EnvVar[]>([]);
  const [editable, setEditable] = useState<EnvVar[]>([]);
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");

  const applyPanel = useCallback((vars: EnvVar[]) => {
    setLocked(vars.filter((v) => v.locked));
    setEditable(
      vars
        .filter((v) => !v.locked)
        .map((v) => ({ ...v, value: v.value ?? "" })),
    );
  }, []);

  const refresh = useCallback(async () => {
    const api = getShellDesktopApi();
    if (!api?.getEmbedEnv) return;
    setLoading(true);
    try {
      const panel = await api.getEmbedEnv(props.service);
      applyPanel(panel.vars as EnvVar[]);
    } finally {
      setLoading(false);
    }
  }, [applyPanel, props.service]);

  useEffect(() => {
    if (!getShellDesktopApi()?.getEmbedEnv) return;
    setDesktop(true);
    void refresh();
  }, [refresh]);

  function setEditableValue(key: string, value: string) {
    setEditable((prev) =>
      prev.map((v) => (v.key === key ? { ...v, value } : v)),
    );
  }

  function removeCustom(key: string) {
    setEditable((prev) => prev.filter((v) => !(v.custom && v.key === key)));
  }

  function addCustom() {
    const key = customKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      toast.error("Nom de variable invalide (A-Z, 0-9, _)");
      return;
    }
    if (locked.some((v) => v.key.toUpperCase() === key.toUpperCase())) {
      toast.error("Cette clé est verrouillée par Creezio");
      return;
    }
    if (editable.some((v) => v.key.toUpperCase() === key.toUpperCase())) {
      toast.error("Variable déjà présente");
      return;
    }
    setEditable((prev) => [
      ...prev,
      {
        key,
        label: key,
        value: customValue,
        locked: false,
        custom: true,
        kind: "string",
      },
    ]);
    setCustomKey("");
    setCustomValue("");
  }

  async function onSave() {
    const api = getShellDesktopApi();
    if (!api?.setEmbedEnv) return;
    setSaving(true);
    try {
      const values: Record<string, string> = {};
      for (const v of editable) {
        const val = String(v.value ?? "").trim();
        if (val !== "") values[v.key] = val;
      }
      const r = await api.setEmbedEnv(props.service, values);
      applyPanel(r.panel.vars as EnvVar[]);
      toast.success(r.detail || "Enregistré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur enregistrement");
    } finally {
      setSaving(false);
    }
  }

  if (!desktop) return null;

  return (
    <div className="space-y-4 border-t border-slate-200 pt-4">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Variables d’environnement
        </div>
        <p className="text-[11px] leading-snug text-slate-500">
          Les clés OS Creezio (tunnel, ports, sandbox) sont visibles mais
          verrouillées. Les autres sont éditables et appliquées au prochain
          démarrage du service (redémarrage automatique à l’enregistrement).
        </p>
      </div>

      {loading ? (
        <div className="inline-flex items-center gap-2 text-sm text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Chargement des
          variables…
        </div>
      ) : (
        <>
          {locked.length > 0 ? (
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">
                Verrouillées (OS)
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {locked.map((v) => (
                  <LockedConfigField
                    key={v.key}
                    label={`${v.label} (${v.key})`}
                    value={v.value || "—"}
                    hint={v.hint}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <div className="mb-2 text-xs font-medium text-slate-500">
              Éditables
            </div>
            <div className="space-y-2">
              {editable.map((v) => (
                <div
                  key={v.key}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-700">
                        {v.label}
                        <span className="ml-1 font-mono text-[11px] text-slate-400">
                          {v.key}
                        </span>
                      </div>
                      {v.hint ? (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {v.hint}
                        </div>
                      ) : null}
                    </div>
                    {v.custom ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 px-2"
                        onClick={() => removeCustom(v.key)}
                        aria-label={`Supprimer ${v.key}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    className="mt-1.5 font-mono text-xs"
                    value={v.value}
                    onChange={(e) => setEditableValue(v.key, e.target.value)}
                    placeholder={v.kind === "boolean" ? "true | false" : ""}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-dashed border-slate-300 px-3 py-2">
            <div className="mb-2 text-xs font-medium text-slate-600">
              Ajouter une variable
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="font-mono text-xs sm:max-w-[220px]"
                placeholder="NOM_VARIABLE"
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
              />
              <Input
                className="font-mono text-xs"
                placeholder="valeur"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addCustom}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Ajouter
              </Button>
            </div>
          </div>

          <Button
            size="sm"
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            Enregistrer et redémarrer
          </Button>
        </>
      )}
    </div>
  );
}
