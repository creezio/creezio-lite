"use client";

import { getShellDesktopApi, getShellUiBrand } from "@creezio/shell-ui";

/**
 * Compte local desktop : identifiant + changement de mot de passe
 * (écrit local-config + redémarre Next, comme BYOK).
 */

import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserRound } from "lucide-react";
import { Button } from "../primitives/button";
import { Input } from "../primitives/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../primitives/card";

export function AccountSettings() {
  const [desktop, setDesktop] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = getShellDesktopApi();
    if (!api?.getAccount) {
      // Hors desktop : afficher le user session si possible
      void fetch("/api/v1/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { user?: string } | null) => {
          if (d?.user) setUsername(d.user);
        })
        .catch(() => {});
      return;
    }
    setDesktop(true);
    void api.getAccount().then((a: { username: string }) => setUsername(a.username));
  }, []);

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    const api = getShellDesktopApi();
    if (!api?.changePassword) {
      toast.error("Changement de mot de passe disponible dans l'app desktop");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Nouveau mot de passe trop court (min. 6 caractères)");
      return;
    }
    if (newPassword !== newPassword2) {
      toast.error("Les mots de passe ne correspondent pas");
      return;
    }
    setBusy(true);
    try {
      const r = await api.changePassword({ currentPassword, newPassword });
      if (!r.ok) {
        toast.error(r.error || "Échec du changement de mot de passe");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setNewPassword2("");
      toast.success("Mot de passe mis à jour — serveur local redémarré");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4" /> Compte
        </CardTitle>
        <CardDescription>
          Identifiant local de cette installation. Le mot de passe est stocké de façon sécurisée
          sur cet ordinateur.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-1 text-[13px] font-medium text-slate-700">Identifiant</p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
            {username || "—"}
          </p>
        </div>
        {desktop ? (
          <form onSubmit={(e) => void onChangePassword(e)} className="space-y-3">
            <p className="text-[13px] font-medium text-slate-700">Changer le mot de passe</p>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Mot de passe actuel"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={busy}
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Nouveau mot de passe"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={busy}
            />
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="Confirmer le nouveau mot de passe"
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
              required
              disabled={busy}
            />
            <Button type="submit" disabled={busy} variant="outline">
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Mise à jour…
                </>
              ) : (
                "Enregistrer le mot de passe"
              )}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            Le changement de mot de passe se fait dans l&apos;application desktop.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
