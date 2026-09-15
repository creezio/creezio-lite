"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { getShellDesktopApi } from "@creezio/shell-ui";
import { Button, Input, Label, isRemoteDesktopClient } from "@creezio/shell-ui/ui/kit";

type Mode = "login" | "recover" | "factory";

export type LoginFormProps = {
  /** Redirect par défaut après login (défaut /dashboard). */
  defaultRedirect?: string;
  /** Endpoint login (défaut /api/v1/auth/login). */
  loginPath?: string;
  /**
   * Masquer recovery/factory sur client distant (défaut true).
   * feature-off historique montrait toujours si bridge présent — préférer true.
   */
  hideLocalRecoveryOnRemote?: boolean;
};

const inputClass =
  "h-11 rounded-lg bg-white text-[15px] shadow-none transition-shadow focus-visible:ring-2 focus-visible:ring-sky-500/70 focus-visible:border-sky-500";

/** Bordure rouge quand le formulaire est en erreur (l'attribut aria-invalid
 *  reste posé pour l'a11y ; la variante aria-[] avec guillemets n'est pas
 *  extraite par Tailwind — d'où la classe conditionnelle). */
function fieldClass(invalid: boolean): string {
  return invalid ? `${inputClass} border-red-400 bg-red-50/40` : inputClass;
}

/**
 * Formulaire login / recovery / factory-reset.
 * Bridge desktop via configureShellUiBrand({ desktopApiGlobal }) — jamais un nom marque.
 * Présentation split-screen : LoginPage (même package) enveloppe ce formulaire.
 */
