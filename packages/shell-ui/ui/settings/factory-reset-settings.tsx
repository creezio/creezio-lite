"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Remise à zéro usine — Configuration desktop.
 * Efface compte, DB, Meili, uploads, tunnel token, cookies CRM + sites externes.
 */

import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";
import { ServerOperatorNotice } from "./server-mode-cards";

export function FactoryResetSettings() {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    setDesktop(Boolean(getShellDesktopApi()?.factoryReset));
  }, []);

  // Web (serveur headless) : wipe = opération opérateur (backup + recreate).
  if (!desktop)
    return <ServerOperatorNotice label="la remise à zéro usine" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (confirm.trim().toUpperCase() !== "SUPPRIMER") {
      toast.error('Tapez SUPPRIMER pour confirmer');
      return;
    }
    const api = getShellDesktopApi();
    if (!api?.factoryReset) return;
    setBusy(true);
    try {
      const r = await api.factoryReset();
      if (!r.ok) {
        toast.error(r.error || "Échec de la remise à zéro");
        setBusy(false);
        return;
      }
      toast.success("Remise à zéro en cours…");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setBusy(false);
    }
  }

  return (
    <Card className="border-rose-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-rose-700">
          <AlertTriangle className="h-4 w-4" /> Remise à zéro usine
        </CardTitle>
        <CardDescription>
          Efface toutes les données locales de cet ordinateur (compte, base catalogue/métier,
          index Meili, uploads, token tunnel, cookies CRM et sessions sites externes), puis relance
          le wizard de premier lancement. Le DNS Cloudflare distant peut rester — vous
          re-réservez un slug au setup.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
          <Input
            type="text"
            placeholder='Tapez SUPPRIMER'
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" variant="destructive" disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Effacement…
              </>
            ) : (
              "Tout effacer et repartir de zéro"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