export function LoginForm(props: LoginFormProps = {}) {
  const {
    defaultRedirect = "/dashboard",
    loginPath = "/api/v1/auth/login",
    hideLocalRecoveryOnRemote = true,
  } = props;
  const router = useRouter();
  const sp = useSearchParams();
  const uid = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [factoryConfirm, setFactoryConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const api = getShellDesktopApi();
    const hasApi = Boolean(api?.recoverPassword || api?.factoryReset);
    if (!hasApi) return;
    if (!hideLocalRecoveryOnRemote) {
      setDesktop(true);
      return;
    }
    // Client distant : le compte vit sur le serveur — recovery/factory locaux masqués.
    void isRemoteDesktopClient().then((remote) => setDesktop(!remote));
  }, [hideLocalRecoveryOnRemote]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(loginPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Échec connexion");
        return;
      }
      try {
        await getShellDesktopApi()?.setStayLoggedIn?.(stayLoggedIn);
      } catch {
        /* hors desktop */
      }
      const next = sp.get("next");
      router.push(!next || next === "/" ? defaultRedirect : next);
    } catch {
      setError("Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  async function onRecover(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const api = getShellDesktopApi();
    if (!api?.recoverPassword) {
      setError("Récupération disponible uniquement dans l'application desktop.");
      setLoading(false);
      return;
    }
    if (newPassword.length < 6) {
      setError("Nouveau mot de passe trop court (min. 6 caractères).");
      setLoading(false);
      return;
    }
    if (newPassword !== newPassword2) {
      setError("Les mots de passe ne correspondent pas.");
      setLoading(false);
      return;
    }
    try {
      const r = await api.recoverPassword({ recoveryKey, newPassword });
      if (!r.ok) {
        setError(r.error || "Échec de la récupération");
        return;
      }
      setUsername(r.username || "");
      setPassword("");
      setRecoveryKey("");
      setNewPassword("");
      setNewPassword2("");
      setMode("login");
      setInfo(
        "Mot de passe réinitialisé. Connectez-vous avec le nouveau mot de passe.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function onFactoryReset(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const api = getShellDesktopApi();
    if (!api?.factoryReset) {
      setError("Remise à zéro disponible uniquement dans l'application desktop.");
      setLoading(false);
      return;
    }
    if (factoryConfirm.trim().toUpperCase() !== "SUPPRIMER") {
      setError("Tapez SUPPRIMER pour confirmer.");
      setLoading(false);
      return;
    }
    try {
      const r = await api.factoryReset();
      if (!r.ok) {
        setError(r.error || "Échec de la remise à zéro");
        setLoading(false);
        return;
      }
      // Le main relance le splash + /setup.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setLoading(false);
    }
  }

  const errorBox = error ? (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{error}</span>
    </p>
  ) : null;

  const backToLogin = (
    <button
      type="button"
      className="w-full rounded-md py-1 text-center text-sm text-slate-500 underline-offset-4 transition-colors hover:text-slate-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
      onClick={() => {
        setMode("login");
        setError(null);
      }}
    >
      Retour à la connexion
    </button>
  );

  if (mode === "recover") {
    return (
      <form onSubmit={(e) => void onRecover(e)} className="space-y-4">
        <p className="text-base font-semibold text-slate-900">
          Récupération du compte
        </p>
        <p className="text-sm leading-relaxed text-slate-500">
          Saisissez la clé de récupération affichée lors de la création du compte,
          puis choisissez un nouveau mot de passe. Les données métier locales ne
          sont pas effacées.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-recovery-key`}>Clé de récupération</Label>
          <Input
            id={`${uid}-recovery-key`}
            type="text"
            autoComplete="off"
            placeholder="A1B2-C3D4-…"
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            required
            disabled={loading}
            className={`${inputClass} font-mono text-sm`}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-new-password`}>Nouveau mot de passe</Label>
          <Input
            id={`${uid}-new-password`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-new-password-2`}>Confirmation</Label>
          <Input
            id={`${uid}-new-password-2`}
            type="password"
            autoComplete="new-password"
            placeholder="Confirmer le nouveau mot de passe"
            value={newPassword2}
            onChange={(e) => setNewPassword2(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        {errorBox}
        <Button
          type="submit"
          className="h-11 w-full rounded-lg text-[15px] font-medium"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Réinitialisation…
            </>
          ) : (
            "Réinitialiser le mot de passe"
          )}
        </Button>
        {backToLogin}
      </form>
    );
  }

  if (mode === "factory") {
    return (
      <form onSubmit={(e) => void onFactoryReset(e)} className="space-y-4">
        <p className="text-base font-semibold text-slate-900">
          Remise à zéro usine
        </p>
        <p className="text-sm leading-relaxed text-slate-500">
          Efface <strong>toutes</strong> les données locales (compte, base, index,
          tunnel token, cookies). Le DNS Cloudflare distant peut rester ; vous
          reconfigurerez un slug au prochain setup.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-factory-confirm`}>
            Tapez SUPPRIMER pour confirmer
          </Label>
          <Input
            id={`${uid}-factory-confirm`}
            type="text"
            placeholder="SUPPRIMER"
            value={factoryConfirm}
            onChange={(e) => setFactoryConfirm(e.target.value)}
            required
            disabled={loading}
            className={inputClass}
          />
        </div>
        {errorBox}
        <Button
          type="submit"
          variant="destructive"
          className="h-11 w-full rounded-lg text-[15px] font-medium"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Effacement…
            </>
          ) : (
            "Tout effacer et repartir de zéro"
          )}
        </Button>
        {backToLogin}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {info ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800"
        >
          {info}
        </p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-username`}>Identifiant</Label>
        <Input
          id={`${uid}-username`}
          type="text"
          autoComplete="username"
          placeholder="vous@exemple.fr"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          disabled={loading}
          aria-invalid={error ? true : undefined}
          className={fieldClass(Boolean(error))}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-password`}>Mot de passe</Label>
        <Input
          id={`${uid}-password`}
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={loading}
          aria-invalid={error ? true : undefined}
          className={fieldClass(Boolean(error))}
        />
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={stayLoggedIn}
          onChange={(e) => setStayLoggedIn(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 accent-sky-600"
        />
        Rester connecté
      </label>
      {errorBox}
      <Button
        type="submit"
        className="h-11 w-full rounded-lg text-[15px] font-medium transition-all"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Connexion…
          </>
        ) : (
          "Se connecter"
        )}
      </Button>
      {desktop ? (
        <div className="space-y-1.5 pt-1 text-center text-sm">
          <button
            type="button"
            className="rounded-md px-1 text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
            onClick={() => {
              setMode("recover");
              setError(null);
              setInfo(null);
            }}
          >
            J&apos;ai oublié mon mot de passe
          </button>
          <div>
            <button
              type="button"
              className="rounded-md px-1 text-xs text-slate-400 underline-offset-4 transition-colors hover:text-slate-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70"
              onClick={() => {
                setMode("factory");
                setError(null);
                setInfo(null);
              }}
            >
              Remise à zéro usine…
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
